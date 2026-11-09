/**
 * Rewrite every source mark in `src` (strict position rules), injecting the runtime-wrapper
 * import once. `rel` is the module's root-relative posix path (the id rail). Returns the input
 * unchanged (same reference) when there is nothing to do.
 */
export declare function rewrite_source(src: string, id: string, rel: string, markup_exts: readonly string[]): string;
