/**
 * An AST node as the compiler's passes read it: the parser seam's output (oxc's ESTree, or whatever
 * parser {@link set_parser} installed) and Svelte's template AST, walked generically and read by field
 * name. Kept loose on purpose: the walkers index arbitrary fields (`node[key]`), and some passes accept
 * node shapes beyond oxc's (store.ts also matches Babel's `StringLiteral` / `ObjectProperty`), which a
 * precise ESTree union would rule out. The one loose node type every pass shares.
 */
export type AstNode = Record<string, any>;
type Node = AstNode;
export type Comment = {
    start: number;
    end: number;
};
export type ParseResult = {
    program: Node | null;
    ok: boolean;
    comments: Comment[];
};
/** The raw oxc parse signature (`(id, code) → { program, errors, comments }`). */
export type RawParse = (id: string, code: string) => {
    program?: Node;
    errors?: unknown[];
    comments?: Comment[];
};
/** Install a browser (or test) parser with the same call shape. No-arg reset restores the default. */
export declare function set_parser(fn?: RawParse): void;
/**
 * Parse `code` (named by `id`, whose extension picks the dialect) to an oxc/ESTree program. Never
 * throws: a syntax error (or a half-typed file mid-edit) yields `{ program: null, ok: false }`, and
 * callers fall back (scanner) or skip. Offsets on the returned nodes are exact against `code`.
 * `comments` carries trivia (block/line) with byte offsets — not present in the AST body.
 */
export declare function parse_module(code: string, id: string): ParseResult;
export {};
