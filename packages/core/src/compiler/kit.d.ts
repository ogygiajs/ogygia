/** The Kit-internal + app paths ogygia deep-imports (resolved off the APP root, not this package). */
export interface KitPaths {
    /** Kit's internal wire-protocol module (deep import), or null → built-in devalue codec fallback. */
    kit_wire_path: string | null;
    /** Kit's client remote-functions entry (Plan A reuse), or null. */
    kit_remote_index: string | null;
    /** The app's universal hooks (`src/hooks.{ts,js}`) for `transport`, or null when absent. */
    universal_hooks: string | null;
    /** The app's CLIENT hooks (`src/hooks.client.{ts,js}`), or null. Kit runs this file only when its
     *  client app boots — which a csr=false page never does — so ogygia runs its `init` on boot there
     *  (client-side monitoring, third-party bootstraps otherwise silently never load). */
    client_hooks: string | null;
    /** Kit 3's client codec module (`#app/internal/transport`), or null on Kit 2. Kit 3's remote
     *  argument encoding reads the app's transport from it, and only Kit's client boot fills it — so on
     *  a csr=false page a custom-type remote argument failed to encode until ogygia filled it too. */
    kit_transport_init: string | null;
}
/**
 * Locate Kit's internal wire-protocol + client remote-functions modules by resolving `@sveltejs/kit`'s
 * package.json (that IS exported) and joining the src path — deep-importing the file bypasses the exports
 * map. Also finds the app's universal hooks. Resolved from the APP root (`createRequire` off a root path),
 * so a monorepo sub-package still finds Kit. Never throws (a missing Kit → the devalue-codec fallback).
 */
export declare function resolve_kit_paths(root: string): KitPaths;
/**
 * The app's Kit MAJOR version (resolved off the app root, like {@link resolve_kit_paths}), or null when
 * no Kit resolves. The one fact `kit_asset` needs: Kit 2's `asset()` takes a path with its leading
 * slash, Kit 3's without — and no runtime probe can tell them apart (Kit 2 refuses a slash-less path
 * only in dev; in a build it returns it page-relative, and every island entry on a nested page 404'd).
 */
export declare function kit_major(root: string): number | null;
export interface KitDirs {
    /** absolute `kit.files.routes` (default `<root>/src/routes`) */
    routes_dir: string;
    /** absolute `kit.outDir` (default `<root>/.svelte-kit`) */
    out_dir: string;
}
export declare const DEFAULT_KIT_DIRS: {
    readonly routes: 'src/routes';
    readonly out: '.svelte-kit';
};
export declare function set_kit_dirs(root: string, dirs: KitDirs): void;
export declare function kit_dirs(root: string): KitDirs;
export declare function set_kit_inline_style_threshold(root: string, bytes: number): void;
export declare function kit_inline_style_threshold(root: string): number;
/** Read `export const csr = true|false` from a route options file; `undefined` if unset/absent. */
export declare function read_csr(file: string): boolean | undefined;
/**
 * The claimed keys `export const config = {…}` sets in one route module: its literal-valued top-level
 * properties named in `keys`. `{}` when the file, the export or the keys are absent (a spread or a
 * `config` that is not an object literal is Kit's to read, not ours). A claimed key with a computed
 * value is a build error: it is read at build time, so ogygia could not honour it.
 */
export declare function read_route_config(file: string, keys: readonly string[]): Record<string, unknown>;
/**
 * A route COMPONENT of `kind`: `+page.svelte`, or the same file in any other extension the app
 * compiles to a component (`+page.md`, `+page.svx`): every `+page.*` but the option scripts. Kit
 * routes all of them alike, so the csr topology does too — a markdown page counted for nothing
 * here, and its layout's world and its own client leg were decided as if it did not exist.
 */
export declare function is_route_component(name: string, kind: 'page' | 'layout'): boolean;
/**
 * The ERROR-RENDER csr of every page route: Kit renders a page's `+error.svelte` with the LAYOUT
 * branch only (`PageNodes(layouts)` in its server renderer — the page node is dropped), so `csr`
 * for a 404 / 500 under a `csr = false` page is the layouts' answer, usually `true`. A document
 * keyed on the page's csr there is rendered client-off while Kit hydrates it: the lakes came out
 * in their bare form, Kit's hydration mismatched, and a site's header vanished on every error page
 * (customer deploy, 2026-09-15). Same walk as {@link csrTrueRouteIds}, page option files ignored.
 */
export declare function errorCsrTrueRouteIds(routesDir: string): string[];
/** The error-render csr of a ROUTELESS response (no route matched: Kit renders the root layout and
 *  the root error page) — the root layout's own option, Kit's default `true` when unset. */
export declare function rootLayoutCsrTrue(routesDir: string): boolean;
/**
 * Kit-effective `csr === false` for a `+page.svelte` / `+layout.svelte` host. Pages use Kit's
 * own-chain rule; a LAYOUT is csr=false exactly when EVERY page it serves is csr=false (a layout
 * with no pages below — endpoint-only subtree — falls back to its own chain).
 * @param hostFile abs path to a route `.svelte`
 * @param routesDir abs `src/routes`
 */
export declare function routeCsrIsFalse(hostFile: string, routesDir: string): boolean;
/**
 * True when `hostFile` is a route host whose islands ogygia must STRIP (Kit hydrates every page
 * this host serves). Pages: Kit's own-chain rule (default true, or an explicit `csr = true` that
 * beats a `false` up the chain). LAYOUTS: strippable ONLY when no page at/below them is
 * csr=false — on a mixed layout both this and {@link routeCsrIsFalse} are false (shared world:
 * islands kept, `documentIsCsrTrue` degrades them per document). `false` for non-route files
 * (shared components): their csr depends on which page renders them, so they keep their islands.
 */
export declare function routeCsrIsTrue(hostFile: string, routesDir: string): boolean;
/** Kit's `route.id` for a page host, with layout GROUP segments (`(app)`) stripped — the same
 *  normalization {@link csrTrueRouteIds} applies, so the two sides match whether or not Kit keeps
 *  groups in `route.id`. Root → `/`. */
export declare function normalize_route_id(id: string): string;
/**
 * The set of route ids (Kit `route.id`, group-stripped) whose EFFECTIVE csr is TRUE — i.e. Kit
 * hydrates the whole document there. A csr=false layout's islands rendered under one of these must
 * degrade to inline on BOTH legs (Kit owns hydration); Region reads this map on the server, and
 * `kit_hydrates_page()` is the identical client signal. Empty for a fully csr=false app (the norm);
 * only the csr=true exceptions land here.
 */
export declare function csrTrueRouteIds(routesDir: string): string[];
/** Every page route id (group-stripped) → its merged config, claimed keys only. A key no level sets
 *  is absent, so the plugin applies its default; a page that sets none maps to `{}`. */
export declare function page_route_config(routesDir: string, keys: readonly string[]): Record<string, Record<string, unknown>>;
/**
 * Does the app have ANY csr=true page (Kit hydrates the whole document there)? Drives whether a
 * csr=false LAYOUT must link its island wrapper on the CLIENT leg: on a csr=true child page Kit
 * hydrates the layout, so its chrome islands must be REAL wrappers (Region degrades them inline),
 * not the thin stub the pure-csr=false path uses. A pure-csr=false app keeps the stub (thin client
 * graph); only mixed apps pay for the layout wrappers.
 */
export declare function hasAnyCsrTrueRoute(routesDir: string): boolean;
/** Drop the memoized csr-topology answers (a route/`csr`-export add/remove invalidates them). */
export declare function clear_route_csr_cache(): void;
export declare const KEEP_CLIENT_DIR = ".ogygia-keep-client";
/**
 * Replicates Kit's `manifest_data.nodes.every(n => n.page_options?.csr === false)` — the exact
 * condition under which Kit skips the client build — with `page_options` CHAIN-RESOLVED exactly as
 * Kit's static analysis resolves it. A single node whose effective csr is `true` or simply unset
 * keeps the build alive. When this is true, ogygia's runtime is never emitted, so index.ts injects
 * the keepalive. Deviations (a `+page@` reset, a statically-unanalysable option file) can only err
 * toward injecting a keepalive Kit didn't need — a harmless extra client build, never a 404.
 */
export declare function clientBuildWillSkip(routesDir: string): boolean;
/**
 * True when AT LEAST ONE page route is csr=false. A pure csr=true app (this returns false) needs no
 * ogygia runtime at all — Kit hydrates everything itself — so the runtime chunk is skipped entirely.
 */
export declare function hasAnyCsrFalseRoute(routesDir: string): boolean;
/** On-disk path of the injected keepalive route for a given app root. */
export declare function keep_client_dir(r: string): string;
/** Write the URL-less `csr = true` keepalive layout into the app's routes (removed at process exit). */
export declare function inject_keep_client_route(r: string): void;
/** Remove leftover on-disk `.ogygia` trees from an earlier materialization approach. */
export declare function clean_stale_ogygia_dirs(dir: string): void;
