/**
 * Small hand-written scans shared by the server's per-request HTML work, each kept only where it
 * MEASURED faster (or allocation-lighter) than the regex it replaced — the engine's compiled
 * matcher wins plain presence tests, so those stayed regexes (head-presence.ts).
 */
/** `[A-Za-z0-9_]` — the regex `\w` (NaN, past the end, is not). */
export declare function is_word(c: number): boolean;
/** The regex `\s`: ASCII whitespace and the Unicode spaces (NaN, past the end, is not). */
export declare function is_space(c: number): boolean;
/**
 * Every region-CSS tag in `head`, in order, joined: the `<link … data-ogygia-region-css>` form AND the
 * inline `<style data-ogygia-region-css="href">…</style>` form a sheet under Kit's
 * `inlineStyleThreshold` takes. What an isolated render (a held region's body) must carry forward
 * from its head: keeping links only silently unstyled every small sheet.
 */
export declare function region_css_tags(head: string): string;
/** Every `<link …data-ogygia-region-css…>` tag in `head`, in order, joined — what
 *  `head.match(/<link\b[^>]*data-ogygia-region-css[^>]*>/g).join('')` returned. */
export declare function region_css_links(head: string): string;
