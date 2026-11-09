/**
 * After lifting lake content into a region, move trailing empty SSR comments
 * (`<!---->`) back into the region. Those are Boundary/host delimiters — not lake
 * content — and hydrate needs them for Boundary+Placeholder.
 */
export interface NodeLike {
    nodeType: number;
    data?: string;
}
export interface ParentLike {
    appendChild(node: NodeLike): unknown;
}
export interface FragmentLike {
    lastChild: NodeLike | null;
    removeChild(node: NodeLike): unknown;
}
/** Relocate trailing empty comments from `frag` into `lake`. Returns how many moved. */
export declare function relocate_trailing_empty_comments(frag: FragmentLike, lake: ParentLike): number;
