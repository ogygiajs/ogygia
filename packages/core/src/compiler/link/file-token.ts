/**
 * A module's own file, named in generated code before the bundler has named it: a token that
 * vite/lazy-files.ts replaces (dev: the module's URL; build: the path to its own chunk, or `null`).
 */

export const FILE_TOKEN_MARK = '__OGYGIA_FILE_';
/** A token in code, in any quotes (a minifier may change them): its hex-encoded module id. */
export const FILE_TOKEN_RE: RegExp = /(["'`])__OGYGIA_FILE_([0-9a-f]+)__\1/g;

/** The string literal that stands for `id`'s own file, quotes included. */
export function file_token(id: string): string {
	return JSON.stringify(`${FILE_TOKEN_MARK}${Buffer.from(id).toString('hex')}__`);
}

/** The module id a token's hex part names. */
export const file_token_id = (hex: string): string => Buffer.from(hex, 'hex').toString();
