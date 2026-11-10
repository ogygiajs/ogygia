/**
 * CORE'S VIRTUAL MODULES, declared in the table (./table.ts): the first registrant. Each entry reads
 * its value off the compile session (`CoreApp`, the driver) and the leg it is loaded for. Each is a
 * named export typed with what its module exports (a value's data, a family's `contract/`
 * interface): the generated per-realm `.d.ts` reads the types off these exports.
 */
import { fs, path } from '../host.ts';
import { kit_dirs, csrTrueRouteIds, errorCsrTrueRouteIds, rootLayoutCsrTrue } from '../kit.ts';
import {
	generateHydrateFeaturesSource,
	generateRuntimeEntrySource,
	generateRuntimeFlagsSource
} from '../link/runtime-entry.ts';
import { island_deps_module } from '../link/island-deps.ts';
import { router_css_module } from '../link/router-css.ts';
import { server_plugins_module, route_config_module, sign_client_source } from '../link/caps.ts';
import {
	transport_module,
	transportables_module,
	kit_transport_module
} from '../link/transport.ts';
import {
	server_manifest_module,
	server_islands_module,
	server_island_ids
} from '../link/server-manifest.ts';
import {
	REGISTRY_STUB_PREFIX,
	registry_stub_names,
	registry_stub_source
} from '../link/registry-stub.ts';
import { dev_hmr_client_source } from '../dev/dev-hmr.ts';
import { PROFILER_MAPS_PLACEHOLDER } from '../ids.ts';
import { line } from '../../messages/build.ts';
import type { CompileCtx } from '../ctx.ts';
import type { Program } from '../program.ts';
import type {
	HydrateFeaturesModule,
	KitTransportModule,
	KitWireModule,
	RegionDepsModule,
	RouteConfigModule,
	RuntimeFlagsModule,
	ServerPluginsModule,
	ServerRegionsModule,
	ServerManifestModule,
	TransportablesModule,
	TransportModule
} from '../../contract/virtual-modules.ts';
import {
	virtual,
	type Entry,
	type FamilyEntry,
	type RequestEntry,
	type ValueEntry
} from './table.ts';

/** What core's entries read off the compile session (the driver implements it). */
export interface CoreApp {
	readonly ctx: CompileCtx;
	readonly program: Program;
	/** og.$ hoists (tag → factory source) */
	readonly dollar_hoists: ReadonlyMap<string, string>;
	prescan(): void;
	runtime_chunk_url(): string;
	region_names(): Record<string, string>;
	router_css_roots(): string[];
	/** dev: the server-region ids a server manifest was just emitted with */
	note_server_ids(ids: Set<string>): void;
}

type Value<T> = ValueEntry<CoreApp, T>;
type Family<M = Record<never, never>> = FamilyEntry<CoreApp, M>;

const BACKSLASH_G = /\\/g;
const posix = (p: string): string => p.replace(BACKSLASH_G, '/');
/** A served dev URL for a virtual module (Vite's `/@id/` form of its resolved id). */
const dev_url = (id: string): string => '/@id/__x00__' + id;
/** The id the bundler keys an entry's module by. */
const key = (e: { alias?: string; realm: string; id: string }): string =>
	e.alias ?? `ogygia:${e.realm}/${e.id}`;

/** A core module (its path under `src/`, no extension) → the built file next to the runtime. */
export const core_path = (app: CoreApp, module: string): string =>
	posix(path.join(path.dirname(app.ctx.runtime_dir), module + '.js'));

/**
 * The runtime the dev boot runs, as the app resolves `ogygia/runtime` (the package's exports map:
 * the dev boot imports that specifier). A published package points it at `dist/runtime` (= the
 * prebuilt `runtime_dir`); this repo's workspace points it at `src/runtime` (`.ts` files). Null
 * when it cannot be read (then `runtime_dir` stands). Once per runtime dir.
 */
const dev_runtimes = new Map<string, { dir: string; ts: boolean } | null>();
function dev_runtime_of(runtime_dir: string): { dir: string; ts: boolean } | null {
	if (dev_runtimes.has(runtime_dir)) return dev_runtimes.get(runtime_dir)!;
	let out: { dir: string; ts: boolean } | null = null;
	try {
		const pkg_dir = path.dirname(path.dirname(runtime_dir));
		const pkg = JSON.parse(fs.readFileSync(path.join(pkg_dir, 'package.json'), 'utf8'));
		const exp = pkg?.exports?.['./runtime'];
		const rel = typeof exp === 'string' ? exp : exp?.default;
		if (typeof rel === 'string') {
			const file = path.join(pkg_dir, rel);
			if (fs.existsSync(file)) out = { dir: path.dirname(file), ts: file.endsWith('.ts') };
		}
	} catch {
		out = null; // ok: an unreadable package keeps `runtime_dir`
	}
	dev_runtimes.set(runtime_dir, out);
	return out;
}

/** The plugins' browser halves for a generated boot: one static import each, and the list to pass. */
function client_plugins_boot(ctx: CompileCtx): { imports: string; list: string } {
	if (!ctx.client_plugins.length) return { imports: '', list: '' };
	return {
		imports: ctx.client_plugins
			.map((spec, i) => `import __og_client_${i} from ${JSON.stringify(spec)};\n`)
			.join(''),
		list: `[${ctx.client_plugins.map((_, i) => `__og_client_${i}`).join(', ')}]`
	};
}

/** The client-hooks boot snippet for a generated runtime entry: an import of the runtime runner and
 *  a call that dynamic-imports the app's `hooks.client.*` — empty when the app has none. Runs the
 *  file's `init` on boot for csr=false pages (the runner skips a csr=true document). */
function client_hooks_boot(ctx: CompileCtx): { imports: string; call: string } {
	if (!ctx.client_hooks) return { imports: '', call: '' };
	const runner = posix(`${ctx.runtime_dir}/client-hooks.js`);
	return {
		imports: `import { run_app_client_hooks as __og_run_client_hooks } from ${JSON.stringify(runner)};\n`,
		call: `__og_run_client_hooks(() => import(${JSON.stringify(ctx.client_hooks)}));\n`
	};
}

// ── boot ────────────────────────────────────────────────────────────────────────────────────

export const runtime: Family = virtual.family({
	realm: 'boot',
	id: 'runtime',
	alias: 'virtual:ogygia-runtime',
	// Dev sticky: kitchen-sink package entry. Build uses the hashed emitFile chunk. An EXPLICIT
	// `bootDev()` call (not a bare side-effect import) so Vite's dep prebundler can't tree-shake the
	// boot away — the bug that left `sideEffects:false` apps with a runtime that never woke.
	load({ ctx }: CoreApp) {
		const ch = client_hooks_boot(ctx);
		const cp = client_plugins_boot(ctx);
		return `import { bootDev } from 'ogygia/runtime';\n${ch.imports}${cp.imports}bootDev(${cp.list});\n${ch.call}`;
	}
});

export const fn_manifest: Family = virtual.family({
	realm: 'boot',
	id: 'fn-manifest',
	alias: 'virtual:ogygia/fn-manifest',
	// og.$ factories, registered pre-hydration. Self-contained by the capture law, so emitting source
	// is a pure text move. DEV: the hoists are complete by the time the browser requests this (SSR
	// transformed the hosts first). BUILD: this module loads BEFORE all client transforms ran, so it
	// is a rename-proof PLACEHOLDER — a globalThis bridge + a token `renderChunk` patches once every
	// transform has contributed.
	load(app: CoreApp) {
		const bridge = `import { __register_fn } from 'ogygia/internal';\nglobalThis.__og_reg_fn = __register_fn;\n`;
		if (!app.ctx.is_dev) return bridge + `/*__OGYGIA_FN_MANIFEST__*/`;
		return (
			bridge +
			[...app.dollar_hoists.entries()]
				.map(([tag, src]) => `globalThis.__og_reg_fn(${JSON.stringify(tag)}, (${src}));`)
				.join('\n')
		);
	}
});

export const runtime_entry: Family = virtual.family({
	realm: 'boot',
	id: 'runtime-entry',
	alias: 'virtual:ogygia/runtime-entry',
	load(app: CoreApp) {
		// every host walked (marks complete) before features are selected
		app.prescan();
		const { ctx } = app;
		const { code } = generateRuntimeEntrySource(
			app.program.runtime_marks,
			ctx.runtime_dir,
			ctx.client_plugins
		);
		const ch = client_hooks_boot(ctx);
		return ch.imports + code + ch.call;
	}
});

export const runtime_flags: Family<RuntimeFlagsModule> = virtual.family({
	realm: 'boot',
	id: 'runtime-flags',
	alias: 'virtual:ogygia/runtime-flags',
	load(app: CoreApp) {
		// Dev runs the kitchen-sink boot: every flag on, like every feature.
		if (!app.ctx.is_build) return generateRuntimeFlagsSource({}, true);
		app.prescan();
		return generateRuntimeFlagsSource(app.program.runtime_marks);
	}
});

export const hydrate_features: Family<HydrateFeaturesModule> = virtual.family({
	realm: 'boot',
	id: 'hydrate-features',
	alias: 'virtual:ogygia/hydrate-features',
	load(app: CoreApp) {
		const { ctx, program } = app;
		// The hydrate core's feature phase, from the same marks as the boot entry. Dev runs the
		// kitchen-sink boot (`bootDev`), so it gets every hydrate-phase feature, from the runtime the
		// dev boot actually runs: a second copy would install the wire into slots it never reads.
		if (!ctx.is_build) {
			const rt = dev_runtime_of(ctx.runtime_dir);
			const code = generateHydrateFeaturesSource({}, rt?.dir ?? ctx.runtime_dir, true).code;
			return rt?.ts ? code.split('.js";').join('.ts";') : code;
		}
		app.prescan();
		// og.$ factories register with the hydrate core, and only a decoder that revives a fn ref
		// looks one up: the wire hub (props), the context bridge, or the app's Kit transport. With
		// none in the build no ref can arrive, and the manifest would ship ~2 kB for nothing.
		const marks = program.runtime_marks;
		const fn_refs_decode = marks.wire === true || marks.context === true || program.crosses_wire;
		return (
			(fn_refs_decode ? `import ${JSON.stringify(key(fn_manifest))};\n` : '') +
			generateHydrateFeaturesSource(marks, ctx.runtime_dir).code
		);
	}
});

export const devtools_meta: Value<Record<string, string>> = virtual.value({
	realm: 'boot',
	id: 'devtools-meta',
	alias: 'virtual:ogygia/devtools-meta',
	// a build: every region's component name, from the prescan (the dev server serves them live)
	from(app: CoreApp) {
		if (app.ctx.is_dev) return {};
		app.prescan();
		return app.region_names();
	}
});

export const transport: Family<TransportModule> = virtual.family({
	realm: 'boot',
	id: 'transport',
	alias: 'virtual:ogygia/transport',
	load: (_app: CoreApp, leg) =>
		transport_module(leg.universalHooks, leg.ssr ? null : (leg.kitCodec ?? null))
});

export const transportables: Family<TransportablesModule> = virtual.family({
	realm: 'boot',
	id: 'transportables',
	alias: 'virtual:ogygia/transportables',
	// transportable-class modules: eager on the server, lazy loaders on the client (tag paths are
	// root-relative, as the registration writes them)
	load(app: CoreApp, { ssr }) {
		app.prescan();
		const { ctx, program } = app;
		return transportables_module(
			program.transportable_modules,
			!!ssr,
			(abs) => path.relative(ctx.root, abs).split(path.sep).join('/'),
			program.crosses_wire
		);
	}
});

// ── dev ─────────────────────────────────────────────────────────────────────────────────────

export const hmr: Family = virtual.family({
	realm: 'dev',
	id: 'hmr',
	alias: 'virtual:ogygia/dev-hmr',
	// Dev-only soft HMR bridge under csr=false (no Kit client entry): join /src/**/*.css into the
	// browser graph + strip Kit's FOUC bag. Failures fall through to a full document reload.
	load: ({ ctx }: CoreApp) => (ctx.is_dev ? dev_hmr_client_source() : `export {}`)
});

export const devtools_boot: Family = virtual.family({
	realm: 'dev',
	id: 'devtools-boot',
	alias: 'virtual:ogygia/devtools-boot',
	// The plugins' browser halves on a csr=true (Kit-owned) page: the ogygia runtime never boots
	// there, so ONLY they boot, told it is a Kit page. Empty with no client realm (never injected).
	load({ ctx }: CoreApp) {
		if (!ctx.client_plugins.length) return `export {}`;
		const cp = client_plugins_boot(ctx);
		return (
			// the dev server hands `define`s (the plugins' gates among them) to the page as globals
			// from Vite's env module: it must run before they read them
			(ctx.is_dev ? `import '/@vite/env';\n` : '') +
			cp.imports +
			`import { boot_client_plugins } from ${JSON.stringify(posix(`${ctx.runtime_dir}/client-plugins.js`))};\n` +
			// the beacon's observers from boot: vitals, resources, long tasks, the CPU sampler
			`import { beacon_watch } from ${JSON.stringify(posix(`${ctx.runtime_dir}/beacon.js`))};\n` +
			`beacon_watch();\n` +
			`boot_client_plugins(${cp.list}, true);\n`
		);
	}
});

// ── server ──────────────────────────────────────────────────────────────────────────────────

export const runtime_url: Value<string> = virtual.value({
	realm: 'server',
	id: 'runtime-url',
	alias: 'virtual:ogygia/runtime-url',
	// The runtime's IDENTITY — dev: its dev URL; build: its stable URL (the hashed file is looked up
	// at render time through the build handoff). Prescan first, so the feature hash matches the
	// client emit's stable name (both legs prescan the same source).
	from(app: CoreApp) {
		if (app.ctx.is_dev) return dev_url(key(runtime));
		app.prescan();
		return app.runtime_chunk_url();
	}
});

export const dev_hmr_url: Value<string> = virtual.value({
	realm: 'server',
	id: 'dev-hmr-url',
	alias: 'virtual:ogygia/dev-hmr-url',
	// '' in build/preview; the dev URL during `vite dev`
	from: ({ ctx }: CoreApp) => (ctx.is_dev ? dev_url(key(hmr)) : '')
});

export const devtools_boot_url: Value<string> = virtual.value({
	realm: 'server',
	id: 'devtools-boot-url',
	alias: 'virtual:ogygia/devtools-boot-url',
	// the dev URL the handle injects on csr=true pages; '' in build/preview and with no client realm
	from: ({ ctx }: CoreApp) =>
		ctx.client_plugins.length && ctx.is_dev ? dev_url(key(devtools_boot)) : ''
});

export const region_deps: Family<RegionDepsModule> = virtual.family({
	realm: 'server',
	id: 'region-deps',
	alias: 'virtual:ogygia/island-deps',
	load: ({ ctx }: CoreApp, { ssr }) =>
		island_deps_module(ssr, ctx.is_dev, path.relative(ctx.root, kit_dirs(ctx.root).out_dir))
});

export const router_css: Family = virtual.family({
	realm: 'server',
	id: 'router-css',
	alias: 'virtual:ogygia/router-css',
	// dev inlines the compiled css, so any style-bearing source change re-emits it
	watch: ['styles'],
	// the server router's component→CSS registrations; `export {}` without a server router
	load: (app: CoreApp, leg) =>
		router_css_module(app.router_css_roots(), {
			root: app.ctx.root,
			lib_dir: app.ctx.libDir,
			is_dev: app.ctx.is_dev,
			read_file: (p) => app.ctx.read_file(p),
			resolve: leg.resolve
		})
});

export const secret: Value<{ buildKey: string; buildHadSecret: boolean }> = virtual.value({
	realm: 'server',
	id: 'secret',
	alias: 'virtual:ogygia/secret',
	watch: ['options'],
	// the build's key material, and whether the build had an `OGYGIA_SECRET` (its ids are salted)
	from: ({ ctx }: CoreApp, { ssr }) =>
		ssr
			? { buildKey: ctx.build_secret, buildHadSecret: ctx.id_salt !== '' }
			: { buildKey: '', buildHadSecret: false }
});

export const sign: RequestEntry<CoreApp> = virtual.request({
	realm: 'server',
	id: 'sign',
	alias: 'virtual:ogygia/sign',
	module: { core: 'server/hmac' },
	exports: ['sign', 'verify', 'region_mac_message'],
	client: () => sign_client_source()
});

export const request_event: RequestEntry<CoreApp> = virtual.request({
	realm: 'server',
	id: 'request-event',
	alias: 'virtual:ogygia/request-event',
	module: { package: '$app/server' },
	exports: ['getRequestEvent'],
	// (the message is written in whole: the stub imports nothing)
	client: () =>
		`export function getRequestEvent() { throw new Error(${JSON.stringify(line('request_event_server_only'))}); }`
});

export const region_endpoint: RequestEntry<CoreApp> = virtual.request({
	realm: 'server',
	id: 'region-endpoint',
	alias: 'virtual:ogygia/region-endpoint',
	// Region's minting (lake endpoints, server regions, fingerprints, a hole's CSS). The browser leg
	// mints nothing: lakes reuse the endpoint the SSR restore cached, and the runtime fetches holes.
	module: { core: 'server/region-endpoint' },
	exports: [
		'makeRegionEndpoint',
		'mintServerIsland',
		'known_region_fps',
		'islandFingerprint',
		'holeCss'
	],
	client: () =>
		`export function makeRegionEndpoint(_entry, _props) { return ''; }\n` +
		`export function mintServerIsland(_entry, _props, _ttl) { return ''; }\n` +
		`export function known_region_fps() { return new Set(); }\n` +
		`export function islandFingerprint(_entry, _canonical) { return ''; }\n` +
		`export function holeCss(_entry) { return []; }`
});

export const kit_wire: Family<KitWireModule> = virtual.family({
	realm: 'server',
	id: 'kit-wire',
	alias: 'virtual:ogygia/kit-wire',
	// Kit's OWN wire protocol (its transport-aware devalue codec), deep-imported by absolute path
	load: ({ ctx }: CoreApp) =>
		ctx.kit_wire_path === null
			? null
			: `export { stringify_remote_arg, stringify_command_arg, create_remote_key } from ${JSON.stringify(ctx.kit_wire_path)};`
});

export const rate_limit: Value<{ max: number; windowMs: number }> = virtual.value({
	realm: 'server',
	id: 'rate-limit',
	alias: 'virtual:ogygia/rate-limit',
	watch: ['options'],
	// `max: 0` disables (`ogygia({ rateLimit })`)
	from: ({ ctx }: CoreApp, { ssr }) => (ssr ? ctx.rate_limit : { max: 0, windowMs: 60000 })
});

export const server_plugins: Family<ServerPluginsModule> = virtual.family({
	realm: 'server',
	id: 'server-plugins',
	alias: 'virtual:ogygia/server-plugins',
	watch: ['plugins'],
	load: ({ ctx }: CoreApp, { ssr }) => server_plugins_module(ssr, ctx.server_plugins)
});

export const profiler_maps: Value<string | null> = virtual.value({
	realm: 'server',
	id: 'profiler-maps',
	alias: 'virtual:ogygia/profiler-maps',
	// a placeholder the build fills with the maps (vite/profiler-maps.ts); anything else: none
	from: ({ ctx }: CoreApp, { ssr }) =>
		ssr && ctx.is_build && ctx.measure ? PROFILER_MAPS_PLACEHOLDER : null
});

export const router_config: Value<{ enabled: boolean; viewTransitions: boolean }> = virtual.value({
	realm: 'server',
	id: 'router-config',
	alias: 'virtual:ogygia/router-config',
	watch: ['options'],
	from: ({ ctx }: CoreApp) => ({
		enabled: ctx.router_enabled,
		viewTransitions: ctx.router_view_transitions
	})
});

export const session_cookie: Value<string> = virtual.value({
	realm: 'server',
	id: 'session-cookie',
	alias: 'virtual:ogygia/session-cookie',
	watch: ['options'],
	// the cookie name sealed into the region MAC, or ''
	from: ({ ctx }: CoreApp, { ssr }) => (ssr ? ctx.session_cookie : '')
});

export const region_ttl: Value<{ regionTtl: number; renewWindow: number }> = virtual.value({
	realm: 'server',
	id: 'region-ttl',
	alias: 'virtual:ogygia/region-ttl',
	watch: ['options'],
	from: ({ ctx }: CoreApp, { ssr }) =>
		ssr
			? { regionTtl: ctx.region_ttl, renewWindow: ctx.renew_window }
			: { regionTtl: 3600, renewWindow: 0 }
});

/** The csr=true routes, so a csr=false layout's regions degrade to inline under a csr=true leaf. */
export interface RouteCsr {
	/** route ids (group-stripped) whose effective csr is true */
	csr_true_routes: ReadonlySet<string>;
	/** route ids whose ERROR render is hydrated (the layouts' csr; the page's option ignored) */
	error_csr_true_routes: ReadonlySet<string>;
	/** the routeless error render: the root layout's own csr (Kit's default `true`) */
	root_layout_csr_true: boolean;
}

export const route_csr: Value<RouteCsr> = virtual.value({
	realm: 'server',
	id: 'route-csr',
	alias: 'virtual:ogygia/route-csr',
	watch: ['routes'],
	// the client reads the same signal from `kit_hydrates_page()`
	from({ ctx }: CoreApp, { ssr }) {
		if (!ssr)
			return {
				csr_true_routes: new Set(),
				error_csr_true_routes: new Set(),
				root_layout_csr_true: true
			};
		const routes = kit_dirs(ctx.root).routes_dir;
		return {
			csr_true_routes: new Set(csrTrueRouteIds(routes)),
			// Kit renders a route's error page with its LAYOUT branch only
			error_csr_true_routes: new Set(errorCsrTrueRouteIds(routes)),
			root_layout_csr_true: rootLayoutCsrTrue(routes)
		};
	}
});

export const route_config: Family<RouteConfigModule> = virtual.family({
	realm: 'server',
	id: 'route-config',
	alias: 'virtual:ogygia/route-config',
	watch: ['routes', 'plugins'],
	load: ({ ctx }: CoreApp, { ssr }) =>
		route_config_module(ssr, kit_dirs(ctx.root).routes_dir, ctx.route_config)
});

export const server_manifest: Family<ServerManifestModule> = virtual.family({
	realm: 'server',
	id: 'server-manifest',
	alias: 'virtual:ogygia/server-manifest',
	watch: ['regions'],
	// filled in dev AND build (the client's would be from URLs)
	load(app: CoreApp, { ssr }) {
		const { ctx, program } = app;
		if (ssr) app.prescan();
		if (ssr && ctx.is_dev) app.note_server_ids(new Set(server_island_ids(program)));
		return server_manifest_module(
			ssr,
			program,
			ctx.is_dev,
			(vp: string) => ctx.dev_url_for(vp),
			(rid: string) => ctx.island_public_url(rid)
		);
	}
});

export const server_regions: Family<ServerRegionsModule> = virtual.family({
	realm: 'server',
	id: 'server-regions',
	alias: 'virtual:ogygia/server-islands',
	watch: ['regions'],
	load(app: CoreApp, { ssr }) {
		if (ssr) app.prescan();
		return server_islands_module(ssr, app.program);
	}
});

// ── region ──────────────────────────────────────────────────────────────────────────────────

export const kit_transport: Family<KitTransportModule> = virtual.family({
	realm: 'region',
	id: 'kit-transport',
	alias: 'virtual:ogygia/kit-transport',
	// `ogygia.transport`: the codec cluster only when the app crosses a region or wired value over
	// Kit's wire; an empty map for an app of plain regions (transport.js sits one level above runtime/)
	load({ ctx, program }: CoreApp) {
		const crosses = program.runtime_marks.wire === true || program.crosses_wire;
		return kit_transport_module(crosses, posix(`${ctx.runtime_dir}/../transport.js`));
	}
});

export const transportables_eager: Family = virtual.family({
	realm: 'region',
	id: 'transportables-eager',
	alias: 'virtual:ogygia/transportables-eager',
	// a region entry's codecs: eager on the server, nothing in the browser
	load(app: CoreApp, { ssr }) {
		if (!ssr) return 'export {};\n';
		app.prescan();
		return transportables_module(app.program.transportable_modules, true, (abs) => abs);
	}
});

/** a csr=false route host's registry import on the client leg: its names as `undefined` */
export const registry_stub: Family = virtual.family({
	realm: 'region',
	id: 'registry-stub/',
	alias: REGISTRY_STUB_PREFIX,
	parse: (rest) => rest,
	load: (_app: CoreApp, _leg, rest) => registry_stub_source(registry_stub_names(rest))
});

/** The per-region families the driver resolves and loads itself, off its registry (declared here
 *  so the namespace is complete): a region's entry, its binding, its lazy client leg, its wrapper,
 *  and its CSS-only FOUC graph. */
const driver_family = (id: string, alias: string): Family =>
	virtual.family({ realm: 'region', id, alias, parse: (rest) => rest });
export const region_entry: Family = driver_family('region-entry/', 'virtual:ogygia/island/');
export const region_binding: Family = driver_family('region/', 'virtual:ogygia/region/');
export const region_lazy: Family = driver_family('region-lazy/', 'virtual:ogygia/lazy/');
export const region_wrapper: Family = driver_family('region-wrapper/', 'virtual:ogygia/wrapper/');
export const fouc_css: Family = driver_family('fouc-css/', 'virtual:ogygia/fouc-css/');
export const fouc_scoped: Family = driver_family('fouc-scoped/', 'virtual:ogygia/fouc-scoped/');
export const client_binding_stub: Family = virtual.family({
	realm: 'region',
	id: 'client-binding-stub',
	alias: 'virtual:ogygia/client-binding-stub'
});

/** Core's entries, in the table's order. */
export const CORE_VIRTUALS: readonly Entry<CoreApp>[] = [
	runtime,
	fn_manifest,
	runtime_entry,
	runtime_flags,
	hydrate_features,
	devtools_meta,
	transport,
	transportables,
	hmr,
	devtools_boot,
	runtime_url,
	dev_hmr_url,
	devtools_boot_url,
	region_deps,
	router_css,
	secret,
	sign,
	request_event,
	region_endpoint,
	kit_wire,
	rate_limit,
	server_plugins,
	profiler_maps,
	router_config,
	session_cookie,
	region_ttl,
	route_csr,
	route_config,
	server_manifest,
	server_regions,
	kit_transport,
	transportables_eager,
	registry_stub,
	region_entry,
	region_binding,
	region_lazy,
	region_wrapper,
	fouc_css,
	fouc_scoped,
	client_binding_stub
];
