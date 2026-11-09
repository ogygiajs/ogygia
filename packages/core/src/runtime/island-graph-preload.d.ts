/** Marks a link this module inserted (tests and devtools tell them from the HTML's own). */
export declare const GRAPH_PRELOAD_ATTR = "data-ogygia-graph-preload";
/** Merge one graph script's text; hrefs resolve against `base` (the document the text came from).
 *  Its locations (`s`) go to the runtime's one identity → location map. */
export declare function register_island_graph(text: string, base?: string): void;
/**
 * Start fetching every chunk `entry`'s code needs: one modulepreload link per chunk not linked yet.
 * Call it in the same task as the entry's `import()`. An entry the page has no graph for (dev, an
 * island inside a fetched hole answer) preloads nothing — its `import()` still finds its chunks.
 */
export declare function preload_island_graph(entry: string, base?: string, priority?: 'high' | 'auto' | 'low'): void;
/** Test seam: forget every graph read and every chunk linked. */
export declare function reset_island_graph(): void;
