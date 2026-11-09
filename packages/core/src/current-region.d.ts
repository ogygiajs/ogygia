/** Runtime sets the region it is about to hydrate so a nested `get()` knows where to start walking. */
export declare function set_current_region(el: Element | null): void;
/** The region currently being hydrated (or null) — read by the context feature's client DOM walk. */
export declare function current_region(): Element | null;
export interface ForeignHydrate {
    /** The MFE origin the island's entry was loaded from. */
    origin: string;
    /** The absolute entry URL — the island's identity for once-per-island warnings. */
    entry: string;
}
/** Runtime marks the foreign island it is about to delegate-hydrate (null when done). */
export declare function set_foreign_hydrate(info: ForeignHydrate | null): void;
/** The foreign island currently hydrating (or null) — read by the page shims' dev warning. */
export declare function foreign_hydrate(): ForeignHydrate | null;
