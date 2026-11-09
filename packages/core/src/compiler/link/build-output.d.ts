/**
 * Guardrail: a content collection must never reach a CLIENT chunk. Ground truth is the finished
 * bundle. A compiled corpus module (.svx/.md) in a client chunk means a `content()` collection was
 * imported into client-shipped code (usually an island), which drags its eager `import.meta.glob` —
 * every doc — into the browser. On a csr=false site the corpus renders server-side and should never
 * appear here, so any hit is a real leak. A warning, not a throw: the guardrail must never break a build.
 */
export declare function warn_content_leaks(bundle: Record<string, unknown>, root: string, is_island_path: (id: string) => boolean): void;
/**
 * Write the island-deps handoff JSON (the map SSR reads at render): the stable path under Kit's
 * `outDir` (`.svelte-kit` unless the app configured `kit.outDir`), an adapter-friendly copy next
 * to the server bundle, AND an in-place inline into every server chunk that carries the token slot
 * — inlining is what makes it survive serverless tracing (@vercel/nft only bundles *imported*
 * files, not runtime fs reads, so the co-located JSON is dropped there; that is why held/dual
 * regions that cross the wire rendered unstyled on Vercel/Netlify). Unpatched builds keep the fs
 * fallback (adapter-node, dev-preview).
 */
export declare function emit_island_deps_handoff(root: string, json: string, out_dir: string): void;
/**
 * SEED SHAPING report (client `writeBundle`): which islands read `page.data` through the shim, how
 * many keys they were pinned to, and — the actionable part — the modules whose reads could not be
 * pinned, each with its line and why, since one such module makes every page carrying that island
 * ship its whole `page.data`. Same shape as the barrels report: a few lines, a count for the rest.
 */
export declare function report_seed_shaping(map: {
    page: Record<string, boolean>;
    page_keys: Record<string, string[] | null>;
}, bundle: Record<string, {
    type: string;
    moduleIds?: string[];
    imports?: string[];
}>, program: {
    page_key_reasons: Map<string, {
        why: string;
        line: number | null;
    }>;
}, root: string, 
/** an entry's IDENTITY (the maps' key) → its emitted file (its location); absent → the key is
 *  the file (a bundle from before content hashing) */
file_of?: (identity: string) => string): Record<string, SeedWhy[]>;
/** a module that made an island ship all of `page.data`: where (root-relative when inside the app)
 *  and why — what the profiler points at when the island's own file reads nothing whole */
export interface SeedWhy {
    file: string;
    line: number | null;
    why: string;
}
