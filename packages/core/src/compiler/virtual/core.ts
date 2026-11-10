/**
 * CORE'S VIRTUAL MODULES, declared in the table (./table.ts): the first registrant. Each entry reads
 * its value off the compile session (`CoreApp`, the driver) and the leg it is loaded for.
 */
import { fs, path } from '../host.ts';
import { kit_dirs } from '../kit.ts';
import {
	generateHydrateFeaturesSource,
	generateRuntimeEntrySource,
	generateRuntimeFlagsSource
} from '../link/runtime-entry.ts';
import { island_deps_module, ISLAND_DEPS_TYPES } from '../link/island-deps.ts';
import { router_css_module } from '../link/router-css.ts';
import { server_plugins_module, route_config_module, sign_client_source } from '../link/caps.ts';
import { csrTrueRouteIds, errorCsrTrueRouteIds, rootLayoutCsrTrue } from '../kit.ts';
import {
	transport_module,
	transportables_module,
	kit_transport_module
} from '../link/transport.ts';
import {
	server_manifest_module,
	server_islands_module,
	server_island_ids,
	SERVER_MANIFEST_TYPES
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
import { virtual, type Entry } from './table.ts';

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
	/** dev: the server-island ids a server manifest was just emitted with */
	note_server_ids(ids: Set<string>): void;
}

/** a Kit transport hook's codecs, by type name (declared inside each module that exports one) */
const CODEC_MAP =
	'type CodecMap = Record<string, { encode: (v: unknown) => unknown; decode: (v: unknown) => unknown }>;';

const BACKSLASH_G = /\\/g;
const posix = (p: string): string => p.replace(BACKSLASH_G, '/');
/** A served dev URL for a virtual module (Vite's `/@id/` form of its resolved id). */
const dev_url = (id: string): string => '/@id/__x00__' + id;

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

const RUNTIME = virtual.family<CoreApp>({
	realm: 'boot',
	id: 'runtime',
	alias: 'virtual:ogygia-runtime',
	// Dev sticky: kitchen-sink package entry. Build uses the hashed emitFile chunk. An EXPLICIT
	// `bootDev()` call (not a bare side-effect import) so Vite's dep prebundler can't tree-shake the
	// boot away — the bug that left `sideEffects:false` apps with a runtime that never woke.
	load({ ctx }) {
		const ch = client_hooks_boot(ctx);
		const cp = client_plugins_boot(ctx);
		return `import { bootDev } from 'ogygia/runtime';\n${ch.imports}${cp.imports}bootDev(${cp.list});\n${ch.call}`;
	}
});
const FN_MANIFEST = virtual.family<CoreApp>({
	realm: 'boot',
	id: 'fn-manifest',
	alias: 'virtual:ogygia/fn-manifest',
	// og.$ factories, registered pre-hydration. Self-contained by the capture law, so emitting source
	// is a pure text move. DEV: the hoists are complete by the time the browser requests this (SSR
	// transformed the hosts first). BUILD: this module loads BEFORE all client transforms ran, so it
	// is a rename-proof PLACEHOLDER — a globalThis bridge + a token `renderChunk` patches once every
	// transform has contributed.
	load(app) {
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

/** Core's entries, in the table's order. */
export const CORE_VIRTUALS: readonly Entry<CoreApp>[] = [
	virtual.value<CoreApp>({
		realm: 'server',
		id: 'runtime-url',
		alias: 'virtual:ogygia/runtime-url',
		types: `const url: string;\nexport default url;`,
		// The runtime's IDENTITY — dev: its dev URL; build: its stable URL (the hashed file is looked up
		// at render time through the build handoff). Prescan first, so the feature hash matches the
		// client emit's stable name (both legs prescan the same source).
		from(app) {
			if (app.ctx.is_dev) return { default: dev_url(key(RUNTIME)) };
			app.prescan();
			return { default: app.runtime_chunk_url() };
		}
	}),
	FN_MANIFEST,
	virtual.family<CoreApp>({
		realm: 'boot',
		id: 'runtime-entry',
		alias: 'virtual:ogygia/runtime-entry',
		load(app) {
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
	}),
	virtual.family<CoreApp>({
		realm: 'boot',
		id: 'runtime-flags',
		alias: 'virtual:ogygia/runtime-flags',
		types: `/** the \`frames\` feature is in the build: some region streams HTML */\nexport const FRAMES: boolean;`,
		load(app) {
			// Dev runs the kitchen-sink boot: every flag on, like every feature.
			if (!app.ctx.is_build) return generateRuntimeFlagsSource({}, true);
			app.prescan();
			return generateRuntimeFlagsSource(app.program.runtime_marks);
		}
	}),
	virtual.family<CoreApp>({
		realm: 'boot',
		id: 'hydrate-features',
		alias: 'virtual:ogygia/hydrate-features',
		types: `/** installs the hydrate-phase features the app's marks selected */\nexport function install(): void;`,
		load(app) {
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
				(fn_refs_decode ? `import ${JSON.stringify(key(FN_MANIFEST))};\n` : '') +
				generateHydrateFeaturesSource(marks, ctx.runtime_dir).code
			);
		}
	}),
	RUNTIME,
	virtual.family<CoreApp>({
		realm: 'dev',
		id: 'hmr',
		alias: 'virtual:ogygia/dev-hmr',
		// Dev-only soft HMR bridge under csr=false (no Kit client entry): join /src/**/*.css into the
		// browser graph + strip Kit's FOUC bag. Failures fall through to a full document reload.
		load: ({ ctx }) => (ctx.is_dev ? dev_hmr_client_source() : `export {}`)
	}),
	virtual.value<CoreApp>({
		realm: 'server',
		id: 'dev-hmr-url',
		alias: 'virtual:ogygia/dev-hmr-url',
		types: `const url: string;\nexport default url;`,
		// '' in build/preview; the dev URL during `vite dev`
		from: ({ ctx }) => ({ default: ctx.is_dev ? dev_url('virtual:ogygia/dev-hmr') : '' })
	}),
	virtual.family<CoreApp>({
		realm: 'dev',
		id: 'devtools-boot',
		alias: 'virtual:ogygia/devtools-boot',
		// The plugins' browser halves on a csr=true (Kit-owned) page: the ogygia runtime never boots
		// there, so ONLY they boot, told it is a Kit page. Empty with no client realm (never injected).
		load({ ctx }) {
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
	}),
	virtual.value<CoreApp>({
		realm: 'boot',
		id: 'devtools-meta',
		alias: 'virtual:ogygia/devtools-meta',
		types: `/** island id → component name (a build; empty on the dev server) */\nexport const names: Record<string, string>;`,
		// a build: every island's component name, from the prescan (the dev server serves them live)
		from(app) {
			if (app.ctx.is_dev) return { names: {} };
			app.prescan();
			return { names: app.region_names() };
		}
	}),
	virtual.value<CoreApp>({
		realm: 'server',
		id: 'devtools-boot-url',
		alias: 'virtual:ogygia/devtools-boot-url',
		types: `const url: string;\nexport default url;`,
		// the dev URL the handle injects on csr=true pages; '' in build/preview and with no client realm
		from: ({ ctx }) => ({
			default:
				ctx.client_plugins.length && ctx.is_dev ? dev_url('virtual:ogygia/devtools-boot') : ''
		})
	}),
	virtual.family<CoreApp>({
		realm: 'server',
		id: 'island-deps',
		alias: 'virtual:ogygia/island-deps',
		types: ISLAND_DEPS_TYPES,
		load: ({ ctx }, { ssr }) =>
			island_deps_module(ssr, ctx.is_dev, path.relative(ctx.root, kit_dirs(ctx.root).out_dir))
	}),
	virtual.family<CoreApp>({
		realm: 'boot',
		id: 'transport',
		alias: 'virtual:ogygia/transport',
		types: `${CODEC_MAP}\nexport const transport: CodecMap;\nexport const encoders: Record<string, (v: unknown) => unknown>;\nexport const decoders: Record<string, (v: unknown) => unknown>;`,
		load: (_app, leg) =>
			transport_module(leg.universalHooks, leg.ssr ? null : (leg.kitCodec ?? null))
	}),
	virtual.family<CoreApp>({
		realm: 'region',
		id: 'kit-transport',
		alias: 'virtual:ogygia/kit-transport',
		types: `${CODEC_MAP}\nexport const transport: CodecMap;`,
		// `ogygia.transport`: the codec cluster only when the app crosses a region or wired value over
		// Kit's wire; an empty map for a pure-island app (transport.js sits one level above runtime/)
		load({ ctx, program }) {
			const crosses = program.runtime_marks.wire === true || program.crosses_wire;
			return kit_transport_module(crosses, posix(`${ctx.runtime_dir}/../transport.js`));
		}
	}),
	virtual.family<CoreApp>({
		realm: 'server',
		id: 'router-css',
		alias: 'virtual:ogygia/router-css',
		// dev inlines the compiled css, so any style-bearing source change re-emits it
		watch: ['styles'],
		// the server router's component→CSS registrations; `export {}` without a server router
		load: (app, leg) =>
			router_css_module(app.router_css_roots(), {
				root: app.ctx.root,
				lib_dir: app.ctx.libDir,
				is_dev: app.ctx.is_dev,
				read_file: (p) => app.ctx.read_file(p),
				resolve: leg.resolve
			})
	}),
	virtual.value<CoreApp>({
		realm: 'server',
		id: 'secret',
		alias: 'virtual:ogygia/secret',
		types: `/** this build's random key material (server leg; '' on the client) */\nexport const buildKey: string;\n/** the build saw an \`OGYGIA_SECRET\` (its region ids are salted from it) */\nexport const buildHadSecret: boolean;`,
		watch: ['options'],
		// the build's key material, and whether the build had an `OGYGIA_SECRET` (its ids are salted)
		from: ({ ctx }, { ssr }) =>
			ssr
				? { buildKey: ctx.build_secret, buildHadSecret: ctx.id_salt !== '' }
				: { buildKey: '', buildHadSecret: false }
	}),
	virtual.request<CoreApp>({
		realm: 'server',
		id: 'sign',
		alias: 'virtual:ogygia/sign',
		types: `export function sign(secret: string, message: string): string;\nexport function verify(secret: string, message: string, sig: string): boolean;\nexport function region_mac_message(id: string, exp: number | string, props: string, session?: string, ttl?: number | string, render?: string): string;`,
		module: ({ ctx }) => ctx.hmac_module,
		exports: ['sign', 'verify', 'region_mac_message'],
		client: () => sign_client_source()
	}),
	virtual.request<CoreApp>({
		realm: 'server',
		id: 'request-event',
		alias: 'virtual:ogygia/request-event',
		types: `export function getRequestEvent(): {\n\tcookies: { get: (name: string) => string | undefined };\n\trequest: Request;\n\t[key: string]: unknown;\n};`,
		module: () => '$app/server',
		exports: ['getRequestEvent'],
		// (the message is written in whole: the stub imports nothing)
		client: () =>
			`export function getRequestEvent() { throw new Error(${JSON.stringify(line('request_event_server_only'))}); }`
	}),
	virtual.request<CoreApp>({
		realm: 'server',
		id: 'kit-wire',
		alias: 'virtual:ogygia/kit-wire',
		types: `export function stringify_remote_arg(value: unknown, transport: unknown): string;\nexport function stringify_command_arg(value: unknown, transport: unknown): Promise<string>;\nexport function create_remote_key(id: string, payload: string): string;`,
		// Kit's OWN wire protocol (its transport-aware devalue codec), deep-imported by absolute path
		module: ({ ctx }) => ctx.kit_wire_path,
		exports: ['stringify_remote_arg', 'stringify_command_arg', 'create_remote_key']
	}),
	virtual.value<CoreApp>({
		realm: 'server',
		id: 'rate-limit',
		alias: 'virtual:ogygia/rate-limit',
		types: `/** \`max: 0\` disables. Baked from \`ogygia({ rateLimit })\`. */\nexport const rateLimit: { max: number; windowMs: number };`,
		watch: ['options'],
		from: ({ ctx }, { ssr }) => ({ rateLimit: ssr ? ctx.rate_limit : { max: 0, windowMs: 60000 } })
	}),
	virtual.family<CoreApp>({
		realm: 'server',
		id: 'server-plugins',
		alias: 'virtual:ogygia/server-plugins',
		types: `/** the server halves of the plugins listed beside \`ogygia()\`, in plugin order (the client: none) */\nexport const plugins: readonly { name: string; options: unknown; server: object }[];`,
		watch: ['plugins'],
		load: ({ ctx }, { ssr }) => server_plugins_module(ssr, ctx.server_plugins)
	}),
	virtual.value<CoreApp>({
		realm: 'server',
		id: 'profiler-maps',
		alias: 'virtual:ogygia/profiler-maps',
		types: `/** the server build's module map and chunk sourcemaps as one string (filled after the build), or\n *  null outside a profiler-on server build */\nconst maps: string | null;\nexport default maps;`,
		// a placeholder the build fills with the maps (vite/profiler-maps.ts); anything else: none
		from: ({ ctx }, { ssr }) => ({
			default: ssr && ctx.is_build && ctx.measure ? PROFILER_MAPS_PLACEHOLDER : null
		})
	}),
	virtual.value<CoreApp>({
		realm: 'server',
		id: 'router-config',
		alias: 'virtual:ogygia/router-config',
		types: `/** the SPA router is on (default), or off: \`ogygia({ router: false })\` */\nexport const enabled: boolean;\n/** navigations use the View Transitions API: \`ogygia({ router: { viewTransitions } })\` */\nexport const viewTransitions: boolean;`,
		watch: ['options'],
		from: ({ ctx }) => ({
			enabled: ctx.router_enabled,
			viewTransitions: ctx.router_view_transitions
		})
	}),
	virtual.value<CoreApp>({
		realm: 'server',
		id: 'session-cookie',
		alias: 'virtual:ogygia/session-cookie',
		types: `/** the cookie name sealed into the region MAC, or '' (\`ogygia({ sessionCookie })\`) */\nexport const sessionCookie: string;`,
		watch: ['options'],
		from: ({ ctx }, { ssr }) => ({ sessionCookie: ssr ? ctx.session_cookie : '' })
	}),
	virtual.value<CoreApp>({
		realm: 'server',
		id: 'region-ttl',
		alias: 'virtual:ogygia/region-ttl',
		types: `/** capability URL TTL in seconds (\`ogygia({ ttl })\`, default 3600) */\nexport const regionTtl: number;\n/** seconds after expiry an anonymous capability still renews (\`ogygia({ maxPageAge })\`) */\nexport const renewWindow: number;`,
		watch: ['options'],
		from: ({ ctx }, { ssr }) =>
			ssr
				? { regionTtl: ctx.region_ttl, renewWindow: ctx.renew_window }
				: { regionTtl: 3600, renewWindow: 0 }
	}),
	virtual.value<CoreApp>({
		realm: 'server',
		id: 'route-csr',
		alias: 'virtual:ogygia/route-csr',
		types: `/** route ids (group-stripped) whose effective csr is true */\nexport const csr_true_routes: ReadonlySet<string>;\n/** route ids whose ERROR render is hydrated (the layouts' csr; the page's option ignored) */\nexport const error_csr_true_routes: ReadonlySet<string>;\n/** the routeless error render: the root layout's own csr (Kit's default \`true\`) */\nexport const root_layout_csr_true: boolean;`,
		watch: ['routes'],
		// the csr=true route ids (a csr=false layout's islands degrade to inline under a csr=true leaf);
		// the client reads the same signal from `kit_hydrates_page()`
		from({ ctx }, { ssr }) {
			if (!ssr) {
				return {
					csr_true_routes: new Set(),
					error_csr_true_routes: new Set(),
					root_layout_csr_true: true
				};
			}
			const routes = kit_dirs(ctx.root).routes_dir;
			return {
				csr_true_routes: new Set(csrTrueRouteIds(routes)),
				// Kit renders a route's error page with its LAYOUT branch only
				error_csr_true_routes: new Set(errorCsrTrueRouteIds(routes)),
				root_layout_csr_true: rootLayoutCsrTrue(routes)
			};
		}
	}),
	virtual.family<CoreApp>({
		realm: 'server',
		id: 'route-config',
		alias: 'virtual:ogygia/route-config',
		types: `/** every Kit page route id → the keys plugins claim inside its \`config\` page option, merged */\nexport const route_config: Record<string, Record<string, unknown>>;`,
		watch: ['routes', 'plugins'],
		load: ({ ctx }, { ssr }) =>
			route_config_module(ssr, kit_dirs(ctx.root).routes_dir, ctx.route_config)
	}),
	virtual.family<CoreApp>({
		realm: 'server',
		id: 'server-manifest',
		alias: 'virtual:ogygia/server-manifest',
		types: SERVER_MANIFEST_TYPES,
		watch: ['regions'],
		// filled in dev AND build (the client's would be from URLs)
		load(app, { ssr }) {
			const { ctx, program } = app;
			if (ssr) app.prescan();
			if (ssr && ctx.is_dev) app.note_server_ids(new Set(server_island_ids(program)));
			return server_manifest_module(
				ssr,
				program,
				ctx.is_dev,
				(vp: string) => ctx.dev_url_for(vp),
				(iid: string) => ctx.island_public_url(iid)
			);
		}
	}),
	virtual.family<CoreApp>({
		realm: 'server',
		id: 'server-islands',
		alias: 'virtual:ogygia/server-islands',
		types: `/** server-island id → its loader */\nexport const islands: Record<string, () => Promise<{ default: unknown }>>;`,
		watch: ['regions'],
		load(app, { ssr }) {
			if (ssr) app.prescan();
			return server_islands_module(ssr, app.program);
		}
	}),
	virtual.family<CoreApp>({
		realm: 'region',
		id: 'transportables-eager',
		alias: 'virtual:ogygia/transportables-eager',
		// an island entry's codecs: eager on the server, nothing in the browser
		load(app, { ssr }) {
			if (!ssr) return 'export {};\n';
			app.prescan();
			return transportables_module(app.program.transportable_modules, true, (abs) => abs);
		}
	}),
	virtual.family<CoreApp>({
		realm: 'boot',
		id: 'transportables',
		alias: 'virtual:ogygia/transportables',
		types: `/** client: a transportable class module's tag path → its lazy import (server: empty, eager) */\nexport const wire_loaders: Record<string, () => Promise<unknown>>;\n/** client: the app sends wired values through Kit's transport — every class loads with every island */\nexport const wire_all: boolean;`,
		// transportable-class modules: eager on the server, lazy loaders on the client (tag paths are
		// root-relative, as the registration writes them)
		load(app, { ssr }) {
			app.prescan();
			const { ctx, program } = app;
			return transportables_module(
				program.transportable_modules,
				!!ssr,
				(abs) => path.relative(ctx.root, abs).split(path.sep).join('/'),
				program.crosses_wire
			);
		}
	}),

	// FAMILIES: generated per-file code under one prefix
	virtual.family<CoreApp>({
		realm: 'region',
		id: 'registry-stub/',
		alias: REGISTRY_STUB_PREFIX,
		parse: (rest) => rest,
		// a csr=false route host's registry import on the client leg: its names as `undefined`
		load: (_app, _leg, rest) => registry_stub_source(registry_stub_names(rest))
	}),
	// …and the families the driver resolves and loads itself, off its registry (declared here so the
	// namespace is complete)
	...(['island/', 'region/', 'lazy/', 'wrapper/', 'fouc-css/', 'fouc-scoped/'] as const).map((id) =>
		virtual.family<CoreApp>({
			realm: 'region',
			id,
			alias: `virtual:ogygia/${id}`,
			parse: (rest) => rest
		})
	),
	virtual.family<CoreApp>({
		realm: 'region',
		id: 'client-binding-stub',
		alias: 'virtual:ogygia/client-binding-stub'
	})
];

/** The id the bundler keys an entry's module by. */
function key(e: { alias?: string; realm: string; id: string }): string {
	return e.alias ?? `ogygia:${e.realm}/${e.id}`;
}
