/**
 * THE IMAGES A CARD DRAWS. satori would fetch every `<img src>`, SVG `<image href>` and `url()` a
 * card's markup names with the global `fetch`: any address, no size cap, no time limit. So before
 * satori runs, every address the markup names (each `src`, an SVG element's `href` and
 * `xlink:href`, and each `url()` in a style or an attribute; a `#…` reference names a part of the
 * card itself) is read by the card's realm, fitted to the card (./fit.ts) and handed over as bytes
 * ogygia read itself: an `<img>`'s as an `ArrayBuffer`, any other as a `data:` URL. A link's `href`
 * (an `<a>` outside any SVG) names no image and is left out of the tree satori draws. Each one is:
 *
 * - an asset of the build (a root-relative URL, or one under `paths.assets`): its bytes, read the
 *   way the image endpoint reads an original;
 * - an `http(s)` URL: fetched through the same guard as `remoteImage()` (`image({ remote })`'s
 *   hosts, the public-address rule for `*.` hosts, `maxBytes`, `timeout`);
 * - a `data:` URL: its bytes, when they are a PNG, JPEG, GIF, WebP or AVIF (an SVG can name
 *   addresses of its own);
 * - anything else, or bytes that are no PNG, JPEG, GIF, WebP or AVIF: `image_card_source`.
 *
 * Then the tree is checked whole, once, right before satori ({@link drawable}): every address left
 * in it is bytes, a `data:` URL of a raster type or a `#` reference, or the card is refused. The
 * guard is closed by that check, not by reading CSS the way satori does.
 *
 * @packageDocumentation
 */
import { OgygiaError } from '../messages.ts';
import { source_tail } from '../recipe.ts';

/** How a card's realm reads one image its markup names, by the URL the markup wrote. */
export type CardImageRead = (src: string) => Promise<Uint8Array>;

/** How a card's images are fitted to it before the draw: the bytes satori is handed and their
 *  type, or a throw saying why the image cannot be drawn. */
export type CardImageFit = (bytes: Uint8Array) => Promise<{ bytes: Uint8Array; type: string }>;

/** The reader of a realm that reads no image: every one is refused. */
export const no_images: CardImageRead = () =>
	Promise.reject(new Error('this card is drawn with no image reader'));

/** A realm's reader: `local` reads an asset of the build by its tail (and the URL as written),
 *  `remote` fetches a URL through `image({ remote })`'s guard (null: no `remote` is set). */
export function card_image_reader(
	prefixes: readonly string[],
	local: (tail: string, src: string) => Promise<Uint8Array>,
	remote: ((url: URL) => Promise<Uint8Array>) | null
): CardImageRead {
	return (src) => {
		const own = prefixes.some((p) => p !== '' && src.startsWith(`${p}/`));
		if (own || (src.startsWith('/') && !src.startsWith('//')))
			return local(source_tail(src, prefixes), src);
		let url: URL | null = null;
		try {
			url = new URL(src);
			// oxlint-disable-next-line ogygia/no-silent-failures -- a src that is no absolute URL is refused just below, saying what it must be
		} catch {}
		if (url === null || (url.protocol !== 'https:' && url.protocol !== 'http:'))
			return Promise.reject(
				new Error('it is no asset URL of this build (root-relative) and no http(s) URL')
			);
		if (remote === null)
			return Promise.reject(new Error('image({ remote }) is not set, so a card fetches no URL'));
		return remote(url);
	};
}

type Node = { type?: unknown; props?: { [prop: string]: unknown } };

const URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
const URL_OPEN_RE = /url\(/gi;
const SAFE_AFTER_OPEN_RE = /^\s*['"]?\s*(?:data:|#|['"]?\s*\))/i;
const HREF_PROPS: ReadonlySet<string> = new Set(['href', 'xlinkHref', 'xlink:href']);
const SVG_DATA_RE = /^\s*data:\s*image\/svg/i;

function is_ref(src: string): boolean {
	return src.trim() === '' || src.startsWith('#');
}

/** What one prop of an element is to the guard: an address to read, a string whose `url()`s are,
 *  a link to leave out, or something else. */
function prop_kind(key: string, in_svg: boolean): 'address' | 'link' | 'text' {
	if (key === 'src') return 'address';
	if (HREF_PROPS.has(key)) return in_svg ? 'address' : 'link';
	return 'text';
}

/** One walk of the tree for both passes: `each` gets every address with where it sits, and the
 *  tree comes back rebuilt from what `each` answers (a link left out). */
function walk(
	node: unknown,
	in_svg: boolean,
	each: (src: string, where: 'img' | 'other') => unknown
): unknown {
	if (Array.isArray(node)) return node.map((n) => walk(n, in_svg, each));
	if (node === null || typeof node !== 'object') return node;
	const { type, props } = node as Node;
	if (props === undefined) return node;
	const svg = in_svg || type === 'svg';
	const text = (value: string): string =>
		value.includes('url(')
			? value.replace(URL_RE, (whole, _q: string, src: string) =>
					is_ref(src) ? whole : `url(${String(each(src, 'other'))})`
				)
			: value;
	const next: { [prop: string]: unknown } = {};
	for (const [key, value] of Object.entries(props)) {
		if (key === 'children') next[key] = walk(value, svg, each);
		else if (typeof value === 'string') {
			const kind = prop_kind(key, svg);
			if (kind === 'link') continue;
			next[key] =
				kind === 'address' && !is_ref(value)
					? each(value, type === 'img' && key === 'src' ? 'img' : 'other')
					: text(value);
		} else if (key === 'style' && value !== null && typeof value === 'object')
			next[key] = Object.fromEntries(
				Object.entries(value).map(([k, v]) => [k, typeof v === 'string' ? text(v) : v])
			);
		else next[key] = value;
	}
	return { ...node, props: next };
}

const DATA_RE = /^data:([^,]*?)(;base64)?,(.*)$/is;

function data_bytes(src: string): Uint8Array | null {
	const m = DATA_RE.exec(src);
	if (m === null) return null;
	try {
		return m[2] !== undefined
			? new Uint8Array(Buffer.from(m[3]!, 'base64'))
			: new Uint8Array(Buffer.from(decodeURIComponent(m[3]!), 'utf8'));
		// oxlint-disable-next-line ogygia/no-silent-failures -- a data: URL whose text does not decode is refused by the caller, saying so
	} catch {
		return null;
	}
}

/** The image type `bytes` start like, or null: PNG, JPEG, GIF, WebP, AVIF. */
export function card_image_type(bytes: Uint8Array): string | null {
	const at = (i: number, text: string): boolean => {
		for (let k = 0; k < text.length; k++) if (bytes[i + k] !== text.charCodeAt(k)) return false;
		return true;
	};
	if (at(0, '\x89PNG\r\n\x1a\n')) return 'image/png';
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
	if (at(0, 'GIF87a') || at(0, 'GIF89a')) return 'image/gif';
	if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
	if (at(4, 'ftypavif') || at(4, 'ftypavis')) return 'image/avif';
	return null;
}

function refused(file: string, src: string, reason: string): Error {
	return new OgygiaError('image_card_source', { file, src, reason });
}

/** A failure the realm answers itself (its line is full, a remote host refused): it passes through
 *  a card's draw as it is, for the realm to answer with its own status. */
export class RealmAnswer extends Error {}

/** The image to draw for one address: its bytes as read (or decoded from a `data:` URL), then
 *  fitted. */
async function drawn_image(
	src: string,
	file: string,
	read: CardImageRead,
	fit: CardImageFit
): Promise<{ bytes: Uint8Array; type: string }> {
	let bytes: Uint8Array | null;
	if (src.startsWith('data:')) {
		bytes = data_bytes(src);
		if (bytes === null || card_image_type(bytes) === null)
			throw refused(file, src.slice(0, 64), 'its data is no PNG, JPEG, GIF, WebP or AVIF');
	} else
		try {
			bytes = await read(src);
		} catch (e) {
			if (e instanceof RealmAnswer) throw e;
			const code = (e as { code?: unknown }).code;
			if (typeof code === 'string' && code.startsWith('image_')) throw e;
			throw refused(file, src, (e as Error).message);
		}
	try {
		return await fit(bytes);
	} catch (e) {
		const code = (e as { code?: unknown }).code;
		if (typeof code === 'string' && code.startsWith('image_')) throw e;
		throw refused(file, src.startsWith('data:') ? src.slice(0, 64) : src, (e as Error).message);
	}
}

function as_buffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.slice().buffer as ArrayBuffer;
}

/** `tree` with every address it names read by `read`, fitted by `fit` and handed over as bytes
 *  (an `<img src>` as an `ArrayBuffer`, satori keeps no copy of it; any other as a `data:` URL of
 *  the type its bytes are), and every link's `href` outside an SVG left out. A `data:` URL is read
 *  like any address: its bytes must be a PNG, JPEG, GIF, WebP or AVIF (an SVG is refused: it can
 *  name addresses of its own). One `read` cannot read, or `fit` cannot fit, is
 *  `image_card_source`; a coded refusal of the realm's own (such as `image_remote_host` at build)
 *  and a {@link RealmAnswer} stay as they are. */
export async function inline_images<T>(
	tree: T,
	file: string,
	read: CardImageRead,
	fit: CardImageFit
): Promise<T> {
	const srcs = new Set<string>();
	walk(tree, false, (src) => srcs.add(src));
	const data = new Map<string, { bytes: Uint8Array; type: string }>();
	await Promise.all(
		[...srcs].map(async (src) => data.set(src, await drawn_image(src, file, read, fit)))
	);
	return walk(tree, false, (src, where) => {
		const image = data.get(src)!;
		return where === 'img'
			? as_buffer(image.bytes)
			: `data:${image.type};base64,${Buffer.from(image.bytes).toString('base64')}`;
	}) as T;
}

/** Refuse `tree` (`image_card_source`) unless every address left in it is one satori cannot fetch:
 *  an `ArrayBuffer`, a `data:` URL of a raster type, or a `#` reference, in every `src`, `href`,
 *  `xlink:href` and after every `url(` of every string, closed or not. Run on the tree satori is
 *  handed, right before the draw. */
export function drawable(tree: unknown, file: string): void {
	const fail = (src: string, reason: string): never => {
		throw refused(file, src.slice(0, 64), reason);
	};
	const text = (value: string): void => {
		if (!value.toLowerCase().includes('url(')) return;
		for (const m of value.matchAll(URL_OPEN_RE)) {
			const after = value.slice(m.index + m[0].length);
			if (!SAFE_AFTER_OPEN_RE.test(after))
				fail(after, 'a url() here names no image ogygia read (an unclosed url() reads as one)');
			if (SVG_DATA_RE.test(after.replace(/^\s*['"]?/, '')))
				fail(after, 'an SVG can name addresses of its own');
		}
	};
	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const n of node) visit(n);
			return;
		}
		if (node === null || typeof node !== 'object') return;
		const { props } = node as Node;
		if (props === undefined) return;
		for (const [key, value] of Object.entries(props)) {
			if (key === 'children') visit(value);
			else if (key === 'src' || HREF_PROPS.has(key)) {
				if (value instanceof ArrayBuffer) continue;
				if (typeof value !== 'string') fail(String(value), 'it is no address');
				const src = value as string;
				if (is_ref(src)) continue;
				if (!src.startsWith('data:')) fail(src, 'it was not read before the draw');
				if (SVG_DATA_RE.test(src)) fail(src, 'an SVG can name addresses of its own');
			} else if (typeof value === 'string') text(value);
			else if (key === 'style' && value !== null && typeof value === 'object')
				for (const v of Object.values(value)) if (typeof v === 'string') text(v);
		}
	};
	visit(tree);
}
