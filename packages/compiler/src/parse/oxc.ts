/**
 * The one parser the `import.meta.og.*` transforms use. It must (a) parse TypeScript — the constructs
 * live in `.ts`/`.svelte.ts` and `<script lang="ts">` — and (b) preserve BYTE OFFSETS against the
 * original source, because every transform splices by span. That rules out `parseAst` (rollup's
 * parser: no TS) and type-stripping (shifts offsets).
 *
 * The parser comes from the app's required `vite` peer: Vite 8 re-exports the TS-capable oxc parser
 * as `parseSync` (byte-identical to `rolldown/utils`' — verified), so ogygia carries no `rolldown`
 * dependency of its own for this. NOT a shaky choice: `parseAst` is the rollup-compat parser (throws
 * on TS); `parseSync` is the oxc parser. One import, one decision.
 */
import { createRequire } from 'node:module';

/**
 * An AST node as the compiler's passes read it: oxc's ESTree and Svelte's template AST, walked generically and read by field
 * name. Kept loose on purpose: the walkers index arbitrary fields (`node[key]`), and some passes accept
 * node shapes beyond oxc's (store.ts also matches Babel's `StringLiteral` / `ObjectProperty`), which a
 * precise ESTree union would rule out. The one loose node type every pass shares.
 */
// oxlint-disable-next-line typescript/no-explicit-any
export type AstNode = Record<string, any>;
type Node = AstNode;

export type Comment = { start: number; end: number };
export type ParseResult = { program: Node | null; ok: boolean; comments: Comment[] };

/** The raw oxc parse signature (`(id, code) → { program, errors, comments }`). */
export type RawParse = (
	id: string,
	code: string
) => { program?: Node; errors?: unknown[]; comments?: Comment[] };

// Loaded on the first parse, not imported: a module that reaches this file without parsing (a server
// runtime path) never loads Vite. The VARIABLE specifier keeps a bundler from pulling `vite` in.
let node_parse_sync: RawParse | undefined;
function raw_parse(id: string, code: string) {
	if (!node_parse_sync) {
		const require = createRequire(import.meta.url);
		// Vite re-exports the SAME oxc parser as `rolldown/utils` (byte-identical AST — verified), so
		// this reads through the app's required `vite` peer instead of a direct `rolldown` dependency.
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
