/**
 * THE IMAGES A CARD DRAWS. satori would fetch every `<img src>`, SVG `<image href>` and `url()` a
 * card's markup names with the global `fetch`: any address, no size cap, no time limit. So before
 * satori runs, every address the markup names, in any element (each `src`, `href` and `xlink:href`,
 * and each `url()` in a style or an attribute; a `#…` reference names a part of the card itself),
 * is read by the card's realm and handed over as a `data:` URL ogygia made itself. A card is an
 * image, so a link's `href` is read as an image too. Each one is:
 *
 * - an asset of the build (a root-relative URL, or one under `paths.assets`): its bytes, read the
 *   way the image endpoint reads an original;
 * - an `http(s)` URL: fetched through the same guard as `remoteImage()` (`image({ remote })`'s
 *   hosts, the public-address rule for `*.` hosts, `maxBytes`, `timeout`);
 * - a `data:` URL: kept, when its bytes are a PNG, JPEG, GIF, WebP or AVIF (an SVG can name
 *   addresses of its own);
 * - anything else, or bytes that are no PNG, JPEG, GIF, WebP or AVIF: `image_card_source`.
 *
 * @packageDocumentation
 */
import { OgygiaError } from '../messages.ts';
import { source_tail } from '../recipe.ts';

/** How a card's realm reads one image its markup names, by the URL the markup wrote. */
export type CardImageRead = (src: string) => Promise<Uint8Array>;

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
const URL_PROPS: ReadonlySet<string> = new Set(['src', 'href', 'xlinkHref', 'xlink:href']);

function is_ref(src: string): boolean {
	return src.trim() === '' || src.startsWith('#');
}

function urls_in(value: string, visit: (src: string) => void): void {
	if (value.includes('url('))
		for (const m of value.matchAll(URL_RE)) if (!is_ref(m[2]!)) visit(m[2]!);
}

function each_src(node: unknown, visit: (src: string) => void): void {
	if (Array.isArray(node)) {
		for (const n of node) each_src(n, visit);
		return;
	}
	if (node === null || typeof node !== 'object') return;
	const { props } = node as Node;
	if (props === undefined) return;
	for (const [key, value] of Object.entries(props)) {
		if (key === 'children') each_src(value, visit);
		else if (typeof value === 'string') {
			if (URL_PROPS.has(key) && !is_ref(value)) visit(value);
			else urls_in(value, visit);
		} else if (key === 'style' && value !== null && typeof value === 'object')
			for (const v of Object.values(value)) if (typeof v === 'string') urls_in(v, visit);
	}
}

function in_data(src: string, data: ReadonlyMap<string, string>): string {
	const url = data.get(src);
	if (url === undefined) throw new Error(`the card image ${src} was not read before the draw`);
	return url;
}

function urls_with_data(value: string, data: ReadonlyMap<string, string>): string {
	return value.includes('url(')
		? value.replace(URL_RE, (whole, _q: string, src: string) =>
				is_ref(src) ? whole : `url(${in_data(src, data)})`
			)
		: value;
}

function with_data(node: unknown, data: ReadonlyMap<string, string>): unknown {
	if (Array.isArray(node)) return node.map((n) => with_data(n, data));
	if (node === null || typeof node !== 'object') return node;
	const { props } = node as Node;
	if (props === undefined) return node;
	const next: { [prop: string]: unknown } = {};
	for (const [key, value] of Object.entries(props)) {
		if (key === 'children') next[key] = with_data(value, data);
		else if (typeof value === 'string')
			next[key] =
				URL_PROPS.has(key) && !is_ref(value) ? in_data(value, data) : urls_with_data(value, data);
		else if (key === 'style' && value !== null && typeof value === 'object')
			next[key] = Object.fromEntries(
				Object.entries(value).map(([k, v]) => [
					k,
					typeof v === 'string' ? urls_with_data(v, data) : v
				])
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

/** `tree` with every address it names (see `each_src`) read by `read` and written as a `data:` URL,
 *  so satori fetches nothing. A `data:` URL stays as it is when its bytes are a PNG, JPEG, GIF, WebP
 *  or AVIF (an SVG is refused: it can name addresses of its own). One `read` cannot read is
 *  `image_card_source`; a coded refusal of the realm's own (such as `image_remote_host` at build)
 *  and a {@link RealmAnswer} stay as they are. */
export async function inline_images<T>(tree: T, file: string, read: CardImageRead): Promise<T> {
	const srcs = new Set<string>();
	each_src(tree, (src) => srcs.add(src));
	if (srcs.size === 0) return tree;
	const data = new Map<string, string>();
	await Promise.all(
		[...srcs].map(async (src) => {
			if (src.startsWith('data:')) {
				const bytes = data_bytes(src);
				if (bytes === null || card_image_type(bytes) === null)
					throw refused(file, src.slice(0, 64), 'its data is no PNG, JPEG, GIF, WebP or AVIF');
				data.set(src, src);
				return;
			}
			let bytes: Uint8Array;
			try {
				bytes = await read(src);
			} catch (e) {
				if (e instanceof RealmAnswer) throw e;
				const code = (e as { code?: unknown }).code;
				if (typeof code === 'string' && code.startsWith('image_')) throw e;
				throw refused(file, src, (e as Error).message);
			}
			const type = card_image_type(bytes);
			if (type === null) throw refused(file, src, 'its bytes are no PNG, JPEG, GIF, WebP or AVIF');
			data.set(src, `data:${type};base64,${Buffer.from(bytes).toString('base64')}`);
		})
	);
	return with_data(tree, data) as T;
}
