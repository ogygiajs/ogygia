/**
 * REMOTE IMAGES AT REQUEST: `remoteImage(entry.coverUrl, { width, height })` in a server load names
 * an image whose URL the app learns only when the page is asked for (a CMS entry). It is a
 * descriptor like any other; the files are made from the URL's bytes:
 *
 * - on a live server and in dev, by the image endpoint, which fetches the URL (its tail
 *   `.remote/<URL>` is signed with the recipe, so it fetches no other) under
 *   `image({ remote: { hosts, maxBytes, timeout } })`, and answers each file to be kept
 *   `remote.maxAge` seconds, never forever: the bytes behind a URL can change;
 * - in a prerender, by the build, which fetches it the same way and names each file by the bytes it
 *   got, so a URL whose bytes change gets new file names in the next build;
 * - with an encoder's own links (`cloudflare()`, `vercel()`), by the CDN, from the URL.
 *
 * Browser-safe: it reads nothing but its arguments.
 *
 * @packageDocumentation
 */
import type { ImageDescriptor, ImageFormat } from './descriptor.ts';
import { FRAME_PIXELS_MAX, SIDE_MAX } from './recipe.ts';
import { RenderError } from './render-messages.ts';
import { sha256 } from './sha256.ts';
import { ENCODER_VERSION } from './source-id.ts';

/** What `remoteImage()` takes besides the URL. */
export interface RemoteImageOptions {
	/** The image's width, in pixels (the CMS's own). */
	width: number;
	/** The image's height, in pixels. */
	height: number;
	/** Alt text the image carries. */
	alt?: string;
	/** Changes when the bytes behind the URL do (a CMS revision): another version is another
	 *  source, with files of its own. */
	version?: string | number;
}

const FORMAT_OF_EXT: ReadonlyMap<string, ImageFormat> = new Map([
	['jpg', 'jpeg'],
	['jpeg', 'jpeg'],
	['png', 'png'],
	['webp', 'webp'],
	['avif', 'avif'],
	['gif', 'gif'],
	['tif', 'tiff'],
	['tiff', 'tiff']
]);
const EXT_RE = /\.([a-z0-9]+)$/i;
const ID_LENGTH = 32;

function invalid(key: string, value: unknown, want: string): never {
	throw new RenderError('image_remote_invalid', {
		key,
		value: JSON.stringify(value) ?? String(value),
		want
	});
}

function side(key: 'width' | 'height', value: unknown): number {
	if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > SIDE_MAX)
		invalid(key, value, `a whole number of pixels from 1 to ${SIDE_MAX}`);
	return value as number;
}

function b64url(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The id of the remote source at `href`, at `version`: `r` and a hash of both. */
export function remote_id(href: string, version: string | number | undefined): string {
	const text = `${href}\0${version === undefined ? '' : String(version)}\0encoder ${ENCODER_VERSION}`;
	return `r${b64url(sha256(new TextEncoder().encode(text))).slice(0, ID_LENGTH)}`;
}

/**
 * An image known only at request, by its URL: a descriptor for `<Img>` and `getImage()`. `width`
 * and `height` are the image's own (the page reserves its box from them); its format is read from
 * the URL's extension (JPEG when it names none). It has no placeholder. The URL's host must be in
 * `image({ remote: { hosts } })`: one it does not list gets no encoder link (the CDN would fetch
 * it), only the endpoint's URL, which answers 404 and says why (`image_remote_refused`).
 */
export function remoteImage(url: string, options: RemoteImageOptions): ImageDescriptor {
	let at: URL | null = null;
	if (typeof url === 'string')
		try {
			at = new URL(url);
			// oxlint-disable-next-line ogygia/no-silent-failures -- a URL that does not parse is refused just below, with what it must be
		} catch {}
	if (
		at === null ||
		(at.protocol !== 'https:' && at.protocol !== 'http:') ||
		at.username ||
		at.password
	)
		invalid('url', url, 'an https:// or http:// URL with no user or password in it');
	if (options === null || typeof options !== 'object')
		invalid('options', options, 'an object with the width and height');
	const width = side('width', options.width);
	const height = side('height', options.height);
	if (width * height > FRAME_PIXELS_MAX)
		invalid(
			'width',
			options.width,
			`a box of at most ${FRAME_PIXELS_MAX} pixels with the height (${height}): no image file has more`
		);
	if (options.alt !== undefined && typeof options.alt !== 'string')
		invalid('alt', options.alt, 'a string');
	const { version } = options;
	if (
		version !== undefined &&
		typeof version !== 'string' &&
		!(typeof version === 'number' && Number.isFinite(version))
	)
		invalid('version', version, 'a string or a number');
	const ext = EXT_RE.exec(at.pathname)?.[1]?.toLowerCase();
	return {
		id: remote_id(at.href, version),
		src: at.href,
		width,
		height,
		format: (ext !== undefined && FORMAT_OF_EXT.get(ext)) || 'jpeg',
		from: 'remote',
		...(options.alt !== undefined ? { alt: options.alt } : {})
	};
}
