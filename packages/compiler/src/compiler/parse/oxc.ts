import { createRequire } from 'node:module';

/**
 * An AST node as the compiler's passes read it: oxc's ESTree and Svelte's template AST, walked
 * generically and read by field name. Kept loose on purpose: the walkers index arbitrary fields
 * (`node[key]`), and some passes accept node shapes beyond oxc's (store.ts also matches Babel's
 * `StringLiteral` / `ObjectProperty`), which a precise ESTree union would rule out.
 */
export type AstNode = Record<
	string,
	// oxlint-disable-next-line typescript/no-explicit-any -- every pass reads fields by name across oxc's and Svelte's node shapes
	any
>;
type Node = AstNode;

export type Comment = { start: number; end: number };
export type ParseResult = { program: Node | null; ok: boolean; comments: Comment[] };

/** The raw oxc parse signature (`(id, code) → { program, errors, comments }`). */
export type RawParse = (
	id: string,
	code: string
) => { program?: Node; errors?: unknown[]; comments?: Comment[] };

let node_parse_sync: RawParse | undefined;
function raw_parse(id: string, code: string) {
	if (!node_parse_sync) {
		const require = createRequire(import.meta.url);
		// @why a bundler follows a literal require() specifier; a variable one keeps vite out of a bundle that never parses (test: test/oxc-parse.test.ts › a module that imports the parser without parsing never loads vite)
		const vite_spec = 'vite';
		node_parse_sync = (require(vite_spec) as { parseSync: RawParse }).parseSync;
	}
	return node_parse_sync(id, code);
}

/**
 * Parse `code` (named by `id`, whose extension picks the dialect) to an oxc/ESTree program. Never
 * throws: a syntax error (or a half-typed file mid-edit) yields `{ program: null, ok: false }`, and
 * callers fall back (scanner) or skip. Offsets on the returned nodes are exact against `code`.
 * `comments` carries trivia (block/line) with byte offsets — not present in the AST body.
 */
export function parse_module(code: string, id: string): ParseResult {
	try {
		const result = raw_parse(id, code) as {
			program?: Node;
			errors?: unknown[];
			comments?: Comment[];
		};
		if (result.errors && result.errors.length > 0)
			return { program: null, ok: false, comments: [] };
		return {
			program: result.program ?? null,
			ok: !!result.program,
			comments: result.comments ?? []
		};
	} catch {
		return { program: null, ok: false, comments: [] };
	}
}
