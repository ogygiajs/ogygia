/**
 * Dev-only per-island byte estimate — walks DOWN the Vite dev module graph from each island entry
 * and sums the served (transformed) size of the APP modules it transitively imports: its wrapper,
 * the component, and every child component / app util the component pulls in. Not just the wrapper
 * chunk a `PerformanceResourceTiming` lookup sees — but also NOT the shared framework.
 *
 * The framework boundary is pruned (`node_modules`, Vite's `.vite/deps` prebundles): Svelte's runtime
 * is loaded ONCE for the whole page, so folding it into every island makes them all read as ~2 MB and
 * hides the real difference. Counting only app code surfaces the number that actually varies island to
 * island — "what does THIS component cost on top of the shared runtime".
 *
 * Caveats (surfaced in the tab): dev code is unbundled + unminified, so the number is an ESTIMATE of
 * relative cost, not the shipped byte count; and a still-cold island (one that hasn't woken, so its
 * component was never loaded) has no subgraph in the graph yet — it simply doesn't appear here until
 * it wakes. Pure over the nodes it's handed; reads, never mutates.
 */
import { type IslandHazard } from '../../insights/hydration-hazards.ts';
/** Structural shape of a Vite dev module-graph node (the fields the byte walk reads). */
export type ByteGraphModule = {
    url?: string | null;
    id?: string | null;
    file?: string | null;
    transformResult?: {
        code?: string | null;
    } | null;
    importedModules?: Iterable<ByteGraphModule>;
};
/**
 * `island id → { bytes, modules }` for every island entry present in the graph, where `bytes` is the
 * summed served size of the entry's whole transitive import subgraph and `modules` the node count.
 * When two graph nodes resolve to the same island id (e.g. `?v=` query variants), the larger wins.
 */
export declare function island_subgraph_bytes(modules: Iterable<ByteGraphModule>, 
/** an app `.svelte` file's source, by its path on disk: what draws differently in the browser */
read?: (file: string) => string | undefined): Record<string, IslandBytes>;
/** An island's app code in dev: the total, its heaviest modules, and any barrel it pulls whole. */
export interface IslandBytes {
    bytes: number;
    modules: number;
    /** the heaviest modules (served size, heaviest first): what to look at first */
    top?: {
        file: string;
        bytes: number;
    }[];
    /** re-export barrels still in the island's graph, with how many app modules each drags in */
    barrels?: {
        file: string;
        fanout: number;
    }[];
    /** its components' lines that draw differently in the browser (a top-level await, a browser-only value) */
    hazards?: IslandHazard[];
}
