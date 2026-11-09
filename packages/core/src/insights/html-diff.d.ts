/**
 * A readable diff of two HTML strings — the server's markup and what the browser ended up with —
 * for the Hydration tab. HTML is cut into tokens (a tag, or the text between tags; comments dropped,
 * whitespace runs folded), the token lists are diffed (Myers, O(ND)), and the result is grouped into
 * hunks with a little context. No regex. A diff too large to compute (edit distance past `max_d`)
 * falls back to the first difference.
 */
export type DiffOp = {
    op: 'same' | 'del' | 'add';
    text: string;
};
export interface DiffHunk {
    ops: DiffOp[];
}
export interface HtmlDiff {
    hunks: DiffHunk[];
    /** tokens removed / added */
    removed: number;
    added: number;
    /** the diff gave up (too many changes) and shows only where they start */
    partial: boolean;
}
/** Tags and text runs; comments out; whitespace inside text folded to one space. */
export declare function tokenize(html: string): string[];
export declare function html_diff(server: string, browser: string, context?: number, max_d?: number): HtmlDiff;
