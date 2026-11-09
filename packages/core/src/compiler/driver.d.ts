import { transformTsRegions } from './region/transform.ts';
import type { Program } from './program.ts';
import type { CompileCtx } from './ctx.ts';
/** The bundler's `emitFile` for an entry chunk, by `name` (the output pattern content-hashes it).
 *  Returns the reference id. */
export type EmitChunk = (chunk: {
    type: 'chunk';
    id: string;
    name: string;
}) => string;
/** Shared OGYGIA_PROFILE instrument — the adapter owns the maps/counters; the driver writes into
 *  them so the transform-phase metrics (and the determinism digest source) live with the transform. */
export interface Profiler {
    prof: {
        transformMs: number;
        transformN: number;
        transformHit: number;
        prescanMs: number;
        bakeMs: number;
        bakeN: number;
        resolveMs: number;
        loadMs: number;
    };
    P: boolean;
    outHash: Map<string, number>;
}
/**
 * The island shim for an `$app/*` import, by specifier or by where Kit's alias sent it: Vite's alias
 * plugin runs before any plugin's resolveId, so an import the transform did not rewrite (a module
 * that joined the island graph late) arrives as `<kit>/src/runtime/app/state`, `…/state/index.js`.
 */
export declare function app_shim_for(source: string, shims: Record<string, string>): string | null;
export declare class Compiler {
    #private;
    readonly program: Program;
    readonly transform_cache: Map<string, {
        code: string;
        result: unknown;
    }>;
    readonly profiler: Profiler;
    /** Every `import.meta.og.$` hoist collected across the build (tag → factory source). Filled by
     *  `macros()`; drained by the adapter's fn-manifest emit (dev load leg, renderChunk, writeBundle). */
    readonly dollar_hoists: Map<string, string>;
    /** True (once) when a server island registered since the last manifest emit — re-invalidate it. */
    server_manifest_stale(): boolean;
    constructor(program: Program, profiler: Profiler);
    /** Bind the resolved compile context (called once the bundler has resolved the build). */
    configure(ctx: CompileCtx): void;
    /**
     * Devtools: the `island id → component name` map, read at call time off the live registry (so a
     * dev-server middleware serves a COMPLETE, current map — no stale virtual-module snapshot). Keys
     * are the island id (`<hash>` in `virtual:ogygia/island/<hash>.js`); values the component's
     * basename. A held/generated island with no source file is skipped (the tab keeps its short hash).
     */
    region_names(): Record<string, string>;
    /**
     * Run the module-macro passes (`wire`/`$`/`source`/`store`/auto-brand, the plugins' macros, then
     * `bake`) over one module — the leg that must land before the island transform / svelte compile /
     * ts-region minting sees it. `source` is the CURRENT text (a plugin's pre-transform may already have
     * edited it). Returns `{ code, touched }`; the caller nulls its own sourcemap when `touched`.
     */
    macros(source: string, id: string): Promise<{
        code: string;
        touched: boolean;
    }>;
    /**
     * Transform a content (`.svx`/`.md`) island source the markdown preprocessor hands back — always
     * wrapper-linked (`linkVirtual: true`), because a preprocessor output is shared across the ssr/client
     * legs and can't take the csr=false stub split; content files aren't routes, so they'd get wrappers
     * anyway. Registers the descriptors and returns the rewritten code, or `null` when it has no islands.
     * This is the transform the adapter installs on the content-island bridge.
     */
    transform_content_island(source: string, filename: string): string | null;
    transform(source: string, id: string, opts?: {
        ssr?: boolean;
        linkVirtual?: boolean;
    }): unknown;
    /**
     * Mint the `.ts` / `.js` regions in one module — `with { wake: … }` load/remote imports become
     * island descriptors. The ts-region half of the front-end, sharing the driver's resolved context
     * (so both the prescan and the transform hook mint identically). Not memoized — the caller gates it
     * on the id + marker; the returned descriptors are the caller's to `register`.
     */
    ts_regions(source: string, id: string): ReturnType<typeof transformTsRegions>;
    /**
     * Discover every island up front — walk `src/`, transform each `.svelte` host and mint each
     * `.ts`/`.js` region, register the descriptors, then complete `island_graph` TRANSITIVELY and
     * finalize the runtime capability marks (so the sticky runtime entry bundles only what the app
     * uses, and its immutable chunk name busts on a feature-set change). Once per session, so the
     * adapter can call it from any hook. Populates the `Program`; the fs walk is the only side effect.
     */
    prescan(): void;
    /** DEV: take the modules newly marked as island code since the last drain (see above). */
    drain_closure_marks(): string[];
    mark_island_closure(componentAbs: string): string[];
    /**
     * Scan ENTRIES for Vite's dep optimizer: every hydrate island's component file and the host file
     * that places it — real, absolute, on-disk source paths. Under `csr = false` Kit ships no client
     * entry and registers only `routes/**\/+*` as scan entries, so Vite's scanner reaches an island
     * only when a route file imports it statically. An island behind a block registry, an
     * `import.meta.og.regions()` glob or a `.remote.ts` mint is never crawled: its client deps are
     * discovered LAZILY on its first wake, and every discovery re-optimizes, rotates the optimizer's
     * browserHash and full-reloads — on a large app a reload storm that never settles. The adapter
     * appends these to `optimizeDeps.entries` (dev) so Vite's OWN scanner crawls them at startup with
     * the full plugin pipeline: its resolver, every plugin's `resolveId` (a `?client` import resolves
     * through vite-plugin-iso-import), a linked workspace package followed as SOURCE and never
     * pre-bundled, the app's `exclude` honoured.
     *
     * Deliberately NOT a self-computed `optimizeDeps.include` list. A resolver that is not Vite's
     * mis-classifies something Vite knows — a plugin query, a workspace link, an `exports` map — and
     * a wrong `include` hands rolldown an id it cannot load: `UNLOADABLE_DEPENDENCY`, a dead dev
     * server (two field-reported regressions). An entry can only ever ADD a crawl root; what the
     * crawl finds is Vite's call. A `defer` island renders on the server (its closure is not client
     * code) and a lake ships no client JS, so neither is an entry; the host file covers a
     * portable-snippet synth, which has no component file of its own. Needs `prescan()`; deduped,
     * sorted, existing source files only.
     */
    island_scan_entries(): string[];
    /** The feature-selected runtime chunk name (immutable-cached). Needs prescan to have run for a
     *  non-empty feature hash; both build legs prescan the same source → the same name. */
    runtime_chunk_filename(): string;
    /** Public URL of the runtime chunk (asset prefix + filename — honors a non-root base / assets CDN). */
    runtime_chunk_url(): string;
    /** The server-router component roots (link/router-css.ts). Build: prescan is complete before any
     *  consumer runs — memoized. Dev: modules appear lazily (HMR), recompute per call. */
    router_css_roots(): string[];
    /** Does the program hold ANY hydrate island? The runtime-emission gate needs this because
     *  `hasAnyCsrFalseRoute` only inspects Kit PAGE leaves — an app whose islands live solely in
     *  router-rendered components (a pure-router / fragment-only service has ZERO `+page` files)
     *  answers "no csr=false page" while its documents still `<script src>` the runtime. */
    /**
     * Server-only islands — `render: 'deferred'` with no client chunk — and the component file each
     * renders. Nothing on any page links such a component's CSS (Kit collects stylesheets from the
     * client graph; this subtree is never in it), so the client leg compiles each one's whole tree
     * CSS into a dedicated asset the hole response links (vite/index.ts, `region_css_links`).
     * Sorted for determinism; a component shared by several ids is emitted once (by `abs`).
     */
    server_island_css_roots(): Array<{
        iid: string;
        abs: string;
    }>;
    /** The public URL key a server island's CSS is handed off under (matches `island_url[id]`). */
    island_public_url(iid: string): string;
    has_hydrate_regions(): boolean;
    /** The server leg's real module graph, for the client-leg handoff (link/emit-gate.ts). */
    ssr_transformed_hosts(): string[];
    /**
     * Client leg: the runtime chunk + one deterministic chunk per deduped hydrate region. `loaded` —
     * the server leg's transformed-module set (the handoff the plugin reads) — gates the emit to
     * islands whose HOST the server bundle actually contains; `null` (no handoff: standalone, or a
     * client-only build) keeps every prescanned island, as before. Returns how many were skipped.
     */
    emit_build_chunks(emitFile: EmitChunk, { emitRuntime, loaded }: {
        emitRuntime: boolean;
        loaded?: Set<string> | null;
    }): number;
    /** Client-build refs of each emitted island entry (by island id) and of the runtime entry: the
     *  bundle end turns them into the hashed file names the handoff maps the stable names to. */
    readonly island_entry_refs: Map<string, string>;
    runtime_entry_ref: string | null;
    /** The location map's served path (`/<appDir>/immutable/og-locations.<hash>.json`), once
     *  `location_map` wrote it: the handoff carries it to the server (`locations`). */
    location_map_url: string | null;
    /**
     * At the bundle's end (the names are final): each entry's IDENTITY → its LOCATION. `islands` maps
     * an island entry's hashed file to its identity (the collector keys every map by identity);
     * `locations` is what the handoff carries to the server (`entries`): identity → served path.
     * `get_file_name` is the bundler's `this.getFileName`.
     */
    entry_locations(get_file_name: (ref: string) => string): {
        islands: Map<string, string>;
        runtime: string | null;
        runtime_file: string | null;
        locations: Record<string, string>;
    };
    /** One hydrate island's entry, content-hashed by the bundler (the location maps that name it are
     *  written at the bundle's end: `location_maps`). */
    emit_island_entry(emitFile: EmitChunk, rid: string, virtualPath: string): void;
    /**
     * The output file pattern for one of OUR entries (by the chunk name `emit_island_entry` / the
     * runtime emit gave it), else null (the app's own naming applies). Readable and content-hashed:
     * `<appDir>/immutable/og-region.<iid>.<hash>.js`, `…/og-runtime-<features>.<hash>.js` — the hash is the
     * cache law, the name is for people (a network tab, a CDN rule, a profile). It never equals a
     * stable name, which has no hash segment.
     */
    entry_file_pattern(chunk_name: string | undefined): string | null;
    /**
     * The build's location maps (link/location-map.ts), for the bundle's end (the names are final):
     * every island entry's identity → its hashed file, content-hashed and at the one fixed name.
     * `get_file_name` is the bundler's `this.getFileName`. Empty with no island.
     */
    location_maps(get_file_name: (ref: string) => string): {
        fileName: string;
        source: string;
    }[];
    /**
     * Emit one ogygia VIRTUAL module's source: the config/capability virtuals (secret / sign / rate-limit
     * / router / session / ttl / manifests / runtime entry+url / transport / dev-hmr / request-event /
     * region-endpoint), and the registered island/region sources (with the client leg's `$app/*`-shim +
     * lake-placeholder rewrites). Returns the source string, or `null` if `id` is not an ogygia virtual —
     * the adapter owns only the FOUC-css virtuals (they carry a Vite `moduleType`) and the Vite build
     * value threaded in here (the `universalHooks` path).
     */
    emit(id: string, { ssr, universalHooks, resolve, kitCodec }: {
        ssr: boolean;
        universalHooks: string | null;
        /** the bundler's resolver (the router-CSS tree walk: compiler/fouc-css.ts) */
        resolve?: (spec: string, importer: string) => Promise<string | null>;
        /** Kit 3's own codec module (`#app/internal/transport`), when the app's Kit has one */
        kitCodec?: string | null;
    }): string | Promise<string> | null;
    /**
     * Resolve an ogygia-owned import id: the virtual-module vocabulary (config/manifest virtuals + FOUC
     * graph + client-binding stub), and the island CLIENT graph — `$app/*` shims for island importers,
     * virtual island/wrapper ids, and relative imports of a generated island module resolved against its
     * host (marking each resolved dep into `island_graph` so its own `$app/*` stays shimmed). `resolve` is
     * the bundler's own resolver (Vite `this.resolve`), threaded in so the driver stays bundler-agnostic.
     * Returns a resolved id / result, or `null` to defer to the bundler. The adapter handles the few
     * package/Kit-specific ids first (ogygia injected imports, Kit's remote runtime, the kit-wire path).
     */
    resolve_id(source: string, importer: string | undefined, { ssr, resolve }: {
        ssr: boolean;
        resolve: (source: string, importer: string, opts: {
            skipSelf: boolean;
        }) => Promise<{
            id: string;
        } | null>;
    }): Promise<string | {
        id: string;
    } | null>;
    /**
     * The per-file transform pass: content-preset tagging ▸ `import.meta.og.*` macros ▸ the host-island
     * transform (`.svelte`) ▸ ts/js region minting (`.ts/.js`) ▸ the client `$app/*` shim. Registers the
     * discovered descriptors into the `Program`, and (client build only) emits the deterministic chunk for
     * any hydrate island a library component declares that the prescan couldn't see — via the `emitFile`
     * callback (the one Vite primitive threaded in). Returns the Vite transform result, or `null` if the
     * module was untouched. `prescan()` runs first so `island_graph` is complete before any module lowers.
     */
    transform_module(code: string, id: string, { ssr, emitFile }: {
        ssr: boolean;
        emitFile: EmitChunk;
    }): Promise<{
        code: string;
        map: unknown;
    } | null>;
    /**
     * Patch the fn-manifest placeholder in a finished chunk with the collected `og.$` factory
     * registrations — every transform has run by renderChunk, so `dollar_hoists` is complete. Registrations
     * go through the globalThis bridge the placeholder module installed (rename-proof under minification).
     * Returns the patched chunk, or `null` if this chunk carries no placeholder.
     */
    patch_fn_manifest(code: string): {
        code: string;
        map: null;
    } | null;
    /**
     * Patch the server manifest's page-data placeholder: per server island (a hole), does its SERVER
     * tree — the component and everything it imports, statically or dynamically (a registry's blocks)
     * — read `page.data`? The transform recorded each module's reads (`page_keys`, seed shaping); by
     * renderChunk the graph is complete. A hole that never reads it never pays the page lookup
     * (server/render-page.ts). One walk per hole, sharing what earlier walks proved: a walk that ends
     * with no reader proves every module it visited reads nothing. `graph` is the bundler's module info.
     */
    patch_page_data_reads(code: string, graph: (id: string) => {
        importedIds: readonly string[];
        dynamicallyImportedIds: readonly string[];
    } | null, module_ids: () => Iterable<string>): {
        code: string;
        map: null;
    } | null;
    /** True when `file` is a registered island HOST (a component that declares islands). */
    is_registered_host(file: string): boolean;
    /**
     * Drop the cached virtual island modules + the registry rows for `file` — call when a HOST changes
     * (an import-target rename keeps the same island id) or an ENTRY component is deleted (NOT on ordinary
     * entry-component content edits — those are soft HMR). Mutates the Program; `invalidate` is the
     * bundler's module-invalidation (Vite's moduleGraph), threaded in. Returns whether anything changed.
     */
    invalidate_for_file(file: string, { deleted, invalidate }: {
        deleted?: boolean;
        invalidate: (id: string) => void;
    }): boolean;
}
