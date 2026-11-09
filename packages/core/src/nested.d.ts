/**
 * Mark the current subtree's hydration state. `true` = inside a hydrated island (nested islands
 * degrade). `false` = a LAKE resets its subtree to "dead", so an island inside the lake self-
 * hydrates again (the nearest-boundary rule — DESIGN.md).
 */
export declare function setNested(value?: boolean): void;
/** The context an island is hydrated with: `base` (a `<Provide>` above it), marked "inside an
 *  island" — what a wrapper's `setNested()` gave its children, with no wrapper in the tree. */
export declare function nested_context(base?: Map<unknown, unknown> | null): Map<unknown, unknown>;
/**
 * True when an ancestor island wrapper already marked the subtree. `getContext` returns `undefined`
 * when no ancestor set it (a top-level island) — that absence is exactly "not nested".
 */
export declare function isNested(): boolean;
