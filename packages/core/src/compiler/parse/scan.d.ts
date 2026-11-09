/** A `/` begins a regex (not division) when the previous significant char is an operator/opener —
 *  always the case for a regex option value (`{ page: /…/ }`, `[/…/, /…/]`). */
export declare function regex_context(prev: string): boolean;
/** Index of the `)` matching the `(` at `open`, skipping strings, comments, and regex literals
 *  (incl. `[…]` char classes, which may hold an unescaped `/`). -1 if unbalanced. */
export declare function match_close(src: string, open: number): number;
/** One located `import.meta.og.<method>(<args>)` call. `args` is the VERBATIM text between the
 *  parens; `method` is the dotted tail after the shared prefix (`loader.git`, `code`, `regions`). */
export type OgCall = {
    start: number;
    end: number;
    method: string;
    args: string;
};
/**
 * Find every `<prefix><method>(…)` call in `src`. `prefix` is the literal namespace head
 * (`import.meta.og.`); `method` is the dotted identifier chain that follows, up to the `(`. Skips
 * strings/comments/regex so a marker in prose is never a false hit. Pure.
 */
export declare function find_og_calls(src: string, prefix: string): OgCall[];
/** Split a call's argument text into the first string-literal (unquoted) and the verbatim rest.
 *  Throws (with `who` in the message) when the first argument is not a STATIC string literal — a
 *  bare identifier, or a template literal with `${…}` interpolation (not build-determinable). */
export declare function split_first_string(args: string, who: string): {
    value: string;
    rest: string;
};
/** A slice of JS/TS to analyze, plus where it starts in the original source (for offset mapping). */
export type JsRegion = {
    code: string;
    offset: number;
};
/** Does `id` (a module path, maybe with a `?query`) end in a plain JS/TS extension? */
export declare function is_js_module(id: string): boolean;
/** Does `id` end in one of the configured MARKUP extensions (`.svelte`, `.svx`, `.md`)? */
export declare function is_markup_module(id: string, markup_exts: readonly string[]): boolean;
/**
 * Extract the JS regions of a module for construct analysis. Returns `null` when the extension is not
 * a recognized construct host (the caller then leaves the file untouched). A JS/TS module is one
 * region; a markup file is its `<script>` blocks. `.svelte.ts`/`.svelte.js` hit the JS branch first
 * (they end in `.ts`/`.js`), so a `.svelte`-suffixed markup ext never shadows them.
 */
export declare function og_js_regions(src: string, id: string, markup_exts: readonly string[]): JsRegion[] | null;
