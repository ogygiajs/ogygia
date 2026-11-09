/**
 * THE ISLAND GRAPH — which chunks each island's code needs, as DATA the page carries, never as
 * `<link rel="modulepreload">` tags.
 *
 * An island entry's own `import()` finds its chunks only after it downloads and parses: a waterfall.
 * A modulepreload per chunk removes the waterfall, but a hint in the HTML fetches the moment the
 * parser meets it — before the page has painted, and for islands that may never wake. So the server
 * writes the graph as data (this format), and the runtime inserts the preload links itself when an
 * island WAKES (runtime/island-graph-preload.ts): after the wake gate, for exactly that island, beside
 * its `import()`. Its whole graph downloads in parallel the moment it may start; nothing lands in
 * the paint window; an island that never wakes downloads nothing.
 *
 * Wire shape (one inert JSON script): `{"h":[href,…],"e":{"<entry>":[i,…]},"s":{"<entry>":src}}` —
 * every chunk href once, each entry (the region's `entry` attribute, as emitted: its IDENTITY)
 * listing the indexes of the chunks it needs. Twenty islands sharing Svelte's client runtime name
 * its chunk once. `s` (optional): the LOCATION of an entry no element on the page carries — a
 * portable snippet's live entry, imported by its identity — so the runtime loads the content-hashed
 * file (runtime/region-endpoint-url.ts `note_entry_location`); an element carries its own (`src`).
 *
 * Universal leaf: the server encodes (server/document-tail.ts), the boot decodes.
 */
/** The attribute that marks a graph script (the runtime finds every one on the page by it). */
export declare const ISLAND_GRAPH_ATTR = "data-ogygia-graph";
/** The JSON shape a graph script carries. */
export interface IslandGraphWire {
    h: string[];
    e: Record<string, number[]>;
    s?: Record<string, string>;
}
/** Encode entry → chunk hrefs (and identity → location, when any) as the wire shape (JSON text,
 *  not yet script-escaped). */
export declare function encode_island_graph(graph: ReadonlyMap<string, readonly string[]>, locations?: ReadonlyMap<string, string>): string;
/** Decode a graph script's `s`: entry identity → location, as written (unresolved). */
export declare function decode_island_locations(text: string): Map<string, string>;
/** Decode a graph script's text: entry → chunk hrefs, as written (unresolved). Malformed → empty. */
export declare function decode_island_graph(text: string): Map<string, string[]>;
