/**
 * The shapes of the virtual modules whose source the compiler generates as code (the table's
 * families, ../compiler/virtual/core.ts): what each exports, written once. The generated per-realm
 * `.d.ts` files point at these; the code that imports a module reads its types from here.
 */
import type { ServerPluginEntry } from '../plugin/server.ts';
import type { BarrelLeftReason } from './barrels.ts';

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

export interface HydrateFeaturesModule {
	/** installs the hydrate-phase features the app's marks selected */
	install(): void;
}

export interface RuntimeFlagsModule {
	/** the `frames` feature is in the build: some region streams HTML */
	FRAMES: boolean;
	/** `null` where the `wire` feature (the codec) is in the build up front; else its load, which a
	 *  wake runs on use */
	load_wire_codec: (() => Promise<{ install(): void }>) | null;
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
}

export interface RouteConfigModule {
	/** every Kit page route id → the keys plugins claim inside its `config` page option, merged */
	route_config: Record<string, Record<string, unknown>>;
}

/** Kit's own remote key helper, deep-imported from its shared runtime (the same in Kit 2 and 3). */
export interface KitWireModule {
	create_remote_key(id: string, payload: string): string;
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
	'ogygia:boot/fn-manifest': SideEffectModule;
	'ogygia:boot/runtime-entry': SideEffectModule;
	'ogygia:boot/runtime-flags': RuntimeFlagsModule;
	'ogygia:boot/hydrate-features': HydrateFeaturesModule;
	'ogygia:boot/devtools-meta': DevtoolsMetaModule;
	'ogygia:region/transport': TransportModule;
	'ogygia:region/transportables': TransportablesModule;
	'ogygia:region/kit-transport': KitTransportModule;
	'ogygia:region/transportables-eager': SideEffectModule;
	'ogygia:dev/hmr': SideEffectModule;
	'ogygia:dev/devtools-boot': SideEffectModule;
	'ogygia:server/runtime-url': RuntimeUrlModule;
	'ogygia:server/devtools-boot-url': DevtoolsBootUrlModule;
	'ogygia:server/region-deps': RegionDepsModule;
	'ogygia:server/router-css': SideEffectModule;
	'ogygia:server/secret': SecretModule;
	'ogygia:server/kit-wire': KitWireModule;
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
	__OGYGIA_CLIENT_PLUGINS__: boolean;
	__OGYGIA_HOOK_REGION_MOUNT__: boolean;
	__OGYGIA_HOOK_REGION_UNMOUNT__: boolean;
	__OGYGIA_HOOK_REGION_HYDRATED__: boolean;
	__OGYGIA_HOOK_REGION_FAILED__: boolean;
	__OGYGIA_HOOK_HOLE_ANSWERED__: boolean;
	__OGYGIA_HOOK_HOLE_FAILED__: boolean;
	__OGYGIA_HOOK_HOLE_BATCH_MISSED__: boolean;
	__OGYGIA_HOOK_ENTRY_FALLBACK__: boolean;
	__OGYGIA_HOOK_NAVIGATED__: boolean;
	__OGYGIA_HOOK_CRITICAL_SETTLED__: boolean;
	__OGYGIA_HOOK_WARNING__: boolean;
	__OGYGIA_HOOK_REGION_HYDRATE__: boolean;
	__OGYGIA_HOOK_ANSWER_PARSED__: boolean;
	__OGYGIA_HOOK_ANSWER_PLACED__: boolean;
	__OGYGIA_HOOK_REGION_WOKE__: boolean;
	__OGYGIA_HOOK_REGION_MISMATCHED__: boolean;
	__OGYGIA_HOOK_NAV_STARTED__: boolean;
	__OGYGIA_HOOK_LOAD_STARTED__: boolean;
	__OGYGIA_KIT_MAJOR__: number | null;
	__OGYGIA_VERSION__: string;
	__OGYGIA_DEV_HMR_URL__: string;
}
