import { type PageKeys } from './page-keys.ts';
import { type IslandHazard } from '../../insights/hydration-hazards.ts';
/**
 * Kit's own `hash()` (`@sveltejs/kit/src/utils/hash.js`: djb2 ×33 xor, unsigned, base36) — the
 * function a remote's id is minted with: `${hash(file)}/${exportName}`, `file` the module's path
 * relative to `process.cwd()`, posix. Mirrored here (Kit does not export it) so the build can
 * name a remote by the same id the server sees on `internals.id` at render time. Covered by a
 * vector test against ids observed from a real Kit build.
 */
export declare function kit_remote_hash(file: string): string;
/**
 * The Kit remote id-hash of a CLIENT module id, or `null` for a module that is not a remote file.
 * `cwd` is what Kit hashed the file against (`process.cwd()` at build), either separator.
 *
 * @internal Exported for the plugin and unit tests.
 */
export declare function remote_hash_of(module_id: string, cwd: string): string | null;
/**
 * From a client `generateBundle` output, collect transitive static `imports` for each
 * `og-region.<id>.js` facade. Keys/values are public URLs (`/_app/immutable/…`).
 * Used so SSR can `modulepreload` hashed dependency chunks for `hydrate: 'load'` islands
 * (Vite’s auto graph does not apply to `@vite-ignore` `import(entry)`).
 *
 * @internal Exported for unit tests.
 */
export declare function collectIslandDepModulepreloads(bundle: Record<string, {
    type: string;
    fileName?: string;
    imports?: string[];
    dynamicImports?: string[];
    /** The source module ids bundled into this chunk (Rollup/rolldown `OutputChunk`). */
    moduleIds?: string[];
    /** Vite/rolldown-vite chunk metadata — `importedCss` lists the CSS assets a chunk owns. */
    viteMetadata?: {
        importedCss?: Set<string> | string[];
    };
}>, 
/**
 * Source files whose presence in an island's chunk closure means the island READS THE PAGE
 * (the `$app/state` / `$app/stores` shims). Per entry, `page[entryUrl]` says whether any chunk
 * in its closure bundles one of them — what lets the handle skip the page seed on a page whose
 * islands never read it. Absolute paths, either separator.
 */
page_reader_files?: readonly string[], 
/**
 * Names a bundled module's Kit remote id-hash (`remote_hash_of`), or `null` for a module that is
 * no remote file. Per entry, `remotes[entryUrl]` lists every remote module in the island's chunk
 * closure — static AND dynamic imports, since a remote called after an `await import()` is still
 * this island's call — which is what lets the handle seed a remote's SSR result only when some
 * island on the page can call it (REMOTE SEED ONLY WHEN REACHABLE). Absent → every entry `[]`.
 */
remote_hash?: ((module_id: string) => string | null) | null, 
/**
 * SEED SHAPING: the top-level `page.data` keys a bundled module reads (link/page-keys.ts, recorded
 * by the transform), `'all'` when its reads could not be pinned, `null` for a module that never
 * imports the page. Per entry, `page_keys[entryUrl]` is the union over its chunk closure — the
 * keys the handle ships — or `null` (ship all) when any module said `'all'`, or when the closure
 * reads the page through a module the transform never saw. Absent → every reader `null`.
 */
page_keys_of?: ((module_id: string) => PageKeys | null) | null, 
/**
 * WAKE ADVISOR: reads a bundled `.svelte` source by id so the collector can count what the
 * island's components do (handlers, `$state`, `bind:`…). Per entry, `interactivity[entryUrl]`
 * is the union over its closure's own components (dependencies and ogygia's wrappers skipped).
 * Absent → no facts (the profiler shows none).
 */
read_source?: ((id: string) => string | null) | null, 
/**
 * The runtime entry chunk's exact file name (compiler `runtime_chunk_filename`). Its static
 * imports are recorded under its URL so SSR hints them beside the runtime script. Matched EXACTLY,
 * never by pattern: the name is ours, and a hand-written pattern drifts from it (the `h` suffix a
 * `hooks.client` app gets was missed, and such apps shipped the runtime with no preloads).
 * Absent (`null`) → no runtime entry.
 */
runtime_file?: string | null, 
/**
 * IDENTITY vs LOCATION: which emitted file is which entry. An island entry and the runtime are
 * content-hashed files; every map below is keyed by their IDENTITY (the stable public URL SSR bakes,
 * `island_public_url` / the runtime's stable URL), never by the hashed name. `islands`: hashed
 * file name → identity; `runtime`: the runtime's identity (its file is `runtime_file`). Absent →
 * a file under the stable name is its own identity (the shape before hashing, and the unit tests').
 */
entries?: {
    islands: ReadonlyMap<string, string>;
    runtime: string | null;
} | null): {
    js: Record<string, string[]>;
    css: Record<string, string[]>;
    page: Record<string, boolean>;
    page_keys: Record<string, string[] | null>;
    remotes: Record<string, string[]>;
    interactivity: Record<string, IslandInteractivityFacts>;
    /** each island's components' lines that draw differently in the browser (hydration-hazards.ts),
     *  by entry — the app's own and the site kit's (ogygia's content components); not other packages */
    hazards: Record<string, IslandHazard[]>;
    /** what is inside each chunk an island pulls: a readable source list per public href */
    contents: Record<string, string[]>;
    /** each chunk's heaviest named modules with their rendered bytes (a package sums its modules):
     *  what the report names as most of an island's code. Apart from `contents`, which stays names
     *  only (a chunk's identity across builds) */
    heavy: Record<string, ChunkHeavy>;
    /** modules the build shipped as two copies (one package file by two paths), each copy's chunk */
    dupes: DuplicateModule[];
};
/** One module the build shipped as two (or more) copies: the same file of a package reached by two
 *  paths (its source and its build, two versions in node_modules), each copy in its chunk. */
export interface DuplicateModule {
    /** the module, package-relative (`ogygia/runtime/beacon`, `svelte/internal/client/index`) */
    name: string;
    /** `from`: where the copy came from — the package's folder (`ogygia/src`, `ogygia/dist`) or its
     *  installed version (`svelte@5.56.8`) — the two paths, told apart */
    copies: {
        file: string;
        bytes: number;
        from?: string;
    }[];
}
/** Where a module id's copy came from: an installed package's version (`name@1.2.3`, from a pnpm
 *  store path), else the package's top folder (`name/src`, `name/dist`). */
export declare function module_origin(id: string): string | undefined;
/** A module id as the file of its package, the build-or-source folder and the extension left out:
 *  two ids with one key are one module twice. Null for ids that are no file (virtual, `\0`). */
export declare function module_key(id: string): string | null;
/** Every module the build shipped more than once: one key, two or more ids (a single id is in one
 *  chunk only). The heaviest first, copies of 512 bytes or more, at most 50.
 *  @internal exported for the tests */
export declare function duplicate_modules(chunks: readonly {
    file: string;
    ids: readonly string[];
    size_of?: (id: string) => number;
}[]): DuplicateModule[];
/** A chunk's rendered size and its heaviest named modules. */
export interface ChunkHeavy {
    /** every module's rendered bytes in the chunk */
    total: number;
    /** the five heaviest, by the names `contents` uses (a package's modules summed) */
    top: {
        name: string;
        bytes: number;
    }[];
}
/** A chunk's modules as readable names (the same names `contents` uses) with their rendered bytes,
 *  heaviest first, the five heaviest; a package's modules summed under its name.
 *  @internal exported for the tests */
export declare function chunk_module_bytes(module_ids: readonly string[], size_of: (id: string) => number): ChunkHeavy;
/**
 * A chunk's source modules as a short readable list: the app's own files first (relative to
 * `src/`), then the packages, the framework runtimes named plainly. Capped; the tail is "+N more".
 * @internal exported for the tests
 */
export declare function summarize_chunk_contents(module_ids: readonly string[], max_files?: number, max_pkgs?: number, size_of?: (id: string) => number): string[];
/** What an island's components do (the wake advisor's evidence) — see `interactivity_facts`. */
export interface IslandInteractivityFacts {
    handlers: number;
    state: number;
    effects: number;
    binds: number;
    actions: number;
    /** remote modules its closure can call (set per island from the remotes scan) */
    remotes?: number;
    /** `{await …}` / `{#await …}` in its markup: a value that lands after it wakes */
    awaits?: number;
    /** context reads and rune-module imports: state another island can change */
    shared?: number;
    files: number;
}
/** Count a component source's interactivity markers. */
export declare function interactivity_facts(src: string): IslandInteractivityFacts;
/** Stable handoff path under Kit's `outDir`: client `generateBundle` writes; SSR reads at render
 *  (Kit is SSR-first). */
export declare function islandDepsHandoffPath(out_dir: string): string;
/**
 * INLINE REGION CSS. For every region CSS asset (`hrefs`: the union of the handoff's `css` and
 * `content_css` lists) whose bytes are under `threshold` — Kit's `inlineStyleThreshold`, the same
 * number Kit inlines its own route sheets under — keep the asset's text, keyed by its public href.
 * The render then emits `<style data-ogygia-region-css="href">` in place of a blocking `<link>`:
 * a page carrying twenty-five small island sheets (42 KB on a measured home page, twenty of them
 * under 3 KB) stops paying twenty-five requests before first paint. `0` = keep nothing (Kit's
 * default: never inline). Above the threshold, or not an emitted asset, → not in the map → linked.
 *
 * @internal Exported for unit tests.
 */
export declare function collect_inline_css(bundle: Record<string, {
    type: string;
    fileName?: string;
    source?: string | Uint8Array;
}>, hrefs: Iterable<string>, threshold: number): Record<string, string>;
export declare function island_deps_module(ssr: boolean, is_dev: boolean, out_dir_rel?: string): string;
