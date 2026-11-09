/** the payload the profiler reads (profiler/embedded-maps.ts) */
export interface ProfilerMaps {
    v: 1;
    /** chunk file (relative to the server output) → [first line, last line, module id] */
    modules: Record<string, [number, number, string][]>;
    /** chunk file → its sourcemap, as the JSON text the build wrote */
    maps: Record<string, string>;
    /** a build WITHOUT maps: the app's own source files at the lines of its chunks, by module id
     *  (`src/lib/x.ts`) — what the profiler matches the chunks' lines to by text on a host without
     *  `src/` */
    sources?: Record<string, string>;
    /** ...and those chunks' own text, by chunk file */
    chunks?: Record<string, string>;
}
export declare function fill_profiler_maps(dir: string, bundle: Record<string, unknown>, root: string): boolean;
/**
 * A CHUNK'S MAP, CUT TO WHAT THE PROFILER READS: the mappings and names whole (every frame's line
 * and name), the source TEXT only for the app's own code files — what the source checks read on a
 * host without `src/` (a load line by line, a component's `{#each}`, a late island's data). A
 * package's text and imported data (`.json`: no function runs on its lines) are the bulk of a real
 * app's maps and never read there. Undefined for a map of data alone (nothing to name).
 */
export declare function slim_map(raw: string, chunk_dir: string, src: string): string | undefined;
