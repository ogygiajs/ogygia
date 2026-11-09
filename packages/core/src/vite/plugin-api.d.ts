import type { Plugin as VitePlugin } from 'vite';
import type { ServerRealm } from '../compiler/link/caps.ts';
/** Where `definePlugin` puts the definition on the Vite plugin it returns. A registered symbol, so a
 *  second copy of ogygia in one app still recognizes the first's plugins. */
export declare const PLUGIN: unique symbol;
/** The value a plugin's factory returns: a Vite plugin carrying its definition. */
export interface OgygiaPlugin<Options = unknown> extends VitePlugin {
    readonly [PLUGIN]: PluginDefinition<Options>;
}
/** What a plugin is: the argument to `definePlugin`. */
export interface PluginDefinition<Options = unknown> {
    /** The plugin's package name (`'@ogygia/postrender'`): its identity. */
    name: string;
    /** The SERVER realm: a module whose default export is `defineServer({…})` (`ogygia/plugin`), as a
     *  `file:` URL or an absolute path — `import.meta.resolve('./server.ts')`. */
    server?: string;
    /** The BROWSER realm: a module whose default export is `defineClient({…})` (`ogygia/plugin/client`),
     *  booted on every page — same form as `server`. */
    client?: string;
    /** Settings for every realm (JSON: no functions, no clients — live objects are configured at
     *  runtime, in hooks.server.ts). */
    options?: Options;
    /** Run before (`'pre'`) or after (`'post'`) the other plugins, in every realm. */
    enforce?: 'pre' | 'post';
    /** Build-time contributions, with the build context. */
    build?(b: BuildContext): void;
}
/** A `import.meta.og.<name>` macro: rewrites a module that contains the marker (it is called only
 *  then), before the island transform or region minting see it. Returns the new code (the same
 *  string when nothing changed). */
export type MacroHandler = (code: string, m: MacroContext) => string | Promise<string>;
/** What a macro knows about the module it rewrites. */
export interface MacroContext {
    /** The module id, query stripped. */
    readonly id: string;
    /** The id relative to the app root, POSIX (a stable identity for stamps). */
    readonly rel: string;
    readonly root: string;
    /** Markup extensions whose `<script>` blocks hold the macro calls (`.svelte`). */
    readonly markupExts: readonly string[];
}
/** A source format that becomes Svelte only through a preprocessor (markdown → Svelte): how its
 *  islands and its modules' CSS reach the build. */
export interface MarkupSource {
    /** The format's file extensions (`['.svx', '.md']`). */
    extensions: readonly string[];
    /** Discover the format's islands up front (build start, dev included): read each file, turn it
     *  into Svelte, and hand that to `transform` so its islands are registered before chunks emit. */
    scan?(ctx: {
        root: string;
        readFile(abs: string): string | null;
    }): void | Promise<void>;
    /** The format's modules, absolute path → their post-preprocess Svelte source. A module only ever
     *  renders on the server, so no client chunk carries its CSS: the build ships, as one client asset
     *  per module, the scoped CSS of its own `<style>` and of every component it imports (and plain
     *  style imports). The plugin keeps filling this map; the build reads it late. */
    modules?: ReadonlyMap<string, string>;
}
/** What the build hands back for a markup source: run the region transform on preprocessed Svelte. */
export interface MarkupRegions {
    /** Rewrite the marked imports in already-preprocessed Svelte and register its regions. The code,
     *  or null when nothing changed. */
    transform(source: string, filename: string): string | null;
}
/** The build, as one plugin sees it (handed to `build`). */
export interface BuildContext {
    /** The app's root directory. */
    readonly root: string;
    /** `vite dev` (true) or `vite build` (false). */
    readonly dev: boolean;
    /** A key this plugin reads inside Kit's own `config` page option (`export const config = { <key>:
     *  false }` in a `+page` / `+layout` module, `.server` included). Read at build time, merged the
     *  way Kit merges `config` (layouts, then the page; later wins), and answered on the server by
     *  `ctx.routeConfig(key)`. Literal values only (a boolean, number, string or null); nothing is
     *  stripped, because Kit accepts any key inside `config`. */
    routeConfig(key: string): void;
    /** Keep the foreign-hydrate exports on this app's island entries: another app's page may host
     *  them and wake them through its own runtime (fragment federation). Off by default — they cost
     *  every island ~185 B gz and a preload. */
    foreignHydrate(): void;
    /** An `import.meta.og.<name>(…)` construct this plugin compiles (`'code'`, `'loader'`). Plugin
     *  macros run after core's own (`wire`, `$`, `source`, `store`) and before `bake`, in plugin order. */
    macro(name: string, handler: MacroHandler): void;
    /** A source format that becomes Svelte through a preprocessor (markdown): register it, get the
     *  island transform to call from that preprocessor. */
    markup(source: MarkupSource): MarkupRegions;
    /** Compile core's EVENT emits in, browser and server (`ogygia/events`: island wakes, server renders,
     *  hub mints, navigations) — off, every emit folds away. `lazy`: measure only once a viewer opens a
     *  tool (the page carries a launcher; a preview build). */
    events(options?: {
        lazy?: boolean;
    }): void;
    /** Record the build's MEASUREMENT data: per-island detail, chunk contents, server source maps, the
     *  module map, the embedded maps, the request stats' detail — what a profiler reads. */
    measure(): void;
    /** Compile a package's files as app source (their islands, router-css roots): `dirs` / `files`
     *  absolute, under `root` (the package's directory). For a plugin's own pages (a UI it serves). */
    files(scan: {
        root: string;
        dirs?: string[];
        files?: string[];
    }): void;
    /** Modules that render pages outside Kit's routes (a programmatic router): every component they
     *  import gets its whole-tree CSS linked when it renders (`componentCssHead()` from
     *  `ogygia/plugin/css`). `importers`: any compiled module importing one of these specifiers is a
     *  page module; `files`: absolute paths that are page modules themselves (compiled ones: app source,
     *  or a `files()` / `ogygia.files` surface). */
    pageModules(modules: {
        importers?: string[];
        files?: string[];
    }): void;
}
/** A plugin, as the Vite plugin the app lists beside `ogygia()`. */
export declare function definePlugin<Options = undefined>(definition: PluginDefinition<Options>): OgygiaPlugin<Options>;
/** The plugin definitions in the app's Vite plugin list (nested arrays and promises included), in
 *  list order, shape-checked. `ogygia()` and its plugins come before `sveltekit()`: Vite runs
 *  same-stage hooks in list order, and theirs (the content pre-transforms, the config ogygia hands
 *  Kit) must see a module before Kit's do. */
export declare function find_plugins(list: unknown): Promise<PluginDefinition[]>;
/** What the build takes from the app's plugins. */
export interface ResolvedPlugins {
    /** each server realm, in plugin order (`enforce` applied) */
    servers: ServerRealm[];
    /** each browser realm (an absolute path), in plugin order */
    clients: string[];
    /** every key any plugin claims inside Kit's `config` page option */
    route_config: string[];
    /** a plugin asked for island entries' foreign-hydrate exports */
    foreign_hydrate: boolean;
    /** plugin macros, in plugin order */
    macros: {
        name: string;
        handler: MacroHandler;
    }[];
    /** markup sources (a preprocessor format with islands) */
    markup: MarkupSource[];
    /** a plugin asked for core's events (`lazy`: measure once a tool opens), or false */
    events: false | {
        lazy: boolean;
    };
    /** a plugin asked for the build's measurement data */
    measure: boolean;
    /** package files compiled as app source, per plugin */
    files: {
        name: string;
        root: string;
        dirs: string[];
        files: string[];
    }[];
    /** page modules (`b.pageModules()`): the specifiers whose importers are page modules, and files
     *  that are page modules themselves */
    page_modules: {
        importers: string[];
        files: string[];
    };
}
/**
 * Config-time shape check of the definitions found: each named once, its realms locations, its
 * options JSON.
 */
export declare function check_plugins(plugins: readonly unknown[]): PluginDefinition[];
/**
 * When the app's root and mode are known (the `config` hook): order the plugins (`enforce`), check their
 * realms, run their `build` hooks. `markup_transform` is the configured compiler's island
 * transform for preprocessed markup (what `b.markup()` hands back).
 */
export declare function resolve_plugins(plugins: readonly PluginDefinition[], root: string, dev: boolean, markup_transform?: MarkupRegions['transform']): ResolvedPlugins;
