import type { Plugin } from 'vite';
import { type Program } from '../compiler/program.ts';
/**
 * Rewrite vite-plugin-svelte island sourcemap `sources` so Vite treats them as virtual.
 *
 * Svelte emits the basename of `virtual:ogygia/island/<id>.svelte` (just `<id>.svelte`).
 * That string does not match Vite's `virtualSourceRE`, so `injectSourcesContent` tries a
 * disk read and warns "points to missing source files". Pointing sources back at the
 * full virtual module id silences the warning (and keeps maps coherent).
 *
 * @internal Also covered by unit tests.
 */
export declare function rewrite_island_sourcemap_sources(moduleId: string, sources: (string | null)[] | undefined): (string | null)[] | null;
/** The `ogygia:island-sourcemaps` post plugin (Vite flattens it into the adapter's array). */
export declare function island_sourcemaps_plugin(deps: {
    program: Program;
    is_island_path: (id: string) => boolean;
}): Plugin;
