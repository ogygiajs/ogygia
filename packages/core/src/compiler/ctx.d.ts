import type { ServerRealm } from './link/caps.ts';
import type { PluginMacro } from './macros/pipeline.ts';
import { type ImportKeys } from './region/transform.ts';
/** One dependency package's declared compile surface (`"ogygia": { "files": […] }` in ITS
 *  package.json) — produced by the plugin's discovery (`vite/package-files.ts`), consumed here
 *  type-only: the compiler stays browser-host-clean, so the node:fs/glob work lives plugin-side.
 *  All paths are posix REALPATHS — Vite resolves ids through symlinks (pnpm), so gate matching
 *  must speak real paths or every check silently misses. */
export interface PackageScan {
    /** The package's published name — the stable identity prefix for its regions. */
    name: string;
    /** realpath of the package root. */
    root: string;
    /** Declared bare directories (prefix-matched, so files added mid-dev still count). */
    dirs: string[];
    /** Individually declared / glob-expanded files. */
    files: string[];
}
export interface CompileCtxInit {
    root: string;
    base: string;
    /** SvelteKit `config.kit.appDir` (default `_app`) — the dir Kit emits AND serves its immutable
     *  assets under. ogygia's runtime + island chunks MUST land here too: a custom appDir otherwise
     *  404s them (Kit's adapter only maps `<appDir>/immutable/*` to the immutable-cache route). Read
     *  from Kit's `__SVELTEKIT_APP_DIR__` build define; `_app` when Kit isn't present (standalone).
     *  NOTE: only the app-internal PATH lives here. `base` / `paths.assets` (CDN) resolution is Kit's
     *  `asset()`'s job — `Region.svelte` runs every baked entry / runtime URL through it at SSR — so
     *  ogygia never bakes a base into these URLs (doing so double-applies it). */
    app_dir: string;
    libDir: string;
    /** A plugin asked for the build's measurement data (`b.measure()`: the profiler) — embedded maps,
     *  per-island detail. */
    measure: boolean;
    /** The server halves of the app's plugins (module path + options), in app order — baked into
     *  `virtual:ogygia/server-plugins`. Optional (default none). */
    server_plugins?: readonly ServerRealm[];
    /** The browser halves of the app's plugins (absolute module paths), in app order —
     *  imported by the runtime's boot. Optional (default none). */
    client_plugins?: readonly string[];
    /** The keys the plugins claim inside Kit's `config` page option (`b.routeConfig`) — read from the
     *  route files and baked into `virtual:ogygia/route-config`. Optional (default none). */
    route_config?: readonly string[];
    /** A plugin asked island entries to keep their foreign-hydrate exports (`b.foreignHydrate()`:
     *  another app's runtime wakes this app's islands). Optional (default off). */
    foreign_hydrate?: boolean;
    /** Dependency packages that DECLARED their ogygia compile surface (`"ogygia": { "files": […] }`
     *  in THEIR package.json) — prescanned + transformed like app source, node_modules gates lifted
     *  for exactly these paths. Optional (default none): standalone/browser hosts have no
     *  node_modules to declare from. */
    pkg_scan?: PackageScan[];
    /** PAGE MODULES (`b.pageModules()`): modules that render pages outside Kit's routes, whose reachable
     *  components get router-css. `page_importers`: a compiled module importing one of these specifiers
     *  is one; `page_files`: absolute paths that are page modules themselves. Optional (default none). */
    page_importers?: readonly string[];
    page_files?: readonly string[];
    is_dev: boolean;
    id_salt: string;
    visibleMargin: string | undefined;
    presets: Record<string, unknown>;
    import_keys: ImportKeys;
    /** Resolved Vite aliases (used by the `bake` macro to bundle the imports a baked fn touches). */
    resolve_alias: unknown[];
    /** The plugins' `import.meta.og.*` macros (`b.macro`), in plugin order. Optional (default none). */
    macros?: readonly PluginMacro[];
    /** ogygia's own package root — the `auto_brand` macro skips ogygia source (it can't self-register). */
    pkg_root: string;
    /** Per-build HMAC material baked into the SSR-only `virtual:ogygia/secret`. */
    build_secret: string;
    /** Region-endpoint rate limit (SSR-only), `{ max: 0 }` when disabled. */
    rate_limit: {
        max: number;
        windowMs: number;
    };
    /** Cookie name sealed into the region MAC, or '' when unbound. */
    session_cookie: string;
    /** Capability-URL TTL in seconds. */
    region_ttl: number;
    /** How long after expiry an anonymous capability still renews, in seconds (`0` = never). */
    renew_window: number;
    /** Router on (app-wide). `false` tree-shakes the feature out. */
    router_enabled: boolean;
    /** View Transitions on for SPA navs. */
    router_view_transitions: boolean;
    /** The app's `src/hooks.client.{ts,js}` absolute path, or null — its `init` runs on boot for
     *  csr=false pages (see runtime/client-hooks.ts). */
    client_hooks?: string | null;
    /** Package-internal absolute paths the emit inlines into generated virtual sources. */
    runtime_dir: string;
    runtime_hash: string;
    hmac_module: string;
    region_endpoint_module: string;
    client_binding_stub_file: string;
    /** `$app/*` → on-disk client-shim path map (island modules under csr=false). */
    app_shims: Record<string, string>;
    /** `command === 'build'` — gates the transform-time deterministic island-chunk emit. */
    is_build: boolean;
    /** Core's event emits compiled in (a plugin's `b.events()`: devtools). Bakes the standalone dock
     *  boot for csr=true pages into `virtual:ogygia/devtools-boot-url`. */
    devtools: boolean;
}
export declare class CompileCtx {
    #private;
    readonly root: string;
    readonly base: string;
    readonly app_dir: string;
    readonly libDir: string;
    readonly pkg_scan: PackageScan[];
    readonly page_importers: readonly string[];
    readonly page_files: readonly string[];
    readonly measure: boolean;
    readonly server_plugins: readonly ServerRealm[];
    readonly client_plugins: readonly string[];
    readonly route_config: readonly string[];
    readonly foreign_hydrate: boolean;
    readonly is_dev: boolean;
    readonly id_salt: string;
    readonly visibleMargin: string | undefined;
    readonly presets: Record<string, unknown>;
    readonly import_keys: ImportKeys;
    readonly resolve_alias: unknown[];
    readonly macros: readonly PluginMacro[];
    readonly pkg_root: string;
    readonly build_secret: string;
    readonly rate_limit: {
        max: number;
        windowMs: number;
    };
    readonly session_cookie: string;
    readonly region_ttl: number;
    readonly renew_window: number;
    readonly router_enabled: boolean;
    readonly router_view_transitions: boolean;
    readonly client_hooks: string | null;
    readonly runtime_dir: string;
    readonly runtime_hash: string;
    readonly hmac_module: string;
    readonly region_endpoint_module: string;
    readonly client_binding_stub_file: string;
    readonly app_shims: Record<string, string>;
    readonly is_build: boolean;
    readonly devtools: boolean;
    constructor(init: CompileCtxInit);
    /** True when `code` carries an ogygia `with { … }` island hint (gates node_modules `.svelte`). */
    has_island_hint(code: string): boolean;
    /** True when a JS module has a real `import … with { <mark key>: … }` declaration. The hint
     *  above is a text sniff, so it also matches a comment, a string or generated code that merely
     *  mentions `with { wake }`; this parses. A module that does not parse counts as marked, so a
     *  warning that depends on it errs toward speaking. */
    has_marked_import(code: string, id: string): boolean;
    /** True when `id` is inside a dependency's DECLARED `ogygia.files` surface — those files are
     *  prescanned + transformed exactly like app source (the node_modules gates lift for them). */
    in_declared_pkg(id: string): boolean;
    /** Install-independent region identity for a file under a declared package: `<name>/<rel>`.
     *  Store paths carry version + peer-resolution hashes (`node_modules/.pnpm/pkg@1.2.3(...)`),
     *  so a root-relative identity would change per install/machine and prod HTML would stop
     *  matching its chunks. Returns `null` for anything not under a declared package root. */
    pkg_identity(abs: string): string | null;
    /** The runtime's feature set, as a name segment: the prescan's feature hash, and a trailing `h` when
     *  the app has `hooks.client.ts` (the runtime entry then dynamic-imports it). Empty until prescan
     *  runs. Both the stable name and the content-hashed file carry it, so a name says which runtime. */
    runtime_features(program_feature_hash: string): string;
    /** The runtime's STABLE name (`RUNTIME_HASH` ⊕ its features): its identity — the key the handoff
     *  maps to the content-hashed file the page loads (a name, not a file). Computed here
     *  (not the caller) so both build legs name it identically. `program_feature_hash` is
     *  `Program.runtime_feature_hash`, threaded in by the caller so this stays a pure naming function. */
    runtime_chunk_filename(program_feature_hash: string): string;
    /** App-internal URL of the runtime chunk (leading slash + appDir; NO base). SSR bakes it as the
     *  `<script src>`, then `asset()` prepends base / the assets CDN at render time. */
    runtime_chunk_url(program_feature_hash: string): string;
    /** Output filename for a hydrate island chunk (under the app dir; an on-disk build path). */
    island_chunk_filename(iid: string): string;
    /** App-internal URL of a hydrate island chunk (leading slash + appDir; NO base — `asset()` adds it). */
    island_public_url(iid: string): string;
    /** Read a file as UTF-8, or `null` if it can't be read (the transform tolerates missing deps). */
    read_file(abs: string): string | null;
    /** Virtual island ENTRY module id for an island id. */
    island_virtual_id(iid: string): string;
    /** Virtual wrapper `.svelte` module id for an island id. */
    wrapper_virtual_id(iid: string): string;
    /** Dev URL for a dynamic `import(entry)` of a virtual island module. Base-LESS, exactly like the
     *  prod island/runtime URLs and the dev runtime URL: `Region.svelte` runs it through Kit's `asset()`
     *  at SSR, which is the sole base authority. Baking `base` here would double it (Vite dev serves
     *  `/@id/…` UNDER base, and `asset()` already adds that prefix). */
    dev_url_for(virtualPath: string): string;
}
