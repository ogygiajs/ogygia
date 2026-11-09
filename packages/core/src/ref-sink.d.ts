/**
 * RESOLVE SINK (reconciler R3) — a hook the runtime installs during an island's hydration to learn
 * which page-scoped ids that island resolves, WITHOUT the hub knowing anything about the DOM.
 * `resolve()` (ref.ts) calls the current sink with each id it freshly remembers in the page scope;
 * the runtime's sink attributes it to the island currently hydrating (region → id-set), so a
 * reconcile nav can dispose exactly the ids owned by REMOVED regions. Null when no island is
 * hydrating.
 *
 * A leaf of its own (ref.ts re-exports the setter): the hydrate core installs the sink around every
 * island, wired values or not, and shares modules with Kit's client graph, which uses the rest of
 * the hub. A shared module ships whole, so reaching the sink through ref.ts sent every island page
 * the hub's registry and minting.
 */
export declare let resolve_sink: ((id: string) => void) | null;
export declare function set_resolve_sink(fn: ((id: string) => void) | null): void;
