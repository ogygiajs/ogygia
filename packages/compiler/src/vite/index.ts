import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { dedent } from '@ogygia/core/contract';
import { isMainThread } from 'node:worker_threads';
import { loadEnv, type Plugin, type Rolldown, type ViteDevServer } from 'vite';
import type { PreprocessorGroup } from 'svelte/compiler';
import { configure_build_cache } from '../compiler/build-cache.ts';
import {
	content_css_key,
	DEFAULT_REGION_TTL_SEC,
	RENEW_WINDOW_SEC,
	derive_id_salt,
	secret_has_min_entropy,
	MIN_SECRET_BYTES,
	BARREL_LEFT_REASONS,
	OWN_PACKAGE_NAMES,
	is_own_specifier,
	CORE_ROOT,
	CORE_ROOT_ID,
	real_posix,
	OGYGIA_REGION_MODULES,
	OGYGIA_INJECTED_IMPORTS,
	OGYGIA_INJECTED_FILES,
	APP_SHIMS,
	CLIENT_BINDING_STUB_FILE,
	STUB_CLIENT,
	STUB_STATE,
	STUB_PATHS,
	RUNTIME_DIR,
	OGYGIA_VERSION,
	type RuntimeHookName,
	type BarrelLeftReason,
	type ChunkBarrel
} from '@ogygia/core/contract';
import { island_sourcemaps_plugin } from './sourcemaps.ts';
import { lazy_files } from './lazy-files.ts';
import { install_dev_client_maps, install_dev_maps, install_dev_page_keys } from './dev-maps.ts';
import {
	is_island_path,
	normalize_import_keys,
	asRegionLocals
} from '../compiler/region/transform.ts';

export {
	normalize_import_keys,
	DEFAULT_IMPORT_KEYS,
	import_keys_hint,
	islandChunkFileName,
	islandPublicUrl,
	islandId,
	wrapperVirtualId,
	CLIENT_BINDING_STUB,
	regionId,
	regionIdentity,
	strategyKey
} from '../compiler/region/transform.ts';
export { rewrite_lake_import_to_placeholder } from '../compiler/region/emit.ts';
export type { ImportKeys } from '../compiler/region/transform.ts';
// the BUILD side of a plugin (design: internal/notes/packages.md, plugin API v2)
export { definePlugin } from './plugin-api.ts';
export type {
	OgygiaPlugin,
	PluginDefinition,
	BuildContext,
	MacroHandler,
	MacroContext,
	MarkupSource,
	MarkupRegions,
	TransformStage,
	TransformContext,
	TransformEvent,
	StageTransform,
	ExportsSeam,
	PinnedDecl,
	RegionsSeam
} from './plugin-api.ts';
export type {
	ExportMap,
	Entry as ExportEntry,
	Leaf as ExportLeaf,
	Policy as ExportPolicy
} from '../compiler/exports/index.ts';
export type { OgygiaPreset, OgygiaRateLimit, OgygiaOptions } from './options.ts';
import {
	find_plugins,
	resolve_plugins,
	type BuildSeams,
	type PluginDefinition,
	type ResolvedPlugins,
	type TransformContext,
	type TransformStage
} from './plugin-api.ts';
import MagicString from 'magic-string';
import { definers_plugin } from './definers.ts';
import type { ClientRealmFile, ServerRealm } from '../compiler/link/caps.ts';
import { assert_no_legacy_options, validate_region_presets, resolve_options } from './options.ts';
import {
	clientBuildWillSkip,
	hasAnyCsrFalseRoute,
	clear_route_csr_cache,
	keep_client_dir,
	inject_keep_client_route,
	resolve_kit_paths,
	kit_major,
	kit_dirs,
	kit_inline_style_threshold
} from '../compiler/kit.ts';
import { load_kit_dirs } from './kit-dirs.ts';
import {
	buildFoucCssModuleSource,
	collectFoucCssReachable,
	compileFoucScopedCss,
	foucRelFromId,
	isFoucCssId,
	isFoucScopedId,
	svelteHasStyle,
	through_caller,
	type WalkResolve
} from '../compiler/fouc-css.ts';
import { ExportIndex, Shapes } from '../compiler/exports/index.ts';
import type { BuildLeg } from '../compiler/leg.ts';
import { strip_bom } from '../compiler/bom.ts';

import { preprocess_component_for_css } from './style-preprocess.ts';
import {
	needs_csr_false_full_reload,
	needs_island_entry_full_reload
} from '../compiler/dev/hmr.ts';
import { derive_css_scope_owners, type DevGraphModule } from '../compiler/dev/css-scope.ts';
import {
	collectIslandDepModulepreloads,
	collect_inline_css,
	remote_hash_of,
	summarize_chunk_contents
} from '../compiler/link/island-deps.ts';
import { report_seed_shaping } from '../compiler/link/build-output.ts';
import { follow_pending_page_calls } from '../compiler/link/page-keys.ts';
import { unpatched } from '../compiler/link/relocations.ts';
import { emit_island_deps_handoff, refuse_client_secrets } from '../compiler/link/build-output.ts';
import {
	ssr_hosts_handoff_path,
	parse_server_handoff,
	type ServerHandoff,
	type ServerRegionRoot
} from '../compiler/link/emit-gate.ts';
import { router_css_key } from '../compiler/link/router-css.ts';
import { Program, strip_id } from '../compiler/program.ts';
import { Compiler } from '../compiler/driver.ts';
import { compiler_of, configured, new_session, resolve } from './session.ts';
import { core_defines } from '../compiler/virtual/core.ts';
import { CompileCtx, type PackageScan } from '../compiler/ctx.ts';
import { discover_package_files } from './package-files.ts';
import { async_twin_redirect, svelte_async_enabled } from './late-island.ts';
import { flags_manifest } from '../compiler/flags.ts';

// Kit's generated CLIENT app entry — Kit 2 dev serves `generated/client/app.js` and the build inputs
// `generated/client-optimized/app.js`; Kit 3 nests both under `generated/dev/` and `generated/build/`
// (`kit.outDir` is configurable, so match from `generated/`). The one module that evaluates exactly
// when Kit's client boots and NEVER on a csr=false page — the append target for the kit-world page
// thread (see the transform hook).
const KIT_CLIENT_APP_RE = /\/generated\/(?:build\/|dev\/)?client(-optimized)?\/app\.js$/;
// A route host (`+page`/`+layout.svelte`) or option file (`.js`/`.ts`, `.server` too): a dev change
// to any of these can shift the csr topology OR a plugin's key inside `export const config`.
const ROUTE_HOST_OR_OPTION_RE = /[\\/]\+(page|layout)(\.server)?\.(svelte|js|ts)$/;
// Appended INLINE (no extra module): publishes Kit's REAL reactive `page`/`navigating` on the
// well-known slot the island `$app/*` shims read through (`kit_bridge()` in shims/kit-bridge; the
// `$page` shim builds its live store from this `page`). Importer is Kit's own entry — never
// island-graph — so `$app/state` here is KIT'S REAL module, already in Kit's client graph. Never
// `$app/stores`: Kit 3 removed it (subscribing throws). Runs at module-eval, BEFORE
// `kit.start()`'s synchronous hydrate flush, so a shared component's first `page.data` read
// already sees Kit's truth (the app product-list crash read `{}` from the never-seeded island
// store there).
// `navigation` is Kit's REAL `$app/navigation` (goto, invalidate, preload, the hooks): an island on
// this document navigates through Kit's router, never through the ogygia one — which, on a document
// it does not own, could only fall back to a full load (a customer's green-band chips inside a live
// island reloaded the whole account page on every click).
const KIT_PAGE_THREAD = `\n${dedent`
	import { page as __og_kit_page, navigating as __og_kit_nav } from '$app/state';
	import * as __og_kit_navigation from '$app/navigation';
	globalThis[Symbol.for('ogygia.kit-page')] = { page: __og_kit_page, navigating: __og_kit_nav, navigation: __og_kit_navigation };
`}\n`;
// Which ogygia a csr=true page runs, on `window.__ogygia.v` — Kit runs that page, and the ogygia
// runtime boots there only for what Kit cannot do (a deferred region, a lake); a page with neither
// runs no ogygia runtime, so Kit's entry discloses it too. Where the runtime does boot, it adds the
// same version (runtime/disclose-version.ts): the Set keeps one.
const KIT_DISCLOSE_VERSION = `((globalThis.__ogygia ??= {}).v ??= new Set()).add(${JSON.stringify(OGYGIA_VERSION)});\n`;
import { scan_entry_pattern, KIT_REMOTE_CLIENT, KIT_REMOTE_STATE, RUNTIME_HASH } from './paths.ts';

import type { OgygiaOptions } from './options.ts';
import { OgygiaError, warn, line } from '../compiler/messages.ts';

/** css-ish file the dev bridge manages (mirrors the bridge's glob). */
const DEV_CSS_FILE_RE = /\.(css|scss|sass|less|styl)$/;
const BACKSLASH_G = /\\/g;

const CSS_EXT_RE = /\.css$/;
const STYLE_BEARING_FILE_RE = /\.(svelte|css|scss|sass|less|styl)$/;
/** The bundler's resolver as the CSS walk's (compiler/fouc-css.ts `collectFoucCssReachable`): what
 *  the build resolves, the walk reaches — a package's `exports`, a workspace link, an alias. */
function bundler_resolve(ctx: {
	resolve(
		source: string,
		importer?: string,
		o?: { skipSelf?: boolean }
	): Promise<{ id: string; external?: boolean | string } | null>;
}): (spec: string, importer: string) => Promise<string | null> {
	return async (spec, importer) => {
		try {
			const r = await ctx.resolve(spec, importer, { skipSelf: true });
			return r && !r.external ? r.id : null;
		} catch {
			return null; // (Vite throws for a specifier this importer cannot resolve)
		}
	};
}

/**
 * Vite plugin: transforms `with { hydrate | defer | preset }` imports into islands,
 * serves virtual island modules, and wires signed region endpoints for deferred HTML.
 *
 * Place **before** `sveltekit()` in `vite.config`.
 *
 * @param options - Plugin configuration. See {@link OgygiaOptions}.
 * @returns Vite plugins (`ogygia` pre + island sourcemap fix post). Vite flattens the array.
 */
export function ogygia(options: OgygiaOptions = {}): Plugin[] {
	const standalone = options.standalone === true;

	assert_no_legacy_options(options);

	const visibleMargin = options.visible?.margin;
	const presets = options.presets || {};
	validate_region_presets(presets);
	// The app's ogygia plugins: Vite plugins listed beside this one, found in the `config` hook (where
	// the list, the root and the mode are known). Standalone has no handle to wire them into.
	let app_plugins: PluginDefinition[] = [];
	let server_plugins: ServerRealm[] = [];
	let client_plugins: ClientRealmFile[] = [];
	let runtime_hooks: RuntimeHookName[] = [];
	let route_config: string[] = [];
	let foreign_hydrate = false;
	let macros: ResolvedPlugins['macros'] = [];
	let stage_transforms: ResolvedPlugins['transforms'] = [];
	let markup: ResolvedPlugins['markup'] = [];
	let definers: ResolvedPlugins['definers'] = [];
	const import_keys = normalize_import_keys(options.importKeys);
	// What the plugins asked of the build (their `build` hooks, run in `config` below): the build's
	// measurement data (`b.measure()`, the profiler) and core's event emits (`b.events()`, devtools).
	let measure = false;
	// Compile surfaces beyond the app's src — ONE mechanism for a plugin's own pages (`b.files()`: the
	// profiler UI and its server-router module) and for dependencies that declare `"ogygia": { "files":
	// […] }` in their package.json. Filled in the config hook (root known); captured by reference into
	// the CompileCtx built in configResolved.
	const pkg_scan: PackageScan[] = [];
	/** the roots of plugins' own pages (`b.files()`), as module-id prefixes */
	const plugin_file_roots: string[] = [];
	let declared_scanned = false;
	// PAGE MODULES (`b.pageModules()`: a programmatic router) — the router-css roots: importers of these
	// specifiers, and these files (real POSIX paths, like the scan's).
	let page_importers: string[] = [];
	let page_files: string[] = [];

	// Router / rate-limit / session / ttl / continuity / server-delta → the flat config (pure derivation).
	const {
		rate_limit,
		session_cookie,
		region_ttl,
		renew_window,
		router_enabled,
		router_view_transitions,
		continuity_forms,
		server_delta
	} = resolve_options(options, DEFAULT_REGION_TTL_SEC, RENEW_WINDOW_SEC);
	// Core's event emits compiled in (a plugin's `b.events()`), and its lazy form (launcher only, no
	// measuring until someone opens a tool) — everything downstream reads these (define, CompileCtx,
	// dev middleware).
	let devtools_effective = false;
	let devtools_lazy = false;

	// The Program — the cross-file linker / island graph, made with the compiler at each resolve (the
	// compiler makes each later build of a watch its own: `compiler.program`). It owns the descriptor
	// registry + the feature-mark bag (seeded from the two app-wide config flags), and the behavior over
	// them (register / unregister_host / note_runtime_mark). Never module-global, so Kit's throwaway
	// plugin instance has a different Program and can't leak into the real build.
	// The feature-selected runtime chunk name lives on the driver as `compiler.runtime_chunk_filename()`
	// (RUNTIME_HASH ⊕ the scan's feature_hash — see CompileCtx.runtime_chunk_filename); buildStart's
	// emitFile and the runtime-url virtual both read it, so both build legs compute the same immutable name.

	// HMAC key for signing region capability URLs (defer / remount:swr). Default: a fresh
	// per-build random baked into the SERVER bundle only (never a client chunk). Optional
	// `OGYGIA_SECRET` overrides that so rolling deploys / long-lived cached HTML keep verifying.
	// Sign/verify HKDF-derive a MAC key from this material (`ogygia-mac-v1`).
	const build_secret = crypto.randomBytes(32).toString('hex');
	/** Salt for region ids — HKDF from stable env only (never per-build random, or SSR/client
	 *  builds would disagree). Empty when unset (dev + default per-build signing). */
	let id_salt = '';

	// THE CSS OF A SUBTREE NO CLIENT CHUNK CARRIES. Three kinds of root render without a client chunk
	// of their own, so no page stylesheet carries their CSS or their children's: a router page (a
	// runtime value, not a Kit route), a server-only hole (`render: 'deferred'` with no client chunk),
	// and a content module (it renders on the server only; the leak-free corpus never enters the
	// client graph). Each root gets its whole tree CSS (every scoped `<style>` + plain style imports,
	// in cascade order) as ONE dedicated asset, which rolldown's shared-chunk CSS hoisting cannot
	// scatter (every profiler page wraps Shell). The walk reaches what the build resolves
	// (compiler/fouc-css.ts), and a file compiles once per build however many roots reach it.
	// Preprocessed, script kept (TS stripped): a raw `svelte.compile` throws on scss or a script-reading
	// template (`$store`) and falls back to UNSCOPED bodies, leaking a component's CSS across the
	// document. A plain `.css` import ships verbatim; a preprocessor dialect file (.scss/…) is skipped.
	// `own`: the root's source when it is not the file on disk (a content module's post-mdsvex Svelte);
	// the root's own CSS is then the caller's. `skip`: files whose CSS ships some other way. Each
	// file's CSS compiles once per leg (`BuildLeg.compiled_css`).
	const tree_css_walk = (
		ctx: Parameters<typeof bundler_resolve>[0] & { environment: { name: string } }
	) => {
		const { compiled_css } = leg_of(ctx);
		const walk_resolve = bundler_resolve(ctx);
		const exports = css_walk_index(ctx.environment.name);
		return async (
			abs: string,
			opts: { own?: string; skip?: (abs: string) => boolean } = {}
		): Promise<string> => {
			const { own, skip } = opts;
			const parts: string[] = [];
			for (const e of await collectFoucCssReachable(abs, {
				root,
				libDir,
				readFile: own == null ? readFile : (p: string) => (p === abs ? own : readFile(p)),
				alias: resolve_alias,
				resolve: walk_resolve,
				exports
			})) {
				if ((own != null && e.abs === abs) || skip?.(e.abs)) continue;
				let css = compiled_css.get(e.abs);
				if (css === undefined) {
					const src = readFile(e.abs);
					css =
						src == null
							? null
							: e.kind === 'scoped'
								? compileFoucScopedCss(
										e.abs,
										await preprocess_component_for_css(src, e.abs, root),
										{ keepScript: true }
									)
								: CSS_EXT_RE.test(e.abs)
									? src
									: null;
					compiled_css.set(e.abs, css);
				}
				if (css) parts.push(css);
			}
			return parts.join('\n');
		};
	};
	// tag → self-contained factory source from og.$ rewrites (served by the fn-manifest virtual so
	// client bundles can register factories pre-hydration; the payload-source fallback covers bundles
	// that miss it) now lives on the driver as `compiler.dollar_hoists` — the macro leg fills it.

	let root: string;
	let base = '';
	/** SvelteKit `config.kit.appDir` (default `_app`) — read from Kit's `__SVELTEKIT_APP_DIR__` define. */
	let app_dir = '_app';
	let libDir: string;
	let is_dev = false;
	/** the app compiles with Svelte's async mode (vite-plugin-svelte's resolved options): Region
	 *  imports the awaiting LateIsland (late-island.ts) */
	let svelte_async = false;
	/** Resolved `resolve.alias` entries — passed to bake()'s rolldown eval so `$lib` etc. resolve. */
	let resolve_alias: { find: string | RegExp; replacement: string }[] = [];
	let is_build = false;
	let is_ssr = false;
	/** The leg a build hook runs in: the hook's ENVIRONMENT — Vite's environment API builds `ssr` and
	 *  `client` in one app build (Kit 3), where `config.build.ssr` is false for both, so the client's
	 *  work (the runtime chunk, the islands, their names) ran in the server leg too and landed in the
	 *  server output — every island 404'd. A hook the bundler calls without one runs in the one leg
	 *  open (driver `Compiler.leg`; two open is refused). */
	const env_of = (ctx: unknown): { name: string; server: boolean } | null => {
		const env = (ctx as { environment?: { name?: string; config?: { consumer?: string } } } | null)
			?.environment;
		if (!env?.name) return null;
		return { name: env.name, server: env.name === 'ssr' || env.config?.consumer === 'server' };
	};
	const leg_of = (ctx: unknown): BuildLeg => compiler_of(session, 'leg').leg(env_of(ctx));
	let vite_server: ViteDevServer | null = null;
	/** absolute path to Kit's internal wire-protocol module (deep import) */
	let kit_wire_path: string | null = null;
	/** absolute path to Kit's client remote-functions entry (Plan A reuse) */
	let kit_remote_index: string | null = null;
	/** absolute path to the app's universal hooks (for `transport`), if present */
	let universal_hooks: string | null = null;
	/** absolute path to the app's client hooks (src/hooks.client.*), if present — its `init` runs on
	 *  boot for csr=false pages (Kit never runs it there). */
	let client_hooks: string | null = null;
	/** absolute path to Kit 3's client codec module (`#app/internal/transport`); null on Kit 2 */
	let kit_transport_init: string | null = null;
	/** true once the process-exit cleanup for the injected keep-client route is registered */
	let keep_client_cleanup_armed = false;

	const readFile = (abs: string) => {
		try {
			return fs.readFileSync(abs, 'utf-8');
		} catch {
			return null;
		}
	};

	// The app's module shapes, each parsed once (compiler/exports/): the CSS walk's indexes and the
	// plugins' (`b.exports`) read the same ones. An index is per resolver: the CSS walk resolves past
	// this plugin, a stage transform through it, so they share parses, never resolutions.
	const shapes = new Shapes((abs) => {
		const code = readFile(abs);
		return code == null ? null : strip_bom(code);
	});
	// The plugins' seams (vite/plugin-api.ts): one export index per environment, resolved as the
	// transformed module resolves (through every plugin's resolveId, this one's included)
	const transform_indexes = new Map<string, ExportIndex<TransformContext>>();
	const seams: BuildSeams = {
		exports: {
			map(file, spec, policy, t) {
				let index = transform_indexes.get(t.environment);
				if (index === undefined)
					transform_indexes.set(
						t.environment,
						(index = new ExportIndex<TransformContext>(
							(s, importer, caller) => caller.resolve(s, importer),
							shapes
						))
					);
				return index.map(file, spec, policy, t);
			}
		},
		pinned_imports(code) {
			const keys = new Set(Object.values(import_keys));
			const locals = asRegionLocals(code);
			return (decl) =>
				decl.attribute_keys.some((k) => keys.has(k)) ||
				(locals.size > 0 && decl.specs.some((s) => locals.has(s.local)));
		},
		regions: {
			names: () => compiler_of(session, 'regions.names').region_names(),
			barrelWhy: (file, importers) => barrel_why(file, importers)
		}
	};
	// Why a barrel stayed (`t.emit`), per environment and stage (a stage's run forgets only its own
	// earlier word on the module): what the findings read back for a barrel an island still imports
	// whole. Each leg keeps its own (`BuildLeg.barrels_left`), dropped with its build.
	/** Why the browser's `barrel` stayed, by every stage. */
	const barrel_why = (barrel: string, importers: Iterable<string>): BarrelLeftReason[] => {
		const ids = [...importers];
		const found = new Set<BarrelLeftReason>();
		const client = compiler_of(session, 'regions.barrelWhy').find_leg('client');
		for (const stage of ['source', 'post'] as const)
			for (const r of client?.barrels_said(stage)?.why(barrel, ids) ?? []) found.add(r);
		return BARREL_LEFT_REASONS.filter((r) => found.has(r));
	};
	// A stage's host: runs the plugins' transforms of `stage` over one MagicString of the module, so
	// the stage is one result and one map wherever the app lists the plugins
	const stage_host = (stage: TransformStage): Plugin => ({
		name: `ogygia:${stage}`,
		enforce: 'pre',
		async transform(raw, id) {
			const mine = stage_transforms.filter((s) => s.stage === stage && (s.filter?.(id) ?? true));
			if (mine.length === 0) return null;
			const left = leg_of(this).barrels_left(stage);
			left.forget(id);
			// edits land by parser offsets: no byte-order mark in front of them (compiler/bom.ts)
			const code = strip_bom(raw);
			const edit = new MagicString(code);
			const t: TransformContext = {
				id,
				code,
				edit,
				environment: this.environment.name,
				resolve: async (spec, importer) => {
					let r: Awaited<ReturnType<typeof this.resolve>>;
					try {
						r = await this.resolve(spec, importer, { skipSelf: true });
					} catch {
						return null; // ok: Vite throws for a specifier this importer cannot resolve
					}
					return r && !r.external ? r.id.replace(BACKSLASH_G, '/') : null;
				},
				watch: (file) => this.addWatchFile(file),
				emit: (e) => left.record(id, e.barrel, e.reason)
			};
			for (const s of mine) await s.transform(t);
			return edit.hasChanged()
				? { code: edit.toString(), map: edit.generateMap({ hires: true }) }
				: null;
		}
	});
	const css_walk_indexes = new Map<string, ExportIndex<WalkResolve>>();
	const css_walk_index = (environment: string): ExportIndex<WalkResolve> => {
		let index = css_walk_indexes.get(environment);
		if (index === undefined)
			css_walk_indexes.set(environment, (index = new ExportIndex(through_caller, shapes)));
		return index;
	};

	const __prof = {
		transformMs: 0,
		transformN: 0,
		transformHit: 0,
		prescanMs: 0,
		bakeMs: 0,
		bakeN: 0,
		resolveMs: 0,
		loadMs: 0
	};
	const __P = !!process.env.OGYGIA_PROFILE;
	const __outHash = new Map<string, number>();

	// The driver — the bundler-agnostic compile session (Program + transform cache + profiler). It holds
	// the whole file-local + discovery front-end (transform / ts_regions / macros / prescan / emit /
	// resolve_id / transform_module / …). It is made in configResolved with its CompileCtx, once the
	// build is resolved (root/dev/id_salt known); each hook takes it from the session (./session.ts)
	// and injects the Vite primitives it owns.
	const session = new_session();

	// ── keep-client route injection ──────────────────────────────────────────
	// All-csr=false apps make Kit skip its ENTIRE client build, so ogygia's runtime is never emitted
	// and islands 404 at runtime. Fix: during a build, inject a URL-less keepalive layout — a single
	// `csr = true` node with no `+page`, so no servable URL — which flips Kit's `skip_client_build`
	// check and lets Kit's OWN client build run (honoring the user's preprocessors, appDir, etc.). It
	// is removed at process exit, so nothing is left on disk. This is fully de-internalified — it
	// consults NO SvelteKit internal:
	//   • WHO injects: only the main build thread (`isMainThread`). Kit runs its postbuild analyse/
	//     prerender tasks in worker THREADS that re-load the Vite config; there `isMainThread` is
	//     false, so they never re-create the dir. (Public Node API — not Kit's `SVELTEKIT_FORK`.)
	//   • WHEN we clean up: `process.on('exit')`, which fires once the whole build (client build +
	//     workers + prerender, however Kit nests them) has finished. No dependency on Kit's hook
	//     ordering. Worst case (a hard crash) leaves a gitignored dir that self-heals next run.
	/** Register the one-time process-exit cleanup (main thread only). */
	const arm_keep_client_cleanup = (r: string) => {
		if (keep_client_cleanup_armed) return;
		keep_client_cleanup_armed = true;
		process.on('exit', () => {
			try {
				fs.rmSync(keep_client_dir(r), { recursive: true, force: true });
			} catch {
				// ok: best effort; the folder is gitignored and cleaned on the next run
			}
		});
	};

	const invalidate_module_id = (server: ViteDevServer, id: string) => {
		const mod = server.moduleGraph.getModuleById(id);
		if (mod) server.moduleGraph.invalidateModule(mod);
	};

	// Drop the cached virtual island modules + registry rows for `file` when a HOST changes or an ENTRY
	// is deleted — the driver (`compiler.invalidate_for_file`) owns the island-graph mutations + the
	// affected-module walk; this binds Vite's module invalidation and the server guard. No server → no-op.
	const invalidate_islands_for_file = (
		file: string,
		{
			deleted = false,
			server = vite_server
		}: { deleted?: boolean; server?: ViteDevServer | null } = {}
	) => {
		if (!server) return false;
		return compiler_of(session, 'invalidate').invalidate_for_file(file, {
			deleted,
			invalidate: (id) => invalidate_module_id(server, id)
		});
	};

	return [
		// the plugins' `source` stage: on the module as written, before the region transform below
		stage_host('source'),
		// dev: the plugins' definer calls marked with their module's run (./definers.ts); a
		// normal-order transform, so its place here among the pre-enforced ones does not matter
		definers_plugin(() => definers),
		{
			name: 'ogygia',
			enforce: 'pre',

			// `order: 'pre'` so it runs before `sveltekit()`'s config hook, which discovers routes
			// (and computes `skip_client_build`). The injected keep-client route must be on disk first.
			config: {
				order: 'pre',
				async handler(userConfig, env) {
					configured(session);
					// Kit's `files.routes` / `outDir` from the app's Kit config — resolved BEFORE anything
					// below walks the routes tree or picks an output path (compiler/kit.ts `kit_dirs`). An
					// app building a second route tree from one source configures both. Read off Kit's own
					// plugin (Kit 3 takes its config in vite.config only), else the svelte.config.js file.
					await load_kit_dirs(path.resolve(userConfig.root ?? '.'), userConfig.plugins);

					// PLUGINS: the realms they name, and their `build` hooks — here, where the root and
					// the mode exist and before the defines below, which read what they asked for. (`b.markup()`
					// hands back the island transform of the instance Vite configures: Kit evaluates the Vite
					// config more than once.)
					app_plugins = standalone ? [] : await find_plugins(userConfig.plugins);
					const resolved = resolve_plugins(
						app_plugins,
						path.resolve(userConfig.root ?? '.'),
						env.command === 'serve',
						(source, filename) =>
							compiler_of(session, 'markup').transform_content_island(source, filename),
						seams
					);
					stage_transforms = resolved.transforms;
					({
						servers: server_plugins,
						clients: client_plugins,
						client_hooks: runtime_hooks,
						route_config,
						foreign_hydrate,
						macros,
						markup,
						definers
					} = resolved);
					measure = resolved.measure;
					devtools_effective = resolved.events !== false;
					devtools_lazy = resolved.events !== false && resolved.events.lazy;
					page_importers = resolved.page_modules.importers;
					page_files = resolved.page_modules.files.map(real_posix);
					for (const p of resolved.files)
						if (!pkg_scan.some((s) => s.name === p.name)) {
							plugin_file_roots.push(`${real_posix(p.root)}/`);
							pkg_scan.push({
								name: p.name,
								root: real_posix(p.root),
								dirs: p.dirs.map(real_posix),
								files: p.files.map(real_posix)
							});
						}

					// Keep Kit's client build alive on all-csr=false apps: inject a URL-less keepalive
					// route BEFORE Kit reads the routes. Main build thread only; removed at process exit.
					if (env.command === 'build' && !standalone && isMainThread) {
						const r = path.resolve(userConfig.root ?? '.');
						const routes = kit_dirs(r).routes_dir;
						// `clientBuildWillSkip` ignores our own keepalive dir, so it reflects the user's
						// real routes: inject only when Kit really would skip, else sweep any stale dir.
						if (clientBuildWillSkip(routes)) {
							inject_keep_client_route(r);
							arm_keep_client_cleanup(r);
						} else {
							fs.rmSync(keep_client_dir(r), { recursive: true, force: true });
						}
					}

					// Dependencies that DECLARED an ogygia compile surface (`"ogygia": { "files": […] }`
					// in their own package.json) — only declared packages, only their declared paths,
					// never a blind node_modules walk. Discovered here (root known), consumed by the
					// prescan + transform gates via CompileCtx.pkg_scan. Guarded against double-push:
					// Kit invokes plugin config more than once per process in some flows.
					if (!standalone && !declared_scanned) {
						declared_scanned = true;
						for (const p of discover_package_files(path.resolve(userConfig.root ?? '.')))
							if (!pkg_scan.some((s) => s.name === p.name)) pkg_scan.push(p);
					}
					// Plugin packages are ogygia's own code to the app: SSR-inlined (they ship `.svelte`, and
					// read core's per-request state) and never pre-bundled (one core in the dev browser).
					const declared_pkg_names = [
						...new Set([...pkg_scan.map((p) => p.name), ...app_plugins.map((p) => p.name)])
					];

					// Match Kit: SSR-inline `esm-env` so its development/production export conditions
					// resolve per mode (used if anything in our server graph imports it). Do NOT
					// optimizeDeps.exclude it — that breaks Svelte client prebundles that import DEV.
					//
					// SSR-inline OGYGIA ITSELF too. ogygia ships real `.svelte` components (Region,
					// OgygiaBoundary, …) that the app's server build MUST compile — if ogygia is left
					// EXTERNAL, Node loads a raw `.svelte` at server runtime and crashes with
					// `ERR_UNKNOWN_FILE_EXTENSION`. vite-plugin-svelte normally auto-noExternals a svelte
					// library (ogygia carries the `svelte` export condition), but that detection is fragile
					// under some installs (adapter-node output, a pkg.pr.new URL dependency, an app that
					// pins/overrides noExternal), so we force it here — the plugin is always present, so this
					// can't be missed. `server.fs.allow`: kit-remote stubs / runtime resolve to absolute
					// paths under this package; without it Vite 403s them when the app root is docs/ or playground/.
					//
					// Declared `ogygia.files` packages join both lists: SSR-external code never enters
					// our compiler, and the dev prebundle would choke on `with { }` attributes (esbuild)
					// before the transform ever saw them.
					// DEV churn guard. Under `csr = false` Kit ships no client entry, so Vite's dep
					// scanner finds nothing to crawl: island client deps are discovered LAZILY, one page
					// render at a time, and each discovery re-optimizes and rotates the optimizer's
					// browserHash. A tab loaded under the old hash then dynamic-imports island deps at a
					// `?v=` that 404s and every island fails on wake (a "works for everyone but me"
					// report after a `.vite` nuke). Pre-declaring the deps EVERY hydrated island imports
					// forces one up-front optimize pass and removes the first-minutes cliff. Dev server
					// only; a build has a real client graph. The app's own `include` is preserved by Vite
					// (it merges plugin `include` arrays).
					// …and what ogygia's own client code imports in dev: `svelte/server` (a region snippet's
					// static capture — a build drops it, the dev server serves it) and, with devtools on, the
					// dock's drag and resize. Found late, each one re-optimized and RELOADED the page — a
					// dock opened in that moment closed again (the devtools suite's cold-start timeouts).
					// (ogygia's own dependencies — devalue, the dock's — are named through it, `ogygia > …`, the
					// way Vite includes a dependency of an excluded package: under a strict install the app
					// cannot resolve them by bare name, and Vite skipped devalue with a warning)
					const dev_island_deps =
						env.command === 'serve'
							? [
									'svelte',
									'svelte/internal/client',
									'svelte/server',
									// (core's dependency, not the app's: under pnpm the app root can't resolve it bare;
									// the app installs `ogygia`, which depends on `@ogygia/core`)
									'ogygia > @ogygia/core > devalue'
									// (a plugin's own client dependencies, named through it — `@ogygia/devtools >
									// @neodrag/svelte` — come from its `vite` plugins' `optimizeDeps.include`)
								]
							: [];
					// ONE OGYGIA IN THE DEV BROWSER: ogygia itself is never pre-bundled. An installed
					// ogygia (not a workspace link) would be: the boot's `ogygia/runtime` went into
					// `.vite/deps` while everything the compiler writes — the island modules and their
					// `ogygia/internal`, `ogygia:boot/hydrate-features` — imports ogygia's files by
					// path, so the page ran two copies of its stateful modules (slots, the devtools bus,
					// the island graph). The wire installed into one `slots` and the hydrate core read the
					// other: every island with a snippet prop failed ("wired prop but no wire feature").
					// A linked ogygia (this repo, every test) is never pre-bundled; excluding it makes an
					// installed one the same single graph. Its own dependencies (svelte, devalue) are
					// still pre-bundled, once, shared with the app.
					return {
						// ONE KIT: ogygia reads Kit's request store (`@sveltejs/kit/internal/server`) — the
						// request a render belongs to (its devtools events, the postrender verdict's reads, the
						// page seed). A second Kit resolved from ogygia's own location has its own, empty store:
						// a workspace-linked ogygia whose peer resolved another Kit than the app's lost every
						// one of those, silently. Kit always resolves from the app.
						resolve: { dedupe: ['@sveltejs/kit'] },
						ssr: { noExternal: ['esm-env', ...OWN_PACKAGE_NAMES, ...declared_pkg_names] },
						optimizeDeps: {
							exclude: [...OWN_PACKAGE_NAMES, ...declared_pkg_names],
							include: dev_island_deps
						},
						// CONTINUITY config → compile-time constants the client runtime reads (typeof-guarded,
						// so a plain node import of dist/ without these defined falls back to defaults).
						// the switches (compiler/virtual/core.ts: the table's constants)
						define: core_defines({
							continuity_forms,
							server_delta,
							devtools: devtools_effective,
							devtools_lazy,
							rules: process.env.OGYGIA_RULES === '1',
							client_plugins: client_plugins.length > 0,
							hooks: runtime_hooks,
							kit_major: kit_major(path.resolve(userConfig.root ?? '.')),
							version: OGYGIA_VERSION,
							dev_server: env.command === 'serve'
						}),
						server: {
							fs: {
								allow: [CORE_ROOT]
							}
						},
						// Island emitFile entries re-export shared components; keep facade exports
						// under Vite 8 / Rolldown (build.rolldownOptions — not deprecated rollupOptions).
						build: {
							rolldownOptions: {
								preserveEntrySignatures: 'exports-only'
							}
						}
					};
				}
			},

			configResolved(config) {
				root = config.root;
				base = config.base || '';
				svelte_async = svelte_async_enabled(config.plugins);
				// ogygia keeps itself out of the dep optimizer (one copy in the dev browser, see the
				// `config` hook); an app that lists part of it in its own `include` brings the second
				// copy back — say so, once, instead of a hydration error far from the cause
				if (config.command === 'serve') {
					const own = (config.optimizeDeps?.include ?? []).filter((d) => is_own_specifier(d));
					if (own.length)
						config.logger.warn(
							line('optimize_deps_includes_ogygia', {
								specifiers: own.join(', '),
								count: own.length
							})
						);
				}
				// SvelteKit exposes appDir via a build-time `define` (its `config` hook runs before any
				// `configResolved`, so it's present whatever the plugin order). We read it so our runtime +
				// island chunks are emitted AND referenced under the user's real appDir — a hardcoded `_app`
				// 404s under a custom appDir. `base` / `paths.assets` are NOT read here: `Region.svelte`
				// runs every baked URL through Kit's `asset()`, the sole base/assets/relative authority.
				// Missing (no sveltekit()) → the standalone `_app` default.
				const app_dir_define = (config.define as Record<string, unknown> | undefined)?.[
					'__SVELTEKIT_APP_DIR__'
				];
				if (typeof app_dir_define === 'string') {
					try {
						const v = JSON.parse(app_dir_define);
						if (typeof v === 'string' && v) app_dir = v;
					} catch {
						// ok: a define that is not JSON keeps the `_app` default
					}
				}
				// Normalize resolve.alias (array or object form) to `{ find, replacement }[]` for bake().
				const ra = config.resolve?.alias ?? [];
				resolve_alias = Array.isArray(ra)
					? ra.map((a) => ({ find: a.find, replacement: a.replacement }))
					: Object.entries(ra).map(([find, replacement]) => ({
							find,
							replacement: replacement as string
						}));
				// The shared build cache (fences, git checkouts, shas) persists under THIS app's
				// node_modules/.ogygia — point it before anything derives.
				configure_build_cache(root);
				libDir = path.join(root, 'src', 'lib');
				is_dev = config.command === 'serve';
				is_build = config.command === 'build';
				is_ssr = !!config.build?.ssr;

				// Self-heal a keep-client route left behind by a crashed build (harmless — no URL — but
				// noisy in the routes tree). Dev never injects, so anything here is a stale leftover.
				if (is_dev) fs.rmSync(keep_client_dir(root), { recursive: true, force: true });

				// Optional stable override. Vite only puts `VITE_*` from `.env` onto import.meta.env —
				// load plain `OGYGIA_SECRET` ourselves so `.env` / `.env.local` work without a shell export.
				if (!process.env.OGYGIA_SECRET?.trim()) {
					const env_dir =
						config.envDir === false
							? false
							: config.envDir
								? path.resolve(root, config.envDir)
								: root;
					if (env_dir !== false) {
						const from_file = loadEnv(config.mode, env_dir, '').OGYGIA_SECRET?.trim();
						if (from_file) process.env.OGYGIA_SECRET = from_file;
					}
				}
				const env_secret = process.env.OGYGIA_SECRET?.trim() || '';
				if (env_secret) {
					// Production builds: reject weak user secrets (L-HMAC). Dev may use short keys.
					if (is_build && !secret_has_min_entropy(env_secret)) {
						throw new OgygiaError('secret_too_short', { min_bytes: MIN_SECRET_BYTES });
					}
					id_salt = derive_id_salt(env_secret);
				} else {
					id_salt = '';
				}

				// Kit's internal wire-protocol + client remote-functions modules (deep-imported) and the
				// app's universal hooks — resolved off the app root (see resolve_kit_paths).
				({ kit_wire_path, kit_remote_index, universal_hooks, client_hooks, kit_transport_init } =
					resolve_kit_paths(root));

				// The driver, made with its resolved compile context — now that root/base/libDir/dev +
				// id_salt are known. Every hook that calls it runs after this (session.ts refuses one that
				// does not).
				const compiler = resolve(session, (prev) => {
					const ctx = new CompileCtx({
						root,
						base,
						app_dir,
						libDir,
						pkg_scan,
						page_importers,
						page_files,
						measure,
						server_plugins,
						client_plugins,
						route_config,
						foreign_hydrate,
						is_dev,
						id_salt,
						visibleMargin,
						presets,
						import_keys,
						resolve_alias,
						macros,
						// (the id prefix, not the native path: every consumer `startsWith`s a module id)
						pkg_root: CORE_ROOT_ID,
						build_secret,
						rate_limit,
						session_cookie,
						region_ttl,
						renew_window,
						router_enabled,
						router_view_transitions,
						client_hooks,
						runtime_dir: RUNTIME_DIR,
						runtime_hash: RUNTIME_HASH,
						kit_wire_path,
						client_binding_stub_file: CLIENT_BINDING_STUB_FILE,
						app_shims: APP_SHIMS,
						is_build,
						devtools: devtools_effective
					});
					// (a plugin shared across a builder's environments: this environment's context, the
					// build the last one began)
					return prev
						? prev.with_ctx(ctx)
						: new Compiler(
								new Program({ forms: continuity_forms, router: router_enabled }),
								{ prof: __prof, P: __P, outHash: __outHash },
								ctx
							);
				});

				// DEV: hand Vite's dep scanner every island as a crawl ROOT. Under `csr = false` Kit ships
				// no client entry and registers only `routes/**/+*` as scan entries, so an island reached
				// through a block registry / a regions() glob / a `.remote.ts` mint is never crawled — its
				// client deps are discovered LAZILY on first wake, each discovery re-optimizing, rotating
				// the browserHash and full-reloading (a reload storm on a large app). Appending the island
				// component + host FILES to `optimizeDeps.entries` lets Vite's OWN scanner crawl them at
				// startup through the full plugin pipeline (every plugin's resolveId, linked packages
				// followed as source, the app's `exclude` honoured) — see Compiler.island_scan_entries for
				// why this is entries and never a self-computed `include`. Vite globs `entries` with
				// `absolute: true`, so an absolute path outside the app root (a monorepo package) works —
				// but as a glob PATTERN, so a route group like `(catalog)` or a `[slug]` dir must be escaped.
				// Vite reads `entries` only when the optimizer starts (after every configResolved), so
				// pushing into the resolved config here is honoured. `prescan()` is once-per-session, so
				// running it now just moves buildStart's call earlier. Dev server only.
				if (is_dev) {
					compiler.prescan();
					// Vite's resolved config always carries `optimizeDeps`; a hand-built config (the resolve
					// unit tests) may not.
					const opt = ((config as { optimizeDeps?: object }).optimizeDeps ??= {}) as {
						entries?: string | string[];
					};
					const entries = Array.isArray(opt.entries)
						? opt.entries
						: opt.entries
							? [opt.entries]
							: [];
					opt.entries = entries;
					const have = new Set(entries);
					for (const abs of compiler.island_scan_entries()) {
						// a plugin's own pages (`b.files()`: the profiler UI) render from its handle only — never
						// crawled as app entries
						const posix = real_posix(abs);
						const pattern = plugin_file_roots.some((r) => posix.startsWith(r))
							? null
							: scan_entry_pattern(abs);
						if (pattern !== null && !have.has(pattern)) {
							have.add(pattern);
							entries.push(pattern);
						}
					}
				}
			},

			async buildStart() {
				const compiler = compiler_of(session, 'buildStart');
				// SERVER leg of a build: a stale handoff from an earlier build must never gate THIS
				// build's client leg — remove it here, where the leg is certain (the environment), not in
				// configResolved, which the client environment runs again AFTER the server leg wrote it.
				// (no environment: the build's own flag, one build per leg)
				const env = env_of(this) ?? { name: is_ssr ? 'ssr' : 'client', server: is_ssr };
				const begins = compiler.start_leg(env.name, env.server);
				const leg = compiler.leg(env);
				const server_leg = leg.server;
				if (is_build && server_leg)
					fs.rmSync(ssr_hosts_handoff_path(kit_dirs(root).out_dir), { force: true });
				// CLIENT build (Kit-driven): emit the runtime chunk. Kit builds the SERVER bundle FIRST,
				// then the client, so the server can't learn a hash the LATER client build produces — a
				// forward handoff is impossible. Instead the filename is a deterministic SOURCE-content
				// hash of ogygia's runtime SOURCE ⊕ the resolved feature set (`runtime_chunk_filename`), so the
				// server (baking the `<script src>`) and the client (emitting this chunk) compute the
				// SAME name independently and agree. (Standalone mode further overrides with the real
				// output-chunk hash below.)
				// Discover islands up front — in BOTH the SSR and client legs. The client build needs them
				// to emit chunks; the SSR build needs them for the server manifest. Kit builds SSR FIRST,
				// so if we only scanned in the client leg the SSR manifest would miss `.svx`/`.md` SERVER
				// islands (defer / deferred regions) and their signed endpoint would 403. `prescan` reads
				// `.svelte`/`.ts`; each markup source's `scan` (`b.markup()`: content's markdown)
				// contributes islands from markdown, which becomes Svelte only after that preprocessor.
				// Discover content (`.svx`/`.md`) islands up front in DEV too, not only build. A server
				// (`render: deferred`) island in a content file is registered lazily when its page SSRs —
				// but its signed endpoint is a SEPARATE request that imports the server manifest, and if
				// the island hasn't registered yet the manifest lacks its id → 403 (NOT_IN_MANIFEST). That
				// made content deferred holes flaky in dev (they worked only when the page-SSR registration
				// happened to win the race). A markup `scan` walks the markdown corpus and registers
				// every island before the first request, so the manifest is complete when any endpoint is
				// hit. Once per build: the leg that begins one (a second build in one process, watch,
				// scans again); a no-op for apps without a content preprocessor.
				if (begins) {
					compiler.prescan();
					for (const source of markup) await source.scan?.({ root, readFile });
				}

				if (is_build && !server_leg) {
					// Pure csr=true app (no csr=false route anywhere) → Kit hydrates everything itself, ogygia
					// ships nothing. Skip the runtime chunk entirely; every host's islands were stripped to
					// plain by the csrTrue transform branch, so nothing references it anyway.
					// `hasAnyCsrFalseRoute` only sees Kit PAGE leaves, so a PURE-ROUTER app (all pages
					// router-rendered, zero `+page` files — the fragment-only MFE service shape) reads as
					// "no csr=false route" while its documents reference the runtime; the compiler's own
					// island registry is the second, page-independent signal (found by the MFE POC: the
					// cms app shipped documents pointing at a runtime chunk that was never emitted).
					const emit_runtime =
						!standalone &&
						(hasAnyCsrFalseRoute(kit_dirs(root).routes_dir) || compiler.has_hydrate_regions());
					// The runtime entry (feature-selected) + one deterministic chunk per deduped hydrate
					// region — the driver owns the naming + dedup; `this.emitFile` is the injected primitive.
					// Gated on the SERVER leg's real module graph (link/emit-gate.ts): an island whose host
					// the server bundle never loaded gets no chunk. No handoff → every prescanned island.
					let loaded: Set<string> | null = null;
					// The holes whose styles this leg builds: the server leg's final list when it handed
					// one off (a host only it reached late included), else this program's own.
					let server_regions: ServerRegionRoot[] | null = null;
					try {
						({ loaded, server_regions } = parse_server_handoff(
							fs.readFileSync(ssr_hosts_handoff_path(kit_dirs(root).out_dir), 'utf8')
						));
					} catch {
						// ok: no server-leg handoff (a standalone or client-only build)
					}
					const skipped = compiler.emit_build_chunks(leg, (chunk) => this.emitFile(chunk), {
						emitRuntime: emit_runtime,
						loaded
					});
					if (skipped && isMainThread)
						console.log(line('island_chunks_not_emitted', { count: skipped }));
					const tree_css = tree_css_walk(this);
					// Router pages: a server router page component's whole-tree scoped CSS as one asset,
					// resolved to a handoff `rcss:<rel>` href in writeBundle, linked at SSR by
					// `ogygia:server/router-css` (link/router-css.ts).
					for (const abs of compiler.router_css_roots()) {
						const source = await tree_css(abs);
						if (source)
							leg.router_css_refs.set(
								router_css_key(root, abs),
								this.emitFile({ type: 'asset', name: 'og-rcss.css', source })
							);
					}
					// Holes: handed off under the island's public URL key, which `region_css_links` already
					// resolves through `islandCss()`, so the hole response links it and the client hoists it.
					const hole_css_by_abs = new Map<string, string>();
					for (const { iid, abs } of server_regions ?? compiler.server_island_css_roots()) {
						let ref = hole_css_by_abs.get(abs);
						if (ref === undefined) {
							const source = await tree_css(abs);
							ref = source ? this.emitFile({ type: 'asset', name: 'og-hole.css', source }) : '';
							hole_css_by_abs.set(abs, ref);
						}
						if (ref) leg.hole_css_refs.set(iid, ref);
					}
					// (content modules: generateBundle, once the client graph is known)
				}
			},

			configureServer(server) {
				const compiler = compiler_of(session, 'configureServer');
				vite_server = server;
				// THE PROFILER IN DEV: Vite runs each server module as its transformed code, so a profile's
				// lines are that code's; the maps back to the source live in Vite's module graph, not in
				// `.map` files. The profiler (same process) asks through this (vite/dev-maps.ts)
				if (measure) {
					install_dev_maps(server);
					// ...and the browser's modules, for the traces the browser sends
					install_dev_client_maps(server);
					// ...and which page.data keys each island's code reads (the build's seed answer)
					install_dev_page_keys(
						server,
						(iid) => {
							const { registry, by_id } = compiler.program;
							return registry.get(by_id.get(iid) ?? '')?.componentPath;
						},
						root
					);
				}
			},

			watchChange(id, change) {
				const compiler = compiler_of(session, 'watchChange');
				// before anything re-emits: a module's parse, and what every export index built from it
				shapes.invalidate(id, change.event);
				// A route add/remove/rename or a `csr` export flip changes the csr topology → drop the
				// memoized answers AND re-run the baked `ogygia:server/route-csr` module. The second
				// half is load-bearing: context.ts imports `csr_true_routes` through the SSR module
				// graph, so without invalidation the SERVER leg keeps deciding island-vs-inline from a
				// STALE set while Kit flips immediately — `<ogygia-region>` shells on a Kit-booted page
				// with the runtime withheld = dead chrome (hit at a consumer after toggling `csr`).
				if (is_dev && ROUTE_HOST_OR_OPTION_RE.test(id)) {
					clear_route_csr_cache();
					// (a plugin's key inside `export const config` add/flip changes the baked values too)
					if (vite_server)
						for (const mid of compiler.changed('routes')) invalidate_module_id(vite_server, mid);
				}
				// Unlink often skips handleHotUpdate; drop islands that still import the deleted file.
				if (!is_dev || change.event !== 'delete' || !vite_server) return;
				if (!invalidate_islands_for_file(id, { deleted: true, server: vite_server })) return;
				vite_server.ws.send({ type: 'full-reload', path: '*' });
			},

			buildEnd() {
				const compiler = compiler_of(session, 'buildEnd');
				// SERVER leg of a build: hand the real module graph to the client leg (emit gate). The
				// leg is read off the ENVIRONMENT (Vite's environment API builds `ssr` then `client` in one
				// app build; `config.build.ssr` is false for both there).
				const server_leg = leg_of(this).server;
				if (is_build && server_leg && !standalone) {
					try {
						const handoff = ssr_hosts_handoff_path(kit_dirs(root).out_dir);
						fs.mkdirSync(path.dirname(handoff), { recursive: true });
						const out: ServerHandoff = {
							hosts: compiler.ssr_transformed_hosts(),
							server_regions: compiler.server_island_css_roots()
						};
						fs.writeFileSync(handoff, JSON.stringify(out));
					} catch (e) {
						// best effort — without it the client leg emits every prescanned island
						if (isMainThread) warn('island_handoff_write_failed', e);
					}
				}
				if (__P) {
					const keys = [...__outHash.keys()].sort();
					let d = 0x811c9dc5; // hash: folds numbers (each file's hash), not a string
					for (const k of keys) {
						d ^= __outHash.get(k)!;
						d = Math.imul(d, 0x01000193) >>> 0;
					}
					const summary = JSON.stringify({
						...__prof,
						transformDigest: (d >>> 0).toString(16),
						transformFiles: keys.length
					});
					console.error(`\n[ogygia-prof] ${summary}`);
				}
			},
			handleHotUpdate({ file, server }) {
				const compiler = compiler_of(session, 'handleHotUpdate');
				if (!is_dev) return;
				vite_server = server;

				// Server-router CSS: the dev `ogygia:server/router-css` INLINES compiled css at emit
				// time, so any style-bearing source change must invalidate it — the next SSR re-emits
				// with fresh css. Cheap (module-graph lookup), so no root-membership check.
				if (STYLE_BEARING_FILE_RE.test(file))
					for (const mid of compiler.changed('styles')) invalidate_module_id(server, mid);

				// SCOPED soft CSS HMR. App css joins the browser graph LAZILY (see dev_hmr_client_source):
				//  - already joined on a client → fall through to Vite's normal CSS update (soft);
				//  - not joined anywhere → suppress Vite's no-boundary full reload and broadcast a scoped
				//    join event instead; each open page joins ONLY css its own route scope imports, so the
				//    `(docs)` and `playground` sub-apps can never paint each other in dev.
				if (DEV_CSS_FILE_RE.test(file) && !file.includes('/node_modules/')) {
					const src_prefix = `${path.join(root, 'src')}${path.sep}`;
					if (path.normalize(file).startsWith(src_prefix)) {
						const envs = (
							server as unknown as {
								environments?: Record<
									string,
									{
										moduleGraph?: {
											getModulesByFile?: (f: string) => Set<DevGraphModule> | undefined;
										};
									}
								>;
							}
						).environments;
						const client_graph = envs?.client?.moduleGraph;
						const joined = client_graph?.getModulesByFile?.(file)?.size ?? 0;
						if (!joined) {
							const owners = derive_css_scope_owners(file, root, [
								envs?.ssr?.moduleGraph,
								client_graph
							]);
							const web_path = `/${path.relative(root, file).split(path.sep).join('/')}`;
							server.ws.send({
								type: 'custom',
								event: 'ogygia:css',
								data: { path: web_path, owners }
							});
							return [];
						}
						return; // client owns the module — Vite's own soft update handles it
					}
				}

				// Island ids are hash(componentPath+strategy) — renaming a host keeps the same virtual
				// id, so Vite's moduleGraph must be cleared or it keeps serving the old import.
				const deleted = !fs.existsSync(strip_id(file));
				const host_changed = !deleted && compiler.is_registered_host(file);
				const entry_changed =
					!deleted && needs_island_entry_full_reload(file, compiler.program.registry.values());
				if (host_changed || deleted) {
					invalidate_islands_for_file(file, { deleted, server });
				}

				// Soft CSS HMR via ogygia:dev/hmr. Route shells + island host rewrites +
				// island entry component edits + deleted entry components need a document reload.
				if (!needs_csr_false_full_reload(file) && !deleted && !host_changed && !entry_changed) {
					return;
				}
				server.ws.send({ type: 'full-reload', path: '*' });
				return [];
			},

			async resolveId(source, importer) {
				// ogygia's OWN injected imports (`ogygia/internal` / `…/server`, written by the transform into
				// a host or a generated island module) resolve to ogygia's own files DIRECTLY (see
				// OGYGIA_INJECTED_FILES) — never via `this.resolve` (unreliable off a synthetic importer, can
				// throw in rolldown-vite) or `config.root` (can be undefined on a throwaway plugin instance).
				// Deterministic, can't throw, can't be left unresolved, works from any sub-package with no
				// ogygia dependency of its own.
				if (OGYGIA_INJECTED_IMPORTS.has(source)) return OGYGIA_INJECTED_FILES[source];

				// Region's twin imports are the awaiting ones where the app runs Svelte's async mode
				// (late-island.ts): a late island in one swap, a promise `of` awaited in the render
				if (svelte_async) {
					const awaiting = async_twin_redirect(source, importer, OGYGIA_REGION_MODULES);
					if (awaiting) return awaiting;
				}

				const ssr = leg_of(this).server;

				// CLIENT build: Kit's client remote runtime needs `app` (never boots under csr=false).
				// Plan A: reuse Kit's OWN remote primitives, redirecting `__sveltekit/remote` at Kit's
				// real remote-functions entry; the router-coupled modules they import are stubbed just
				// below. Fallback: our hand-rolled shim. enforce:'pre' wins over Kit's resolveId.
				if (!ssr && source === '__sveltekit/remote') {
					if (!kit_remote_index) throw new OgygiaError('kit_remote_src_missing');
					return kit_remote_index;
				}
				// Scope-alias the two router-coupled modules Kit's remote-functions pull in, ONLY when
				// imported from within Kit's remote-functions dir (so a csr=true page's real Kit client
				// still gets the real client.js). Keeps the router graph out of island bundles.
				if (!ssr && importer && importer.includes('/remote-functions/')) {
					if (KIT_REMOTE_CLIENT.test(source)) return STUB_CLIENT;
					if (KIT_REMOTE_STATE.test(source)) return STUB_STATE;
					// (Kit 3 imports its paths and page state through its package imports)
					if (source === '#app/paths') return STUB_PATHS;
					if (source === '#app/state/client') return STUB_STATE;
				}
				if (!ssr && source === '$app/paths/internal/client') return STUB_PATHS;

				// Everything else — the ogygia virtual-module vocabulary + the island CLIENT graph ($app/*
				// shims, virtual entry ids, relative-to-host + transitive-dep resolution) — is the driver's,
				// with Vite's own resolver threaded in for the two branches that need it.
				return compiler_of(session, 'resolveId').resolve_id(source, importer, {
					ssr,
					resolve: (s, i, o) => this.resolve(s, i, o)
				});
			},

			async load(id) {
				const compiler = compiler_of(session, 'load');
				// The request's leg (its environment), never `config.build.ssr`: that stays set for Kit
				// apps and leaked `$app/server` into the browser guard.
				const ssr = leg_of(this).server;

				const fouc_bare = id.startsWith('\0') ? id.slice(1) : id;
				if (isFoucCssId(fouc_bare)) {
					const rel = foucRelFromId(fouc_bare);
					if (!rel) {
						return { code: 'export {}', moduleSideEffects: false };
					}
					const abs = path.join(root, rel);
					const code = await buildFoucCssModuleSource(abs, {
						root,
						libDir,
						readFile: (p) => {
							try {
								return fs.readFileSync(p, 'utf8');
							} catch {
								return null;
							}
						}
						// (no bundler resolver: this module names each sheet by its root-relative path, so it
						// carries the app's own files — an island's exact chunk CSS reaches the page through its
						// region-CSS link: Region.svelte `island_css_html`)
					});
					// Must not tree-shake: the only purpose of this module is CSS side effects.
					return { code, moduleSideEffects: true };
				}
				if (isFoucScopedId(fouc_bare)) {
					const rel = foucRelFromId(fouc_bare);
					if (!rel) return { code: '', moduleType: 'css' };
					const abs = path.join(root, rel);
					let source = '';
					try {
						source = fs.readFileSync(abs, 'utf8');
					} catch {
						return { code: '', moduleType: 'css' };
					}
					// Preprocess (scss/sass → css, TS stripped) and KEEP the script before compiling — the
					// same path the hole-CSS leg uses. `svelte.compile` reads neither dialect, and a
					// script-stripped template that references a script name throws; BOTH make
					// compileFoucScopedCss fall back to UNSCOPED style bodies. This module is a LAKE's (and
					// island's) scoped CSS, so an unscoped fallback ships the component's rules global —
					// `.x { … }` instead of `.x.svelte-<hash>` — and they then match any element anywhere on
					// the page that reuses the class name (a header lake restyling an unrelated breadcrumb).
					const code = compileFoucScopedCss(
						abs,
						await preprocess_component_for_css(source, abs, root),
						{ keepScript: true }
					);
					return { code, moduleType: 'css' };
				}

				// Every other ogygia virtual is a pure `id → source` emit the driver owns. The Vite build
				// values it can't see are threaded in: the app's universal-hooks path and Kit 3's client
				// codec module (configResolved).
				return compiler.emit(id, {
					ssr,
					universalHooks: universal_hooks,
					resolve: bundler_resolve(this),
					exports: css_walk_index(this.environment.name),
					kitCodec: kit_transport_init
				});
			},

			async transform(code, id) {
				const compiler = compiler_of(session, 'transform');
				let source = code;

				// KIT-WORLD PAGE THREAD: append the two publish lines to Kit's generated client app
				// entry (see KIT_PAGE_THREAD above), and the version it discloses. Client leg only — the
				// SSR graph renders islands against Kit's real modules already, and this file is
				// client-world by construction.
				const leg = leg_of(this);
				if (!leg.server && KIT_CLIENT_APP_RE.test(id)) {
					source += KIT_PAGE_THREAD + KIT_DISCLOSE_VERSION;
				}
				// a realm module's names, imported from the entries that have them (the graph a page
				// ships is the names it uses: compiler/virtual/resolver.ts `split_realm_imports`)
				source = compiler.split_realm_imports(source) ?? source;

				// The whole per-file pass — content-preset tag ▸ macros ▸ host-island transform ▸ ts-region
				// mint ▸ $app shim — is the driver's; `this.emitFile` (the one Vite primitive it needs, for
				// the transform-time island entry) is threaded in. The driver's result is
				// bundler-neutral (`map: unknown`); cast it to Vite's transform shape at this boundary.
				const result = await compiler.transform_module(source, id, {
					leg,
					emitFile: (chunk) => this.emitFile(chunk)
				});
				// DEV: a host edit dropped its server islands from the manifest the handle already
				// re-imported (empty of them); this transform just registered them again — invalidate the
				// manifest once more so the NEXT endpoint request sees the ids (driver: server_manifest_stale).
				if (is_dev && vite_server && compiler.server_manifest_stale())
					for (const mid of compiler.changed('regions')) invalidate_module_id(vite_server, mid);
				// DEV: an island this transform registered (a file added while the server runs) pulled
				// modules into the island world that the server may already hold transformed for a
				// non-island importer — with Kit's real `$app/*`, which never boots on a csr=false page.
				// Drop those transforms so the next load re-resolves them to the shim (driver:
				// mark_island_closure).
				if (is_dev && vite_server) {
					for (const marked of compiler.drain_closure_marks())
						invalidate_module_id(vite_server, marked);
				}
				if (result) return result as { code: string; map: Rolldown.SourceMapInput | null };
				// The driver saw nothing to do, but the edge rewrite above must still ship.
				return source === code ? null : { code: source, map: null };
			},

			renderChunk(code, chunk, _options, meta) {
				// the values known only once every transform has run (link/relocations.ts)
				let facades: Map<string, string> | null = null;
				return compiler_of(session, 'renderChunk').relocate(code, leg_of(this), {
					chunk_file: chunk.fileName,
					file_name: (ref) => this.getFileName(ref),
					facade_file: (id) => {
						if (facades === null) {
							facades = new Map();
							for (const c of Object.values(meta.chunks))
								if (c.facadeModuleId) facades.set(c.facadeModuleId, c.fileName);
						}
						return facades.get(id);
					},
					graph: (id) => this.getModuleInfo(id),
					module_ids: () => this.getModuleIds()
				});
			},

			// THE LOCATION MAPS (client build, generateBundle below): each island entry is content-hashed;
			// its identity is a name, not a file. Every identity → location pair is written now — the
			// hashed names are final, and files can still join the output — once named by content and once
			// at the one fixed name (link/location-map.ts), for a load that arrives without a location.
			// OUR ENTRIES' FILE NAMES (client build): readable and content-hashed — the driver's pattern for
			// an island entry or the runtime, the app's own naming for every other chunk. (The bundler
			// files an emitted chunk under the chunk pattern, which carries no name.)
			outputOptions(output) {
				const compiler = compiler_of(session, 'outputOptions');
				// (before the leg starts: rolldown reads its output options first)
				if (!is_build || (env_of(this)?.server ?? is_ssr)) return null;
				type Info = { name?: string };
				type Names = string | ((info: Info) => string) | undefined;
				const ours = (fallback: Names, dflt: string) => (info: Info) =>
					compiler.entry_file_pattern(info.name) ??
					(typeof fallback === 'function' ? fallback(info) : (fallback ?? dflt));
				return {
					...output,
					entryFileNames: ours(output.entryFileNames as Names, '[name].js'),
					chunkFileNames: ours(output.chunkFileNames as Names, '[name]-[hash].js')
				} as typeof output;
			},

			async generateBundle(_options, bundle) {
				const compiler = compiler_of(session, 'generateBundle');
				if (!is_build) return;
				const leg = leg_of(this);
				const chunks = Object.values(bundle).filter((item) => item.type === 'chunk');
				for (const r of unpatched(leg.server, leg.relocated, chunks))
					warn('relocation_unpatched', { name: r.name, leg: leg.name });
				if (leg.server) return;
				for (const file of compiler.location_maps(leg, (ref) => this.getFileName(ref)))
					this.emitFile({ type: 'asset', fileName: file.fileName, source: file.source });
				// CONTENT MODULES (the third root of `tree_css_walk`): Region.svelte links each one's asset
				// via the handoff (writeBundle maps content_css_key → the emitted `.css` by referenceId).
				// Unlike a router page or a hole, a content module imports components the client graph
				// may carry too (a layout's, an island's, a registry's): their CSS already ships with that
				// chunk, and a second copy, hoisted after the page's stylesheets on a client-side
				// navigation, would outrank the app's own overrides. So the walk skips every file the
				// client graph holds, and the asset carries only what no client chunk does. The module's
				// own `<style>` comes first, compiled with `svelte.compile` on the post-mdsvex source the
				// scanner captured, so Svelte resolves `:global` (a raw `:global` would crash the CSS
				// minifier) and mints the SAME scoped hash the SSR'd HTML carries (default `cssHash` =
				// hash of the CSS; `.svx` bodies use plain `<style>`, so vitePreprocess is a no-op).
				const modules = markup.flatMap((m) => (m.modules ? [...m.modules] : []));
				if (!modules.length) return;
				const client = new Set<string>();
				for (const id of this.getModuleIds()) client.add(path.normalize(id.split('?')[0]));
				const tree_css = tree_css_walk(this);
				const { compile } = await import('svelte/compiler');
				for (const [abs, source] of modules) {
					try {
						let own = '';
						if (svelteHasStyle(source)) {
							const { css } = compile(source, {
								filename: abs,
								css: 'external',
								dev: false,
								generate: 'client',
								experimental: { async: true }
							});
							own = css?.code ?? '';
						}
						const tree = await tree_css(abs, { own: source, skip: (p) => client.has(p) });
						const css = [own, tree].filter(Boolean).join('\n');
						if (css)
							leg.content_css_refs.set(
								content_css_key(abs),
								this.emitFile({ type: 'asset', name: 'og-content.css', source: css })
							);
					} catch {
						// ok: a content file whose CSS cannot be extracted goes unstyled; the fix never breaks a build
					}
				}
			},

			// (each build leg's end, and the dev server closing)
			closeBundle() {
				compiler_of(session, 'closeBundle').end_leg(env_of(this)?.name ?? null);
			},

			async writeBundle(_options, bundle) {
				const compiler = compiler_of(session, 'writeBundle');
				const leg = leg_of(this);
				const server_leg = leg.server;
				// THE BUNDLE CHECK: no table module of a realm this leg may not hold, however it got in
				// (a re-export past the resolve check included)
				if (is_build) {
					const ids: string[] = [];
					for (const item of Object.values(bundle))
						if (item.type === 'chunk') ids.push(...item.moduleIds);
					const [wrong] = compiler.misplaced_modules(ids, server_leg);
					if (wrong)
						this.error(
							new OgygiaError('virtual_wrong_realm', {
								id: wrong[0].replace('\0', ''),
								realm: wrong[1],
								leg: server_leg ? 'server' : 'browser'
							})
						);
				}
				// Client only — Kit builds SSR first, so Region.svelte reads this JSON at render
				// (prerender / live SSR), not at SSR-bundle `load()` time.
				//
				// `writeBundle` (not `generateBundle`): rolldown merges/eliminates shared chunks AFTER
				// `generateBundle`, so a chunk's `imports` there can name a phantom that's gone by write.
				// By `writeBundle` the bundle reflects the files actually on disk.
				if (!is_build || server_leg) return;

				// SECRET-SPLIT on the finished client bundle: no signing secret, no signing module
				refuse_client_secrets(bundle as Record<string, unknown>, [
					build_secret,
					process.env.OGYGIA_SECRET?.trim() ?? ''
				]);

				// FLAG MANIFEST — the inventory the prescan OBSERVED (AST-resolved flag()/experiment()
				// call sites in modules importing 'ogygia'). Written once per build for CI flag-debt
				// diffs; the client leg runs last, so the file reflects the completed build.
				const program = compiler.program;
				if (program.flag_sites.length && isMainThread) {
					try {
						const dir = path.join(root, 'node_modules', '.ogygia');
						fs.mkdirSync(dir, { recursive: true });
						const manifest = flags_manifest(program.flag_sites);
						fs.writeFileSync(
							path.join(dir, 'flags-manifest.json'),
							`${JSON.stringify(manifest, null, '\t')}\n`
						);
						console.log(line('flags_manifest_written', { count: manifest.names.length }));
					} catch {
						// ok: a read-only file system never fails the build over an inventory
					}
				}

				// `page`: per island entry, whether its chunk closure bundles the `$app/state` /
				// `$app/stores` shim — the handle seeds `page.data` only for islands that read it.
				// `remotes`: per island entry, the Kit remote modules in that closure (by the id-hash Kit
				// mints them with — relative to `process.cwd()`, as Kit's own transform hashes them) —
				// the handle seeds an SSR-resolved remote only for a page with an island that can call it.
				// SEED SHAPING, the calls to follow: `helper(page)` into an IMPORTED helper. Resolve the
				// specifier from the calling module, summarize what the helper's export reads of its page
				// parameter (through barrel re-exports, a few hops), and fold it into the caller's keys.
				// Anything unresolvable answers 'all' with a reason naming the call.
				await follow_pending_page_calls(program, (s, importer) => this.resolve(s, importer));

				const remote_hash = (id: string) => remote_hash_of(id, process.cwd());
				// IDENTITY → LOCATION: the entries' final (content-hashed) names. Every map the collector
				// builds is keyed by identity; the server resolves a location through `entries`.
				const entries = compiler.entry_locations(leg, (ref) => this.getFileName(ref));
				const map = collectIslandDepModulepreloads(
					bundle as Record<
						string,
						{
							type: string;
							fileName?: string;
							imports?: string[];
							dynamicImports?: string[];
							moduleIds?: string[];
							viteMetadata?: { importedCss?: Set<string> | string[] };
						}
					>,
					[APP_SHIMS['$app/state'], APP_SHIMS['$app/stores']],
					remote_hash,
					// SEED SHAPING: the transform recorded, per module, the `page.data` keys it reads
					// (Program.page_keys); the collector unions them over each island's closure.
					(module_id) => program.page_keys.get(module_id) ?? null,
					// WAKE ADVISOR: the collector counts what each island's own components do
					(id) => {
						try {
							return fs.readFileSync(id, 'utf8');
						} catch {
							return null;
						}
					},
					// The runtime entry, by the file the bundler named: its static imports become the
					// preload hints beside the runtime script, keyed by the runtime's identity.
					entries.runtime_file,
					{ islands: entries.islands, runtime: entries.runtime }
				);
				const page_why = report_seed_shaping(
					map,
					bundle as Record<string, { type: string; moduleIds?: string[]; imports?: string[] }>,
					program,
					root,
					// (the maps key identities; the walk starts at each one's emitted file)
					(identity) => entries.locations[identity] ?? identity
				);
				// SERVER-ROUTER CSS handoff: each root's whole component-tree CSS was compiled + emitted as
				// ONE dedicated asset in buildStart (router_css_refs). Resolve each referenceId to its
				// hashed URL under `rcss:<rel>`, the key `ogygia:server/router-css` reads via `islandCss()`
				// at SSR. A dedicated asset (not a chunk's importedCss) is immune to rolldown's shared-chunk
				// CSS hoisting — every profiler page shares Shell, which otherwise scatters onto whichever
				// chunk rolldown parks it on (an island's, off the router's static graph entirely).
				for (const [key, ref] of leg.router_css_refs) {
					try {
						const file = this.getFileName(ref);
						map.css[key] = [file.startsWith('/') ? file : `/${file}`];
					} catch {
						// ok: an asset the bundle dropped: the page goes unstyled rather than link a 404
					}
				}

				// Server-island CSS handoff: island id → its tree-CSS asset, keyed by the island's public
				// URL (`island_url[id]` in the server manifest) so `region_css_links(id)` finds it through
				// the same `islandCss()` lookup a hydrating island's chunk CSS uses.
				for (const [iid, ref] of leg.hole_css_refs) {
					try {
						const file = this.getFileName(ref);
						const key = compiler.island_public_url(iid);
						(map.css[key] ??= []).push(file.startsWith('/') ? file : `/${file}`);
					} catch {
						// ok: an asset the bundle dropped: the hole goes unstyled rather than link a 404
					}
				}

				// Content-body CSS handoff: content_css_key → the emitted CSS asset URL, so Region.svelte can
				// link a content body's own scoped CSS (which lives on no page stylesheet — the corpus is
				// server-only). The client leg emitted each as an asset and stashed its referenceId; resolve
				// to the hashed filename now that the bundle is finalized. Same key the preprocessor baked
				// as `__ogygia_css`, so the body region resolves it at SSR.
				const content_css: Record<string, string[]> = {};
				for (const [key, ref] of leg.content_css_refs) {
					try {
						const file = this.getFileName(ref);
						content_css[key] = [file.startsWith('/') ? file : `/${file}`];
					} catch {
						// ok: an asset the bundle dropped: the body goes unstyled rather than link a 404
					}
				}

				// INLINE REGION CSS: the text of every region sheet under Kit's `inlineStyleThreshold`
				// (the app's svelte.config.js, read next to `kit_dirs`), keyed by href — the render emits
				// those as `<style data-ogygia-region-css>` instead of blocking `<link>`s.
				const css_inline = collect_inline_css(
					bundle as Record<
						string,
						{ type: string; fileName?: string; source?: string | Uint8Array }
					>,
					[...Object.values(map.css).flat(), ...Object.values(content_css).flat()],
					kit_inline_style_threshold(root)
				);
				// The per-chunk contents (what is inside each hashed chunk) serve the profiler's Islands
				// table only: without a profiler in the config they never leave the build. Nothing here
				// reaches the browser either way; the server parses the handoff once per process.
				if (!measure) {
					map.contents = {};
					map.heavy = {};
					map.hazards = {};
					map.dupes = [];
				}
				// BARRELS a chunk still holds (the profiler's island-barrel note): a module with little
				// code of its own and many modules behind it — a re-export index the barrel pass left
				// (it has side effects, or the pass is off), so everything it re-exports ships with the
				// island. The bundler's own module info decides; only with a profiler, like `contents`.
				const barrels: Record<string, ChunkBarrel[]> = {};
				if (measure) {
					for (const [key, chunk] of Object.entries(bundle)) {
						if (chunk.type !== 'chunk') continue;
						const found: ChunkBarrel[] = [];
						for (const id of chunk.moduleIds ?? []) {
							if (id.startsWith('\0')) continue;
							// (a component uses what it imports — a small one composing seven children is no
							// re-export index; only a script module can be a barrel)
							const q = id.indexOf('?');
							if ((q === -1 ? id : id.slice(0, q)).endsWith('.svelte')) continue;
							const info = this.getModuleInfo(id);
							if (!info) continue;
							const fanout = info.importedIds.filter((d) => !d.startsWith('\0')).length;
							const own = info.code?.length ?? Infinity;
							if (fanout >= 6 && own <= fanout * 160) {
								const name = summarize_chunk_contents([id], 1, 1)[0];
								const why = barrel_why(id, info.importers);
								if (name) found.push(why.length ? { name, fanout, why } : { name, fanout });
							}
						}
						if (found.length)
							barrels[`/${chunk.fileName || key}`] = found
								.sort((a, b) => b.fanout - a.fanout)
								.slice(0, 3);
					}
				}
				const json = JSON.stringify({
					...map,
					// why an island ships all of page.data (the build's reasons, per entry): the profiler's
					// seed finding points at that line; like `contents`, only with a profiler
					...(measure ? { page_why, barrels } : {}),
					content_css,
					css_inline,
					fn_manifest: Object.fromEntries(compiler.dollar_hoists),
					// identity (the stable URL SSR bakes) → location (the content-hashed file to load)
					entries: entries.locations,
					// the same, as one file the browser reads (the runtime's script tag names it)
					locations: leg.location_map_url
				});
				emit_island_deps_handoff(root, json, kit_dirs(root).out_dir, leg.relocated);
			}
		},
		// the plugins' `post` stage: on what the region transform made of the module
		stage_host('post'),
		island_sourcemaps_plugin({
			program: () => compiler_of(session, 'sourcemaps').program,
			is_island_path
		}),
		lazy_files()
	];
}

// The svelte config's markdown preprocessor and extensions belong to the content plugin
// (`@ogygia/content/vite`). The old spellings stay callable and do nothing: they answer what they
// answered for an app without markdown, so a svelte config written for 0.8 still loads.

export declare namespace ogygia {
	/**
	 * @deprecated Does nothing: returns `['.svelte']`. Markdown extensions come from
	 * `extensions()` in `@ogygia/content/vite`.
	 */
	export const extensions: () => string[];
	/**
	 * @deprecated Does nothing: returns `[]`. The markdown preprocessor comes from `preprocess()` in
	 * `@ogygia/content/vite`.
	 */
	export const preprocess: () => PreprocessorGroup[];
}
Object.assign(ogygia, {
	extensions: (): string[] => ['.svelte'],
	preprocess: (): PreprocessorGroup[] => []
});

// NOTE(deferred-types, 2026-09-01): a preprocessor that rewrote `render:'deferred'` imports to
// type the reserved `ogygiaFallback` snippet was built and REVERTED — svelte-check/language-tools
// type the ORIGINAL source and ignore script preprocessors' output for diagnostics (probe-proven),
// so no preprocessor can augment call-site types. Server islands hand-declare the prop instead.
