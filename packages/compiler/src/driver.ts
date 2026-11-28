import path from 'node:path';
import { createHash } from 'node:crypto';
import { cache, say } from '@ogygia/machine';
import { feature_word, fnv1a32, key_label, key_of, OWN_FILE_RE } from '@ogygia/core/contract';
import {
	transformHost,
	transformTsRegions,
	wrapperVirtualId,
	ISLAND_DIR,
	is_island_path,
	CLIENT_BINDING_STUB
} from './region/transform.ts';
import {
	routeCsrIsFalse,
	routeCsrIsTrue,
	hasAnyCsrTrueRoute,
	clean_stale_ogygia_dirs,
	is_route_component,
	type FileEvent
} from './kit.ts';
import { kit_env_build } from './kit-patches.ts';
import { run_module_macros } from './macros/pipeline.ts';
import { fn_manifest_entries } from './macros/dollar.ts';
import { is_script_request } from './script-request.ts';
import { resolveFeatures, type FeatureId, type RuntimeMarks } from './link/runtime-entry.ts';
import { FOUC_CSS_PREFIX, FOUC_SCOPED_PREFIX } from './fouc-css.ts';
import { resolve_app_spec } from './app-spec.ts';
import { island_imports } from './link/island-imports.ts';
import {
	moduleHasTransportable,
	svelteModuleHasTransportable,
	svelte_module_registration,
	appendTransportRegistrations
} from './transportables.ts';
import {
	rewrite_lake_import_to_placeholder,
	APP_SHIM_IMPORT,
	FOREIGN_HYDRATE_MARK
} from './region/emit.ts';
import { by_code_unit, by_key, location_map_files } from './link/location-map.ts';
import { context_keys } from './link/context-detect.ts';
import { own_reach, reaches_context, reaches_wire } from './link/own-reach.ts';
import { router_css_roots } from './link/router-css.ts';
import type { SourceMap } from 'magic-string';
import { relocate, relocations_of, type RelocateCx } from './link/relocations.ts';
import { same_module_path, island_vpaths_affected_by_file } from './dev/hmr.ts';
import { VirtualTable, import_chain } from './virtual/resolver.ts';
import { CORE_VALUE_NAMES } from './virtual/value-names.ts';
import {
	CORE_PARTS,
	CORE_VIRTUALS,
	core_path,
	type CoreApp,
	type CorePlugins
} from './virtual/core.ts';
import type { Leg, Part } from './virtual/table.ts';
import { strip_id, host_key } from './program.ts';
import {
	export_names,
	registry_client_id,
	registry_client_path,
	registry_client_source,
	registry_stub_source,
	static_script_specs
} from './link/registry-stub.ts';
import { island_host_loaded, type HandedRuntime, type ServerHandoff } from './link/emit-gate.ts';
import { opaque_stamp_edits } from './ownership-stamps.ts';
import { MapChain, type StepMap } from './map-chain.ts';
import type { SourceMapInput } from '@jridgewell/remapping';
import { splice_map, splice_text, type Edit } from './splice.ts';
import { strip_bom } from './bom.ts';
import { RESOLVED, V_RUNTIME_ENTRY, region_family } from './ids.ts';
import { is_generated_specifier } from './virtual/table.ts';
import { OgygiaError, warn } from './messages.ts';
import { new_leg, type BuildLeg } from './leg.ts';
import type { Program, RegisterResult } from './program.ts';
import type { FileFacts } from './scan-facts.ts';
import type { CompileCtx } from './ctx.ts';

type TransformResult = RegisterResult & { code: string; map: unknown };

function result_map(result: TransformResult): StepMap {
	const map = result.map;
	return map ? () => map as SourceMapInput : null;
}
const ISLAND_ENTRY_NAME_PREFIX = 'og-region.';
const RUNTIME_ENTRY_NAME = 'og-runtime';
const LATE_SERVER_REGION_NAME = 'og-server-region';

/** The bundler's `emitFile` for an entry chunk, by `name` (the output pattern content-hashes it).
 *  Returns the reference id. */
export type EmitChunk = (chunk: { type: 'chunk'; id: string; name: string }) => string;

/** The app's scan, finished (`Compiler.prescan`): what the build knows before the bundler walks. */
export interface Scan {
	/** The resolved runtime feature set, folded into the runtime chunk's name: it busts the immutable
	 *  URL when the app's features change. Both legs scan the same source, so both name it alike. */
	readonly feature_hash: string;
}

type EmittedSource = string | { code: string; moduleSideEffects: false };

interface Build {
	readonly legs: Map<string, BuildLeg>;
	begun: boolean;
	readonly program: Program;
	readonly transform_cache: Map<string, { code: string; result: unknown }>;
	readonly dollar_hoists: Map<string, string>;
	scan: Scan | null;
	handoff: ServerHandoff | null;
	server_runtime: HandedRuntime | null;
	router_css_roots: string[] | null;
	kit_env_build: string | null;
	readonly resolve_memo: Map<string, string | null>;
	readonly reach_memo: Map<string, boolean>;
	readonly specs_memo: Map<string, readonly string[]>;
	readonly island_closure_seen: Set<string>;
	readonly closure_frontier: ClosureEdge[];
	readonly transformed_outside_islands: Set<string>;
	readonly virtuals: VirtualTable<CoreApp>;
}
const new_build = (program: Program): Build => ({
	legs: new Map(),
	begun: false,
	program,
	virtuals: new VirtualTable<CoreApp>(
		CORE_VIRTUALS,
		core_path,
		CORE_VALUE_NAMES,
		CORE_PARTS,
		program.scan.db
	),
	transform_cache: new Map(),
	dollar_hoists: new Map(),
	scan: null,
	handoff: null,
	server_runtime: null,
	router_css_roots: null,
	kit_env_build: null,
	resolve_memo: new Map(),
	reach_memo: new Map(),
	specs_memo: new Map(),
	island_closure_seen: new Set(),
	closure_frontier: [],
	transformed_outside_islands: new Set()
});

/** Shared OGYGIA_PROFILE instrument — the adapter owns the maps/counters; the driver writes into
 *  them so the transform-phase metrics (and the determinism digest source) live with the transform. */
export interface Profiler {
	prof: {
		transformMs: number;
		transformN: number;
		transformHit: number;
		prescanMs: number;
		/** time in plugin macros (`b.macro`), and how many calls */
		macroMs: number;
		macroN: number;
		resolveMs: number;
		loadMs: number;
	};
	P: boolean;
	outHash: Map<string, number>;
}

const LEADING_SLASH = /^\//;
const COMPONENT_EXT_RE = /\.(svelte|js|ts)$/;
const ROUTE_HOST_FILE_RE = /^\+(page|layout)\.(ts|js|mjs)$/;
const REGION_BINDING_PREFIX = region_family('binding');
const WRAPPER_PREFIX = region_family('wrapper');
const TS_REGISTRY_EXT_RE = /\.(ts|js|mjs)$/;
const SVELTE_RUNE_MODULE_RE = /\.svelte\.(ts|js)$/;
type RegistryResolve = (
	source: string,
	importer: string,
	opts: { skipSelf: boolean }
) => Promise<{ id: string } | null>;
const SCRIPT_MODULE_RE = /\.(?:[cm]?[jt]sx?)$/;
const SOURCE_EXT_RE = /\.(svelte|ts|js|mjs|cjs)$/;
const CLOSURE_SOURCE_RE = /\.(?:svelte|[cm]?[jt]sx?)$/;
const SERVER_MODULE_EXT_RE = /\.(server|remote)\.(ts|js|mjs)$/;
const SERVER_DIR_RE = /\/(src\/lib\/server|server)\//;
const NODE_MODULES_DIR = `${path.sep}node_modules${path.sep}`;
interface ClosureEdge {
	readonly spec: string;
	readonly importer: string;
}
type ClosureResolve = (spec: string, importer: string) => Promise<string | null>;
const PAGE_FREE_APP_MODULES: ReadonlySet<string> = new Set([
	'$app/environment',
	'$app/paths',
	'$app/env/public'
]);
const ASSET_EXTS =
	'css|scss|sass|less|styl|pcss|postcss|json|svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|txt|wasm|mp4|webm|mp3|wav';
const ASSET_EXT_RE = new RegExp(`\\.(?:${ASSET_EXTS})$`, 'i');
const PAGE_FREE_UNRESOLVED_RE = new RegExp(
	`^svelte(?:\\/[\\w/-]+)?$|\\.(?:${ASSET_EXTS})(?:\\?[^/]*)?$`,
	'i'
);
const ISLAND_DEP_EXTS: readonly string[] = [
	'',
	'.svelte',
	'.ts',
	'.js',
	'.svelte.ts',
	'.svelte.js',
	'.mjs'
];

const MODULE_SPEC_RE =
	/(?:^|[\n;])\s*(?:import|export)\b[^;'"()]*?from\s*['"]([^'"]+)['"]|(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g;
const KIT_RUNTIME_APP = '/@sveltejs/kit/src/runtime/app/';
/**
 * The island shim for an `$app/*` import, by specifier or by where Kit's alias sent it: Vite's alias
 * plugin runs before any plugin's resolveId, so an import the transform did not rewrite (a module
 * that joined the island graph late) arrives as `<kit>/src/runtime/app/state`, `…/state/index.js`.
 */
export function app_shim_for(source: string, shims: Record<string, string>): string | null {
	const direct = shims[source];
	if (direct) return direct;
	const at = source.indexOf(KIT_RUNTIME_APP);
	if (at === -1) return null;
	let name = source.slice(at + KIT_RUNTIME_APP.length);
	if (name.endsWith('/index.js')) name = name.slice(0, -'/index.js'.length);
	else if (name.endsWith('.js')) name = name.slice(0, -'.js'.length);
	return shims[`$app/${name}`] ?? null;
}
function prescan_rel(
	ctx: { pkg_identity(p: string): string | null; root: string },
	full: string
): string {
	return (ctx.pkg_identity(full) ?? path.relative(ctx.root, full)).split(path.sep).join('/');
}
function scan_kind(name: string): 'svelte' | 'script' | null {
	if (name.endsWith('.svelte')) return 'svelte';
	if (SCAN_SCRIPT_RE.test(name) && !name.endsWith('.d.ts')) return 'script';
	return null;
}
const SCAN_SCRIPT_RE = /\.(?:ts|js|mjs)$/;
const REMOTE_FILE_RE = /\.remote\.[jt]s$/;

const PLUGIN_PACKAGES: Readonly<Record<string, string>> = { '@ogygia/flags': 'flags()' };
const unlisted_said = say();
function extract_module_specs(src: string): string[] {
	return [...src.matchAll(MODULE_SPEC_RE)].map((m) => m[1] ?? m[2]);
}

const warned_undeclared = cache<string, true>({
	name: 'warned undeclared package marks',
	max: 10_000
});
function warn_undeclared_pkg_marks(id: string): void {
	if (warned_undeclared.has(id)) return;
	warned_undeclared.set(id, true);
	warn('package_marks_undeclared', { file: id });
}

export class Compiler implements CoreApp {
	readonly profiler: Profiler;
	/** The build under way (see `Build`). */
	#build: Build;
	/** The build's program: registry, graph and the scan's facts. */
	get program(): Program {
		return this.#build.program;
	}
	get transform_cache(): Map<string, { code: string; result: unknown }> {
		return this.#build.transform_cache;
	}
	/** Every `import.meta.og.$` hoist collected across the build (tag → factory source). Filled by
	 *  `macros()`; drained by the adapter's fn-manifest emit (dev load leg, renderChunk, writeBundle). */
	get dollar_hoists(): Map<string, string> {
		return this.#build.dollar_hoists;
	}

	/**
	 * Open leg `name` (the bundler environment a build hook runs in; `server` when its output runs in
	 * Node). A leg that already ran in this build begins the next one (watch, a second `build()` in
	 * one process): everything the last build learned is dropped. Dev is one build for the session.
	 * True when this leg begins a build, so the caller runs its once-per-build work; Kit's route
	 * answers are read afresh from there. `handoff`: what the server leg handed this client leg: the
	 * build's scan reads every module it compiled, and ships the runtime it named
	 * (test/runtime-marks-reached.test.ts).
	 */
	start_leg(name: string, server: boolean, handoff: ServerHandoff | null = null): boolean {
		if (this.#build.legs.has(name) && this.#ctx.is_build)
			this.#build = new_build(this.#build.program.fresh());
		const build = this.#build;
		if (!build.legs.has(name)) build.legs.set(name, new_leg(name, server));
		if (build.begun) return false;
		build.begun = true;
		build.handoff = handoff;
		this.#ctx.routes.db.reread();
		return true;
	}

	/**
	 * The leg a hook runs in: its environment's, else (a hook the bundler calls without one) the one
	 * leg open now. Refused when that is not one leg (`build_leg_unclear`): two legs open at once
	 * cannot be told apart. Dev opens an environment's leg on its first use.
	 */
	leg(env: { name: string; server: boolean } | null): BuildLeg {
		const legs = this.#build.legs;
		if (env) {
			const leg = legs.get(env.name);
			if (leg) return leg;
			if (!this.#ctx.is_build) {
				const opened = new_leg(env.name, env.server);
				legs.set(env.name, opened);
				return opened;
			}
			throw new OgygiaError('build_leg_unclear', { leg: env.name, open: 0 });
		}
		const open = [...legs.values()].filter((l) => l.life.now.kind === 'open');
		if (open.length === 1) return open[0];
		throw new OgygiaError('build_leg_unclear', { leg: '', open: open.length });
	}

	/** Leg `name` of this build, if it started (a reader that may run outside any leg). */
	find_leg(name: string): BuildLeg | undefined {
		return this.#build.legs.get(name);
	}

	/**
	 * A leg ends (its bundle is written): `env`'s, else (a hook the bundler calls without one) the one
	 * leg open now. With two open (a dev server closing: its legs live for the session) there is no
	 * one leg to end, and none ends. Ending a leg that already ended does nothing (closeBundle may run
	 * again).
	 */
	end_leg(env: string | null): void {
		const legs = this.#build.legs;
		const open = [...legs.values()].filter((l) => l.life.now.kind === 'open');
		let leg = env !== null ? legs.get(env) : undefined;
		if (env === null && open.length === 1) leg = open[0];
		if (leg?.life.now.kind === 'open') leg.life.go('closed');
	}

	/**
	 * DEV, after each transform: the virtual modules whose last load read something (the registry,
	 * the marks, a fold over the files' scan facts) that has since changed, for the adapter to
	 * invalidate. One rule for every reader: the server manifest emitted while a host's rows were
	 * dropped for its edit (every hole answered 403 until a restart), the runtime entry chosen before
	 * a page's first `idle` region (it never woke: test/dev-regions-reload.test.ts), and the wire
	 * loaders, Kit's codecs and the router CSS roots read before a file's facts changed
	 * (test/dev-scan-facts.test.ts). A registry module a load answered null while no host held it is
	 * named once a host registers it.
	 */
	moved(): string[] {
		const out = this.#virtuals.moved();
		for (const id of this.#unanswered)
			if (this.program.registry.has(id)) {
				this.#unanswered.delete(id);
				out.push(id);
			}
		return out;
	}

	/** Register a transform's regions; in dev, note whether that moved what `regions` readers read. */
	#register(result: TransformResult, host: string): void {
		if (!this.#ctx!.is_dev) return this.program.register(result, host);
		const before = this.#regions_print(host);
		this.program.register(result, host);
		if (this.#regions_print(host) !== before) this.#virtuals.move('regions');
	}

	/**
	 * One file's scan facts: what the prescan reads of every file, and the dev transform reads again of
	 * the file it transforms (a file added or edited while dev runs). Replaces the file's old facts
	 * (`src` null: a deleted file has none). The marks only grow: a feature too many is safe.
	 */
	#scan_facts(full: string, src: string | null, kind: 'svelte' | 'script'): readonly string[] {
		const ctx = this.#ctx;
		const { runtime_marks, scan } = this.program;
		const dev = ctx.is_dev;
		const marks_before = dev ? JSON.stringify(runtime_marks) : '';
		let specs: string[] = [];

		if (src === null) scan.set(full, null);
		else {
			const remote = kind === 'script' && REMOTE_FILE_RE.test(full);
			specs = extract_module_specs(src);
			const page_importers = ctx.page_importers;
			const reach = own_reach(src, full, kind);
			const facts: FileFacts = {
				crosses_wire: remote || reaches_wire(reach),
				transportable:
					kind === 'svelte'
						? svelteModuleHasTransportable(src, full)
						: moduleHasTransportable(src, full),
				specs,
				router:
					(page_importers.length > 0 && specs.some((s) => page_importers.includes(s))) ||
					ctx.page_files.includes(full)
			};
			scan.set(full, facts);
			if (!runtime_marks.context && reaches_context(reach)) runtime_marks.context = true;
			if (remote) runtime_marks.remoteSeeds = true;
			if (facts.transportable) runtime_marks.wire = true;
		}

		if (dev && JSON.stringify(runtime_marks) !== marks_before) this.#virtuals.move('regions');
		return specs;
	}

	/** How the prescan's walk reads `id`: the app's `src/` and the declared package surfaces, minus
	 *  `node_modules` and generated island dirs beneath them. Null: the walk never reaches it. */
	#scans(id: string): 'svelte' | 'script' | null {
		const ctx = this.#ctx!;
		const kind = scan_kind(id);
		if (!kind || !path.isAbsolute(id)) return null;
		const posix_id = id.split(path.sep).join('/');
		const src_dir = `${path.join(ctx.root, 'src').split(path.sep).join('/')}/`;
		let rest: string;
		if (posix_id.startsWith(src_dir)) rest = posix_id.slice(src_dir.length);
		else if (ctx.in_declared_pkg(posix_id)) {
			const dir = ctx.pkg_scan.flatMap((p) => p.dirs).find((d) => posix_id.startsWith(`${d}/`));
			rest = dir === undefined ? '' : posix_id.slice(dir.length + 1);
		} else return null;
		const segments = rest.split('/').slice(0, -1);
		return segments.includes('node_modules') || segments.includes(ISLAND_DIR) ? null : kind;
	}

	/** The marks and one host's rows, as text (dev only: the change check above). */
	#regions_print(host: string): string {
		const { registry, host_index, runtime_marks } = this.program;
		const rows = [...(host_index.get(host_key(host))?.vpaths ?? [])].sort().map((vpath) => {
			const e = registry.get(vpath);
			return [vpath, e?.hostPath, e?.server, e?.source, e?.ssrSource, e?.clientSource];
		});
		return JSON.stringify([runtime_marks, rows]);
	}
	readonly #ctx: CompileCtx;
	/** The resolved compile context (the bundler's resolved config, read once it is resolved). */
	get ctx(): CompileCtx {
		return this.#ctx;
	}
	get #virtuals(): VirtualTable<CoreApp> {
		return this.#build.virtuals;
	}
	/** The app's Kit routes directory (a virtual module that reads it reloads on a route change). */
	routes_dir(): string {
		return this.#ctx.kit_dirs.routes_dir;
	}
	/** The plugins listed beside `ogygia()`. */
	plugins(): CorePlugins {
		const ctx = this.#ctx;
		return {
			server: ctx.server_plugins,
			client: ctx.client_plugins,
			route_config: ctx.route_config
		};
	}
	/** The modules of one leg's built output that its realms may not hold (./virtual/resolver.ts). */
	misplaced_modules(module_ids: Iterable<string>, ssr: boolean): [string, string][] {
		return this.#virtuals.misplaced(module_ids, { ssr, dev: false });
	}
	/** A module's named imports of a realm module, per entry (./virtual/resolver.ts). */
	split_realm_imports(code: string): string | null {
		return this.#virtuals.split_realm_imports(code);
	}
	/** A dev change to a part of the session: the resolved ids of the virtual modules whose last load
	 *  read it (or anything else that has moved), for the caller to invalidate. */
	changed(part: Part): string[] {
		this.#virtuals.move(part);
		return this.#virtuals.moved();
	}

	/**
	 * DEV: a file was added, changed or removed. What the route answers read of it is read again
	 * (`Routes.touch`); when none of that changed, nothing is invalidated. Else the ids to invalidate
	 * are the virtual modules that read the routes AND every module compiled for a csr world that is
	 * no longer its own: a host compiled for csr=true has its marks stripped, so a page that became
	 * csr=false kept no regions until a restart (test/dev-csr-change.test.ts). Its old rows go now;
	 * its next transform registers anew.
	 */
	routes_changed(file: string, event: FileEvent): string[] {
		if (!this.#ctx.routes.touch(file, event)) return [];
		const out = new Set(this.changed('routes'));
		const invalidate = (id: string) => out.add(id);
		for (const [k, w] of this.#worlds) {
			if (this.#csr_world(w.id, w.ssr, w.link).key === w.key) continue;
			this.#worlds.delete(k);
			if (this.is_registered_host(w.id)) this.invalidate_for_file(w.id, { invalidate });
			out.add(w.id);
		}
		return [...out];
	}

	/** DEV: each module's csr world as last compiled, by leg and id (`routes_changed`). */
	readonly #worlds = new Map<
		string,
		{ id: string; ssr: boolean; link: boolean | undefined; key: string }
	>();

	/**
	 * The csr world a module is compiled for, on one leg: whether it links the real region modules
	 * (`link_virtual`), its route's csr (`route_csr`), and both as a cache key.
	 *
	 * A csr=false CLIENT host does not link the real wrappers (or the hydrate entries they pull in):
	 * Kit still emits its page node, and sharing that module with the page graph makes Rolldown emit
	 * thin `og-region.*` facades. SSR links them for the HTML, and a csr=true client links them so Kit
	 * hydrates the regions as plain components. A csr=false LAYOUT links them too when the app has a
	 * csr=true route: Kit hydrates that layout under a csr=true child page.
	 *
	 * `route_csr`: true for a csr=true route host (its marks are stripped so Kit compiles the
	 * components inline), false for a csr=false one, undefined for a module that is not a route host
	 * (its csr is the page that renders it, read at run time by `documentIsCsrTrue`).
	 */
	#csr_world(
		id: string,
		ssr: boolean,
		link_override: boolean | undefined
	): { link_virtual: boolean; route_csr: boolean | undefined; key: string } {
		const ctx = this.#ctx;
		const routesDir = ctx.kit_dirs.routes_dir;
		const is_layout_host = is_route_component(path.basename(id), 'layout');
		const link_virtual =
			link_override !== undefined
				? link_override
				: ssr ||
					!routeCsrIsFalse(ctx.routes, id, routesDir) ||
					(is_layout_host && hasAnyCsrTrueRoute(ctx.routes, routesDir));
		let route_csr: boolean | undefined;
		let csr_key = 'n';
		if (routeCsrIsTrue(ctx.routes, id, routesDir)) {
			route_csr = true;
			csr_key = 't';
		} else if (routeCsrIsFalse(ctx.routes, id, routesDir)) {
			route_csr = false;
			csr_key = 'f';
		}
		const key = `${link_virtual ? '1' : '0'}\0${csr_key}`;
		return { link_virtual, route_csr, key };
	}

	/** A compile session, made once the bundler has resolved the build (`ctx`): nothing runs before
	 *  its context exists. */
	constructor(program: Program, profiler: Profiler, ctx: CompileCtx) {
		this.#build = new_build(program);
		this.profiler = profiler;
		this.#ctx = ctx;
	}

	/**
	 * The app's identity on Kit's env channel (kit-patches.ts `kit_env_build`), made once per build
	 * and kept on it, so a build's server leg and client leg (each with its own context) bear one,
	 * though the source changes between them. A dev app with no identity yet (`''`) is asked again,
	 * so one that gains its first dynamic public variable gets its own
	 * (test/kit-env-build.test.ts, test/vite-hooks.test.ts).
	 */
	kit_env_build(): string {
		const build = this.#build;
		if (build.kit_env_build !== null) return build.kit_env_build;
		const ctx = this.#ctx;
		const id = kit_env_build({
			root: ctx.root,
			base: ctx.base,
			app_dir: ctx.app_dir,
			out_dir: ctx.kit_dirs.out_dir,
			mode: ctx.is_build ? 'build' : 'dev',
			fs: ctx.fs,
			browser_files: () => {
				this.prescan();
				return this.program.island_graph;
			}
		});
		if (id !== '' || ctx.is_build) build.kit_env_build = id;
		return id;
	}

	/** A compiler with context `ctx` that carries on this one's build (its program, legs and caches):
	 *  the next environment of a builder that shares one plugin across them. */
	with_ctx(ctx: CompileCtx): Compiler {
		const next = new Compiler(this.program, this.profiler, ctx);
		next.#build = this.#build;
		return next;
	}

	/**
	 * Devtools: the `island id → component name` map, read at call time off the live registry (so a
	 * dev-server middleware serves a COMPLETE, current map — no stale virtual-module snapshot). Keys
	 * are the island id (`<hash>` in `ogygia:region/entry/<hash>.js`); values the component's
	 * basename. A held/generated island with no source file is skipped (the tab keeps its short hash).
	 */
	region_names(): Record<string, string> {
		const names: Record<string, string> = {};
		for (const [iid, vpath] of this.program.by_id) {
			const cp = this.program.registry.get(vpath)?.componentPath;
			if (!cp) continue;
			const base = (cp.split('?')[0].split('#')[0].split('/').pop() || '').replace(
				COMPONENT_EXT_RE,
				''
			);
			if (base && base !== iid) names[iid] = base;
		}
		return names;
	}

	/**
	 * Each module that marks region imports (a host, by its absolute path), with the module ids its
	 * regions are built from: their components and the modules minted for them. Read at call time
	 * off the live registry, like {@link region_names}.
	 */
	region_hosts(): Map<string, Set<string>> {
		const { host_index, registry } = this.program;
		const hosts = new Map<string, Set<string>>();
		for (const [host, entry] of host_index) {
			const ids = new Set<string>();
			for (const vpath of entry.vpaths) {
				ids.add(vpath);
				const component = registry.get(vpath)?.componentPath;
				if (component) ids.add(strip_id(component));
			}
			if (ids.size > 0) hosts.set(host, ids);
		}
		return hosts;
	}

	/**
	 * Run the module-macro passes (`wire`/`$`/`source`/`store`/auto-brand, then the plugins' macros)
	 * over one module — the leg that must land before the island transform / svelte compile /
	 * ts-region minting sees it. `source` is the CURRENT text (a plugin's pre-transform may already have
	 * edited it). Returns `{ code, touched, maps }`, one map per pass that changed the text.
	 */
	macros(
		source: string,
		id: string,
		watch?: (file: string) => void
	): Promise<{ code: string; touched: boolean; maps: StepMap[] }> {
		const ctx = this.#ctx;
		return run_module_macros(
			source,
			id,
			{
				root: ctx.root,
				alias: ctx.resolve_alias,
				pkgRoot: ctx.pkg_root,
				dollarHoists: this.dollar_hoists,
				macros: ctx.macros,
				markdownExts: ctx.markdown_exts,
				ownSource: (file) => ctx.is_own_source(file),
				watch
			},
			this.profiler
		);
	}

	/**
	 * Transform a content (`.svx`/`.md`) island source the markdown preprocessor hands back — always
	 * wrapper-linked (`linkVirtual: true`), because a preprocessor output is shared across the ssr/client
	 * legs and can't take the csr=false stub split; content files aren't routes, so they'd get wrappers
	 * anyway. Registers the descriptors and returns the rewritten code, or `null` when it has no islands.
	 * This is the transform the adapter installs on the content-island bridge.
	 */
	transform_content_island(source: string, filename: string): string | null {
		const result = this.transform(source, filename, {
			ssr: false,
			linkVirtual: true
		}) as TransformResult | null;
		if (!result || !result.islands?.length) return null;
		this.#register(result, filename);
		return result.code;
	}

	/**
	 * The REAL source file a module derives from. A real file is its own origin. A generated entry
	 * (a portable-snippet synth, re-processed under its `ogygia:region/entry/<iid>.svelte` id)
	 * resolves through the registry's `hostPath` — transitively, so an entry minted while re-processing
	 * another entry still lands on the file the outermost slice was cut from. This is the ONE rule
	 * `resolve_id` already applies to an entry's plain imports; threading it into the transform keeps
	 * a re-minted marked import (whose resolved path is BAKED into a region module's source, bypassing
	 * resolveId) on the same base. Normalized like `transform_module`'s gate (`strip_id`, `/@id/`).
	 */
	#origin_of(id: string): string {
		const { registry } = this.program;
		const bare = (s: string) => {
			const n = strip_id(s);
			return n.startsWith('/@id/') ? n.slice(5) : n;
		};
		let cur = bare(id);
		const seen = new Set<string>([cur]);
		for (;;) {
			const host = registry.get(cur)?.hostPath;
			if (!host) break;
			const next = bare(host);
			if (seen.has(next)) break;
			seen.add(next);
			cur = next;
		}
		return cur;
	}

	/**
	 * Lower one file and register nothing: the caller registers the returned descriptors into the
	 * `Program`. Memoized per id, leg and csr world, and only while the source is the same.
	 */
	transform(
		source: string,
		id: string,
		opts: { ssr?: boolean; linkVirtual?: boolean } = {}
	): unknown {
		const ctx = this.#ctx;
		const { prof, P, outHash } = this.profiler;
		const ssr = opts.ssr !== false;
		const { link_virtual, route_csr, key } = this.#csr_world(id, ssr, opts.linkVirtual);
		if (ctx.is_dev)
			this.#worlds.set(`${ssr ? 's' : 'c'}\0${id}`, { id, ssr, link: opts.linkVirtual, key });
		const cache_key = `${id}\0${ssr ? 's' : 'c'}\0${key}`;
		const hit = this.transform_cache.get(cache_key);
		if (hit && hit.code === source) {
			if (P) prof.transformHit++;
			return hit.result;
		}
		const th0 = P ? performance.now() : 0;
		const result = transformHost(source, id, {
			root: ctx.root,
			libDir: ctx.libDir,
			readFile: (abs: string) => ctx.read_file(abs),
			dev: ctx.is_dev,
			virtualPathFor: (_hostId: string, iid: string) => ctx.island_virtual_id(iid),
			wrapperPathFor: (_hostId: string, iid: string) => wrapperVirtualId(iid),
			devUrlFor: (virtualPath: string) => ctx.dev_url_for(virtualPath),
			originOf: (host: string) => this.#origin_of(host),
			appDir: ctx.app_dir,
			visibleMargin: ctx.visibleMargin,
			presets: ctx.presets,
			importKeys: ctx.import_keys,
			idSalt: ctx.id_salt,
			pkg_identity: (abs: string) => ctx.pkg_identity(abs),
			alias: ctx.app_spec.alias,
			stat: ctx.app_spec.stat,
			linkVirtualIsland: link_virtual,
			clientBindingStub: CLIENT_BINDING_STUB,
			routeCsr: route_csr,
			ssr
		});
		if (P) {
			prof.transformMs += performance.now() - th0;
			prof.transformN++;
			outHash.set(
				cache_key,
				fnv1a32(JSON.stringify((result as { code?: unknown })?.code ?? result))
			);
		}
		this.transform_cache.set(cache_key, { code: source, result });
		return result;
	}

	/**
	 * Mint the `.ts` / `.js` regions in one module — `with { wake: … }` load/remote imports become
	 * island descriptors. The ts-region half of the front-end, sharing the driver's resolved context
	 * (so both the prescan and the transform hook mint identically). Not memoized — the caller gates it
	 * on the id + marker; the returned descriptors are the caller's to `register`.
	 */
	ts_regions(source: string, id: string): ReturnType<typeof transformTsRegions> {
		const ctx = this.#ctx;
		return transformTsRegions(source, id, {
			root: ctx.root,
			libDir: ctx.libDir,
			dev: ctx.is_dev,
			virtualPathFor: (_hostId: string, iid: string) => ctx.island_virtual_id(iid),
			devUrlFor: (virtualPath: string) => ctx.dev_url_for(virtualPath),
			appDir: ctx.app_dir,
			importKeys: ctx.import_keys,
			idSalt: ctx.id_salt,
			pkg_identity: (abs: string) => ctx.pkg_identity(abs),
			alias: ctx.app_spec.alias,
			stat: ctx.app_spec.stat
		});
	}

	/**
	 * Discover every island up front — walk `src/`, transform each `.svelte` host and mint each
	 * `.ts`/`.js` region, register the descriptors, then complete `island_graph` TRANSITIVELY and
	 * finalize the runtime capability marks (so the sticky runtime entry bundles only what the app
	 * uses, and its immutable chunk name busts on a feature-set change). Once per build, so the
	 * adapter can call it from any hook. Populates the `Program`; the fs walk is the only side effect.
	 */
	prescan(): Scan {
		return (this.#build.scan ??= this.#scan());
	}

	#scan(): Scan {
		const ctx = this.#ctx;
		const { prof, P } = this.profiler;
		const program = this.program;
		const { island_graph, runtime_marks } = program;
		const root = ctx.root;

		const src_dir = path.join(root, 'src');
		clean_stale_ogygia_dirs(src_dir);
		const unlisted = new Map<string, string>();
		const read_for_plugins = (full: string, src: string, specs: readonly string[]) => {
			for (const hook of ctx.prescans)
				if (specs.some((s) => hook.imports.includes(s)))
					hook.module({ file: full, rel: prescan_rel(ctx, full), code: src });
			for (const s of specs)
				if (Object.hasOwn(PLUGIN_PACKAGES, s) && !ctx.plugins.includes(s) && !unlisted.has(s))
					unlisted.set(s, prescan_rel(ctx, full));
		};
		const say_one_off_keys = (full: string, src: string, kind: 'svelte' | 'script') => {
			if (!src.includes('Symbol(') || !reaches_context(own_reach(src, full, kind))) return;
			for (const key of context_keys(src, kind).one_off)
				warn('region_context_key_one_off', { file: path.relative(root, full), key });
		};
		const scan_file = (full: string) => {
			const readable = this.#readable(full);
			if (!readable) return;
			const { kind, src } = readable;
			say_one_off_keys(full, src, kind);
			read_for_plugins(full, src, this.#scan_facts(full, src, kind));
			if (kind === 'svelte') {
				const result = this.transform(src, full);
				if (result) program.register(result, full);
			} else {
				const result = this.ts_regions(src, full);
				if (result) program.register(result, full);
			}
		};
		const walk = (dir: string) => {
			const entries = ctx.fs.list(dir);
			if (entries === null) return;
			for (const entry of entries) {
				const full = path.join(dir, entry.name);
				if (entry.kind === 'dir') {
					if (entry.name === 'node_modules' || entry.name === ISLAND_DIR) continue;
					walk(full);
				} else {
					scan_file(full);
				}
			}
		};
		{
			const __ps = P ? performance.now() : 0;
			walk(src_dir);
			for (const p of ctx.pkg_scan) {
				for (const d of p.dirs) walk(d);
				for (const f of p.files) scan_file(f);
			}
			for (const f of this.#compiled_unread(this.#build.handoff?.hosts ?? [])) scan_file(f);
			for (const f of ctx.page_files) {
				if (program.scan.has(f)) continue;
				const src = ctx.read_file(f);
				program.scan.set(f, {
					crosses_wire: false,
					transportable: false,
					specs: src == null ? [] : extract_module_specs(src),
					router: true
				});
			}
			if (P) prof.prescanMs += performance.now() - __ps;
		}
		for (const [pkg, file] of unlisted)
			unlisted_said.once(pkg, () =>
				warn('plugin_not_listed', { package: pkg, plugin: PLUGIN_PACKAGES[pkg]!, file })
			);

		this.#walk_closures();

		if (!runtime_marks.context) {
			const reads: { file: string; keys: string[] }[] = [];
			const island_set = new Set<string>();
			for (const file of island_graph) {
				if (!file.endsWith('.svelte') && !SCRIPT_MODULE_RE.test(file)) continue;
				const src = ctx.read_file(file);
				if (src == null) continue;
				const { reads: r, sets } = context_keys(
					src,
					file.endsWith('.svelte') ? 'svelte' : 'script'
				);
				for (const k of sets) island_set.add(k);
				if (r.length) reads.push({ file, keys: r });
			}
			for (const { file, keys } of reads) {
				for (const key of keys) {
					if (island_set.has(key)) continue;
					warn('island_context_unprovided', {
						file: path.relative(root, file),
						key: key_label(key_of(key))
					});
				}
			}
		}

		const feature_hash = this.#seal_marks();
		const handoff = this.#build.handoff;
		if (!handoff) return { feature_hash };
		const handed = handoff.runtime;
		if (!handed) throw new OgygiaError('server_runtime_unnamed');
		const named = new Set(resolveFeatures(handed.marks));
		const unnamed = resolveFeatures(runtime_marks).filter((f) => !named.has(f));
		if (unnamed.length)
			throw new OgygiaError('runtime_features_unnamed', { features: unnamed.join(', ') });
		for (const key of Object.keys(runtime_marks)) delete runtime_marks[key as keyof RuntimeMarks];
		Object.assign(runtime_marks, structuredClone(handed.marks));
		return { feature_hash: handed.feature_hash };
	}

	/** A file the scan reads for regions, as the transform reads it (`#region_reading`): its kind and
	 *  source, or null. */
	#readable(full: string): { kind: 'svelte' | 'script'; src: string } | null {
		const kind = scan_kind(path.basename(full));
		if (!kind) return null;
		const reading = this.#region_reading(full, kind);
		if (reading === 'never') return null;
		const src = this.#ctx.read_file(full);
		if (src == null) return null;
		if (reading === 'hinted' && !this.#ctx.has_island_hint(src)) return null;
		return { kind, src };
	}

	/** The modules a server leg compiled that the scan has not read: never a region's own module, nor
	 *  ogygia's (its entry re-exports every feature, so it would turn each one on). */
	#compiled_unread(compiled: Iterable<string>): string[] {
		const { scan } = this.program;
		return [...compiled].filter((f) => !scan.has(f) && !is_island_path(f) && !OWN_FILE_RE.test(f));
	}

	/** Walk each registered region's island closure (what reaches Kit's page world); `page_by`
	 *  hears the component whose closure first reads the page. */
	#walk_closures(page_by?: (component: string) => void): void {
		const { prof, P } = this.profiler;
		const __ws = P ? performance.now() : 0;
		for (const entry of this.program.registry.values()) {
			if (!entry.componentPath) continue;
			const read = this.program.island_reads_page;
			this.mark_island_closure(entry.componentPath);
			if (!read && this.program.island_reads_page) page_by?.(entry.componentPath);
		}
		if (P) prof.prescanMs += performance.now() - __ws;
	}

	/** Fold the build's options into the runtime marks and close them: the feature hash the runtime
	 *  is named by. */
	#seal_marks(): string {
		const ctx = this.#ctx;
		const { runtime_marks } = this.program;
		runtime_marks.foreign = ctx.foreign_hydrate;
		runtime_marks.page = this.program.island_reads_page || runtime_marks.foreign;
		runtime_marks.complete = true;
		return createHash('sha256')
			.update(resolveFeatures(runtime_marks).join(','))
			.digest('hex')
			.slice(0, 8);
	}

	/**
	 * BUILD, server leg, once it has compiled every module (`buildEnd`): the runtime its pages name.
	 * It reads what the leg compiled as the client leg's scan reads its handoff, so both legs name one
	 * runtime, and the client leg ships exactly it (test/runtime-marks-reached.test.ts).
	 */
	server_runtime(): HandedRuntime {
		return (this.#build.server_runtime ??= this.#seal_server_runtime());
	}

	/** Read each module the server leg compiled that the scan has not, as the scan reads `src/`, then
	 *  close the marks; `read` hears each file it read. Returns the feature hash. */
	#read_server_compiled(
		read?: (file: string) => void,
		page_by?: (component: string) => void
	): string {
		this.prescan();
		for (const f of this.#compiled_unread(this.program.ssr_transformed)) {
			const readable = this.#readable(f);
			if (!readable) continue;
			this.#scan_facts(f, readable.src, readable.kind);
			read?.(f);
		}
		this.#walk_closures(page_by);
		return this.#seal_marks();
	}

	#seal_server_runtime(): HandedRuntime {
		const word = this.program.server_word;
		const needed_by = new Map<FeatureId, string>(this.program.server_late);
		const feature_hash = this.#read_server_compiled(
			(f) => {
				if (word === null) return;
				for (const id of resolveFeatures({ ...this.program.runtime_marks, complete: true }))
					if (!(word & feature_word([id])) && !needed_by.has(id)) needed_by.set(id, f);
			},
			(component) => needed_by.set('page', component)
		);
		const marks = structuredClone(this.program.runtime_marks);
		if (word !== null) this.#refuse_late_features(marks, word, needed_by);
		const shipped = this.program.shipped_features;
		if (!shipped) return { marks, feature_hash };
		const unnamed = resolveFeatures(marks).filter((f) => !shipped.has(f));
		if (unnamed.length)
			throw new OgygiaError('runtime_features_unnamed', { features: unnamed.join(', ') });
		return { marks, feature_hash: this.#build.scan?.feature_hash ?? feature_hash };
	}

	/** Stops the build when the server's settled runtime needs a feature its bundle's word, fixed as
	 *  `ogygia:server/runtime-flags` loaded, left out: the server code for it is not in the bundle. */
	#refuse_late_features(
		marks: RuntimeMarks,
		word: number,
		needed_by: ReadonlyMap<FeatureId, string>
	): void {
		const left = resolveFeatures(marks).filter((id) => !(word & feature_word([id])));
		if (!left.length) return;
		const modules = new Set<string>();
		for (const id of left) {
			const file = needed_by.get(id);
			if (file) modules.add(prescan_rel(this.#ctx, file));
		}
		throw new OgygiaError('server_features_late', {
			features: left.join(', '),
			modules: [...modules].join(', ') || 'a region one of them reaches'
		});
	}

	/** Whether the regions of `id` are read: always (app source, a declared `ogygia.files` file), when
	 *  its source names an import key (any other installed component), or never (any other installed
	 *  script). The transform and the scan share it, so the scan knows each region the bundle places. */
	#region_reading(id: string, kind: 'svelte' | 'script'): 'always' | 'hinted' | 'never' {
		const p = id.split(path.sep).join('/');
		if (!p.includes('/node_modules/') || this.#ctx.in_declared_pkg(p)) return 'always';
		return kind === 'svelte' ? 'hinted' : 'never';
	}

	/** The scan's feature hash; empty before the scan ran. */
	get #feature_hash(): string {
		return this.#build.server_runtime?.feature_hash ?? this.#build.scan?.feature_hash ?? '';
	}

	/** DEV: modules `mark_island_closure` marked for the first time AFTER prescan — an island a later
	 *  transform registered (a file added while the server runs). Each may already sit in the dev
	 *  server's module graph, transformed with Kit's real `$app/*` for a non-island importer; the
	 *  plugin drains this list and drops those cached transforms so the next load re-resolves them. */
	#closure_added: string[] = [];
	/** Each walked file's imports, with the source they were read from (kept across rebuilds). */
	readonly #closure_imports = new Map<string, { src: string; specs: readonly string[] }>();
	/** What the bundler resolved each package file's import to (`importer\0spec`), across the
	 *  rebuilds of this compiler: a Kit 3 builder's watch. Kit 2 runs each client build as a new
	 *  `vite.build`, a new plugin, so there it starts empty. An import that did not resolve is not
	 *  kept. */
	readonly #package_resolves = new Map<string, string>();

	#mark_registered_closures(result: TransformResult): void {
		if (!this.#ctx.is_dev) return;
		for (const isl of result.islands ?? []) {
			if (isl.componentPath)
				this.#closure_added.push(...this.mark_island_closure(isl.componentPath));
		}
	}

	/** DEV: take the modules newly marked as island code since the last drain (see above). */
	drain_closure_marks(): string[] {
		const out = this.#closure_added;
		this.#closure_added = [];
		return out;
	}

	/**
	 * Mark `componentAbs` and everything it imports through relative paths and the app's aliases as
	 * island code, before the bundler resolves any of it. A bare package specifier stops this walk; a
	 * build keeps it for {@link follow_island_closure}. Returns the modules marked for the first time
	 * by this call.
	 */
	mark_island_closure(componentAbs: string): string[] {
		const walk = this.#closure([componentAbs], [], true);
		for (let step = walk.next(); ;) {
			if (step.done) return step.value;
			const found: (string | null)[] = [];
			for (const edge of step.value) found.push(this.#app_resolve(edge));
			step = walk.next(found);
		}
	}

	/**
	 * BUILD, client leg, before any module loads: go on with the island closure past the package
	 * specifiers {@link mark_island_closure} stopped at, through the bundler's own resolver, so every
	 * module an island reaches is island code (its `$app/*` imports read the shims) before any
	 * transform or resolve asks.
	 */
	async follow_island_closure(resolve: ClosureResolve): Promise<void> {
		const walk = this.#closure([], this.#build.closure_frontier.splice(0), false);
		for (let step = walk.next(); !step.done;)
			step = walk.next(await this.#bundler_resolve(step.value, resolve));
	}

	/**
	 * OGYGIA_RULES builds, the client leg's end: stops the build when a module that imports `$app/*`
	 * joined the island graph after its client transform ran (`island_graph_late`). Its `$app/*`
	 * imports had been read as a page's: which side it took hung on which importer the bundler
	 * reached first. Each one is reached through an import the closure walk cannot see. A module that
	 * imports no `$app/*` itself is not reported (Svelte's runtime, ogygia's own helpers a generated
	 * module imports), though one it imported while still page code may have kept Kit's `$app/*`:
	 * that case goes unreported.
	 */
	check_island_order(): void {
		const { island_graph } = this.program;
		const late: string[] = [];
		for (const id of this.#build.transformed_outside_islands)
			if (island_graph.has(id)) late.push(prescan_rel(this.#ctx, id));
		if (late.length)
			throw new OgygiaError('island_graph_late', { modules: late.sort().join(', ') });
	}

	/**
	 * The island closure walk, one level of imports at a time: it yields each level's imports and is
	 * handed back what each resolved to (null: not resolved), in order. `app`: the resolver is the
	 * app-path one (`mark_island_closure`), so an import it leaves unresolved may read Kit's page, and
	 * a build keeps it for the bundler's resolver. Returns the modules marked for the first time.
	 */
	*#closure(
		files: readonly string[],
		pending: readonly ClosureEdge[],
		app: boolean
	): Generator<readonly ClosureEdge[], string[], readonly (string | null)[]> {
		const program = this.program;
		const { island_graph } = program;
		const seen = this.#build.island_closure_seen;
		const added: string[] = [];
		let level = files;
		let edges = [...pending];
		for (;;) {
			for (const abs of level) {
				const file = strip_id(abs);
				if (seen.has(file)) continue;
				seen.add(file);
				if (!island_graph.has(file)) {
					island_graph.add(file);
					added.push(file);
				}
				if (!CLOSURE_SOURCE_RE.test(file)) {
					if (app && !ASSET_EXT_RE.test(file)) program.island_reads_page = true;
					continue;
				}
				const src = this.#ctx.read_file(file);
				if (src == null) continue;
				for (const spec of this.#imports_of(file, src)) {
					if (!spec || spec[0] === '\0') continue;
					if (spec.startsWith('$app/')) {
						if (app && !PAGE_FREE_APP_MODULES.has(spec)) program.island_reads_page = true;
						continue;
					}
					if (spec.startsWith('$env/') || is_generated_specifier(spec) || is_island_path(spec))
						continue;
					if (PAGE_FREE_UNRESOLVED_RE.test(spec)) continue;
					edges.push({ spec, importer: file });
				}
			}
			if (edges.length === 0) return added;
			const found = yield edges;
			const next: string[] = [];
			for (let i = 0; i < edges.length; i++) {
				const id = found[i] ?? null;
				if (id !== null) {
					if (!id.startsWith('\0')) next.push(id);
				} else if (app) {
					program.island_reads_page = true;
					if (this.#ctx.is_build) this.#build.closure_frontier.push(edges[i]);
				}
			}
			level = next;
			edges = [];
		}
	}

	/** What the app-path resolver makes of an import: the root, `$lib`, the aliases, then a file by
	 *  extension or an `index` file. */
	#app_resolve({ spec, importer }: ClosureEdge): string | null {
		const ctx = this.#ctx;
		const base = resolve_app_spec(spec, importer, ctx.app_spec);
		if (!base) return null;
		for (const ext of ISLAND_DEP_EXTS) if (ctx.fs.stat(base + ext) === 'file') return base + ext;
		for (const ext of ISLAND_DEP_EXTS.slice(1)) {
			const idx = path.join(base, `index${ext}`);
			if (ctx.fs.stat(idx) === 'file') return idx;
		}
		return null;
	}

	/** One level of the walk through the bundler's resolver, all at once. An import a package file
	 *  makes resolves the same in every rebuild of one compiler, so once resolved it is not asked
	 *  again; one that failed is asked again. */
	async #bundler_resolve(
		edges: readonly ClosureEdge[],
		resolve: ClosureResolve
	): Promise<(string | null)[]> {
		const known = this.#package_resolves;
		const keys: (string | null)[] = [];
		const asks: Promise<string | null>[] = [];
		for (const { spec, importer } of edges) {
			const key = importer.includes(NODE_MODULES_DIR) ? `${importer}\0${spec}` : null;
			const had = key === null ? undefined : known.get(key);
			keys.push(had === undefined ? key : null);
			asks.push(had === undefined ? resolve(spec, importer) : Promise.resolve(had));
		}
		const found = await Promise.all(asks);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			const id = found[i];
			if (key !== null && id !== null) known.set(key, id);
		}
		return found;
	}

	/** Whether `file` imports an `$app/*` module an island reads through a shim (a mention in a
	 *  comment is no import). */
	#imports_app_shim(file: string, src: string): boolean {
		for (const spec of this.#imports_of(file, src))
			if (Object.hasOwn(this.#ctx.app_shims, spec)) return true;
		return false;
	}

	/** The imports of `file`, read once per version of its source (link/island-imports.ts). */
	#imports_of(file: string, src: string): readonly string[] {
		const had = this.#closure_imports.get(file);
		if (had?.src === src) return had.specs;
		const specs = island_imports(src, file);
		this.#closure_imports.set(file, { src, specs });
		return specs;
	}

	/**
	 * Scan ENTRIES for Vite's dep optimizer: every hydrate island's component file and the host file
	 * that places it — real, absolute, on-disk source paths. Under `csr = false` Kit ships no client
	 * entry and registers only `routes/**\/+*` as scan entries, so Vite's scanner reaches an island
	 * only when a route file imports it statically. An island behind a block registry, an
	 * `import.meta.og.regions()` glob or a `.remote.ts` mint is never crawled: its client deps are
	 * discovered LAZILY on its first wake, and every discovery re-optimizes, rotates the optimizer's
	 * browserHash and full-reloads — on a large app a reload storm that never settles. The adapter
	 * appends these to `optimizeDeps.entries` (dev) so Vite's OWN scanner crawls them at startup with
	 * the full plugin pipeline: its resolver, every plugin's `resolveId` (a `?client` import resolves
	 * through vite-plugin-iso-import), a linked workspace package followed as SOURCE and never
	 * pre-bundled, the app's `exclude` honoured.
	 *
	 * Deliberately NOT a self-computed `optimizeDeps.include` list. A resolver that is not Vite's
	 * mis-classifies something Vite knows — a plugin query, a workspace link, an `exports` map — and
	 * a wrong `include` hands rolldown an id it cannot load: `UNLOADABLE_DEPENDENCY`, a dead dev
	 * server (two field-reported regressions). An entry can only ever ADD a crawl root; what the
	 * crawl finds is Vite's call. A `defer` island renders on the server (its closure is not client
	 * code) and a lake ships no client JS, so neither is an entry; the host file covers a
	 * portable-snippet synth, which has no component file of its own. Needs `prescan()`; deduped,
	 * sorted, existing source files only.
	 */
	island_scan_entries(): string[] {
		const { registry } = this.program;
		const out = new Set<string>();
		const add = (p: string | null | undefined) => {
			if (!p) return;
			const abs = strip_id(p);
			if (!SOURCE_EXT_RE.test(abs)) return;
			if (this.#ctx.fs.stat(abs) === 'file') out.add(abs);
		};
		for (const entry of registry.values()) {
			if (entry.role !== 'entry' || entry.server) continue;
			add(entry.componentPath);
			add(entry.hostPath);
		}
		return [...out].sort();
	}

	/** The feature-selected runtime chunk name (immutable-cached). Needs prescan to have run for a
	 *  non-empty feature hash; both build legs prescan the same source → the same name. */
	runtime_chunk_filename(): string {
		return this.#ctx.runtime_chunk_filename(this.#feature_hash);
	}

	/** Public URL of the runtime chunk (asset prefix + filename — honors a non-root base / assets CDN). */
	runtime_chunk_url(): string {
		return this.#ctx.runtime_chunk_url(this.#feature_hash);
	}

	/** The server-router component roots (link/router-css.ts). Build: prescan is complete before any
	 *  consumer runs — memoized for the build. Dev: modules appear lazily (HMR), recompute per call. */
	router_css_roots(): string[] {
		const ctx = this.#ctx;
		const build = this.#build;
		if (ctx.is_build && build.router_css_roots) return build.router_css_roots;
		const roots = router_css_roots(
			this.program.router_modules,
			this.program.module_specs,
			ctx.app_spec,
			(p) => ctx.fs.stat(p) === 'file'
		);
		if (ctx.is_build) build.router_css_roots = roots;
		return roots;
	}

	/**
	 * Server-only islands — `render: 'deferred'` with no client chunk — and the component file each
	 * renders. Nothing on any page links such a component's CSS (Kit collects stylesheets from the
	 * client graph; this subtree is never in it), so the client leg compiles each one's whole tree
	 * CSS into a dedicated asset the hole response links (vite/index.ts, `region_css_links`).
	 * Sorted for determinism; a component shared by several ids is emitted once (by `abs`).
	 */
	server_island_css_roots(): Array<{ iid: string; abs: string }> {
		const out: Array<{ iid: string; abs: string }> = [];
		for (const [iid, vpath] of this.program.by_id) {
			const entry = this.program.registry.get(vpath);
			if (!entry?.server || !entry.componentPath) continue;
			if (this.program.region_kinds.get(iid) === 'hydrate') continue;
			out.push({ iid, abs: host_key(entry.componentPath) });
		}
		return out.sort((a, b) => by_code_unit(a.iid, b.iid));
	}

	/** The public URL key a server island's CSS is handed off under (matches `island_url[id]`). */
	island_public_url(iid: string): string {
		return this.#ctx.island_public_url(iid);
	}

	/** Whether the program holds any hydrate region, wherever it is placed (a Kit page or not). */
	has_hydrate_regions(): boolean {
		for (const kind of this.program.region_kinds.values()) if (kind === 'hydrate') return true;
		return false;
	}

	/** The server leg's real module graph, for the client-leg handoff (link/emit-gate.ts). */
	ssr_transformed_hosts(): string[] {
		return [...this.program.ssr_transformed].sort();
	}

	/** The feature word the server bundle was made with, for the handoff (null: it never loaded). */
	server_word(): number | null {
		return this.program.server_word;
	}

	/**
	 * Client leg: the runtime chunk + one deterministic chunk per deduped hydrate region. `loaded` —
	 * the server leg's transformed-module set (the handoff the plugin reads) — gates the emit to
	 * islands whose HOST the server bundle actually contains; `null` (no handoff: standalone, or a
	 * client-only build) keeps every prescanned island, as before. Returns how many were skipped.
	 */
	emit_build_chunks(
		leg: BuildLeg,
		emitFile: EmitChunk,
		{ emitRuntime, loaded = null }: { emitRuntime: boolean; loaded?: Set<string> | null }
	): number {
		if (emitRuntime) {
			const feat = this.#ctx.runtime_features(this.#feature_hash);
			leg.runtime_entry_ref = emitFile({
				type: 'chunk',
				id: V_RUNTIME_ENTRY,
				name: RUNTIME_ENTRY_NAME + (feat ? `-${feat}` : '')
			});
		}
		const { region_kinds, by_id, registry } = this.program;
		let skipped = 0;
		for (const [rid, kind] of region_kinds) {
			if (kind !== 'hydrate') continue;
			const virtualPath = by_id.get(rid);
			if (!virtualPath) continue;
			if (leg.island_entry_refs.has(rid)) continue;
			if (!island_host_loaded(registry.get(virtualPath)?.hostPath, loaded)) {
				skipped++;
				continue;
			}
			this.emit_island_entry(leg, emitFile, rid, virtualPath);
		}
		return skipped;
	}

	/**
	 * At the bundle's end (the names are final): each entry's IDENTITY → its LOCATION. `islands` maps
	 * an island entry's hashed file to its identity (the collector keys every map by identity);
	 * `locations` is what the handoff carries to the server (`entries`): identity → served path.
	 * `get_file_name` is the bundler's `this.getFileName`.
	 */
	entry_locations(
		leg: BuildLeg,
		get_file_name: (ref: string) => string
	): {
		islands: Map<string, string>;
		runtime: string | null;
		runtime_file: string | null;
		locations: Record<string, string>;
	} {
		const islands = new Map<string, string>();
		const locations: Record<string, string> = {};
		const served = (file: string) => (file.startsWith('/') ? file : `/${file}`);
		const refs = [...leg.island_entry_refs].sort(by_key);
		for (const [rid, ref] of refs) {
			const file = get_file_name(ref);
			const identity = this.island_public_url(rid);
			islands.set(file, identity);
			locations[identity] = served(file);
		}
		let runtime: string | null = null;
		let runtime_file: string | null = null;
		if (leg.runtime_entry_ref) {
			runtime_file = get_file_name(leg.runtime_entry_ref);
			runtime = this.runtime_chunk_url();
			locations[runtime] = served(runtime_file);
		}
		return { islands, runtime, runtime_file, locations };
	}

	/**
	 * A server region this registration added after the leg wrote `server-regions` (its host was
	 * reached late: outside the start-up scan, #1420): its loader is its own chunk, emitted now and
	 * named in that module at renderChunk (link/relocations.ts). Once per region per leg.
	 */
	#emit_late_server_regions(leg: BuildLeg, emitFile: EmitChunk, result: TransformResult): void {
		const written = this.program.server_regions_written;
		if (written === null) return;
		for (const isl of result.islands ?? []) {
			if (!isl.server || !isl.virtualPath || written.has(isl.id)) continue;
			if (leg.late_server_regions.has(isl.id)) continue;
			leg.late_server_regions.set(
				isl.id,
				emitFile({ type: 'chunk', id: isl.virtualPath, name: LATE_SERVER_REGION_NAME })
			);
		}
	}

	/** Emit one hydrate region's entry chunk into `leg`, by name: the bundler content-hashes it. */
	emit_island_entry(leg: BuildLeg, emitFile: EmitChunk, rid: string, virtualPath: string): void {
		leg.island_entry_refs.set(
			rid,
			emitFile({ type: 'chunk', id: virtualPath, name: ISLAND_ENTRY_NAME_PREFIX + rid })
		);
	}

	/**
	 * The output file pattern for one of OUR entries (by the chunk name `emit_island_entry` / the
	 * runtime emit gave it), else null (the app's own naming applies). Readable and content-hashed:
	 * `<appDir>/immutable/og-region.<iid>.<hash>.js`, `…/og-runtime-<features>.<hash>.js` — the hash is the
	 * cache law, the name is for people (a network tab, a CDN rule, a profile). It never equals a
	 * stable name, which has no hash segment.
	 */
	entry_file_pattern(chunk_name: string | undefined): string | null {
		if (!chunk_name) return null;
		const ours =
			chunk_name.startsWith(ISLAND_ENTRY_NAME_PREFIX) ||
			chunk_name === RUNTIME_ENTRY_NAME ||
			chunk_name.startsWith(`${RUNTIME_ENTRY_NAME}-`);
		if (!ours) return null;
		return `${this.#ctx.app_dir}/immutable/[name].[hash].js`;
	}

	/**
	 * The build's location maps (link/location-map.ts), for the bundle's end (the names are final):
	 * every island entry's identity → its hashed file, content-hashed and at the one fixed name.
	 * `get_file_name` is the bundler's `this.getFileName`. Empty with no island.
	 */
	location_maps(
		leg: BuildLeg,
		get_file_name: (ref: string) => string
	): { fileName: string; source: string }[] {
		const ctx = this.#ctx;
		const pairs: [string, string][] = [];
		for (const [rid, ref] of leg.island_entry_refs)
			pairs.push([ctx.island_chunk_filename(rid), get_file_name(ref)]);
		const files = location_map_files(ctx.app_dir, pairs, (source) =>
			createHash('sha256').update(source).digest('hex').slice(0, 12)
		);
		leg.location_map_url = files.length ? `/${files[0].fileName}` : null;
		return files;
	}

	/**
	 * Emit one ogygia VIRTUAL module's source: the config/capability virtuals (secret / sign / rate-limit
	 * / router / session / ttl / manifests / runtime entry+url / transport / dev-hmr / request-event /
	 * region-endpoint), and the registered island/region sources (with the client leg's `$app/*`-shim +
	 * lake-placeholder rewrites). Returns the source string, or `null` if `id` is not an ogygia virtual —
	 * the adapter owns only the FOUC-css virtuals (they carry a Vite `moduleType`) and the Vite build
	 * value threaded in here (the `universalHooks` path). On a build's server leg, a module whose
	 * source is the runtime the bundle needs (`settles`) is answered once the bundler has compiled
	 * every other module, each read into the marks first, so the server's code is made for them all.
	 */
	emit(id: string, leg: Leg): EmittedSource | Promise<EmittedSource | null> | null {
		if (leg.ssr && leg.compiled && this.#virtuals.settles(id))
			return this.#emit_settled(id, leg, leg.compiled);
		const ctx = this.#ctx;
		const program = this.program;
		const { ssr } = leg;

		const registry_client = registry_client_path(id);
		if (registry_client) return this.#registry_client_emit(registry_client);

		const declared = this.#virtuals.load(id, this, leg);
		if (declared !== null) {
			if (typeof declared === 'string' && this.#virtuals.side_effect_free(id))
				return { code: declared, moduleSideEffects: false };
			return declared;
		}

		const srcEntry = program.registry.get(id);
		if (srcEntry && srcEntry.role === 'region') {
			return ssr ? srcEntry.ssrSource! : srcEntry.clientSource!;
		}
		if (srcEntry) {
			let src = !ssr && srcEntry.clientSource ? srcEntry.clientSource : srcEntry.source!;
			const foreign = src.indexOf(FOREIGN_HYDRATE_MARK);
			if (foreign !== -1 && (ssr || !ctx.foreign_hydrate)) src = src.slice(0, foreign);
			if (!ssr) {
				src = src.replace(APP_SHIM_IMPORT, (_m: string, _q: string, name: string) =>
					JSON.stringify(ctx.app_shims[`$app/${name}`])
				);
				for (const local of srcEntry.lakes ?? []) {
					src = rewrite_lake_import_to_placeholder(src, local, ctx.client_binding_stub_file);
				}
			}
			return src;
		}
		if (ctx.is_dev && this.#virtuals.claims(id)) this.#unanswered.add(id);
		return null;
	}

	async #emit_settled(
		id: string,
		leg: Leg,
		compiled: NonNullable<Leg['compiled']>
	): Promise<EmittedSource | null> {
		await compiled((m) => this.#virtuals.settles(m));
		this.#read_server_compiled();
		const { compiled: _, ...answered } = leg;
		return this.emit(id, answered);
	}

	/** DEV: the registry's modules a load answered null for while no host held them (`moved`). */
	readonly #unanswered = new Set<string>();

	/**
	 * Resolve an ogygia-owned import id: the virtual-module vocabulary (config/manifest virtuals + FOUC
	 * graph + client-binding stub), and the island CLIENT graph — `$app/*` shims for island importers,
	 * virtual island/wrapper ids, and relative imports of a generated island module resolved against its
	 * host (marking each resolved dep into `island_graph` so its own `$app/*` stays shimmed). `resolve` is
	 * the bundler's own resolver (Vite `this.resolve`), threaded in so the driver stays bundler-agnostic.
	 * Returns a resolved id / result, or `null` to defer to the bundler. The adapter handles the few
	 * package/Kit-specific ids first (ogygia injected imports, Kit's remote runtime, the kit-wire path).
	 */
	async resolve_id(
		source: string,
		importer: string | undefined,
		{
			ssr,
			resolve,
			importers_of
		}: {
			ssr: boolean;
			resolve: (
				source: string,
				importer: string,
				opts: { skipSelf: boolean }
			) => Promise<{ id: string } | null>;
			/** the bundler's module graph: who imported a module, for a refusal's import chain */
			importers_of?: (id: string) => readonly string[] | undefined;
		}
	): Promise<string | { id: string } | null> {
		const ctx = this.#ctx;
		const { registry, island_graph } = this.program;

		const declared = this.#virtuals.resolve(source, {
			ssr,
			dev: ctx.is_dev,
			via: () => (importer ? import_chain(importer, importers_of ?? (() => []), ctx.root) : '')
		});
		if (declared) return declared;
		if (source === CLIENT_BINDING_STUB) return ctx.client_binding_stub_file;
		if (
			!ssr &&
			ctx.is_build &&
			importer &&
			(source.startsWith(REGION_BINDING_PREFIX) || source.startsWith(WRAPPER_PREFIX)) &&
			this.#links_client_stub(importer)
		)
			return ctx.client_binding_stub_file;
		if (source.startsWith(FOUC_CSS_PREFIX) || source.startsWith(FOUC_SCOPED_PREFIX)) {
			return RESOLVED(source);
		}

		const registry_stub = await this.#registry_stub_for(source, importer, { ssr, resolve });
		if (registry_stub) return registry_stub;

		const importer_id = importer ? strip_id(importer) : undefined;
		const from_island = importer_id && (registry.has(importer_id) || island_graph.has(importer_id));
		if (!ssr && from_island) {
			const shim = app_shim_for(source, ctx.app_shims);
			if (shim) return shim;
		}

		if (is_island_path(source)) {
			let candidate = source.split('?')[0];
			if (candidate.startsWith('/@id/')) candidate = candidate.slice('/@id/'.length);
			if (candidate.startsWith('/@fs/')) candidate = candidate.slice('/@fs'.length);
			if (registry.has(candidate)) {
				island_graph.add(candidate);
				return candidate;
			}
			const abs = path.isAbsolute(candidate)
				? candidate
				: path.join(ctx.root, candidate.replace(LEADING_SLASH, ''));
			if (registry.has(abs)) {
				island_graph.add(abs);
				return abs;
			}
		}

		if (importer_id && registry.has(importer_id) && !is_island_path(source)) {
			const host = registry.get(importer_id)!.hostPath ?? '';
			const resolved = await resolve(source, host, { skipSelf: true });
			if (resolved?.id) island_graph.add(strip_id(resolved.id));
			if (
				!resolved &&
				!source.startsWith('.') &&
				!source.startsWith('\0') &&
				!is_generated_specifier(source) &&
				!path.isAbsolute(source)
			) {
				throw new OgygiaError('island_import_unresolved', {
					specifier: source,
					host: path.relative(ctx.root, host)
				});
			}
			return resolved;
		}
		if (!ssr && importer_id && island_graph.has(importer_id) && !is_island_path(source)) {
			const resolved = await resolve(source, importer!, { skipSelf: true });
			if (resolved?.id) island_graph.add(strip_id(resolved.id));
			return resolved;
		}
		return null;
	}

	/**
	 * The client-leg registry decision for one import edge (see link/registry-stub.ts). Fires only on
	 * the client leg of a build, for an importer that is either a csr=false ROUTE host (`+page`/
	 * `+layout` `.svelte`/`.ts`/`.js` — the page node's own files, whose client JS never runs) or a
	 * module already in that variant world (its id carries the variant query), and only when the
	 * resolved target is a local `.ts`/`.js` module that IS a region registry or REACHES one through
	 * static script imports. The variant world is contagious along script edges only: a registry
	 * behind a plain helper (`+page.svelte` → `$lib/factory.ts` → `registry.ts`) gets the same
	 * treatment as a direct import, while modules that reach no registry stay shared (no copies).
	 * `.svelte` edges never fork (forking a component's id breaks its scoped CSS). Returns the
	 * variant id, or `null` to let resolution continue.
	 */
	async #registry_stub_for(
		source: string,
		importer: string | undefined,
		{
			ssr,
			resolve
		}: {
			ssr: boolean;
			resolve: RegistryResolve;
		}
	): Promise<string | null> {
		const ctx = this.#ctx;
		if (ssr || ctx.is_dev || !ctx.is_build || !importer) return null;
		if (source.startsWith('\0') || is_generated_specifier(source) || source.startsWith('$app/'))
			return null;
		if (registry_client_path(importer) == null && !this.#is_csr_false_route_host(importer))
			return null;
		const target = await this.#resolve_local_script(source, importer, resolve);
		if (!target) return null;
		this.prescan();
		if (!(await this.#reaches_registry(target, resolve))) return null;
		return registry_client_id(target);
	}

	/** A route COMPONENT whose client leg links the binding stub — `transform`'s `link_virtual` rule,
	 *  for a host that could not apply it itself: csr=false, and not a layout of an app with a
	 *  csr=true route (Kit can hydrate that layout: a csr=true child page, or an error render). */
	#links_client_stub(importer: string): boolean {
		const importer_abs = strip_id(importer);
		const { routes } = this.#ctx;
		const routes_dir = this.#ctx.kit_dirs.routes_dir;
		if (!importer_abs.startsWith(routes_dir + path.sep)) return false;
		const base = path.basename(importer_abs);
		if (is_route_component(base, 'layout'))
			return (
				routeCsrIsFalse(routes, importer_abs, routes_dir) && !hasAnyCsrTrueRoute(routes, routes_dir)
			);
		return is_route_component(base, 'page') && routeCsrIsFalse(routes, importer_abs, routes_dir);
	}

	/** A csr=false route host file: a page or layout component, or its option module. */
	#is_csr_false_route_host(importer: string): boolean {
		const importer_abs = strip_id(importer);
		const { routes } = this.#ctx;
		const routes_dir = this.#ctx.kit_dirs.routes_dir;
		if (!importer_abs.startsWith(routes_dir + path.sep)) return false;
		const base = path.basename(importer_abs);
		if (is_route_component(base, 'page') || is_route_component(base, 'layout'))
			return routeCsrIsFalse(routes, importer_abs, routes_dir);
		const m = ROUTE_HOST_FILE_RE.exec(base);
		if (!m) return false;
		return routeCsrIsFalse(routes, path.join(importer_abs, '..', `+${m[1]}.svelte`), routes_dir);
	}

	/** `source` resolved from `importer` to a local `.ts`/`.js` file on disk, or `null` (virtuals,
	 *  components, assets, unresolvable). Package files count only when the prescan registered them
	 *  as region hosts (an `ogygia.files` package registry) — package internals are never walked. */
	async #resolve_local_script(
		source: string,
		importer: string,
		resolve: RegistryResolve
	): Promise<string | null> {
		const memo_key = `${strip_id(importer)}\n${source}`;
		const memos = this.#build.resolve_memo;
		const memo = memos.get(memo_key);
		if (memo !== undefined) return memo;
		const target = await this.#resolve_local_script_uncached(source, importer, resolve);
		memos.set(memo_key, target);
		return target;
	}
	async #resolve_local_script_uncached(
		source: string,
		importer: string,
		resolve: RegistryResolve
	): Promise<string | null> {
		let resolved: { id: string } | null = null;
		try {
			resolved = await resolve(source, importer, { skipSelf: true });
			// oxlint-disable-next-line ogygia/no-silent-failures -- an edge the resolver refuses is not forked: the real module stays (bytes, never a missing style); the bundler reports the import
		} catch {
			return null;
		}
		if (!resolved?.id || resolved.id.startsWith('\0')) return null;
		const target = strip_id(resolved.id);
		if (!TS_REGISTRY_EXT_RE.test(target) || this.#ctx.fs.stat(target) === null) return null;
		const posix = target.split(path.sep).join('/');
		if (SERVER_MODULE_EXT_RE.test(posix) || SERVER_DIR_RE.test(posix)) return null;
		if (SVELTE_RUNE_MODULE_RE.test(posix)) return null;
		return target;
	}

	/**
	 * Whether `file` is a region registry or reaches one through static script imports (`.svelte`
	 * and package-internal edges are not walked). Every module is read, parsed and walked AT MOST
	 * ONCE per build: a shared helper reached from thousands of import edges answers from the memo.
	 *
	 * Cycles are why that needs care. A NEGATIVE computed while the walk was inside a cycle may
	 * depend on a file still open above it (that file can still turn out to reach a registry), so it
	 * is not final yet. Tarjan's strongly-connected-components bookkeeping decides exactly when it
	 * is: each open file gets its depth on the walk, every step reports the shallowest open file its
	 * subtree looped back to (`low`), and when a file finishes with `low >= depth` nothing below it
	 * depends on anything above it — the file and every file still parked on the component stack
	 * above it form one finished component, all with the same answer. A positive is always final.
	 * (Keeping only top-level negatives instead, as this did first, re-walked every shared module
	 * once per path to it — a large app's build never finished.)
	 */
	async #reaches_registry(file: string, resolve: RegistryResolve): Promise<boolean> {
		return (await this.#reach(file, resolve, new Map(), [])).reaches;
	}
	async #reach(
		file: string,
		resolve: RegistryResolve,
		open: Map<string, number>,
		component: string[]
	): Promise<{ reaches: boolean; low: number }> {
		const key = host_key(file);
		const reach_memo = this.#build.reach_memo;
		const memo = reach_memo.get(key);
		if (memo !== undefined) return { reaches: memo, low: Infinity };
		if (this.program.host_index.has(key)) {
			reach_memo.set(key, true);
			return { reaches: true, low: Infinity };
		}
		const open_depth = open.get(key);
		if (open_depth !== undefined) return { reaches: false, low: open_depth };
		if (file.includes('/node_modules/')) return { reaches: false, low: Infinity };
		const depth = open.size;
		open.set(key, depth);
		const parked = component.length;
		component.push(key);
		let reaches = false;
		let low = Infinity;
		for (const spec of this.#script_specs(key, file)) {
			const target = await this.#resolve_local_script(spec, file, resolve);
			if (!target) continue;
			const step = await this.#reach(target, resolve, open, component);
			if (step.low < low) low = step.low;
			if (step.reaches) {
				reaches = true;
				break;
			}
		}
		open.delete(key);
		if (reaches) {
			reach_memo.set(key, true);
			component.length = parked + 1;
			component.pop();
			return { reaches: true, low: Infinity };
		}
		if (low >= depth) {
			for (let i = parked; i < component.length; i++) reach_memo.set(component[i], false);
			component.length = parked;
			return { reaches: false, low: Infinity };
		}
		return { reaches: false, low };
	}
	/** A module's static script specifiers, read and parsed once per build. */
	#script_specs(key: string, file: string): readonly string[] {
		const memos = this.#build.specs_memo;
		let specs = memos.get(key);
		if (specs === undefined) {
			const src = this.#ctx.read_file(file);
			specs = src == null ? [] : (static_script_specs(src, file) ?? []);
			memos.set(key, specs);
		}
		return specs;
	}

	/** The client-leg registry source (link/registry-stub.ts): marks blanked, plain imports kept. A
	 *  registry that does not parse falls back to the names-only stub. */
	#registry_client_emit(file: string): string | null {
		const ctx = this.#ctx;
		const src = ctx.read_file(file);
		if (src == null) return null;
		const keys = ctx.import_keys;
		const region_keys = new Set([keys.wake, keys.render, keys.preset, keys.region]);
		return (
			registry_client_source(src, file, region_keys) ?? registry_stub_source([...export_names(src)])
		);
	}

	/**
	 * The per-file transform pass: content-preset tagging ▸ `import.meta.og.*` macros ▸ the host-island
	 * transform (`.svelte`) ▸ ts/js region minting (`.ts/.js`) ▸ the client `$app/*` shim. Registers the
	 * discovered descriptors into the `Program`, and (client build only) emits the deterministic chunk for
	 * any hydrate island a library component declares that the prescan couldn't see — via the `emitFile`
	 * callback (the one Vite primitive threaded in), into `leg` (the leg the transform runs in).
	 * Returns the Vite transform result, or `null` if the module was untouched. `prescan()` runs first
	 * so `island_graph` is complete before any module lowers.
	 */
	async transform_module(
		code: string,
		id: string,
		{
			leg,
			emitFile,
			watch
		}: {
			/** The leg it runs in: its `server` is the one answer to "which side is this" (#1439). */
			leg: BuildLeg;
			emitFile: EmitChunk;
			/** The bundler's watch for this module: a macro names the files it read. */
			watch?: (file: string) => void;
		}
	): Promise<{ code: string; map: unknown } | null> {
		const ctx = this.#ctx;
		const ssr = leg.server;
		const program = this.program;
		const { registry, island_graph } = program;
		const root = ctx.root;
		code = strip_bom(code);
		this.prescan();
		if (registry_client_path(id) != null) return null;

		const id_n = strip_id(id);
		if (ssr && ctx.is_build) program.ssr_transformed.add(host_key(id_n));
		if (
			!ssr &&
			ctx.is_build &&
			ctx.rules &&
			!island_graph.has(id_n) &&
			(id_n.endsWith('.svelte') || SCRIPT_MODULE_RE.test(id_n)) &&
			this.#imports_app_shim(id_n, code)
		)
			this.#build.transformed_outside_islands.add(id_n);
		if (ctx.is_dev && is_script_request(id)) {
			const kind = this.#scans(id_n);
			if (kind) this.#scan_facts(path.normalize(id_n), code, kind);
		}

		if (ctx.is_build && ctx.page_reads)
			ctx.page_reads.module(id.split('?')[0].split('\\').join('/'), code);

		let out = code;
		let touched = false;
		const chain = new MapChain();
		const edit = (edits: readonly Edit[]): void => {
			const before = out;
			out = splice_text(before, edits);
			chain.step(() => splice_map(before, edits, id_n));
			touched = true;
		};

		const macroed = await this.macros(out, id_n, watch);
		if (macroed.touched) {
			out = macroed.code;
			chain.steps(macroed.maps);
			touched = true;
		}

		const in_node_modules = id_n.includes('/node_modules/');
		const bare_v = id_n.startsWith('/@id/') ? id_n.slice(5) : id_n;

		const portable_entry =
			id_n.endsWith('.svelte') && is_island_path(bare_v) && registry.get(bare_v)?.portable === true;
		if (
			id_n.endsWith('.svelte') &&
			is_script_request(id) &&
			(!is_island_path(bare_v) || portable_entry) &&
			(this.#region_reading(bare_v, 'svelte') === 'always' || ctx.has_island_hint(code))
		) {
			const result = this.transform(out, id_n, { ssr }) as TransformResult | null;
			if (result) {
				this.#register(result, id_n);
				this.#mark_registered_closures(result);
				out = result.code;
				chain.step(result_map(result));
				touched = true;

				if (ctx.is_build && !ssr) {
					for (const isl of result.islands ?? []) {
						const kind = isl.kind ?? (isl.server ? 'defer' : 'hydrate');
						if (kind !== 'hydrate' || !isl.virtualPath || leg.island_entry_refs.has(isl.id))
							continue;
						this.emit_island_entry(leg, emitFile, isl.id, isl.virtualPath);
					}
				}
				if (ctx.is_build && ssr) this.#emit_late_server_regions(leg, emitFile, result);
			}

			if (!id_n.startsWith(ctx.pkg_root)) {
				const registration = svelte_module_registration(out, id_n, root);
				if (registration !== null) edit([registration]);
			}
		}

		const nm_ts =
			id_n.endsWith('.ts') || id_n.endsWith('.js') || id_n.endsWith('.mjs')
				? id_n.includes('/node_modules/')
				: null;
		if (
			nm_ts === true &&
			!id_n.startsWith(ctx.pkg_root) &&
			!ctx.in_declared_pkg(id_n) &&
			ctx.has_island_hint(out) &&
			ctx.has_marked_import(out, id_n)
		) {
			warn_undeclared_pkg_marks(id_n);
		}
		if (
			nm_ts !== null &&
			this.#region_reading(id_n, 'script') === 'always' &&
			!is_island_path(id_n)
		) {
			const result = this.ts_regions(out, id_n) as TransformResult | null;
			if (result) {
				this.#register(result, id_n);
				this.#mark_registered_closures(result);
				if (ctx.is_build && ssr) this.#emit_late_server_regions(leg, emitFile, result);
				out = result.code;
				chain.step(result_map(result));
				touched = true;
			}

			if (!id_n.startsWith(ctx.pkg_root)) {
				const registered = appendTransportRegistrations(out, id_n, root);
				if (registered !== null)
					edit([{ start: out.length, end: out.length, text: registered.slice(out.length) }]);
			}
		}

		if (
			!ssr &&
			island_graph.has(id_n) &&
			(id_n.endsWith('.svelte') || SCRIPT_MODULE_RE.test(id_n))
		) {
			const shims = [...out.matchAll(APP_SHIM_IMPORT)].map((m) => ({
				start: m.index,
				end: m.index + m[0].length,
				text: JSON.stringify(ctx.app_shims[`$app/${m[2]}`])
			}));
			if (shims.length) edit(shims);
		}

		if (
			ssr &&
			!id.includes('?') &&
			id_n.endsWith('.svelte') &&
			!is_island_path(bare_v) &&
			(!in_node_modules || ctx.in_declared_pkg(id_n))
		) {
			const stamps = opaque_stamp_edits(out, id_n);
			if (stamps.length) edit(stamps);
		}

		return touched ? { code: out, map: chain.result(id_n) } : null;
	}

	/** The fn-manifest for the build handoff (tag → factory source), sorted by tag. */
	fn_manifest(): Record<string, string> {
		return Object.fromEntries(fn_manifest_entries(this.dollar_hoists));
	}

	/**
	 * A finished chunk with its relocation tokens replaced from the final records (every transform has
	 * run by renderChunk, and the graph is complete), each patch counted on the leg
	 * (link/relocations.ts). `null` when the chunk carries none.
	 */
	relocate(
		code: string,
		leg: Pick<BuildLeg, 'server' | 'relocated' | 'late_server_regions'>,
		bundle: Pick<RelocateCx, 'graph' | 'module_ids' | 'chunk_file' | 'file_name' | 'facade_file'>
	): { code: string; map: SourceMap | null } | null {
		const ctx = this.#ctx;
		const out = relocate(code, relocations_of(leg.server), leg.relocated, {
			program: this.program,
			public_url: (iid) => ctx.island_public_url(iid),
			late_server_regions: leg.late_server_regions,
			chunk_file: bundle.chunk_file,
			file_name: bundle.file_name,
			facade_file: bundle.facade_file,
			graph: bundle.graph,
			module_ids: bundle.module_ids,
			page_reads: ctx.page_reads,
			runtime_url: () => ctx.runtime_chunk_url(this.server_runtime().feature_hash)
		});
		if (out === null) return null;
		const { s, mapped } = out;
		return { code: s.toString(), map: mapped ? s.generateMap({ hires: true }) : null };
	}

	/** True when `file` is a registered island HOST (a component that declares islands). */
	is_registered_host(file: string): boolean {
		const { host_index, registry } = this.program;
		return (
			host_index.has(host_key(file)) ||
			[...registry.values()].some((e) => same_module_path(e.hostPath, file))
		);
	}

	/**
	 * Drop the cached virtual island modules + the registry rows for `file` — call when a HOST changes
	 * (an import-target rename keeps the same island id) or an ENTRY component is deleted (NOT on ordinary
	 * entry-component content edits — those are soft HMR). Mutates the Program; `invalidate` is the
	 * bundler's module-invalidation (Vite's moduleGraph), threaded in. Returns whether anything changed.
	 */
	invalidate_for_file(
		file: string,
		{ deleted = false, invalidate }: { deleted?: boolean; invalidate: (id: string) => void }
	): boolean {
		const { registry, host_index } = this.program;
		const affected = new Set<string>();

		if (this.is_registered_host(file)) {
			for (const vpath of island_vpaths_affected_by_file(file, registry.entries())) {
				affected.add(vpath);
			}
			const prev = host_index.get(host_key(file));
			if (prev) for (const vpath of prev.vpaths) affected.add(vpath);
			this.program.unregister_host(file);
		}

		if (deleted) {
			const kind = this.#scans(file);
			if (kind) this.#scan_facts(path.normalize(file), null, kind);
			for (const id of this.moved()) invalidate(id);
			for (const vpath of this.program.drop_component(file)) affected.add(vpath);
		}

		if (affected.size === 0) return false;

		for (const vpath of affected) invalidate(vpath);
		for (const id of this.changed('regions')) invalidate(id);
		return true;
	}
}
