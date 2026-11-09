/** The devalue type tag. */
export declare const SEED_REF_KEY = "OgygiaSeedRef";
export type SeedPath = (string | number)[];
/** Client: the node a path points at, or `undefined` when the seed does not have it. */
export declare function resolve_seed_ref(data: unknown, path: SeedPath): unknown;
/**
 * Client reviver for the devalue type: resolve BY REFERENCE. The island receives the seed's own
 * node — the same object its `page.data` read would hand it, shared exactly the way `page.data`
 * already is between islands. A deep copy per reference (129 of them on a measured page) bought
 * nothing: island props are a snapshot either way, and the DEV mutation guard the runtime wraps
 * every island's props in (`PropMutationGuard`) already warns on a write into them. `get_data` is
 * called lazily, once per reviver — the first reference resolves the seed. A dangling path (no seed,
 * or a seed that does not carry the node) revives to `undefined` and, in dev, says why.
 */
export declare function seed_ref_reviver(get_data: () => unknown): (path: SeedPath) => unknown;
