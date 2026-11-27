/**
 * What a MAKER is: the module that turns an original's bytes into one recipe's file on the server,
 * and the store it keeps its files in. The plugin picks exactly one at build, from the app's encoder,
 * as `virtual:ogygia-image/maker` (./makers/sharp.ts), so a server bundle holds no other. ./settle.ts
 * runs it.
 *
 * @packageDocumentation
 */
import type { ParsedRecipe } from './recipe.ts';

/** A kept file, opened to read. */
export interface Kept {
	body: ReadableStream<Uint8Array>;
	size: number;
}

/** Where a maker keeps the files it made, by key (../recipe.ts `recipe_file`). */
export interface MadeStore {
	/** The file of `key`, when it is kept (anything but null). */
	find(key: string): Promise<unknown>;
	/** The file of `key` opened to read, when it is kept. */
	open(key: string): Promise<Kept | null>;
	/** Keep `data` as the file of `key`; false when it could not be kept. */
	keep(key: string, data: Uint8Array): Promise<boolean>;
}

/** The maker cannot make any file in this runtime (a binding it needs is not there): the endpoint
 *  says `code` once and answers 500. */
export class CannotMake extends Error {
	readonly code: 'image_binding_missing';
	readonly args: { binding: string };

	constructor(code: 'image_binding_missing', args: { binding: string }) {
		super(`${code}: ${JSON.stringify(args)}`);
		this.code = code;
		this.args = args;
	}
}

/** The original's own bytes cannot be read (they are no image, its header or its pixels do not
 *  decode, or it is past the pixels one frame may have): every file of it fails the same way, so a
 *  fetched URL's is that URL's failure. Any other failure of a make or a fit (memory, the
 *  platform) is that one ask's. Thrown only after {@link unreadable} says so. */
export class SourceUnreadable extends Error {}

const OWN_FAILURE_RE =
	/out of memory|insufficient memory|memory area too large|bad_alloc|ENOMEM|cannot allocate|unable to allocate/i;
const VIPS_SOURCE_RE =
	/^(?:Input (?:buffer|file|image) |Vips(?:Jpeg|Png|Gif|Webp|Tiff|Heif|ForeignLoad\w*): |vipspng: |\w+load(?:_\w+)?: |heif: |source: |Warning treated as error)|premature end|corrupt/im;
const BINDING_SOURCE_CODES: ReadonlySet<number> = new Set([9412, 9413, 9520, 9523]);
const BINDING_SOURCE_RE = /\b(?:9412|9413|9520|9523):/;

/** Whether `e`, thrown by a decoder, says the bytes it was given are a broken file: a libvips
 *  loader's error (sharp), or an Images binding error about its input (no image 9412, too many
 *  pixels 9413, a format it does not take 9520, one it could not read 9523). A failure of the
 *  server's own (out of memory) never is, whoever reports it. The one line between a source's
 *  failure and an ask's. */
export function unreadable(e: unknown): boolean {
	if (e instanceof SourceUnreadable) return true;
	if (!(e instanceof Error)) return false;
	if (OWN_FAILURE_RE.test(e.message)) return false;
	const code = (e as { code?: unknown }).code;
	if (typeof code === 'number') return BINDING_SOURCE_CODES.has(code);
	return VIPS_SOURCE_RE.test(e.message) || BINDING_SOURCE_RE.test(e.message);
}

/** `e` as a {@link SourceUnreadable} when {@link unreadable} says it is one, prefixed by `why`;
 *  else `e` as it is. */
export function source_failure(e: unknown, why = ''): unknown {
	if (e instanceof SourceUnreadable || !unreadable(e)) return e;
	return new SourceUnreadable(`${why}${(e as Error).message}`);
}

/** An image fitted to a `width` × `height` card: the bytes a card's engine is handed and their
 *  type, or a throw saying why it cannot be drawn (../cards/fit.ts). */
export type ImageFit = (
	bytes: Uint8Array,
	width: number,
	height: number
) => Promise<{ bytes: Uint8Array; type: string }>;

/** What a maker module exports. */
export interface Maker {
	/** How many files it makes at once. */
	parallel: number;
	/** One recipe's file from its original's bytes. `platform` is the request's `event.platform`
	 *  (a Worker's bindings), for a maker that makes files with one. */
	make(bytes: Uint8Array, recipe: ParsedRecipe, platform: unknown): Promise<Uint8Array>;
	/** Where its files are kept, or null: each is made per ask (and kept in memory). */
	store: MadeStore | null;
	/** How a card drawn here fits its images to the card (sharp's), or null: a card drawn here
	 *  names no image. */
	fit: ImageFit | null;
}
