export type AliasEntry = {
    find: string | RegExp;
    replacement: string;
};
export type BakeOptions = {
    /** Content hash of the eval entry — names/isolates the bundle in the cache. */
    hash: string;
    /** `resolve.alias` entries so a baked `fn` can import `$lib/…`. */
    alias: AliasEntry[];
    /** Project root — anchors the `$lib` convention fallback. */
    root: string;
};
/**
 * Rewrite every `import.meta.og.bake(fn)` in `src` to its inlined, devalue-serialized result. ASYNC
 * (bundles + executes). Returns the input unchanged (same reference) when there is nothing to do.
 * Throws build-voice on a non-serializable result or an `fn` that references non-imported scope.
 */
export declare function rewrite_bake(src: string, id: string, opts: Omit<BakeOptions, 'hash'> & {
    markupExts?: readonly string[];
}): Promise<string>;
