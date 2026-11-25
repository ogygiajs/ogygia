/**
 * A recipe: one file a page asks for, made from one source. On a live server and in dev its whole
 * description rides in the URL PATH, signed by the server, so the endpoint that makes it needs
 * nothing but the URL: any server instance, a CDN in front. Isomorphic: `<Img>` builds recipes on the
 * server and in the browser; only the server can sign one.
 *
 *   <base>/__ogygia__/i/<sig>/<id>-<w>x<h>[-q<q>][-p<position>][-s][-o<ops>]/<original path>.<ext>
 *
 * A file the BUILD makes (a warmed preset's, and every file a prerendered page names) is a static
 * file instead, named by its head alone, which names its source by content: the same name in every
 * build, with no key.
 *
 *   <assets or base>/<appDir>/immutable/og/<id>-<w>x<h>[-q<q>][-p<position>][-s][-o<ops>].<ext>
 *
 * `-s` asks for the first frame only (a moving source's reduced-motion still).
 *
 * A remote source known only at request (`remoteImage()`) has no original among the app's assets:
 * its tail is `.remote/<its URL as base64url>`, so the signature covers the URL, and the endpoint
 * fetches only what the server named.
 *
 * A share card (`import.meta.og.image.card()`) is made from a component and its props: its tail is
 * `.card/<card>/<its props as base64url JSON>`, so the signature covers the props, and the endpoint
 * renders only what the server named.
 *
 * @packageDocumentation
 */
import { slot } from '@ogygia/machine';
import type { AppPaths } from './config.ts';
import type { ImageFormat, ImageOps } from './descriptor.ts';

/** One file to make. */
export interface Recipe {
	/** The source's id. */
	id: string;
	/** The source's original file, as its descriptor names it. */
	src: string;
	width: number;
	height: number;
	format: ImageFormat;
	quality?: number;
	/** Where a crop keeps, when the box's shape is not the source's. */
	position?: string;
	/** The first frame only: a moving source's still. */
	still?: true;
	ops?: ImageOps;
	/** The box cuts the source (its shape is not the source's). Never in a URL: the namer reads it
	 *  to pick an encoder that can crop. */
	crop?: true;
	/** What the source is, for the namer: its own format, and whether it moves. Never in a URL. */
	source?: { format: ImageFormat; animated?: true };
	/** The source is a remote URL known only at request (`src`), or a share card (`card`): the
	 *  recipe's tail names it ({@link recipe_tail}). */
	from?: 'remote' | 'card';
	/** A card's own part of its tail: `<card>/<props as base64url JSON>`. */
	card?: string;
}

/** The URL path every recipe sits under, after the app's base. */
export const IMAGE_PREFIX = '/__ogygia__/i/';

/** Where the build's own files sit, under the app's `appDir`: Kit's immutable folder, which every
 *  adapter and static host serves as files kept forever. */
export const BUILT_DIR = 'immutable/og';

const EXT: Readonly<Record<ImageFormat, string>> = {
	avif: 'avif',
	webp: 'webp',
	png: 'png',
	jpeg: 'jpg',
	gif: 'gif',
	svg: 'svg',
	tiff: 'tif'
};
const FORMAT_OF_EXT: ReadonlyMap<string, ImageFormat> = new Map([
	['avif', 'avif'],
	['webp', 'webp'],
	['png', 'png'],
	['jpg', 'jpeg']
]);
/** Every place a crop can keep: what a recipe's `-p` names, a preset's and an `<Img>`'s `position`. */
export const POSITIONS: ReadonlySet<string> = new Set([
	'centre',
	'center',
	'top',
	'bottom',
	'left',
	'right',
	'attention',
	'entropy'
]);
/** The widest and tallest file a recipe names, in pixels: five digits a side. */
export const SIDE_MAX = 99_999;
/** A source id as a recipe names it. */
export const SOURCE_ID_RE: RegExp = /^[A-Za-z0-9_-]{1,64}$/;
const HEAD_RE =
	/^([A-Za-z0-9_-]{1,64})-(\d{1,5})x(\d{1,5})(?:-q(\d{1,3}))?(?:-p([a-z]+))?(-s)?(?:-o([A-Za-z0-9_-]+))?$/;
const TAIL_RE = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\\\0]+$/;

/** `text`'s UTF-8 bytes as base64url, unpadded. */
export function b64url_encode(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64url_decode(text: string): string {
	const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
	return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** The original's path as a recipe carries it, decoded: the asset URL without its origin, base,
 *  query or leading slash. `prefixes` are the app's asset and base paths (`https://cdn.example.com`,
 *  `/shop`). */
export function source_tail(src: string, prefixes: readonly string[]): string {
	let s = src.split(/[?#]/)[0]!;
	for (const p of prefixes)
		if (p && s.startsWith(`${p}/`)) {
			s = s.slice(p.length);
			break;
		}
	s = s.replace(/^\/+/, '');
	try {
		return decodeURI(s);
		// oxlint-disable-next-line ogygia/no-silent-failures -- a path that is not an escaped URL is already the file's own name
	} catch {
		return s;
	}
}

/** Where a remote source's tail starts: `.remote/<its URL as base64url>`. */
export const REMOTE_TAIL = '.remote/';
const REMOTE_TAIL_RE = /^\.remote\/([A-Za-z0-9_-]+)$/;

/** Where a share card's tail starts: `.card/<card>/<props as base64url JSON>`. */
export const CARD_TAIL = '.card/';
const CARD_TAIL_RE = /^\.card\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_-]+)$/;

/** The tail of `r`'s original, decoded: a remote source's URL as {@link REMOTE_TAIL} and base64url,
 *  a card's as {@link CARD_TAIL}, else {@link source_tail}. */
export function recipe_tail(r: Recipe, prefixes: readonly string[]): string {
	if (r.from === 'card') return `${CARD_TAIL}${r.card ?? ''}`;
	return r.from === 'remote'
		? `${REMOTE_TAIL}${b64url_encode(r.src)}`
		: source_tail(r.src, prefixes);
}

/** What a card's tail names: the card, and its props as the JSON text the minter wrote; or null
 *  when `tail` is none. */
export function card_of_tail(tail: string): { card: string; props: string } | null {
	const m = CARD_TAIL_RE.exec(tail);
	if (!m) return null;
	try {
		return { card: m[1]!, props: b64url_decode(m[2]!) };
		// oxlint-disable-next-line ogygia/no-silent-failures -- props that do not decode name no card: the endpoint answers 404
	} catch {
		return null;
	}
}

/** The URL a remote source's tail names, or null when `tail` is none: only an `http:` or `https:`
 *  URL written as the minter writes it. */
export function remote_of_tail(tail: string): URL | null {
	const m = REMOTE_TAIL_RE.exec(tail);
	if (!m) return null;
	let url: URL;
	try {
		const text = b64url_decode(m[1]!);
		url = new URL(text);
		if (url.href !== text) return null;
		// oxlint-disable-next-line ogygia/no-silent-failures -- a tail that does not decode to a URL names no remote source: the endpoint answers 404
	} catch {
		return null;
	}
	return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
}

/** A decoded tail as URL path segments. */
export function encode_tail(tail: string): string {
	return tail.split('/').map(encodeURIComponent).join('/');
}

function decode_tail(raw: string): string | null {
	try {
		return raw.split('/').map(decodeURIComponent).join('/');
		// oxlint-disable-next-line ogygia/no-silent-failures -- a path that does not decode names no original: the endpoint answers 404
	} catch {
		return null;
	}
}

/** The recipe's path below {@link IMAGE_PREFIX} and its signature: `<id>-<w>x<h>…/<tail>.<ext>`,
 *  `tail` (decoded) written as escaped path segments. */
export function recipe_path(r: Recipe, tail: string): string {
	return `${recipe_head(r)}/${encode_tail(tail)}.${EXT[r.format]}`;
}

/** What a recipe asks of its source, with no file name: `<id>-<w>x<h>[-q…][-p…][-s][-o…]`. */
export function recipe_head(r: Omit<Recipe, 'src'>): string {
	const q = r.quality === undefined ? '' : `-q${r.quality}`;
	const p = r.position === undefined ? '' : `-p${r.position}`;
	const s = r.still ? '-s' : '';
	const o =
		r.ops === undefined || !Object.keys(r.ops).length
			? ''
			: `-o${b64url_encode(JSON.stringify(r.ops))}`;
	return `${r.id}-${r.width}x${r.height}${q}${p}${s}${o}`;
}

/** The file a recipe makes, by its recipe alone: `<head>.<ext>`. Its source is named by content (the
 *  id), so it is the key of every store and the name of every file the build writes. */
export function recipe_file(r: Omit<Recipe, 'src'>): string {
	return `${recipe_head(r)}.${EXT[r.format]}`;
}

/** A file the build makes, below the app's `appDir`: `immutable/og/<head>.<ext>`. */
export function built_file(r: Omit<Recipe, 'src'>): string {
	return `${BUILT_DIR}/${recipe_file(r)}`;
}

/** The URL of a file the build makes: a static file under the app folder. */
export function built_url(paths: AppPaths, r: Omit<Recipe, 'src'>): string {
	return `${paths.assets || paths.base}/${paths.app_dir}/${built_file(r)}`;
}

/** What a recipe path asks for. The original is named by its tail (decoded). */
export interface ParsedRecipe {
	id: string;
	tail: string;
	width: number;
	height: number;
	format: ImageFormat;
	quality?: number;
	position?: string;
	still?: true;
	ops?: ImageOps;
}

/** Read a recipe path (`<id>-<w>x<h>…/<tail>.<ext>`), strictly: anything else is null. */
export function parse_recipe(path: string): ParsedRecipe | null {
	const slash = path.indexOf('/');
	if (slash === -1) return null;
	const head = HEAD_RE.exec(path.slice(0, slash));
	const rest = path.slice(slash + 1);
	const dot = rest.lastIndexOf('.');
	if (!head || dot === -1) return null;
	const format = FORMAT_OF_EXT.get(rest.slice(dot + 1));
	const tail = decode_tail(rest.slice(0, dot));
	if (!format || tail === null || !TAIL_RE.test(tail)) return null;
	const width = Number(head[2]);
	const height = Number(head[3]);
	if (width < 1 || height < 1) return null;
	const out: ParsedRecipe = { id: head[1]!, tail, width, height, format };
	if (head[4] !== undefined) {
		const q = Number(head[4]);
		if (q < 1 || q > 100) return null;
		out.quality = q;
	}
	if (head[5] !== undefined) {
		if (!POSITIONS.has(head[5])) return null;
		out.position = head[5];
	}
	if (head[6] !== undefined) out.still = true;
	if (head[7] !== undefined) {
		try {
			const ops = JSON.parse(b64url_decode(head[7])) as unknown;
			if (ops === null || typeof ops !== 'object' || Array.isArray(ops)) return null;
			out.ops = ops as ImageOps;
			// oxlint-disable-next-line ogygia/no-silent-failures -- ops that do not decode make the path no recipe: the endpoint answers 404
		} catch {
			return null;
		}
	}
	return out;
}

/** The app's encoder's own URL of a live file (a CDN's link), in the server and in the browser, or
 *  null: the endpoint makes it. The plugin picks one at build as `virtual:ogygia-image/namer`. */
export type Namer = (recipe: Recipe) => string | null;

/** What the server realm hands `<Img>`: a recipe's URL. `built` says the build made the file (a
 *  warmed preset's); a prerender names every file as one the build makes. */
export type Minter = (recipe: Recipe, built: boolean) => string;

const minting = slot<{ mint: Minter | null }>({
	name: 'ogygia.image.minter',
	version: 1,
	make: () => ({ mint: null })
});

/** Set (or clear) the process's minter: the image server realm's `setup`. */
export function set_minter(mint: Minter | null): void {
	minting.mint = mint;
}

/** The URL of `recipe` the server names, or null where no server realm runs (the browser). */
export function mint(recipe: Recipe, built: boolean): string | null {
	return minting.mint ? minting.mint(recipe, built) : null;
}
