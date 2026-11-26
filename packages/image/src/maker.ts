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

/** The original's own bytes cannot be read (its header does not decode, or it is past the pixels
 *  one frame may have): every file of it fails the same way. Any other failure of a make is that
 *  one file's. */
export class SourceUnreadable extends Error {}

/** What a maker module exports. */
export interface Maker {
	/** How many files it makes at once. */
	parallel: number;
	/** One recipe's file from its original's bytes. `platform` is the request's `event.platform`
	 *  (a Worker's bindings), for a maker that makes files with one. */
	make(bytes: Uint8Array, recipe: ParsedRecipe, platform: unknown): Promise<Uint8Array>;
	/** Where its files are kept, or null: each is made per ask (and kept in memory). */
	store: MadeStore | null;
}
