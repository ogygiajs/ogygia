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
 * - a `data:` URL: its bytes, when they are a PNG, JPEG, GIF, WebP, AVIF or TIFF (an SVG can name
 *   addresses of its own);
 * - anything else, or bytes that are no PNG, JPEG, GIF, WebP, AVIF or TIFF (the types
 *   `remoteImage()` takes, ../image-type.ts): `image_card_source`.
 *
 * Then the tree is checked whole, once, right before satori ({@link drawable}): every address left
 * in it is bytes or a `data:` URL of a file resvg draws ({@link resvg_draws}), or a `#` reference,
 * or the card is refused. The
 * guard is closed by that check, not by reading CSS the way satori does.
 *
 * @packageDocumentation
 */
import { image_type } from '../image-type.ts';
import { OgygiaError } from '../messages.ts';
import { source_tail } from '../recipe.ts';

/** How a card's realm reads one image its markup names, by the URL the markup wrote. `unfit`, when
 *  the realm keeps a failure memory of its own for the URLs it fetches: the failure a draw throws
 *  when the bytes read for `src` cannot be fitted to the card (undefined, or no `unfit`:
 *  `image_card_source`). */
export interface CardImageRead {
	(src: string): Promise<Uint8Array>;
	unfit?: (src: string, reason: string) => Error | undefined;
}

/** How a card's images are fitted to it before the draw: the bytes satori is handed and their
 *  type, or a throw saying why the image cannot be drawn. */
export type CardImageFit = (bytes: Uint8Array) => Promise<{ bytes: Uint8Array; type: string }>;

/** The reader of a realm that reads no image: every one is refused. */
export const no_images: CardImageRead = () =>
	Promise.reject(new Error('this card is drawn with no image reader'));

function routed(src: string, prefixes: readonly string[]): 'local' | URL | null {
	const own = prefixes.some((p) => p !== '' && src.startsWith(`${p}/`));
	if (own || (src.startsWith('/') && !src.startsWith('//'))) return 'local';
	let url: URL | null = null;
	try {
		url = new URL(src);
		// oxlint-disable-next-line ogygia/no-silent-failures -- a src that is no absolute URL is refused by the reader, saying what it must be
	} catch {}
	return url !== null && (url.protocol === 'https:' || url.protocol === 'http:') ? url : null;
}

/** A realm's reader: `local` reads an asset of the build by its tail (and the URL as written),
 *  `remote` fetches a URL through `image({ remote })`'s guard (null: no `remote` is set), and
 *  `undecoded` is the failure of a fetched URL whose bytes cannot be fitted to the card (null: it
 *  is `image_card_source`). */
export function card_image_reader(
	prefixes: readonly string[],
	local: (tail: string, src: string) => Promise<Uint8Array>,
	remote: ((url: URL) => Promise<Uint8Array>) | null,
	undecoded: ((url: URL, reason: string) => Error) | null = null
): CardImageRead {
	const read: CardImageRead = (src) => {
		const to = routed(src, prefixes);
		if (to === 'local') return local(source_tail(src, prefixes), src);
		if (to === null)
			return Promise.reject(
				new Error('it is no asset URL of this build (root-relative) and no http(s) URL')
			);
		if (remote === null)
			return Promise.reject(new Error('image({ remote }) is not set, so a card fetches no URL'));
		return remote(to);
	};
	if (remote !== null && undecoded !== null)
		read.unfit = (src, reason) => {
			const to = routed(src, prefixes);
			return to instanceof URL ? undecoded(to, reason) : undefined;
		};
	return read;
}

type Node = { type?: unknown; props?: { [prop: string]: unknown } };

const SPACE_RE = /\s/;
const HREF_PROPS: ReadonlySet<string> = new Set(['href', 'xlinkHref', 'xlink:href']);

/** One `url(` in a string: where it starts and ends, the address it names (its quotes taken off),
 *  and whether it is closed (an unclosed one runs to the end of the string). */
export interface UrlSpan {
	start: number;
	end: number;
	src: string;
	closed: boolean;
}

/** Every `url(` in `value` (any case), read one way for the rewrite and for the check before the
 *  draw, so the two cannot disagree: a quoted address ends at its quote and then a `)`, any other
 *  at the first `)`; with no such end the span is unclosed. */
export function url_spans(value: string): UrlSpan[] {
	const spans: UrlSpan[] = [];
	const lower = value.toLowerCase();
	let from = 0;
	for (;;) {
		const start = lower.indexOf('url(', from);
		if (start === -1) return spans;
		let at = start + 4;
		while (at < value.length && SPACE_RE.test(value[at]!)) at++;
		const quote = value[at] === '"' || value[at] === "'" ? value[at]! : '';
		let src: string;
		let close: number;
		if (quote !== '') {
			const shut = value.indexOf(quote, at + 1);
			src = value.slice(at + 1, shut === -1 ? value.length : shut);
			close = shut === -1 ? -1 : shut + 1;
			while (close !== -1 && close < value.length && SPACE_RE.test(value[close]!)) close++;
			if (close !== -1 && value[close] !== ')') close = -1;
		} else {
			close = value.indexOf(')', at);
			src = value.slice(at, close === -1 ? value.length : close).trimEnd();
		}
		const end = close === -1 ? value.length : close + 1;
		spans.push({ start, end, src, closed: close !== -1 });
		from = end;
	}
}

const JPEG_SOF_DRAWN: ReadonlySet<number> = new Set([0xc0, 0xc1, 0xc2]);
const JPEG_NO_LENGTH = (marker: number): boolean =>
	marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);

function jpeg_drawn(bytes: Uint8Array): boolean {
	let at = 2;
	while (at + 3 < bytes.length) {
		if (bytes[at] !== 0xff) return false;
		const marker = bytes[at + 1]!;
		if (marker === 0xff) {
			at += 1;
			continue;
		}
		if (JPEG_NO_LENGTH(marker)) {
			at += 2;
			continue;
		}
		if (marker === 0xda || marker === 0xd9) return false;
		const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			if (at + 9 >= bytes.length) return false;
			const components = bytes[at + 9]!;
			return (
				JPEG_SOF_DRAWN.has(marker) && bytes[at + 4] === 8 && (components === 1 || components === 3)
			);
		}
		at += 2 + length;
	}
	return false;
}

/** Does resvg draw these bytes: a PNG of at most 8 bits a sample, a JPEG of 8 bits in one or three
 *  components (no CMYK) coded as baseline or progressive, or a GIF. These are the only files the
 *  tree satori is handed may hold: satori writes any image it is given into its SVG as it is, and
 *  resvg draws the rest (a WebP, an AVIF, a CMYK JPEG) as nothing, with no error. The card's fitter
 *  makes every other file again as one of these. */
export function resvg_draws(bytes: Uint8Array): boolean {
	const type = image_type(bytes);
	if (type === 'image/gif') return true;
	if (type === 'image/png') return bytes.length > 24 && bytes[24]! <= 8;
	if (type === 'image/jpeg') return jpeg_drawn(bytes);
	return false;
}

function is_ref(src: string): boolean {
	return src.trim() === '' || src.startsWith('#');
}

function prop_kind(key: string, in_svg: boolean): 'address' | 'link' | 'text' {
	if (key === 'src') return 'address';
	if (HREF_PROPS.has(key)) return in_svg ? 'address' : 'link';
	return 'text';
}

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
	const text = (value: string): string => {
		const parts: string[] = [];
		let at = 0;
		for (const span of url_spans(value)) {
			if (!span.closed || is_ref(span.src)) continue;
			parts.push(value.slice(at, span.start), `url(${String(each(span.src, 'other'))})`);
			at = span.end;
		}
		if (at === 0) return value;
		parts.push(value.slice(at));
		return parts.join('');
	};
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

function refused(file: string, src: string, reason: string): Error {
	return new OgygiaError('image_card_source', { file, src, reason });
}

/** A failure the realm answers itself (its line is full, a remote host refused): it passes through
 *  a card's draw as it is, for the realm to answer with its own status. */
export class RealmAnswer extends Error {}

async function drawn_image(
	src: string,
	file: string,
	read: CardImageRead,
	fit: CardImageFit | null
): Promise<{ bytes: Uint8Array; type: string }> {
	const shown = src.startsWith('data:') ? src.slice(0, 64) : src;
	if (fit === null)
		throw refused(
			file,
			shown,
			'this server fits no image to a card: sharp makes no file here (list sharp() in image({ encoder }))'
		);
	let bytes: Uint8Array | null;
	if (src.startsWith('data:')) {
		bytes = data_bytes(src);
		if (bytes === null) throw refused(file, shown, 'its data does not decode');
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
		const reason = (e as Error).message;
		const own = src.startsWith('data:') ? undefined : read.unfit?.(src, reason);
		throw own ?? refused(file, shown, reason);
	}
}

function as_buffer(bytes: Uint8Array): ArrayBuffer {
	const own = new Uint8Array(bytes.byteLength);
	own.set(bytes);
	return own.buffer;
}

/** `tree` with every address it names read by `read`, fitted by `fit` and handed over as bytes
 *  (an `<img src>` as an `ArrayBuffer`, satori keeps no copy of it; any other as a `data:` URL of
 *  the type its bytes are), and every link's `href` outside an SVG left out. A `data:` URL is read
 *  like any address: its bytes must be a PNG, JPEG, GIF, WebP, AVIF or TIFF (an SVG is refused:
 *  it can name addresses of its own). One `read` cannot read, or `fit` cannot fit (or any, with no
 *  `fit`: nothing is read then), is `image_card_source`, but for a fetched URL whose bytes do not
 *  fit when `read.unfit` names the failure; a coded refusal of the realm's own (such as
 *  `image_remote_host` at build) and a {@link RealmAnswer} stay as they are. */
export async function inline_images<T>(
	tree: T,
	file: string,
	read: CardImageRead,
	fit: CardImageFit | null
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

/** Refuse `tree` (`image_card_source`) unless every address left in it is one satori cannot fetch
 *  and resvg draws: an `ArrayBuffer` or a `data:` URL whose bytes resvg draws
 *  ({@link resvg_draws}), or a `#` reference, in every `src`, `href`, `xlink:href` and after every
 *  `url(` of every string, closed or not. Run on the tree satori is handed, right before the draw. */
export function drawable(tree: unknown, file: string): void {
	const fail = (src: string, reason: string): never => {
		throw refused(file, src.slice(0, 64), reason);
	};
	const drawn = (src: string, bytes: Uint8Array | null): void => {
		if (bytes !== null && resvg_draws(bytes)) return;
		const type = bytes === null ? null : image_type(bytes);
		fail(
			src,
			`its bytes are ${type ?? 'no image'} that resvg does not draw: it draws only an 8-bit PNG, an 8-bit grey or RGB JPEG and a GIF (an SVG can name addresses of its own)`
		);
	};
	const text = (value: string): void => {
		for (const span of url_spans(value)) {
			if (!span.closed)
				fail(
					value.slice(span.start),
					'its url( has no closing paren, and satori would read it as one'
				);
			if (is_ref(span.src)) continue;
			if (!/^data:/i.test(span.src))
				fail(span.src, 'a url() here names no image ogygia read before the draw');
			drawn(span.src, data_bytes(span.src));
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
				if (value instanceof ArrayBuffer) {
					drawn(`the bytes of a ${key}`, new Uint8Array(value));
					continue;
				}
				if (typeof value !== 'string') fail(String(value), 'it is no address');
				const src = value as string;
				if (is_ref(src)) continue;
				if (!src.startsWith('data:')) fail(src, 'it was not read before the draw');
				drawn(src, data_bytes(src));
			} else if (typeof value === 'string') text(value);
			else if (key === 'style' && value !== null && typeof value === 'object')
				for (const v of Object.values(value)) if (typeof v === 'string') text(v);
		}
	};
	visit(tree);
}
