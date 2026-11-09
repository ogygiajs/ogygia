/**
 * The comment an unscoped CSS fallback carries in the shipped stylesheet. When the build cannot
 * compile a component's scoped CSS (compiler/fouc-css.ts), it ships the raw style bodies, which
 * then apply to the WHOLE page (`.bar {…}` instead of `.bar.svelte-x {…}`). A build log line is
 * easy to miss, so the CSS itself says so, and devtools (the page's sheets) and the profiler (the
 * weighed CSS files) name the component. Import-free: the browser loads this too.
 *
 * A legal comment (`/*!`) so a minifier keeps it; the file NAME only, never the build machine's path.
 */
export declare const UNSCOPED_MARK = "ogygia-unscoped:";
export declare function unscoped_marker(abs: string, why: string): string;
export interface UnscopedStyles {
    /** the component's file name (`Card.svelte`) */
    file: string;
    /** why the build could not scope it (the compiler's first message line) */
    why: string;
}
/** The finding both devtools and the profiler raise, in the same words. */
export declare function unscoped_finding(list: readonly UnscopedStyles[]): {
    code: 'css-unscoped';
    message: string;
    fix: string;
};
/** Every unscoped fallback a stylesheet's text carries, once per file. Plain scan, no regex: it
 *  runs over whole stylesheets in the browser. */
export declare function find_unscoped(css: string): UnscopedStyles[];
