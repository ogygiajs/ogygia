/**
 * The shapes of the virtual modules whose source the compiler generates as code (the table's
 * families, ../compiler/virtual/core.ts): what each exports, written once. The generated per-realm
 * `.d.ts` files point at these; the code that imports a module reads its types from here.
 */
import type { ServerPluginEntry } from '../plugin/server.ts';
import type { BarrelLeftReason } from './barrels.ts';
import type { LazyHookName, LazyHooks, RuntimeHookName, RuntimeHooks } from './runtime-hooks.ts';

/** A re-export barrel a chunk still holds: its name, the modules it brings, and why the barrel pass
 *  left it (when it said). */
export interface ChunkBarrel {
	name: string;
	fanout: number;
	why?: BarrelLeftReason[];
}

/** A Kit transport hook's codecs, by type name. */
export type CodecMap = Record<
	string,
	{ encode: (v: unknown) => unknown; decode: (v: unknown) => unknown }
>;

/** What the build learned about each region's client code, read at render time from its handoff. */
export interface RegionDepsModule {
	/** Public URLs of hashed dependency chunks for a hydrate island entry (`/_app/immutable/…`). */
	region_deps(entry: string): string[];
	/** Public URLs of the hydrate core's chunk and its static imports: what the runtime's first
	 *  island wake imports. `[]` in dev and with a handoff from before it. */
	wake_code(): string[];
	/** WAKE ADVISOR: what the island's own components do, from the build; `null` without facts. */
	region_interactivity(entry: string): {
		handlers: number;
		state: number;
		effects: number;
		binds: number;
		actions: number;
		files: number;
	} | null;
	/** a hashed client chunk's source modules, app files first; `null` when the handoff has none */
	chunk_contents(href: string): string[] | null;
	/** a chunk's heaviest named modules with their rendered bytes (profiler builds only) */
	chunk_heavy(href: string): { total: number; top: { name: string; bytes: number }[] } | null;
	/** the modules the build shipped as two copies, each copy's chunk and bytes (profiler builds) */
	chunk_duplicates():
		| { name: string; copies: { file: string; bytes: number; from?: string }[] }[]
		| null;
	/** the re-export barrels a chunk still holds, with how many modules each brings (profiler builds) */
	chunk_barrels(href: string): ChunkBarrel[] | null;
	/** an island's components' lines that draw differently in the browser (the build's scan) */
	region_hazards(
		entry: string
	):
		| { file: string; line: number; code: string; kind: 'await' | 'browser'; reads?: string }[]
		| null;
	/** Public URLs of the CSS assets an island entry (+ its dep chunks) owns. */
	region_css(entry: string): string[];
	/** Public URLs of the CSS a content page's own components own (by content id). */
	content_css(id: string): string[];
	/** The text of a region CSS asset the build kept under Kit's `inlineStyleThreshold`; `null` = link it. */
	region_css_inline(href: string): string | null;
	/** The island's client code reads `$page` (fail-open: true in dev and for an unknown entry). */
	region_reads_page(entry: string): boolean;
	/** The top-level `page.data` keys the island's client code reads; `null` = ship all. */
	region_page_keys(entry: string): string[] | null;
	/** why an island ships all of page.data: the modules whose reads the build could not pin */
	region_page_why(entry: string): { file: string; line: number | null; why: string }[] | null;
	/** The Kit remote-function modules (by id-hash) the island can call; `null` = may call anything. */
	region_remotes(entry: string): string[] | null;
	/** The island's client code imports Kit's `$app/env/public` (fail-open: true in dev and for an
	 *  unknown entry). */
	region_reads_env(entry: string): boolean;
	/** og.$ hoisted factories (tag → source) for the page-inline registration; prod SSR only. */
	fn_manifest(): Record<string, string> | null;
	/** An entry's identity (its stable URL) → the content-hashed file it is served from. */
	entry_location(identity: string): string | null;
	/** The build's location map file (base-less served path), or `null`: none built. */
	location_map(): string | null;
	/** Why the production server has no client-build handoff (`missing`: no path held one;
	 *  `unreadable`: one failed to read or parse, with the error), or `null` when it has one (and
	 *  always in dev, which reads none). */
	handoff_problem(): {
		kind: 'missing' | 'unreadable';
		tried: string[];
		error?: string;
	} | null;
}

/** The server islands this build has, and how to reach each one. */
export interface ServerManifestModule {
	/** The server islands' loaders, one dynamic import away (link/server-manifest.ts says why). */
	load_server_regions(): Promise<ServerRegionsModule>;
	/** Server-island id → its built client-chunk URL (the key `region_css()` is keyed by). */
	region_url: Record<string, string>;
	/** Server-island id → its component name, where the component file is known. */
	region_name: Record<string, string>;
	/** Server-island id → its render identity (the component it renders), signed into its capabilities. */
	region_render: Record<string, string>;
	/** Render identity → a server-island id of this build that renders it. */
	render_region: Record<string, string>;
	/** Server-island id → its server tree reads `page.data`; `null` in dev (unknown). */
	region_reads_page_data: Record<string, boolean> | null;
}

export interface ServerRegionsModule {
	/** server-region id → its loader */
	regions: Record<string, () => Promise<{ default: unknown }>>;
}

export interface TransportModule {
	transport: CodecMap;
	encoders: Record<string, (v: unknown) => unknown>;
	decoders: Record<string, (v: unknown) => unknown>;
}

export interface KitTransportModule {
	transport: CodecMap;
}

/** `ogygia:boot/hydrate-features`: the hydrate-phase features' modules, each `null` where the build
 *  leaves the feature out, and `<name>_on`, which says so (the hydrate core tests it before every
 *  use). Only the hydrate core imports it (the remote seeds are `ogygia:boot/remote-seeds`), so the
 *  features ride the hydrate core's one `import()`. */
export interface HydrateFeaturesModule {
	readonly page: typeof import('../runtime/seeds.ts');
	readonly page_on: boolean;
	readonly wire: typeof import('../live-transport.ts');
	readonly wire_on: boolean;
	readonly live: typeof import('../runtime/live.ts');
	readonly live_on: boolean;
	readonly context: typeof import('../runtime/context.ts');
	readonly context_on: boolean;
}

/** `ogygia:boot/remote-seeds`: the remote-seeds feature's module, `null` where the build leaves it
 *  out (`remote_seeds_on` says so). Its readers are the hydrate core and the page feature, which the
 *  navigation chunk imports too, so it is a module of its own (the navigation never loads the other
 *  hydrate features). */
export interface RemoteSeedsModule {
	readonly remote_seeds: typeof import('../runtime/remote-seeds.ts');
	readonly remote_seeds_on: boolean;
}

export interface RuntimeFlagsModule {
	/** the build's feature word: a bit per feature its marks select (./features.ts) */
	HAS: number;
	/** `null` where the `wire` feature (the codec) is in the build up front; else its load, which a
	 *  wake runs on use */
	load_wire_codec: (() => Promise<{ install(): void }>) | null;
}

/** `ogygia:boot/feature-code`: the boot features' modules the boot calls directly, each `null` where
 *  the build leaves the feature out (its bit is off in `HAS`, which the boot tests before every
 *  call). Only the boot imports it, so a feature's module, its state included, is in a boot exactly
 *  when its bit is. */
export interface FeatureCodeModule {
	readonly wire_classes: typeof import('../runtime/wire-classes.ts');
	readonly frames: typeof import('../runtime/frames.ts');
	readonly lakes: typeof import('../runtime/lakes.ts');
	readonly morph: typeof import('../runtime/morph.ts');
	readonly interaction: typeof import('../runtime/interaction.ts');
	readonly forms: typeof import('../runtime/form-continuity.ts');
	readonly mpa_nav: typeof import('../runtime/nav-handle.ts');
	readonly router: typeof import('../runtime/router.ts');
}

/** `ogygia:boot/hooks`: each runtime hook the app's client realms subscribe to, as the function the
 *  boot calls (it tells every realm that subscribes); every other hook `0`, so the call folds out. */
export type HooksModule = { readonly [K in RuntimeHookName]: RuntimeHooks[K] | 0 } & {
	/** how many client realms the app lists (`0`: the plugin boot folds out) */
	readonly realm_count: number;
	/** the lazy chunks' hooks the realms subscribe to, for the boot link; `0` when none */
	readonly lazy_hooks: LazyHooks | 0;
};

/** `ogygia:boot/hook-bits`: a lazy chunk's hooks, `1` each where a client realm subscribes, else
 *  `0` (one character: the bundler inlines it in every chunk, so no chunk imports the module). */
export type HookBitsModule = { readonly [K in LazyHookName]: 0 | 1 };

export interface ServerFlagsModule {
	/** the build's feature word, the browser's `HAS` (./features.ts): the server writes into a page
	 *  only what the page's runtime can revive */
	HAS: number;
}

export interface ProgramsModule {
	/** the build's frames bit, on each leg (a region streams HTML: holes, held regions) */
	HAS_FRAMES: boolean;
	/** the build's lakes bit */
	HAS_LAKES: boolean;
	/** the build's live bit (a held region's updates) */
	HAS_LIVE: boolean;
}

export interface TransportablesModule {
	/** client: a transportable class module's tag path → its lazy import, the file it imports (`null`
	 *  when it has none of its own) and the URL that file is relative to (server: empty, eager) */
	wire_loaders: Record<
		string,
		readonly [load: () => Promise<unknown>, file: string | null, base: string]
	>;
	/** client: the app sends wired values through Kit's transport: every class loads with every island */
	wire_all: boolean;
}

export interface ServerPluginsModule {
	/** the server halves of the plugins listed beside `ogygia()`, in plugin order */
	plugins: readonly ServerPluginEntry[];
	/** how many there are (`0`: nothing a plugin adds to a request, a fact or a shared hook, runs) */
	plugin_count: number;
	/** `1` where some server half implements core's shared hook `measures`, else `0` */
	measures: 0 | 1;
}

export interface RouteConfigModule {
	/** every Kit page route id → the keys plugins claim inside its `config` page option, merged */
	route_config: Record<string, Record<string, unknown>>;
}

/** Kit's own remote key helper, deep-imported from its shared runtime (the same in Kit 2 and 3). */
export interface KitWireModule {
	create_remote_key(id: string, payload: string): string;
}

/** `ogygia:server/kit-env`: the public env Kit puts in its boot payload on a csr=true page (Kit 3's
 *  `rendered_env`), or `null` where this Kit has none ogygia reads. */
export interface KitEnvModule {
	kit_public_env(): Record<string, unknown> | null;
	/** This build's identity, written beside the env so only this build's reader reads it. */
	readonly kit_env_build: string;
}

/** `ogygia:boot/kit-env`: the browser's reader of that env (runtime/kit-env.ts), bound to this
 *  build's `kit_env_build`, which Kit's patched `$app/env/public` imports. */
export interface KitEnvReaderModule {
	kit_env(): Record<string, unknown>;
}

/** A module that only runs (it exports nothing). */
export type SideEffectModule = Record<never, never>;

/** Every region's component name, from the build's prescan (empty on the dev server). */
export interface DevtoolsMetaModule {
	region_names: Record<string, string>;
}

/** The runtime chunk's served URL. */
export interface RuntimeUrlModule {
	runtime_url: string;
}

/** The devtools boot's served URL. */
export interface DevtoolsBootUrlModule {
	devtools_boot_url: string;
}

/** The build's key material, and whether the build had an `OGYGIA_SECRET` (its ids are salted). */
export interface SecretModule {
	build_key: string;
	build_had_secret: boolean;
}

/** The region endpoint's rate limit. */
export interface RateLimitModule {
	rate_limit: { max: number; windowMs: number };
}

/** The profiler's build maps, packed (null without them). */
export interface ProfilerMapsModule {
	profiler_maps: string | null;
}

/** Whether the SPA router is on, and with view transitions. */
export interface RouterConfigModule {
	router_enabled: boolean;
	view_transitions: boolean;
}

/** The runtime session cookie's name. */
export interface SessionCookieModule {
	session_cookie: string;
}

/** How long a region capability lives, and the window in which it renews. */
export interface RegionTtlModule {
	region_ttl: number;
	renew_window: number;
}

/** The csr=true routes, so a csr=false layout's regions degrade to inline under a csr=true leaf. */
export interface RouteCsrModule {
	/** route ids (group-stripped) whose effective csr is true */
	csr_true_routes: ReadonlySet<string>;
	/** route ids whose ERROR render is hydrated (the layouts' csr; the page's option ignored) */
	error_csr_true_routes: ReadonlySet<string>;
	/** the routeless error render: the root layout's own csr (Kit's default `true`) */
	root_layout_csr_true: boolean;
}

/**
 * Each generated virtual module's type, by its id: what the compiler's table fills and what the
 * generated `virtual/*.d.ts` files declare. The compiler types each entry with its id's shape here.
 */
export interface VirtualModules {
	'ogygia:boot/runtime': SideEffectModule;
	'ogygia:boot/runtime-entry': SideEffectModule;
	'ogygia:boot/runtime-flags': RuntimeFlagsModule;
	'ogygia:boot/hydrate-features': HydrateFeaturesModule;
	'ogygia:boot/remote-seeds': RemoteSeedsModule;
	'ogygia:boot/feature-code': FeatureCodeModule;
	'ogygia:boot/hooks': HooksModule;
	'ogygia:boot/hook-bits': HookBitsModule;
	'ogygia:boot/devtools-meta': DevtoolsMetaModule;
	'ogygia:boot/kit-env': KitEnvReaderModule;
	'ogygia:region/transport': TransportModule;
	'ogygia:region/transportables': TransportablesModule;
	'ogygia:region/kit-transport': KitTransportModule;
	'ogygia:region/transportables-eager': SideEffectModule;
	'ogygia:region/programs': ProgramsModule;
	'ogygia:dev/hmr': SideEffectModule;
	'ogygia:dev/devtools-boot': SideEffectModule;
	'ogygia:server/runtime-flags': ServerFlagsModule;
	'ogygia:server/runtime-url': RuntimeUrlModule;
	'ogygia:server/devtools-boot-url': DevtoolsBootUrlModule;
	'ogygia:server/region-deps': RegionDepsModule;
	'ogygia:server/router-css': SideEffectModule;
	'ogygia:server/secret': SecretModule;
	'ogygia:server/kit-wire': KitWireModule;
	'ogygia:server/kit-env': KitEnvModule;
	'ogygia:server/rate-limit': RateLimitModule;
	'ogygia:server/server-plugins': ServerPluginsModule;
	'ogygia:server/profiler-maps': ProfilerMapsModule;
	'ogygia:server/router-config': RouterConfigModule;
	'ogygia:server/session-cookie': SessionCookieModule;
	'ogygia:server/region-ttl': RegionTtlModule;
	'ogygia:server/route-csr': RouteCsrModule;
	'ogygia:server/route-config': RouteConfigModule;
	'ogygia:server/server-manifest': ServerManifestModule;
	'ogygia:server/server-regions': ServerRegionsModule;
}

/** Each build constant's type, by its global's name: the `define`s the compiler inlines. */
export interface VirtualConstants {
	__OGYGIA_CONTINUITY_FORMS__: boolean;
	__OGYGIA_SERVER_DELTA__: boolean;
	__OGYGIA_DEVTOOLS__: boolean;
	__OGYGIA_DEVTOOLS_LAZY__: boolean;
	__OGYGIA_RULES__: boolean;
	__OGYGIA_KIT_MAJOR__: number | null;
	__OGYGIA_KIT_PAGES__: boolean;
	__OGYGIA_VERSION__: string;
	__OGYGIA_DEV_HMR_URL__: string;
}
