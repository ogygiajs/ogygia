/**
 * The component-import line for a generated module — a NAMED export (`import { Header as X } from
 * '@barrel'`, the asRegion/barrel escape hatch) or a plain default (`import X from './X.svelte'`, a
 * `.svelte` file or a package default). `exportName` is undefined/`'default'` for the default case.
 */
export declare function component_import_line(local: string, spec: string, exportName?: string): string;
/**
 * The island ENTRY module — a JS re-export of the real component, loaded on both client hydrate and
 * server render. The transportables import registers every `[ogygia.wire]` codec before props decode,
 * so an island receiving a transportable prop never needs to import the class itself. Shared by the
 * `.svelte` host and the `.ts` registry (a `wake:` mark) so a mountable binding is built the same way
 * from either.
 */
export declare function island_entry_source(componentPath: string, iid: string, exportName?: string): string;
/** Where an island entry's foreign-hydrate exports begin (compiler/driver.ts cuts from here). */
export declare const FOREIGN_HYDRATE_MARK = "// og:foreign-hydrate\n";
/**
 * The island WRAPPER (`.svelte`) — a MOUNTABLE component that renders `<ogygia-region>` on its wake
 * schedule. Placing it (`<C/>`, `<svelte:component this={C}/>`) emits the shell; the island's JS is
 * fetched only when the shell wakes (e.g. `wake: 'visible'` → on scroll-into-view). Shared by the
 * `.svelte` host and the `.ts` registry. `entry_url` is the resolved client/dev module URL the caller
 * computes (ctx-dependent); `lang` is the `<script>` lang attribute (`''` for plain JS).
 */
export declare function island_wrapper_source(iid: string, componentPath: string, entryPath: string, strategy: string, options: Record<string, unknown> | undefined, exportName: string | undefined, entry_url: string, lang: string): string;
/**
 * The island wrapper's CLIENT leg (a csr=true-capable host imports it; Kit hydrates the island
 * inline as a normal component). The SSR wrapper imports the component statically — it must
 * render. The client wrapper must NOT: Kit links a route's `node.stylesheets` and preloads from the
 * page's STATIC client graph, so a registry of N marked blocks imported by a csr=true route linked
 * every block's CSS + chunk on every page (a newsroom page: 172 stylesheets for 4 islands). The
 * component therefore comes through `lazy_entry_source` — a top-level-await module that imports
 * the real entry only for the islands this document RENDERED (the SSR stamped a
 * `<meta name="ogygia-kit-island">` per rendered island), so Kit still hydrates them in place with
 * the component in hand, and a block nobody rendered costs nothing. Mounted fresh on a Kit
 * client-side navigation (no SSR, no stamp), the wrapper loads the entry on demand and renders once
 * it lands — a client render, so no hydration to mismatch.
 */
export declare function island_wrapper_client_source(iid: string, lazyPath: string, strategy: string, options: Record<string, unknown> | undefined, entry_url: string, lang: string): string;
/**
 * The client wrapper's component source (`lazyEntryVirtualId`). Decides ONCE, at module
 * evaluation — before Kit hydrates, because Kit awaits the page node's import and a top-level
 * await holds it. The two facts it reads are the document's own: `documentIsCsrTrue()` (the ONE
 * csr fact Region reads on both legs) and the `<meta name="ogygia-kit-island">` stamp Region
 * emits per rendered inline island (context.ts `claim_kit_island`).
 *   - not a Kit-hydrated document (the runtime woke this island's parent; no stamp exists there):
 *     import the entry now — a nested island must be in hand when its parent hydrates;
 *   - a Kit document that rendered this island: import the entry now, Kit hydrates it in place;
 *   - a Kit document that did NOT render it (an unrendered registry block): `undefined`, nothing
 *     fetched, nothing linked — `load()` is the on-demand path a client-side navigation takes.
 * `entry_url` is the same string Region bakes into the stamp (`__entry`), on both legs.
 */
export declare function lazy_entry_source(entryPath: string, entry_url: string): string;
/**
 * Build the held-region descriptor shared by the `.svelte` and `.ts` paths. It ALWAYS carries a
 * client chunk + `__module` (the region MIGHT be woken); when used statically the chunk is simply
 * never fetched (HTML only at runtime). Two marker flavors feed it:
 *   - `wake: 'x'`      → bakes `__hydrate: 'x'` — `region(C, props)` wakes on that schedule.
 *   - `region: 'raw'`  → bakes NO schedule — `region(C, props, { wake })` sets it at the call.
 * `region()` reads `opts.wake ?? binding.__hydrate`, so a baked schedule is the default and the call
 * can override. `kind` is always `'hydrate'` so the chunk is emitted; `server:true` — the endpoint
 * renders the HTML either way.
 */
export declare function make_region_binding(opts: {
    iid: string;
    componentPath: string;
    entryPath: string;
    hostPath: string;
    moduleUrl: string;
    /** baked wake schedule from a `wake:` mark; absent for `region: 'raw'` (schedule set at the call) */
    hydrate?: string;
    /** rootMargin baked when `hydrate` is `'visible'` */
    hydrateMargin?: string;
    /** named export to pull (asRegion/barrel); undefined → default import */
    exportName?: string;
    identity: string;
}): {
    id: string;
    virtualPath: string;
    source: string;
    bindingPath: string;
    bindingSsrSource: string;
    bindingClientSource: string;
    hostPath: string;
    componentPath: string;
    server: boolean;
    kind: string;
    held: boolean;
    lakes: never[];
    identity: string;
};
/**
 * The complete island record for a `wake:` mark — the ONE emitter shared by the `.svelte` host (a
 * placed `import X with { wake }`) and the `.ts` registry (a `wake:` mark handed to a renderer). The
 * binding it produces is BOTH mountable (placing it, incl. via `<svelte:component>`, renders the
 * `<ogygia-region>` shell that fetches the island JS only on its schedule) AND holdable (the descriptor
 * fields ride on the wrapper, so `region(C)` still works). Threading both paths through here is what
 * keeps `.svelte` and `.ts` `wake:` byte-identical — a `.ts` `wake: 'visible'` is exactly a `.svelte`
 * `wake: 'visible'`. Callers own the host-specific import rewrite; this owns the record.
 * `moduleUrl` is the resolved client/dev module URL; `lang` is the wrapper `<script>` lang (`''` = JS).
 */
export declare function make_wake_island(opts: {
    iid: string;
    componentPath: string;
    entryPath: string;
    wrapperPath: string;
    moduleUrl: string;
    strategy: string;
    options?: Record<string, unknown>;
    exportName?: string;
    hostPath: string;
    identity: string;
    lang: string;
    /**
     * A `.ts` registry / remote binding, which may be handed to `region()` and CROSS the wire (a live
     * or remote region): it needs a server-manifest entry (`server`) so its endpoint can render it, and
     * the `held` mark that pulls in the live/morph runtime. A `.svelte` placed island never crosses, so
     * it stays `server:false`. Either way the binding is the SAME mountable wrapper — only the manifest
     * flags differ, which is also why the two carry distinct identities (an endpoint vs none).
     */
    held?: boolean;
}): {
    kind: string;
    lakes: never[];
    identity: string;
    strategy: string;
    keep: unknown;
    held?: boolean;
    id: string;
    virtualPath: string;
    wrapperPath: string;
    wrapperSource: string;
    wrapperClientSource: string;
    lazyPath: string;
    lazySource: string;
    bindingPath: string;
    bindingSsrSource: string;
    bindingClientSource: string;
    source: string;
    hostPath: string;
    componentPath: string;
    server: boolean;
};
/**
 * The SERVER-island wrapper (`.svelte`) — `render: 'deferred'`: a hole whose HTML is fetched on the
 * `wake` schedule. `__defer` carries the fetch schedule; `__cacheTtl` (when signed) sets the hole's
 * response cache; a deferred island that ALSO hydrates carries `__hydrate` + `__module` (its client
 * entry URL). `module_url` is the resolved client/dev entry URL (used only when it hydrates); `lang`
 * is the wrapper `<script>` lang.
 */
export declare function server_wrapper_source(iid: string, componentPath: string, entryPath: string, options: Record<string, unknown> | undefined, exportName: string | undefined, module_url: string, lang: string, component?: boolean): string;
/**
 * The LAKE wrapper (`.svelte`) — `render: page, wake: none`: a frozen region inside a hydrated island.
 * A `swr` lake carries an endpoint (`__when` + `__props`) to remount on its schedule; `cache`/`empty`
 * are wrapper-only. Static `<OgygiaLakeInner>` (not dynamic) preserves the LAKE-ENVELOPE; the client
 * build swaps that import for the render-nothing stub. `lang` is the wrapper `<script>` lang.
 */
export declare function lake_wrapper_source(iid: string, componentPath: string, options: Record<string, unknown> | undefined, exportName: string | undefined, lang: string): string;
/** Map a hydrate strategy (+ options) to the Island wrapper attribute markup. */
export declare function strategy_to_attr(strategy: string, options?: Record<string, unknown>): string;
/** Rewrite `$app/{state,stores,navigation}` string literals to absolute shim paths. */
export declare const APP_SHIM_IMPORT: RegExp;
/**
 * Rewrite a lake binding's import to the render-nothing placeholder (client island modules only).
 * Default imports are repointed; named imports drop that specifier (and keep siblings) then add a
 * default import of the placeholder under the same local name.
 *
 * @internal Used by the plugin client emit and unit tests.
 */
export declare function rewrite_lake_import_to_placeholder(src: string, local: string, placeholder: string): string;
