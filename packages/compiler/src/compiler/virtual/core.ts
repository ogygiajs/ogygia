/**
 * CORE'S VIRTUAL MODULES, declared in the table (./table.ts): the first registrant. Each entry reads
 * its value off the compile session (`CoreApp`, the driver) and the leg it is loaded for. Each is a
 * named export typed with what its module exports (a value's data, a family's `contract/`
 * interface): the generated per-realm `.d.ts` reads the types off these exports.
 */
import fs from 'node:fs';
import path from 'node:path';
import { kit_dirs, csrTrueRouteIds, errorCsrTrueRouteIds, rootLayoutCsrTrue } from '../kit.ts';
import {
	generateHydrateFeaturesSource,
	generateRuntimeEntrySource,
	generateRuntimeFlagsSource
} from '../link/runtime-entry.ts';
import { island_deps_module } from '../link/island-deps.ts';
import { router_css_module } from '../link/router-css.ts';
import { server_plugins_module, route_config_module, client_realms_source } from '../link/caps.ts';
import {
	transport_module,
	transportables_server_module,
	transportables_client_module,
	kit_transport_module
} from '../link/transport.ts';
import {
	server_manifest_module,
	server_regions_module,
	server_island_ids
} from '../link/server-manifest.ts';
import { registry_stub_names, registry_stub_source } from '../link/registry-stub.ts';
import { dev_hmr_client_source } from '../dev/dev-hmr.ts';
import { PROFILER_MAPS_PLACEHOLDER, REGION_FAMILY } from '../ids.ts';
import type { CompileCtx } from '../ctx.ts';
import type { ClientRealmFile, ServerRealm } from '../link/caps.ts';
import type { Program } from '../program.ts';
import {
	RUNTIME_HOOK_CONSTANTS,
	type RuntimeHookName,
	type DevtoolsBootUrlModule,
	type DevtoolsMetaModule,
	type ProfilerMapsModule,
	type RateLimitModule,
	type RegionTtlModule,
	type RouteCsrModule,
	type RouterConfigModule,
	type RuntimeUrlModule,
	type SecretModule,
	type SessionCookieModule,
	type VirtualConstants,
	type HydrateFeaturesModule,
	type KitTransportModule,
	type KitWireModule,
	type RegionDepsModule,
	type RouteConfigModule,
	type RuntimeFlagsModule,
	type ServerPluginsModule,
	type ServerRegionsModule,
	type ServerManifestModule,
	type TransportablesModule,
	type TransportModule
} from '@ogygia/core/contract';
import {
	virtual,
	defines,
	specifier_of,
	type ConstantEntry,
	type Entry,
	type FamilyEntry,
	type Leg,
	type Parts,
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
	/** the app's Kit routes directory */
	routes_dir(): string;
	/** the plugins listed beside `ogygia()` */
	plugins(): CorePlugins;
}

/** The plugins listed beside `ogygia()`: their server halves, browser halves, and the route
 *  `config` keys they claim. */
export interface CorePlugins {
	server: readonly ServerRealm[];
	client: readonly ClientRealmFile[];
	route_config: readonly string[];
}

/** Which part of the session each field is (table.ts `Parts`): what a dev change to it reloads. */
export const CORE_PARTS: Parts<CoreApp> = {
	ctx: 'options',
	program: 'regions',
	dollar_hoists: 'regions',
	prescan: 'regions',
	runtime_chunk_url: 'regions',
	region_names: 'regions',
	router_css_roots: 'styles',
	// (a report the load makes, not a read)
	note_server_ids: null,
	routes_dir: 'routes',
	plugins: 'plugins'
};

type Value<T extends object> = ValueEntry<CoreApp, T>;
type Family<M = Record<never, never>> = FamilyEntry<CoreApp, M>;

const BACKSLASH_G = /\\/g;
const posix = (p: string): string => p.replace(BACKSLASH_G, '/');
/** A served dev URL for a virtual module (Vite's `/@id/` form of its resolved id). */
const dev_url = (id: string): string => '/@id/__x00__' + id;
/** The id the bundler keys an entry's module by. */
const key = specifier_of;

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
	// Dev sticky: kitchen-sink package entry. Build uses the hashed emitFile chunk. An EXPLICIT
	// `bootDev()` call (not a bare side-effect import) so Vite's dep prebundler can't tree-shake the
	// boot away — the bug that left `sideEffects:false` apps with a runtime that never woke.
	load(app: CoreApp) {
		const ch = client_hooks_boot(app.ctx);
		const cp = client_realms_source(app.plugins().client);
		return `import { bootDev } from 'ogygia/runtime';\n${ch.imports}${cp.imports}bootDev(${cp.list});\n${ch.call}`;
	}
});

export const fn_manifest: Family = virtual.family({
	realm: 'boot',
	id: 'fn-manifest',
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
	load(app: CoreApp) {
		// every host walked (marks complete) before features are selected
		app.prescan();
		const { ctx } = app;
		const { code } = generateRuntimeEntrySource(
			app.program.runtime_marks,
			ctx.runtime_dir,
			app.plugins().client
		);
		const ch = client_hooks_boot(ctx);
		return ch.imports + code + ch.call;
	}
});

export const runtime_flags: Family<RuntimeFlagsModule> = virtual.family({
	realm: 'boot',
	id: 'runtime-flags',
	exports: { FRAMES: 'FRAMES' },
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
	exports: { install_hydrate_features: 'install' },
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

export const devtools_meta: Value<DevtoolsMetaModule> = virtual.value({
	realm: 'boot',
	id: 'devtools-meta',
	// a build: every region's component name, from the prescan (the dev server serves them live)
	from(app: CoreApp) {
		if (app.ctx.is_dev) return { region_names: {} };
		app.prescan();
		return { region_names: app.region_names() };
	}
});

// region, not boot: the app's codecs, on the server leg too (its render encodes with them)
export const transport: Family<TransportModule> = virtual.family({
	realm: 'region',
	id: 'transport',
	exports: { transport: 'transport', encoders: 'encoders', decoders: 'decoders' },
	load: (_app: CoreApp, leg) =>
		transport_module(leg.universalHooks, leg.ssr ? null : (leg.kitCodec ?? null))
});

// region, not boot: eager on the server leg, lazy loaders in the browser
export const transportables: Family<TransportablesModule> = virtual.family({
	realm: 'region',
	id: 'transportables',
	exports: { wire_loaders: 'wire_loaders', wire_all: 'wire_all' },
	// transportable-class modules: eager on the server, lazy loaders on the client (tag paths are
	// root-relative, as the registration writes them)
	load(app: CoreApp, { ssr }) {
		app.prescan();
		const { ctx, program } = app;
		if (ssr) return transportables_server_module(program.transportable_modules);
		return transportables_client_module(
			program.transportable_modules,
			(abs) => path.relative(ctx.root, abs).split(path.sep).join('/'),
			program.crosses_wire
		);
	}
});

// ── dev ─────────────────────────────────────────────────────────────────────────────────────

export const hmr: Family = virtual.family({
	realm: 'dev',
	id: 'hmr',
	// Dev-only soft HMR bridge under csr=false (no Kit client entry): join /src/**/*.css into the
	// browser graph + strip Kit's FOUC bag. Failures fall through to a full document reload.
	load: ({ ctx }: CoreApp) => (ctx.is_dev ? dev_hmr_client_source() : `export {}`)
});

export const devtools_boot: Family = virtual.family({
	realm: 'dev',
	id: 'devtools-boot',
	// The plugins' browser halves on a csr=true (Kit-owned) page: the ogygia runtime never boots
	// there, so ONLY they boot, told it is a Kit page. Empty with no client realm (never injected).
	load(app: CoreApp) {
		const { ctx } = app;
		const client = app.plugins().client;
		if (!client.length) return `export {}`;
		const cp = client_realms_source(client);
		return (
			// the dev server hands `define`s (the plugins' gates among them) to the page as globals
			// from Vite's env module: it must run before they read them
			(ctx.is_dev ? `import '/@vite/env';\n` : '') +
			cp.imports +
			`import { boot_client_plugins } from ${JSON.stringify(posix(`${ctx.runtime_dir}/client-plugins.js`))};\n` +
			`boot_client_plugins(${cp.list}, true);\n`
		);
	}
});

// ── server ──────────────────────────────────────────────────────────────────────────────────

export const runtime_url: Value<RuntimeUrlModule> = virtual.value({
	realm: 'server',
	id: 'runtime-url',
	// The runtime's IDENTITY — dev: its dev URL; build: its stable URL (the hashed file is looked up
	// at render time through the build handoff). Prescan first, so the feature hash matches the
	// client emit's stable name (both legs prescan the same source).
	from(app: CoreApp) {
		if (app.ctx.is_dev) return { runtime_url: dev_url(key(runtime)) };
		app.prescan();
		return { runtime_url: app.runtime_chunk_url() };
	}
});

/** The dev HMR bridge's served URL: the dev server's `__OGYGIA_DEV_HMR_URL__` (`''` in a build, so
 *  the script that loads it folds out of every leg: src/dev-hmr-url.ts). */
export const DEV_HMR_URL: string = dev_url(key(hmr));

export const devtools_boot_url: Value<DevtoolsBootUrlModule> = virtual.value({
	realm: 'server',
	id: 'devtools-boot-url',
	// the dev URL the handle injects on csr=true pages; '' in build/preview and with no client realm
	from: (app: CoreApp) => ({
		devtools_boot_url:
			app.plugins().client.length && app.ctx.is_dev ? dev_url(key(devtools_boot)) : ''
	})
});

export const region_deps: Family<RegionDepsModule> = virtual.family({
	realm: 'server',
	id: 'region-deps',
	exports: {
		region_deps: 'region_deps',
		region_interactivity: 'region_interactivity',
		chunk_contents: 'chunk_contents',
		chunk_heavy: 'chunk_heavy',
		chunk_duplicates: 'chunk_duplicates',
		chunk_barrels: 'chunk_barrels',
		region_hazards: 'region_hazards',
		region_css: 'region_css',
		content_css: 'content_css',
		region_css_inline: 'region_css_inline',
		region_reads_page: 'region_reads_page',
		region_page_keys: 'region_page_keys',
		region_page_why: 'region_page_why',
		region_remotes: 'region_remotes',
		fn_manifest: 'fn_manifest',
		entry_location: 'entry_location',
		location_map: 'location_map'
	},
	load: ({ ctx }: CoreApp, { ssr }) =>
		island_deps_module(ssr, ctx.is_dev, path.relative(ctx.root, kit_dirs(ctx.root).out_dir))
});

export const router_css: Family = virtual.family({
	realm: 'server',
	id: 'router-css',
	// the server router's component→CSS registrations; `export {}` without a server router
	load: (app: CoreApp, leg) =>
		router_css_module(app.router_css_roots(), {
			root: app.ctx.root,
			lib_dir: app.ctx.libDir,
			is_dev: app.ctx.is_dev,
			read_file: (p) => app.ctx.read_file(p),
			resolve: leg.resolve,
			exports: leg.exports
		})
});

export const secret: Value<SecretModule> = virtual.value({
	realm: 'server',
	id: 'secret',
	// the build's key material, and whether the build had an `OGYGIA_SECRET` (its ids are salted)
	from: ({ ctx }: CoreApp, { ssr }) =>
		ssr
			? { build_key: ctx.build_secret, build_had_secret: ctx.id_salt !== '' }
			: { build_key: '', build_had_secret: false }
});

export const sign: RequestEntry<CoreApp> = virtual.request({
	realm: 'server',
	id: 'sign',
	module: { core: 'server/hmac' },
	exports: { sign: 'sign', verify: 'verify', region_mac_message: 'region_mac_message' }
});

export const request_event: RequestEntry<CoreApp> = virtual.request({
	realm: 'server',
	id: 'request-event',
	module: { package: '$app/server' },
	exports: { get_request_event: 'getRequestEvent' }
});

export const region_endpoint: RequestEntry<CoreApp> = virtual.request({
	realm: 'server',
	id: 'region-endpoint',
	// Region's minting (lake endpoints, server regions, fingerprints, a hole's CSS). The browser leg
	// mints nothing: lakes reuse the endpoint the SSR restore cached, and the runtime fetches holes.
	module: { core: 'server/region-endpoint' },
	exports: {
		make_region_endpoint: 'make_region_endpoint',
		mint_server_region: 'mint_server_region',
		reuse_known_region: 'reuse_known_region',
		region_fingerprint: 'region_fingerprint',
		hole_css: 'hole_css'
	}
});

export const kit_wire: Family<KitWireModule> = virtual.family({
	realm: 'server',
	id: 'kit-wire',
	// Kit's OWN wire protocol (its transport-aware devalue codec), deep-imported by absolute path
	exports: {
		stringify_remote_arg: 'stringify_remote_arg',
		stringify_command_arg: 'stringify_command_arg',
		create_remote_key: 'create_remote_key'
	},
	load: ({ ctx }: CoreApp) =>
		ctx.kit_wire_path === null
			? null
			: `export { stringify_remote_arg, stringify_command_arg, create_remote_key } from ${JSON.stringify(ctx.kit_wire_path)};`
});

export const rate_limit: Value<RateLimitModule> = virtual.value({
	realm: 'server',
	id: 'rate-limit',
	// `max: 0` disables (`ogygia({ rateLimit })`)
	from: ({ ctx }: CoreApp, { ssr }) => ({
		rate_limit: ssr ? ctx.rate_limit : { max: 0, windowMs: 60000 }
	})
});

export const server_plugins: Family<ServerPluginsModule> = virtual.family({
	realm: 'server',
	id: 'server-plugins',
	exports: { server_plugins: 'plugins' },
	load: (app: CoreApp, { ssr }) => server_plugins_module(ssr, app.plugins().server)
});

export const profiler_maps: Value<ProfilerMapsModule> = virtual.value({
	realm: 'server',
	id: 'profiler-maps',
	// a placeholder the build fills with the maps (devtools' build/profiler-maps.ts); anything else: none
	from: ({ ctx }: CoreApp, { ssr }) => ({
		profiler_maps: ssr && ctx.is_build && ctx.measure ? PROFILER_MAPS_PLACEHOLDER : null
	})
});

export const router_config: Value<RouterConfigModule> = virtual.value({
	realm: 'server',
	id: 'router-config',
	from: ({ ctx }: CoreApp) => ({
		router_enabled: ctx.router_enabled,
		view_transitions: ctx.router_view_transitions
	})
});

export const session_cookie: Value<SessionCookieModule> = virtual.value({
	realm: 'server',
	id: 'session-cookie',
	// the cookie name sealed into the region MAC, or '' (`ogygia({ sessionCookie })`)
	from: ({ ctx }: CoreApp, { ssr }) => ({ session_cookie: ssr ? ctx.session_cookie : '' })
});

export const region_ttl: Value<RegionTtlModule> = virtual.value({
	realm: 'server',
	id: 'region-ttl',
	from: ({ ctx }: CoreApp, { ssr }) =>
		ssr
			? { region_ttl: ctx.region_ttl, renew_window: ctx.renew_window }
			: { region_ttl: 3600, renew_window: 0 }
});

export const route_csr: Value<RouteCsrModule> = virtual.value<CoreApp, RouteCsrModule>({
	realm: 'server',
	id: 'route-csr',
	// the client reads the same signal from `kit_hydrates_page()`
	from(app: CoreApp, { ssr }) {
		if (!ssr)
			return {
				csr_true_routes: new Set(),
				error_csr_true_routes: new Set(),
				root_layout_csr_true: true
			};
		const routes = app.routes_dir();
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
	exports: { route_config: 'route_config' },
	load: (app: CoreApp, { ssr }) =>
		route_config_module(ssr, app.routes_dir(), app.plugins().route_config)
});

export const server_manifest: Family<ServerManifestModule> = virtual.family({
	realm: 'server',
	id: 'server-manifest',
	exports: {
		load_server_regions: 'load_server_regions',
		region_url: 'region_url',
		region_name: 'region_name',
		region_render: 'region_render',
		render_region: 'render_region',
		region_reads_page_data: 'region_reads_page_data'
	},
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
	load(app: CoreApp, { ssr }) {
		if (ssr) app.prescan();
		return server_regions_module(ssr, app.program);
	}
});

// ── region ──────────────────────────────────────────────────────────────────────────────────

export const kit_transport: Family<KitTransportModule> = virtual.family({
	realm: 'region',
	id: 'kit-transport',
	exports: { kit_transport: 'transport' },
	// `ogygia.transport`: the codec cluster only when the app crosses a region or wired value over
	// Kit's wire; an empty map for an app of plain regions. The dist dir sits one level above
	// runtime/; the realm picks the transport.
	load({ ctx, program }: CoreApp, { ssr }) {
		const crosses = program.runtime_marks.wire === true || program.crosses_wire;
		return kit_transport_module(crosses, posix(`${ctx.runtime_dir}/..`), ssr);
	}
});

export const transportables_eager: Family = virtual.family({
	realm: 'region',
	id: 'transportables-eager',
	// a region entry's codecs: eager on the server, nothing in the browser
	load(app: CoreApp, { ssr }) {
		if (!ssr) return 'export {};\n';
		app.prescan();
		return transportables_server_module(app.program.transportable_modules);
	}
});

/** a csr=false route host's registry import on the client leg: its names as `undefined` */
export const registry_stub: Family = virtual.family({
	realm: 'region',
	id: REGION_FAMILY.registry_stub,
	parse: (rest) => rest,
	load: (_app: CoreApp, _leg, rest) => registry_stub_source(registry_stub_names(rest))
});

/** The per-region families the driver resolves and loads itself, off its registry (declared here
 *  so the namespace is complete): a region's entry, its binding, its lazy client leg, its wrapper,
 *  and its CSS-only FOUC graph. */
const driver_family = (id: string): Family =>
	virtual.family({ realm: 'region', id, parse: (rest) => rest });
export const region_entry: Family = driver_family(REGION_FAMILY.entry);
export const region_binding: Family = driver_family(REGION_FAMILY.binding);
export const region_lazy: Family = driver_family(REGION_FAMILY.lazy);
export const region_wrapper: Family = driver_family(REGION_FAMILY.wrapper);
export const fouc_css: Family = driver_family(REGION_FAMILY.fouc_css);
export const fouc_scoped: Family = driver_family(REGION_FAMILY.fouc_scoped);
export const client_binding_stub: Family = virtual.family({
	realm: 'region',
	id: REGION_FAMILY.client_binding_stub
});

// ── constants: the switches, as `define`s (read at config time, from the resolved options) ──

/** What core's switches read: the plugin's options, resolved at config time. */
export interface ConstantInput {
	continuity_forms: boolean;
	server_delta: boolean;
	devtools: boolean;
	devtools_lazy: boolean;
	rules: boolean;
	client_plugins: boolean;
	/** the runtime hooks some plugin's browser half subscribes to */
	hooks: readonly RuntimeHookName[];
	kit_major: number | null;
	version: string;
	dev_server: boolean;
}
type Constant<T extends boolean | number | string | null = boolean> = ConstantEntry<
	ConstantInput,
	T
>;

/** form continuity is on (`router: { forms }`) */
export const continuity_forms: Constant = virtual.constant({
	id: '__OGYGIA_CONTINUITY_FORMS__',
	from: (o: ConstantInput) => o.continuity_forms
});
/** server-delta navigation is on (`router.serverDelta`, default off) */
export const server_delta: Constant = virtual.constant({
	id: '__OGYGIA_SERVER_DELTA__',
	from: (o: ConstantInput) => o.server_delta
});
/** the event layer: off unless a plugin asked (`b.events()`); off, every `if (DEVTOOLS) emit(…)`
 *  folds out and the bus tree-shakes away */
export const devtools_gate: Constant = virtual.constant({
	id: '__OGYGIA_DEVTOOLS__',
	from: (o: ConstantInput) => o.devtools
});
/** a build with devtools on: the dock and the page measuring wait until someone opens it */
export const devtools_lazy: Constant = virtual.constant({
	id: '__OGYGIA_DEVTOOLS_LAZY__',
	from: (o: ConstantInput) => o.devtools_lazy
});
/** ogygia's rules on itself, in a build made for e2e (`OGYGIA_RULES=1`); dev has them always */
export const rules_gate: Constant = virtual.constant({
	id: '__OGYGIA_RULES__',
	from: (o: ConstantInput) => o.rules
});
/** a plugin's browser half is in the boot: the runtime calls its hooks */
export const client_plugins_gate: Constant = virtual.constant({
	id: '__OGYGIA_CLIENT_PLUGINS__',
	from: (o: ConstantInput) => o.client_plugins
});
const hook_gate = (name: RuntimeHookName): Constant =>
	virtual.constant({
		id: RUNTIME_HOOK_CONSTANTS[name],
		from: (o: ConstantInput) => o.hooks.includes(name)
	});
/** a plugin's browser half subscribes to `regionMount`; otherwise its emit point folds out */
export const hook_region_mount: Constant = hook_gate('regionMount');
/** a plugin's browser half subscribes to `regionUnmount` */
export const hook_region_unmount: Constant = hook_gate('regionUnmount');
/** a plugin's browser half subscribes to `regionHydrate` (around Svelte's hydrate) */
export const hook_region_hydrate: Constant = hook_gate('regionHydrate');
/** a plugin's browser half subscribes to `answerParsed` */
export const hook_answer_parsed: Constant = hook_gate('answerParsed');
/** a plugin's browser half subscribes to `answerPlaced` */
export const hook_answer_placed: Constant = hook_gate('answerPlaced');
/** a plugin's browser half subscribes to `regionHydrated` */
export const hook_region_hydrated: Constant = hook_gate('regionHydrated');
/** a plugin's browser half subscribes to `regionFailed` */
export const hook_region_failed: Constant = hook_gate('regionFailed');
/** a plugin's browser half subscribes to `holeAnswered` */
export const hook_hole_answered: Constant = hook_gate('holeAnswered');
/** a plugin's browser half subscribes to `holeFailed` */
export const hook_hole_failed: Constant = hook_gate('holeFailed');
/** a plugin's browser half subscribes to `holeBatchMissed` */
export const hook_hole_batch_missed: Constant = hook_gate('holeBatchMissed');
/** a plugin's browser half subscribes to `entryFallback` */
export const hook_entry_fallback: Constant = hook_gate('entryFallback');
/** a plugin's browser half subscribes to `navigated` */
export const hook_navigated: Constant = hook_gate('navigated');
/** a plugin's browser half subscribes to `criticalSettled` */
export const hook_critical_settled: Constant = hook_gate('criticalSettled');
/** a plugin's browser half subscribes to `warning` */
export const hook_warning: Constant = hook_gate('warning');

/** the app's Kit major (2, 3), or null when none was found (kit-paths.ts) */
export const kit_major: Constant<VirtualConstants['__OGYGIA_KIT_MAJOR__']> = virtual.constant({
	id: '__OGYGIA_KIT_MAJOR__',
	from: (o: ConstantInput) => o.kit_major
});
/** the installed ogygia's version, which the runtime discloses (`window.__ogygia.v`) */
export const version: Constant<VirtualConstants['__OGYGIA_VERSION__']> = virtual.constant({
	id: '__OGYGIA_VERSION__',
	from: (o: ConstantInput) => o.version
});
/** the dev HMR bridge's served URL on the dev server; '' in a build, so its script folds out */
export const dev_hmr_url: Constant<VirtualConstants['__OGYGIA_DEV_HMR_URL__']> = virtual.constant({
	id: '__OGYGIA_DEV_HMR_URL__',
	from: (o: ConstantInput) => (o.dev_server ? DEV_HMR_URL : '')
});

/** Core's constants. */
export const CORE_CONSTANTS: readonly Constant<boolean | number | string | null>[] = [
	continuity_forms,
	server_delta,
	devtools_gate,
	devtools_lazy,
	rules_gate,
	client_plugins_gate,
	hook_region_mount,
	hook_region_unmount,
	hook_region_hydrate,
	hook_answer_parsed,
	hook_answer_placed,
	hook_region_hydrated,
	hook_region_failed,
	hook_hole_answered,
	hook_hole_failed,
	hook_hole_batch_missed,
	hook_entry_fallback,
	hook_navigated,
	hook_critical_settled,
	hook_warning,
	kit_major,
	version,
	dev_hmr_url
];

/** The `define` map of core's constants, from the resolved options. */
export const core_defines = (input: ConstantInput): Record<string, string> =>
	defines(CORE_CONSTANTS, input);

/** The session the value entries' names are probed with at core build time (types.ts
 *  `probe_value_names`): the dev server, no plugins, the browser leg, so no `from` reads disk. */
export const CORE_PROBE: { app: CoreApp; leg: Leg } = {
	app: {
		ctx: { is_dev: true, is_build: false },
		plugins: () => ({ server: [], client: [], route_config: [] })
	} as unknown as CoreApp,
	leg: { ssr: false, universalHooks: null }
};

/** Core's entries, in the table's order. */
export const CORE_VIRTUALS: readonly Entry<CoreApp>[] = [
	runtime,
	fn_manifest,
	runtime_entry,
	runtime_flags,
	devtools_meta,
	transport,
	transportables,
	// (after the boot values: its features import the runtime, which reads them back)
	hydrate_features,
	hmr,
	devtools_boot,
	runtime_url,
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
