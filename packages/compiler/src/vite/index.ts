import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { dedent } from '@ogygia/core/contract';
import { isMainThread } from 'node:worker_threads';
import { loadEnv, type Plugin, type Rolldown, type ViteDevServer } from 'vite';
import { configure_build_cache } from '../build-cache.ts';
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
import { is_island_path, normalize_import_keys } from '../region/transform.ts';

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
} from '../region/transform.ts';
export { rewrite_lake_import_to_placeholder } from '../region/emit.ts';
export type { ImportKeys } from '../region/transform.ts';
export { definePlugin } from './plugin-api.ts';
export type {
	OgygiaPlugin,
	PluginDefinition,
	BuildContext,
	MacroHandler,
	MacroContext,
	PrescanHook,
	MarkupSource,
	MarkupRegions,
	TransformStage,
	TransformContext,
	StageTransform,
	StayedAnswer,
	ExportsSeam,
	PinnedDecl,
	RegionsSeam,
	PageReads,
	PageReadsResolve,
	PageReadWhy
} from './plugin-api.ts';
export type {
	ExportMap,
	Entry as ExportEntry,
	Leaf as ExportLeaf,
	Policy as ExportPolicy
} from '../exports/index.ts';
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
import type { ClientRealmFile, ServerRealm } from '../link/caps.ts';
import { assert_known_options, validate_region_presets, resolve_options } from './options.ts';
import {
	clientBuildWillSkip,
	hasAnyCsrFalseRoute,
	route_reader,
	keep_client_dir,
	inject_keep_client_route,
	resolve_kit_paths,
	kit_major,
	default_kit_dirs,
	type KitConfig
} from '../kit.ts';
import { node_fs } from '../fs.ts';
import { load_kit_config } from './kit-dirs.ts';
import {
	buildFoucCssModuleSource,
	collectFoucCssReachable,
	scoped_component_css,
	type PreprocessCss,
	foucRelFromId,
	isFoucCssId,
	isFoucScopedId,
	svelteHasStyle,
	through_caller,
	type WalkResolve
} from '../fouc-css.ts';
import { ExportIndex, Shapes } from '../exports/index.ts';
import type { BuildLeg } from '../leg.ts';
import { strip_bom } from '../bom.ts';

import { preprocess_component_for_css } from './style-preprocess.ts';
import { needs_csr_false_full_reload, needs_island_entry_full_reload } from '../dev/hmr.ts';
import { derive_css_scope_owners, type DevGraphModule } from '../dev/css-scope.ts';
import {
	collectIslandDepModulepreloads,
	collect_inline_css,
	remote_hash_of,
	summarize_chunk_contents
} from '../link/island-deps.ts';
import { report_seed_shaping } from '../link/build-output.ts';
import { unpatched } from '../link/relocations.ts';
import { emit_island_deps_handoff, refuse_client_secrets } from '../link/build-output.ts';
import {
	server_handoff_path,
	server_handoff_json,
	read_server_handoff
} from '../link/emit-gate.ts';
import { router_css_key } from '../link/router-css.ts';
import { Program, strip_id } from '../program.ts';
import { Compiler } from '../driver.ts';
import { compiler_of, configured, new_session, resolve } from './session.ts';
import { core_defines } from '../virtual/core.ts';
import { CompileCtx, type PackageScan } from '../ctx.ts';
import { discover_package_files } from './package-files.ts';
import { async_twin_redirect, svelte_async_enabled } from './late-island.ts';

const KIT_CLIENT_APP_RE = /\/generated\/(?:build\/|dev\/)?client(-optimized)?\/app\.js$/;
const KIT_PAGE_THREAD = `\n${dedent`
	import { page as __og_kit_page, navigating as __og_kit_nav } from '$app/state';
	import * as __og_kit_navigation from '$app/navigation';
	globalThis[Symbol.for('ogygia.kit-page')] = { page: __og_kit_page, navigating: __og_kit_nav, navigation: __og_kit_navigation };
`}\n`;
const KIT_DISCLOSE_VERSION = `((globalThis.__ogygia ??= {}).v ??= new Set()).add(${JSON.stringify(OGYGIA_VERSION)});\n`;
import { scan_entry_pattern, KIT_REMOTE_CLIENT, KIT_REMOTE_STATE, RUNTIME_HASH } from './paths.ts';

import type { OgygiaOptions } from './options.ts';
import { SVELTE_DEV_ISLAND_ENTRIES } from './svelte-entries.ts';
import { OgygiaError, warn, line } from '../messages.ts';

const DEV_CSS_FILE_RE = /\.(css|scss|sass|less|styl)$/;
const BACKSLASH_G = /\\/g;

const CSS_EXT_RE = /\.css$/;
const STYLE_BEARING_FILE_RE = /\.(svelte|css|scss|sass|less|styl)$/;
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
			// oxlint-disable-next-line ogygia/no-silent-failures -- Vite throws for a specifier this importer cannot resolve: unresolved, as a null answer is
		} catch {
			return null;
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

	assert_known_options(options);

	const visibleMargin = options.visible?.margin;
	const presets = options.presets || {};
	validate_region_presets(presets);
	let app_plugins: PluginDefinition[] = [];
	let server_plugins: ServerRealm[] = [];
	let client_plugins: ClientRealmFile[] = [];
	let runtime_hooks: RuntimeHookName[] = [];
	let route_config: string[] = [];
	let foreign_hydrate = false;
	let macros: ResolvedPlugins['macros'] = [];
	let page_reads: ResolvedPlugins['page_reads'] = null;
	let prescans: ResolvedPlugins['prescans'] = [];
	let listed_plugins: string[] = [];
	let stage_transforms: ResolvedPlugins['transforms'] = [];
	let stayed_answers: ResolvedPlugins['stayed'] = [];
	let markup: ResolvedPlugins['markup'] = [];
	let definers: ResolvedPlugins['definers'] = [];
	const import_keys = normalize_import_keys(options.importKeys);
	let measure = false;
	const pkg_scan: PackageScan[] = [];
	const plugin_file_roots: string[] = [];
	let declared_scanned = false;
	let page_importers: string[] = [];
	let page_files: string[] = [];

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
	let devtools_effective = false;
	let devtools_lazy = false;

	const build_secret = crypto.randomBytes(32).toString('hex');
	let id_salt = '';

	const preprocess_css: PreprocessCss = (source, abs) =>
		preprocess_component_for_css(source, abs, root);
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
					css = null;
					if (src != null && e.kind === 'scoped')
						css = await scoped_component_css(e.abs, src, preprocess_css);
					else if (src != null && CSS_EXT_RE.test(e.abs)) css = src;
					compiled_css.set(e.abs, css);
				}
				if (css) parts.push(css);
			}
			return parts.join('\n');
		};
	};

	let root: string;
	let kit: KitConfig;
	let base = '';
	let app_dir = '_app';
	let libDir: string;
	let is_dev = false;
	let svelte_async = false;
	let resolve_alias: { find: string | RegExp; replacement: string }[] = [];
	let is_build = false;
	let is_ssr = false;
	const env_of = (ctx: unknown): { name: string; server: boolean } | null => {
		const env = (ctx as { environment?: { name?: string; config?: { consumer?: string } } } | null)
			?.environment;
		if (!env?.name) return null;
		return { name: env.name, server: env.name === 'ssr' || env.config?.consumer === 'server' };
	};
	const leg_of = (ctx: unknown): BuildLeg => compiler_of(session, 'leg').leg(env_of(ctx));
	let vite_server: ViteDevServer | null = null;
	let kit_wire_path: string | null = null;
	let kit_remote_index: string | null = null;
	let universal_hooks: string | null = null;
	let client_hooks: string | null = null;
	let kit_transport_init: string | null = null;
	let keep_client_cleanup_armed = false;

	const readFile = (abs: string) => {
		try {
			return fs.readFileSync(abs, 'utf-8');
			// oxlint-disable-next-line ogygia/no-silent-failures -- null is "no such file" (the CSS walk tries candidates; a markup scan skips it)
		} catch {
			return null;
		}
	};

	const shapes = new Shapes((abs) => {
		const code = readFile(abs);
		return code == null ? null : strip_bom(code);
	});
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
		pinned_imports() {
			const keys = new Set(Object.values(import_keys));
			return (decl) => decl.attribute_keys.some((k) => keys.has(k));
		},
		regions: {
			names: () => compiler_of(session, 'regions.names').region_names(),
			hosts: () => compiler_of(session, 'regions.hosts').region_hosts(),
			whyStayed: (file, importers) => why_stayed(file, importers)
		}
	};
	const why_stayed = (file: string, importers: Iterable<string>): BarrelLeftReason[] => {
		const ids = [...importers];
		const found = new Set<BarrelLeftReason>();
		for (const answer of stayed_answers) for (const r of answer(file, ids, 'client')) found.add(r);
		return BARREL_LEFT_REASONS.filter((r) => found.has(r));
	};
	const stage_host = (stage: TransformStage): Plugin => ({
		name: `ogygia:${stage}`,
		enforce: 'pre',
		async transform(raw, id) {
			const mine = stage_transforms.filter((s) => s.stage === stage && (s.filter?.(id) ?? true));
			if (mine.length === 0) return null;
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
						// oxlint-disable-next-line ogygia/no-silent-failures -- Vite throws for a specifier this importer cannot resolve
					} catch {
						return null;
					}
					return r && !r.external ? r.id.replace(BACKSLASH_G, '/') : null;
				},
				watch: (file) => this.addWatchFile(file)
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
		macroMs: 0,
		macroN: 0,
		resolveMs: 0,
		loadMs: 0
	};
	const __P = !!process.env.OGYGIA_PROFILE;
	const __outHash = new Map<string, number>();

	const session = new_session();

	const arm_keep_client_cleanup = (routes_dir: string) => {
		if (keep_client_cleanup_armed) return;
		keep_client_cleanup_armed = true;
		process.on('exit', () => {
			try {
				fs.rmSync(keep_client_dir(routes_dir), { recursive: true, force: true });
				// oxlint-disable-next-line ogygia/no-silent-failures -- best effort; the folder is gitignored and cleaned on the next run
			} catch {}
		});
	};

	const invalidate_module_id = (server: ViteDevServer, id: string) => {
		const mod = server.moduleGraph.getModuleById(id);
		if (mod) server.moduleGraph.invalidateModule(mod);
	};

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
		stage_host('source'),
		definers_plugin(() => definers),
		{
			name: 'ogygia',
			enforce: 'pre',

			config: {
				order: 'pre',
				async handler(userConfig, env) {
					configured(session);
					kit = await load_kit_config(path.resolve(userConfig.root ?? '.'), userConfig.plugins);

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
					stayed_answers = resolved.stayed;
					({
						servers: server_plugins,
						clients: client_plugins,
						client_hooks: runtime_hooks,
						route_config,
						foreign_hydrate,
						macros,
						prescans,
						markup,
						definers,
						page_reads
					} = resolved);
					listed_plugins = app_plugins.map((p) => p.name);
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

					if (env.command === 'build' && !standalone && isMainThread) {
						const routes = kit.dirs.routes_dir;
						if (clientBuildWillSkip(route_reader(node_fs), routes)) {
							inject_keep_client_route(routes);
							arm_keep_client_cleanup(routes);
						} else {
							fs.rmSync(keep_client_dir(routes), { recursive: true, force: true });
						}
					}

					if (!standalone && !declared_scanned) {
						declared_scanned = true;
						for (const p of discover_package_files(path.resolve(userConfig.root ?? '.')))
							if (!pkg_scan.some((s) => s.name === p.name)) pkg_scan.push(p);
					}
					const declared_pkg_names = [
						...new Set([...pkg_scan.map((p) => p.name), ...app_plugins.map((p) => p.name)])
					];

					const dev_island_deps =
						env.command === 'serve'
							? [...SVELTE_DEV_ISLAND_ENTRIES, 'ogygia > @ogygia/core > devalue']
							: [];
					return {
						resolve: { dedupe: ['@sveltejs/kit'] },
						ssr: { noExternal: ['esm-env', ...OWN_PACKAGE_NAMES, ...declared_pkg_names] },
						optimizeDeps: {
							exclude: [...OWN_PACKAGE_NAMES, ...declared_pkg_names],
							include: dev_island_deps
						},
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
				kit ??= { dirs: default_kit_dirs(root), inline_style_threshold: 0 };
				base = config.base || '';
				svelte_async = svelte_async_enabled(config.plugins);
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
				const app_dir_define = (config.define as Record<string, unknown> | undefined)?.[
					'__SVELTEKIT_APP_DIR__'
				];
				if (typeof app_dir_define === 'string') {
					try {
						const v = JSON.parse(app_dir_define);
						if (typeof v === 'string' && v) app_dir = v;
						// oxlint-disable-next-line ogygia/no-silent-failures -- a define that is not JSON keeps the `_app` default
					} catch {}
				}
				const ra = config.resolve?.alias ?? [];
				resolve_alias = Array.isArray(ra)
					? ra.map((a) => ({ find: a.find, replacement: a.replacement }))
					: Object.entries(ra).map(([find, replacement]) => ({
							find,
							replacement: replacement as string
						}));
				configure_build_cache(root);
				libDir = path.join(root, 'src', 'lib');
				is_dev = config.command === 'serve';
				is_build = config.command === 'build';
				is_ssr = !!config.build?.ssr;

				if (is_dev)
					fs.rmSync(keep_client_dir(kit.dirs.routes_dir), { recursive: true, force: true });

				if (!process.env.OGYGIA_SECRET?.trim()) {
					let env_dir: string | false = root;
					if (config.envDir === false) env_dir = false;
					else if (config.envDir) env_dir = path.resolve(root, config.envDir);
					if (env_dir !== false) {
						const from_file = loadEnv(config.mode, env_dir, '').OGYGIA_SECRET?.trim();
						if (from_file) process.env.OGYGIA_SECRET = from_file;
					}
				}
				const env_secret = process.env.OGYGIA_SECRET?.trim() || '';
				if (env_secret) {
					if (is_build && !secret_has_min_entropy(env_secret)) {
						throw new OgygiaError('secret_too_short', { min_bytes: MIN_SECRET_BYTES });
					}
					id_salt = derive_id_salt(env_secret);
				} else {
					id_salt = '';
				}

				({ kit_wire_path, kit_remote_index, universal_hooks, client_hooks, kit_transport_init } =
					resolve_kit_paths(root));

				const compiler = resolve(session, (prev) => {
					const ctx = new CompileCtx({
						root,
						kit_dirs: kit.dirs,
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
						preprocess_css,
						macros,
						page_reads,
						prescans,
						plugins: listed_plugins,
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
					return prev
						? prev.with_ctx(ctx)
						: new Compiler(
								new Program({ forms: continuity_forms, router: router_enabled }),
								{ prof: __prof, P: __P, outHash: __outHash },
								ctx
							);
				});

				if (is_dev) {
					compiler.prescan();
					const opt = ((config as { optimizeDeps?: object }).optimizeDeps ??= {}) as {
						entries?: string | string[];
					};
					let entries: string[] = [];
					if (Array.isArray(opt.entries)) entries = opt.entries;
					else if (opt.entries) entries = [opt.entries];
					opt.entries = entries;
					const have = new Set(entries);
					for (const abs of compiler.island_scan_entries()) {
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
				const env = env_of(this) ?? { name: is_ssr ? 'ssr' : 'client', server: is_ssr };
				const begins = compiler.start_leg(env.name, env.server);
				const leg = compiler.leg(env);
				const server_leg = leg.server;
				if (is_build && server_leg)
					fs.rmSync(server_handoff_path(kit.dirs.out_dir), { force: true });
				if (begins) {
					compiler.prescan();
					for (const source of markup) await source.scan?.({ root, readFile });
				}

				if (is_build && !server_leg) {
					const emit_runtime =
						!standalone &&
						(hasAnyCsrFalseRoute(compiler.ctx.routes, kit.dirs.routes_dir) ||
							compiler.has_hydrate_regions());
					const handoff = read_server_handoff(kit.dirs.out_dir);
					const loaded = handoff?.hosts ?? null;
					const server_regions = handoff?.server_regions ?? null;
					const skipped = compiler.emit_build_chunks(leg, (chunk) => this.emitFile(chunk), {
						emitRuntime: emit_runtime,
						loaded
					});
					if (skipped && isMainThread)
						console.log(line('island_chunks_not_emitted', { count: skipped }));
					const tree_css = tree_css_walk(this);
					for (const abs of compiler.router_css_roots()) {
						const source = await tree_css(abs);
						if (source)
							leg.router_css_refs.set(
								router_css_key(root, abs),
								this.emitFile({ type: 'asset', name: 'og-rcss.css', source })
							);
					}
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
				}
			},

			configureServer(server) {
				const compiler = compiler_of(session, 'configureServer');
				vite_server = server;
				if (measure) {
					install_dev_maps(server);
					install_dev_client_maps(server);
					if (page_reads)
						install_dev_page_keys(
							server,
							(iid) => {
								const { registry, by_id } = compiler.program;
								return registry.get(by_id.get(iid) ?? '')?.componentPath;
							},
							root,
							page_reads
						);
				}
			},

			watchChange(id, change) {
				const compiler = compiler_of(session, 'watchChange');
				shapes.invalidate(id, change.event);
				if (is_dev) {
					const ids = compiler.routes_changed(id, change.event);
					if (vite_server) for (const mid of ids) invalidate_module_id(vite_server, mid);
				}
				if (!is_dev || change.event !== 'delete' || !vite_server) return;
				if (!invalidate_islands_for_file(id, { deleted: true, server: vite_server })) return;
				vite_server.ws.send({ type: 'full-reload', path: '*' });
			},

			buildEnd() {
				const compiler = compiler_of(session, 'buildEnd');
				const server_leg = leg_of(this).server;
				if (is_build && server_leg && !standalone) {
					try {
						const handoff = server_handoff_path(kit.dirs.out_dir);
						fs.mkdirSync(path.dirname(handoff), { recursive: true });
						fs.writeFileSync(
							handoff,
							server_handoff_json(
								compiler.ssr_transformed_hosts(),
								build_secret,
								compiler.server_island_css_roots()
							)
						);
					} catch (e) {
						if (isMainThread) warn('island_handoff_write_failed', e);
					}
				}
				if (__P) {
					const keys = [...__outHash.keys()].sort();
					// oxlint-disable-next-line ogygia/one-hash -- folds numbers (each file's hash), not a string
					let d = 0x811c9dc5;
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

				if (STYLE_BEARING_FILE_RE.test(file))
					for (const mid of compiler.changed('styles')) invalidate_module_id(server, mid);

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
							const owners = derive_css_scope_owners(file, kit.dirs.routes_dir, [
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
						return;
					}
				}

				const deleted = !fs.existsSync(strip_id(file));
				const host_changed = !deleted && compiler.is_registered_host(file);
				const entry_changed =
					!deleted && needs_island_entry_full_reload(file, compiler.program.registry.values());
				if (host_changed || deleted) {
					invalidate_islands_for_file(file, { deleted, server });
				}

				if (!needs_csr_false_full_reload(file) && !deleted && !host_changed && !entry_changed) {
					return;
				}
				server.ws.send({ type: 'full-reload', path: '*' });
				return [];
			},

			async resolveId(source, importer) {
				if (OGYGIA_INJECTED_IMPORTS.has(source)) return OGYGIA_INJECTED_FILES[source];

				if (svelte_async) {
					const awaiting = async_twin_redirect(source, importer, OGYGIA_REGION_MODULES);
					if (awaiting) return awaiting;
				}

				const ssr = leg_of(this).server;

				if (!ssr && source === '__sveltekit/remote') {
					if (!kit_remote_index) throw new OgygiaError('kit_remote_src_missing');
					return kit_remote_index;
				}
				if (!ssr && importer && importer.includes('/remote-functions/')) {
					if (KIT_REMOTE_CLIENT.test(source)) return STUB_CLIENT;
					if (KIT_REMOTE_STATE.test(source)) return STUB_STATE;
					if (source === '#app/paths') return STUB_PATHS;
					if (source === '#app/state/client') return STUB_STATE;
				}
				if (!ssr && source === '$app/paths/internal/client') return STUB_PATHS;

				return compiler_of(session, 'resolveId').resolve_id(source, importer, {
					ssr,
					resolve: (s, i, o) => this.resolve(s, i, o)
				});
			},

			async load(id) {
				const compiler = compiler_of(session, 'load');
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
						readFile
					});
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
					const code = await scoped_component_css(abs, source, preprocess_css);
					return { code, moduleType: 'css' };
				}

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

				const leg = leg_of(this);
				if (!leg.server && KIT_CLIENT_APP_RE.test(id)) {
					source += KIT_PAGE_THREAD + KIT_DISCLOSE_VERSION;
				}
				source = compiler.split_realm_imports(source) ?? source;

				const result = await compiler.transform_module(source, id, {
					leg,
					emitFile: (chunk) => this.emitFile(chunk),
					watch: (file) => this.addWatchFile(file)
				});
				if (is_dev && vite_server)
					for (const mid of compiler.moved()) invalidate_module_id(vite_server, mid);
				if (is_dev && vite_server) {
					for (const marked of compiler.drain_closure_marks())
						invalidate_module_id(vite_server, marked);
				}
				if (result) return result as { code: string; map: Rolldown.SourceMapInput | null };
				return source === code ? null : { code: source, map: null };
			},

			renderChunk(code, chunk, _options, meta) {
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

			outputOptions(output) {
				const compiler = compiler_of(session, 'outputOptions');
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
				for (const r of unpatched(leg.server, chunks))
					warn('relocation_unpatched', { name: r.name, leg: leg.name });
				if (leg.server) return;
				for (const file of compiler.location_maps(leg, (ref) => this.getFileName(ref)))
					this.emitFile({ type: 'asset', fileName: file.fileName, source: file.source });
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
						// oxlint-disable-next-line ogygia/no-silent-failures -- a content file whose CSS cannot be extracted goes unstyled; it never breaks a build
					} catch {}
				}
			},

			closeBundle() {
				compiler_of(session, 'closeBundle').end_leg(env_of(this)?.name ?? null);
			},

			async writeBundle(_options, bundle) {
				const compiler = compiler_of(session, 'writeBundle');
				const leg = leg_of(this);
				const server_leg = leg.server;
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
				// @why rolldown merges shared chunks after generateBundle, so only writeBundle's chunks are the files on disk (test: test/vite-hooks.test.ts › the browser leg hands the server its region deps; the server leg does not)
				if (!is_build || server_leg) return;

				refuse_client_secrets(bundle as Record<string, unknown>, [
					read_server_handoff(kit.dirs.out_dir)?.build_key ?? build_secret,
					process.env.OGYGIA_SECRET?.trim() ?? ''
				]);

				if (isMainThread) for (const hook of prescans) hook.written?.();

				await page_reads?.settle((s, importer) => this.resolve(s, importer));

				const remote_hash = (id: string) => remote_hash_of(id, process.cwd());
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
					page_reads && ((module_id) => page_reads!.keys(module_id)),
					readFile,
					entries.runtime_file,
					{ islands: entries.islands, runtime: entries.runtime }
				);
				const page_why = page_reads
					? report_seed_shaping(
							map,
							bundle as Record<string, { type: string; moduleIds?: string[]; imports?: string[] }>,
							(module) => page_reads!.why(module),
							root,
							(identity) => entries.locations[identity] ?? identity
						)
					: {};
				for (const [key, ref] of leg.router_css_refs) {
					try {
						const file = this.getFileName(ref);
						map.css[key] = [file.startsWith('/') ? file : `/${file}`];
						// oxlint-disable-next-line ogygia/no-silent-failures -- an asset the bundle dropped: the page goes unstyled rather than link a 404
					} catch {}
				}

				for (const [iid, ref] of leg.hole_css_refs) {
					try {
						const file = this.getFileName(ref);
						const key = compiler.island_public_url(iid);
						(map.css[key] ??= []).push(file.startsWith('/') ? file : `/${file}`);
						// oxlint-disable-next-line ogygia/no-silent-failures -- an asset the bundle dropped: the hole goes unstyled rather than link a 404
					} catch {}
				}

				const content_css: Record<string, string[]> = {};
				for (const [key, ref] of leg.content_css_refs) {
					try {
						const file = this.getFileName(ref);
						content_css[key] = [file.startsWith('/') ? file : `/${file}`];
						// oxlint-disable-next-line ogygia/no-silent-failures -- an asset the bundle dropped: the body goes unstyled rather than link a 404
					} catch {}
				}

				const css_inline = collect_inline_css(
					bundle as Record<
						string,
						{ type: string; fileName?: string; source?: string | Uint8Array }
					>,
					[...Object.values(map.css).flat(), ...Object.values(content_css).flat()],
					kit.inline_style_threshold
				);
				if (!measure) {
					map.contents = {};
					map.heavy = {};
					map.hazards = {};
					map.dupes = [];
				}
				const barrels: Record<string, ChunkBarrel[]> = {};
				if (measure) {
					for (const [key, chunk] of Object.entries(bundle)) {
						if (chunk.type !== 'chunk') continue;
						const found: ChunkBarrel[] = [];
						for (const id of chunk.moduleIds ?? []) {
							if (id.startsWith('\0')) continue;
							const q = id.indexOf('?');
							if ((q === -1 ? id : id.slice(0, q)).endsWith('.svelte')) continue;
							const info = this.getModuleInfo(id);
							if (!info) continue;
							const fanout = info.importedIds.filter((d) => !d.startsWith('\0')).length;
							const own = info.code?.length ?? Infinity;
							if (fanout >= 6 && own <= fanout * 160) {
								const name = summarize_chunk_contents([id], 1, 1)[0];
								const why = why_stayed(id, info.importers);
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
					...(measure ? { page_why, barrels } : {}),
					content_css,
					css_inline,
					fn_manifest: compiler.fn_manifest(),
					entries: entries.locations,
					locations: leg.location_map_url
				});
				emit_island_deps_handoff(root, json, kit.dirs.out_dir, leg.relocated);
			}
		},
		stage_host('post'),
		island_sourcemaps_plugin({
			program: () => compiler_of(session, 'sourcemaps').program,
			is_island_path
		}),
		lazy_files()
	];
}
