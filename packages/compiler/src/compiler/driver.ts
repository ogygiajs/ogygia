/**
 * The `Compiler` — the driver / long-lived compile session. It holds the `Program` (cross-file
 * linker), the resolved `CompileCtx`, and the per-file transform cache, and exposes the file-local
 * front-end as one call: `transform(source, id)` → parse ▸ analyze ▸ lower ▸ emit (today fused inside
 * `transformHost`), memoized. It is bundler-agnostic by construction — it imports no Vite; the adapter
 * drives it.
 *
 * The transform cache is content-keyed (`hit.code === source`), so a changed source misses and
 * recomputes on its own; the linker's `unregister_host` deliberately does NOT clear it.
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cache, say } from '@ogygia/machine';
import { fnv1a32, key_label, key_of } from '@ogygia/core/contract';
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
	kit_dirs,
	type FileEvent
} from './kit.ts';
import { run_module_macros } from './macros/pipeline.ts';
import { fn_manifest_entries } from './macros/dollar.ts';
import { is_script_request } from './script-request.ts';
import { resolveFeatures } from './link/runtime-entry.ts';
import { resolveFoucImportSpec, FOUC_CSS_PREFIX, FOUC_SCOPED_PREFIX } from './fouc-css.ts';
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
import { by_key, location_map_files } from './link/location-map.ts';
import { context_keys } from './link/context-detect.ts';
import { own_reach, reaches_context, reaches_wire } from './link/own-reach.ts';
import { router_css_roots } from './link/router-css.ts';
import type { SourceMap } from 'magic-string';
import { relocate, relocations_of, type RelocateCx } from './link/relocations.ts';
import { same_module_path, island_vpaths_affected_by_file } from './dev/hmr.ts';
import { VirtualTable } from './virtual/resolver.ts';
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
import { mentions_page_store, page_data_keys_answer } from './link/page-keys.ts';
import {
	export_names,
	registry_client_id,
	registry_client_path,
	registry_client_source,
	registry_stub_source,
	static_script_specs
} from './link/registry-stub.ts';
import { island_host_loaded } from './link/emit-gate.ts';
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

/** A file-local transform result: the Vite `{ code, map }` plus the descriptors the linker registers. */
type TransformResult = RegisterResult & { code: string; map: unknown };

function result_map(result: TransformResult): StepMap {
	const map = result.map;
	return map ? () => map as SourceMapInput : null;
}
/** The chunk names our content-hashed entries are emitted under (`entry_file_pattern` keys on them). */
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

/** What one build learned, from its scan to what it emitted: made new when a build begins
 *  (`Compiler.start_leg`) and never carried into the next one (test/second-build.test.ts). Dev is one
 *  build for the whole session. */
interface Build {
	/** The legs (bundler environments) that started in this build, by environment name. */
	readonly legs: Map<string, BuildLeg>;
	/** A leg began this build (`start_leg`): its once-per-build work ran. */
	begun: boolean;
	readonly program: Program;
	readonly transform_cache: Map<string, { code: string; result: unknown }>;
	/** Every `import.meta.og.$` hoist (tag → factory source). */
	readonly dollar_hoists: Map<string, string>;
	/** The finished scan, once `prescan` ran. */
	scan: Scan | null;
	/** The server-router component roots, once the scan is complete (build only). */
	router_css_roots: string[] | null;
	/** The registry-reach walk's answers: one resolution, read and verdict per module. */
	readonly resolve_memo: Map<string, string | null>;
	readonly reach_memo: Map<string, boolean>;
	readonly specs_memo: Map<string, readonly string[]>;
	/** Files the island-closure walk has already read (`mark_island_closure`): a closure marked at
	 *  prescan is never re-walked when a later island shares it. The build's, like the island graph
	 *  it fills (test/watch-island-closure.test.ts). */
	readonly island_closure_seen: Set<string>;
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
	router_css_roots: null,
	resolve_memo: new Map(),
	reach_memo: new Map(),
	specs_memo: new Map(),
	island_closure_seen: new Set()
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
/** A Kit route option module (`+page.ts`, `+layout.js`, …) — the page node's own client modules
 *  beside its component (kit.ts `is_route_component`). */
const ROUTE_HOST_FILE_RE = /^\+(page|layout)\.(ts|js|mjs)$/;
/** The real binding modules a host imports for a marked region (ids.ts `regionBindingVirtualId`,
 *  `wrapperVirtualId`). */
const REGION_BINDING_PREFIX = region_family('binding');
const WRAPPER_PREFIX = region_family('wrapper');
/** A `.ts`/`.js` module that can be a region registry (a minted `.ts` region host). */
const TS_REGISTRY_EXT_RE = /\.(ts|js|mjs)$/;
/** A Svelte rune module (`.svelte.ts` / `.svelte.js`). */
const SVELTE_RUNE_MODULE_RE = /\.svelte\.(ts|js)$/;
/** The plugin-context resolver the client-leg registry decision walks import edges with. */
type RegistryResolve = (
	source: string,
	importer: string,
	opts: { skipSelf: boolean }
) => Promise<{ id: string } | null>;
/** A script module the seed-shaping analysis parses with oxc (`.svelte.ts` included). */
const SCRIPT_MODULE_RE = /\.(?:[cm]?[jt]sx?)$/;
const SOURCE_EXT_RE = /\.(svelte|ts|js|mjs|cjs)$/;
const SERVER_MODULE_EXT_RE = /\.(server|remote)\.(ts|js|mjs)$/;
const SERVER_DIR_RE = /\/(src\/lib\/server|server)\//;
/** Static import / export-from / `import()` specifiers, for the island-graph dep walk (shared `g`
 *  regex — `walk_dep` resets `lastIndex` before each scan). */
const IMPORT_SPEC_G =
	/\bfrom\s*['"]([^'"\n]+)['"]|\bimport\s*['"]([^'"\n]+)['"]|\bimport\s*\(\s*['"]([^'"\n]+)['"]/g;
// THE PAGE MARK (link/runtime-entry.ts `page`), from the island-closure walk: which imports island
// code can make without reaching Kit's page world. Everything else under `$app/`, any package but
// Svelte, and anything the walk cannot resolve or read counts as a reader: over-inclusion ships the
// page seed's runtime for nothing, a miss would leave an island's `page.data` empty.
// static: the two `$app/` modules that never read Kit's page
const PAGE_FREE_APP_MODULES = new Set(['$app/environment', '$app/paths']);
const ASSET_EXTS =
	'css|scss|sass|less|styl|pcss|postcss|json|svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|txt|wasm|mp4|webm|mp3|wav';
const ASSET_EXT_RE = new RegExp(`\\.(?:${ASSET_EXTS})$`, 'i');
const PAGE_FREE_UNRESOLVED_RE = new RegExp(
	`^svelte(?:\\/[\\w/-]+)?$|\\.(?:${ASSET_EXTS})(?:\\?[^/]*)?$`,
	'i'
);
/** The extensions an extension-less island import may resolve to (bare, then index files). */
const ISLAND_DEP_EXTS = ['', '.svelte', '.ts', '.js', '.svelte.ts', '.svelte.js', '.mjs'];

// Import/export-from specifier extraction for the router-css closure (link/router-css.ts). A cheap
// regex over raw source — a stray match in a comment/string just fails to resolve later, harmless.
// Runs once per file in the prescan walk; module-level so it compiles once.
const MODULE_SPEC_RE =
	/(?:^|[\n;])\s*(?:import|export)\b[^;'"()]*?from\s*['"]([^'"]+)['"]|(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g;
/** Where Kit's `$app` alias points (Kit 2 and 3: `resolve.alias` `$app` → `<kit>/src/runtime/app`). */
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
/** A prescanned module's identity: package-relative in declared files, root-relative else. */
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

/** First-party packages with a build half an app turns on by listing their plugin: importing one
 *  without the plugin is said once (packages/flags/test/inventory-build.test.ts). */
// static: the first-party plugins whose package an app's modules import
const PLUGIN_PACKAGES: Readonly<Record<string, string>> = { '@ogygia/flags': 'flags()' };
/** Each unlisted package is said once per process (Kit builds two legs in one). */
const unlisted_said = say();
function extract_module_specs(src: string): string[] {
	MODULE_SPEC_RE.lastIndex = 0;
	const specs: string[] = [];
	let m: RegExpExecArray | null;
	while ((m = MODULE_SPEC_RE.exec(src))) specs.push(m[1] ?? m[2]);
	return specs;
}

// one shared FNV-1a-32 (contract/hash.ts is the pure, import-anywhere home)
const fnv = fnv1a32;

/** Once per module id: a dependency file carries ogygia marks but its package declares no
 *  `ogygia.files` — the marks are then silently inert (a `with { }` attribute is valid syntax,
 *  it just never rewrites), which is the worst way to fail. Say it loudly, once. */
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
	 * answers are read afresh from there.
	 */
	start_leg(name: string, server: boolean): boolean {
		if (this.#build.legs.has(name) && this.#ctx.is_build)
			this.#build = new_build(this.#build.program.fresh());
		const build = this.#build;
		if (!build.legs.has(name)) build.legs.set(name, new_leg(name, server));
		if (build.begun) return false;
		build.begun = true;
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
		const leg = env !== null ? legs.get(env) : open.length === 1 ? open[0] : undefined;
		if (leg?.life.now.kind === 'open') leg.life.go('closed');
	}

	/**
	 * DEV, after each transform: the virtual modules whose last load read something (the registry,
	 * the marks, a fold over the files' scan facts) that has since changed, for the adapter to
	 * invalidate. One rule for every reader: the server manifest emitted while a host's rows were
	 * dropped for its edit (every hole answered 403 until a restart), the runtime entry chosen before
	 * a page's first `idle` region (it never woke: test/dev-regions-reload.test.ts), and the wire
	 * loaders, Kit's codecs and the router CSS roots read before a file's facts changed
	 * (test/dev-scan-facts.test.ts).
	 */
	moved(): string[] {
		return this.#virtuals.moved();
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
		return kit_dirs(this.#ctx.root).routes_dir;
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
		const routesDir = kit_dirs(ctx.root).routes_dir;
		const is_layout_host = is_route_component(path.basename(id), 'layout');
		const link_virtual =
			link_override !== undefined
				? link_override
				: ssr ||
					!routeCsrIsFalse(ctx.routes, id, routesDir) ||
					(is_layout_host && hasAnyCsrTrueRoute(ctx.routes, routesDir));
		const route_csr = routeCsrIsTrue(ctx.routes, id, routesDir)
			? true
			: routeCsrIsFalse(ctx.routes, id, routesDir)
				? false
				: undefined;
		const key = `${link_virtual ? '1' : '0'}\0${route_csr === true ? 't' : route_csr === false ? 'f' : 'n'}`;
		return { link_virtual, route_csr, key };
	}

	/** A compile session, made once the bundler has resolved the build (`ctx`): nothing runs before
	 *  its context exists. */
	constructor(program: Program, profiler: Profiler, ctx: CompileCtx) {
		this.#build = new_build(program);
		this.profiler = profiler;
		this.#ctx = ctx;
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
	 * Lower one file: run the fused parse ▸ analyze ▸ lower ▸ emit front-end and register nothing —
	 * the caller registers the returned descriptors into the `Program`. Memoized per
	 * `(id, ssr, linkVirtual, routeCsr)`, content-gated on the source.
	 */
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
		// No depth ceiling — snippet-in-snippet nests as deep as an app cares to go. The only thing to
		// guard against is a registry cycle, and a visited set does that exactly.
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
		// `ssr` joins the key because transformHost output legitimately differs by pass — the client
		// build side-effect-imports fouc-css for a lake binding (its scoped CSS is on no client chunk),
		// the SSR build must not. Without `ssr` here a layout+csr=true host (where ssr and client share
		// `link_virtual`) would reuse the SSR result on the client and drop that CSS link.
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
			linkVirtualIsland: link_virtual,
			clientBindingStub: CLIENT_BINDING_STUB,
			routeCsr: route_csr,
			ssr
		});
		if (P) {
			prof.transformMs += performance.now() - th0;
			prof.transformN++;
			outHash.set(cache_key, fnv(JSON.stringify((result as { code?: unknown })?.code ?? result)));
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
			pkg_identity: (abs: string) => ctx.pkg_identity(abs)
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
		const { registry, island_graph, runtime_marks } = program;
		const root = ctx.root;

		const src_dir = path.join(root, 'src');
		clean_stale_ogygia_dirs(src_dir);
		// PLUGIN READERS (`b.prescan`): each module importing what one asked for is handed to it; a
		// first-party package imported with its plugin not listed is noted, and said at the end.
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
		const scan_file = (full: string, name: string) => {
			const kind = scan_kind(name);
			if (!kind) return;
			const src = ctx.read_file(full);
			if (src == null) return;
			say_one_off_keys(full, src, kind);
			read_for_plugins(full, src, this.#scan_facts(full, src, kind));
			if (kind === 'svelte') {
				const result = this.transform(src, full);
				if (result) program.register(result, full);
			} else {
				// `.ts` / `.js` region mints (load / remote functions). Discover them up front so a
				// deferred region's server-manifest entry exists before the endpoint is ever hit —
				// lazy transform order would otherwise leave the id missing (403 on first fetch).
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
					scan_file(full, entry.name);
				}
			}
		};
		{
			const __ps = P ? performance.now() : 0;
			walk(src_dir);
			// Extra island roots beyond the app's src (e.g. the profiler UI, `ogygia({ profiler: true })`):
			// server-only library components whose client hydrate chunks only build if the prescan — which
			// runs in both build legs — registers them here. Same `walk`, so same iid ⇒ the SSR shell's
			// `entry` matches the chunk this emits.
			// Declared compile surfaces beyond src (`"ogygia": { "files": […] }` in a DEP's
			// package.json; ogygia's own profiler UI rides the same rail as an internal entry):
			// the same walk/scan as app src, so a library island gets everything an app island gets
			// (feature marks, deferred manifests, wired classes, router-css specs) and both build
			// legs mint the same iids. Only DECLARED packages, only their DECLARED paths.
			for (const p of ctx.pkg_scan) {
				for (const d of p.dirs) walk(d);
				for (const f of p.files) scan_file(f, f.slice(f.lastIndexOf('/') + 1));
			}
			// Page modules named by path (`b.pageModules({ files })`): roots whatever they import. One the
			// walks above did not reach still needs its import specs for the closure.
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

		// Complete `island_graph` TRANSITIVELY, before the bundler resolves a single module. `walk`
		// above registered each island's OWN component; this marks everything those components import
		// (and what THOSE import, …) as island code too — so the `$app/*` shim decision is DETERMINISTIC
		// rather than a build-order race. Without it, a component shared between an island and a
		// non-island route is marked lazily during Rolldown's own walk: if its `$app/*` (or its
		// transform) resolves before the island path marks it, it keeps Kit's real client store — which
		// under `csr = false` is never populated → `page.url` undefined → the island crashes at hydrate.
		// (This is the race the `?og-region` module-id fork tried to fix; that fork broke Svelte's
		// scoped-CSS emission, so membership rides OUTSIDE the module id here — the walk only READS.)
		//
		// PERF: strictly O(reachable modules) — see `mark_island_closure`: one shared `seen` set for
		// the life of the program, so each file is read and scanned exactly once, never re-descended.
		{
			const __ws = P ? performance.now() : 0;
			for (const entry of registry.values()) {
				if (entry.componentPath) this.mark_island_closure(entry.componentPath);
			}
			if (P) prof.prescanMs += performance.now() - __ws;
		}

		// CONTEXT-BOUNDARY diagnostic: an island (or a component inside it — the whole island closure) that
		// READS a string-keyed `getContext(…)` for a key nothing in the island's own code SETS, while this
		// app registers NO ogygia context provider. On a csr=false page the page/layout `<script>` never
		// runs on the client, so a value set with Svelte's own `setContext` in a page/layout is gone by the
		// time the island hydrates in isolation — the island reads `undefined`, renders a different tree,
		// and Svelte silently discards its server DOM on hydration (`data-og-recovered`). Naming it here
		// turns that silent discard into a build-time pointer at the fix.
		//
		// Precision: gated to "no ogygia bridge at all" (`!runtime_marks.context`) so it never false-warns
		// an app that DOES bridge (there a matching provided key resolves); and a key the island's OWN code
		// both sets and reads (a component library using context WITHIN one hydration root) is subtracted
		// out, since that needs no bridge. The runtime recovery diagnostic covers the partial-bridge case.
		// Reads are cache hits — the closure walk already read these files.
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
					if (island_set.has(key)) continue; // the island provides it itself, within one root
					warn('island_context_unprovided', {
						file: path.relative(root, file),
						key: key_label(key_of(key))
					});
				}
			}
		}

		// The page seed and the MPA navigation handle are for island code that reaches Kit's page world
		// (the closure walk above). Islands the walk never saw count as readers: a federated peer's,
		// hydrated by this app's runtime against this page, and whatever a plugin's browser half wakes.
		// A federated app's page carries a peer's regions, whatever its own are (`foreign`).
		runtime_marks.foreign = ctx.foreign_hydrate;
		runtime_marks.page =
			program.island_reads_page || runtime_marks.foreign || ctx.client_plugins.length > 0;
		// prescan walked every host — the capability marks are now COMPLETE, so the generated sticky
		// runtime entry can bundle only the features this app uses (else it stays kitchen-sink).
		runtime_marks.complete = true;
		// Fold the resolved feature set into the runtime chunk name so it busts when the emitted bytes
		// change (see `runtime_chunk_filename`). Deterministic across both build legs (same prescan).
		return {
			feature_hash: createHash('sha256')
				.update(resolveFeatures(runtime_marks).join(','))
				.digest('hex')
				.slice(0, 8)
		};
	}

	/** The scan's feature hash; empty before the scan ran. */
	get #feature_hash(): string {
		return this.#build.scan?.feature_hash ?? '';
	}

	/**
	 * Mark `componentAbs` and EVERYTHING it imports (transitively) as island code, so the `$app/*`
	 * shim decision for each of those modules is DETERMINISTIC — before the bundler resolves a single
	 * one of them. A module shared between an island and a non-island route is otherwise marked lazily
	 * during the bundler's own walk: if its `$app/*` resolves before the island path reaches it, it
	 * keeps Kit's real client store — which under `csr = false` is never populated → `page.url`
	 * undefined, `page.data` empty → the island crashes or reads nothing at hydrate. Shimming it is
	 * right in both worlds: on a Kit-booted document the shim reads Kit's real page (the kit-page
	 * thread). (The `?og-region` module-id fork was tried and reverted — it broke Svelte's scoped-CSS
	 * emission; membership rides OUTSIDE the module id here, the walk only READS.)
	 *
	 * Follows relative, `$lib` AND the app's aliases (`kit.alias` / `resolve.alias` — a customer's
	 * `$lib_x/utils/boot` import was where the walk used to stop, and its `$app/state` went to whichever
	 * page loaded first). Bare package specifiers stop it; the lazy resolveId marking stays their
	 * backstop. Called at prescan for every island, and again in dev for an island registered by a
	 * later transform (a file added while the server runs). Returns the modules marked for the first
	 * time by this call, so a dev caller can drop their cached transforms.
	 */
	/** DEV: modules `mark_island_closure` marked for the first time AFTER prescan — an island a later
	 *  transform registered (a file added while the server runs). Each may already sit in the dev
	 *  server's module graph, transformed with Kit's real `$app/*` for a non-island importer; the
	 *  plugin drains this list and drops those cached transforms so the next load re-resolves them. */
	#closure_added: string[] = [];

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

	mark_island_closure(componentAbs: string): string[] {
		const ctx = this.#ctx;
		const { island_graph } = this.program;
		const aliases = ctx.resolve_alias;
		const added: string[] = [];
		const resolve_dep = (spec: string, importerAbs: string): string | null => {
			const base = resolveFoucImportSpec(spec, importerAbs, ctx.libDir, aliases);
			if (!base) return null; // a bare package specifier — the lazy resolveId marking is the backstop
			for (const ext of ISLAND_DEP_EXTS) if (ctx.fs.stat(base + ext) === 'file') return base + ext;
			for (const ext of ISLAND_DEP_EXTS.slice(1)) {
				const idx = path.join(base, `index${ext}`);
				if (ctx.fs.stat(idx) === 'file') return idx;
			}
			return null;
		};
		const walk = (abs: string) => {
			const norm = strip_id(abs);
			const seen = this.#build.island_closure_seen;
			if (seen.has(norm)) return;
			seen.add(norm);
			if (!island_graph.has(norm)) {
				island_graph.add(norm);
				added.push(norm);
			}
			if (!SOURCE_EXT_RE.test(norm)) {
				// a module this walk does not read (markdown, a JSX file): it may read the page
				if (!ASSET_EXT_RE.test(norm)) this.program.island_reads_page = true;
				return;
			}
			const src = ctx.read_file(norm);
			if (src == null) return;
			IMPORT_SPEC_G.lastIndex = 0;
			let m: RegExpExecArray | null;
			while ((m = IMPORT_SPEC_G.exec(src))) {
				const spec = m[1] || m[2] || m[3];
				if (!spec || spec[0] === '\0') continue;
				if (spec.startsWith('$app/')) {
					if (!PAGE_FREE_APP_MODULES.has(spec)) this.program.island_reads_page = true;
					continue;
				}
				if (spec.startsWith('$env/') || is_generated_specifier(spec)) continue;
				const dep = resolve_dep(spec, norm);
				if (dep) walk(dep);
				// A package or an import this walk cannot resolve may read the page; Svelte and assets cannot.
				else if (!PAGE_FREE_UNRESOLVED_RE.test(spec)) this.program.island_reads_page = true;
			}
		};
		walk(componentAbs);
		return added;
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
		const { registry, region_kinds } = this.program;
		const out = new Set<string>();
		const add = (p: string | null | undefined) => {
			if (!p) return;
			const abs = strip_id(p);
			if (!SOURCE_EXT_RE.test(abs)) return; // only what the scanner can parse
			if (this.#ctx.fs.stat(abs) === 'file') out.add(abs);
		};
		for (const entry of registry.values()) {
			if (entry.role !== 'entry' || entry.server) continue;
			if (region_kinds.get(entry.id) !== 'hydrate') continue;
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

	/**
	 * Client-build chunk emit (via the injected `emitFile`): the feature-selected runtime entry (when
	 * `emitRuntime`), then one chunk per deduped HYDRATE region id. IDENTITY vs LOCATION: SSR bakes the
	 * stable name (`island_public_url`) as the region's identity; the file the browser loads is named
	 * by its content (the bundler hashes it), and the bundle end hands the stable → hashed map to the
	 * server (the handoff's `entries`) and to the browser (the location maps).
	 * csr=false hosts omit wrapper imports so this emit owns the module. Idempotent per id.
	 */
	/** The server-router component roots (link/router-css.ts). Build: prescan is complete before any
	 *  consumer runs — memoized for the build. Dev: modules appear lazily (HMR), recompute per call. */
	router_css_roots(): string[] {
		const ctx = this.#ctx;
		const build = this.#build;
		if (ctx.is_build && build.router_css_roots) return build.router_css_roots;
		// One path for ALL page modules (`b.pageModules()`) — app source AND declared surfaces: an
		// importer of a page specifier is detected by the prescan wherever it lives, a named file joins
		// directly (the profiler's router). The walk's recursion is bounded by prescanned module_specs,
		// so profiler-router's type-import of `./index.js` dead-ends instead of dragging the host graph in.
		const roots = new Set(
			router_css_roots(
				this.program.router_modules,
				this.program.module_specs,
				ctx.libDir,
				(p) => ctx.fs.stat(p) === 'file'
			)
		);
		const sorted = [...roots].sort();
		if (ctx.is_build) build.router_css_roots = sorted;
		return sorted;
	}

	/** Does the program hold ANY hydrate island? The runtime-emission gate needs this because
	 *  `hasAnyCsrFalseRoute` only inspects Kit PAGE leaves — an app whose islands live solely in
	 *  router-rendered components (a pure-router / fragment-only service has ZERO `+page` files)
	 *  answers "no csr=false page" while its documents still `<script src>` the runtime. */
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
		return out.sort((a, b) => (a.iid < b.iid ? -1 : a.iid > b.iid ? 1 : 0));
	}

	/** The public URL key a server island's CSS is handed off under (matches `island_url[id]`). */
	island_public_url(iid: string): string {
		return this.#ctx.island_public_url(iid);
	}

	has_hydrate_regions(): boolean {
		for (const kind of this.program.region_kinds.values()) if (kind === 'hydrate') return true;
		return false;
	}

	/** The server leg's real module graph, for the client-leg handoff (link/emit-gate.ts). */
	ssr_transformed_hosts(): string[] {
		return [...this.program.ssr_transformed].sort();
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
			// Unresolved virtual id — resolve_id/emit synthesize the feature-selected entry. Named, not
			// fixed: the bundler hashes its content into the file name (its imports included), and the
			// server finds that name in the build handoff (its stable name is an identity, not a file).
			// (named with its features: `og-runtime-<features>.<hash>.js` says which runtime it is)
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
		// by island id: the bundler emits entries in no stable order, and the handoff is output (#490)
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

	/** One hydrate island's entry, content-hashed by the bundler (the location maps that name it are
	 *  written at the bundle's end: `location_maps`). */
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
	 * value threaded in here (the `universalHooks` path).
	 */
	emit(
		id: string,
		leg: Leg
	): string | { code: string; moduleSideEffects: false } | Promise<string> | null {
		const ctx = this.#ctx;
		const program = this.program;
		const { ssr } = leg;

		const registry_client = registry_client_path(id);
		if (registry_client) return this.#registry_client_emit(registry_client);

		const declared = this.#virtuals.load(id, this, leg);
		if (declared !== null) {
			// (a module of definitions only: unused, the bundler drops it and what it imports)
			if (typeof declared === 'string' && this.#virtuals.side_effect_free(id))
				return { code: declared, moduleSideEffects: false };
			return declared;
		}

		const srcEntry = program.registry.get(id);
		if (srcEntry && srcEntry.role === 'region') {
			// Leg-split: SSR gets the signer-carrying descriptor, client gets metadata only.
			return ssr ? srcEntry.ssrSource! : srcEntry.clientSource!;
		}
		if (srcEntry) {
			// A wake island's WRAPPER is leg-split too: the client leg imports its component through
			// the lazy module (emit.ts `island_wrapper_client_source`), the SSR leg the real entry.
			let src = !ssr && srcEntry.clientSource ? srcEntry.clientSource : srcEntry.source!;
			// An island entry's FOREIGN-HYDRATE exports exist for another app's runtime: never on the
			// server, and only when a plugin asks for them (`b.foreignHydrate()`: federation). Every
			// island of every other app carried them otherwise, and their imports: ~185 B gz and a
			// preload each.
			const foreign = src.indexOf(FOREIGN_HYDRATE_MARK);
			if (foreign !== -1 && (ssr || !ctx.foreign_hydrate)) src = src.slice(0, foreign);
			// CLIENT build: rewrite `$app/*` in the GENERATED virtual source to absolute
			// shim paths (defense in depth alongside resolveId island-graph shimming).
			// SSR keeps the real Kit modules (correct server-rendered page.data).
			if (!ssr) {
				src = src.replace(APP_SHIM_IMPORT, (_m: string, _q: string, name: string) =>
					JSON.stringify(ctx.app_shims[`$app/${name}`])
				);
				// LAKES: swap each lake import for the render-nothing placeholder so the lake
				// component's JS is excluded from this island's client chunk. Handles default
				// (`import Lake from '…'`) and named (`import { Lake } from '…'`) forms.
				for (const local of srcEntry.lakes ?? []) {
					src = rewrite_lake_import_to_placeholder(src, local, ctx.client_binding_stub_file);
				}
			}
			return src;
		}
		return null;
	}

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
			resolve
		}: {
			ssr: boolean;
			resolve: (
				source: string,
				importer: string,
				opts: { skipSelf: boolean }
			) => Promise<{ id: string } | null>;
		}
	): Promise<string | { id: string } | null> {
		const ctx = this.#ctx;
		const { registry, island_graph } = this.program;

		// the declared modules (./virtual/core.ts); an undeclared id in the namespace fails here, and
		// so does a module of a realm this leg may not import
		const declared = this.#virtuals.resolve(source, { ssr, dev: ctx.is_dev });
		if (declared) return declared;
		// csr=false client hosts rewrite marked bindings here — not a hydrate entry.
		if (source === CLIENT_BINDING_STUB) return ctx.client_binding_stub_file;
		// …and so does a csr=false route host that could not pick its leg itself: a markup source
		// (content's markdown) runs the region transform in the preprocessor, before the compile knows
		// which leg it is on, so it always links the real binding. On the CLIENT leg of a build that
		// binding pulled Region and every island wrapper into Kit's client graph of a page Kit never
		// boots, and the modules that graph shares with the islands (Svelte's above all) shipped to
		// every island page with all of Region's uses in them. It resolves to the stub a `.svelte` host
		// links there.
		if (
			!ssr &&
			ctx.is_build &&
			importer &&
			(source.startsWith(REGION_BINDING_PREFIX) || source.startsWith(WRAPPER_PREFIX)) &&
			this.#links_client_stub(importer)
		)
			return ctx.client_binding_stub_file;
		// CSS-only FOUC graph (no component JS) for csr=false client stubs.
		if (source.startsWith(FOUC_CSS_PREFIX) || source.startsWith(FOUC_SCOPED_PREFIX)) {
			return RESOLVED(source);
		}

		// csr=false CLIENT leg of a BUILD: a route host's import of a `.ts`/`.js` REGION REGISTRY
		// resolves to the registry with its MARKS blanked (link/registry-stub.ts). The marked wrappers
		// would otherwise drag every component + its CSS into the page node's client graph, and Kit
		// links `node.stylesheets` for all of it, rendered or not — the render pass already links what
		// renders. Its PLAIN imports keep their edges: nothing else links their CSS. The registry
		// module itself stays real for csr=true hosts and the island world.
		const registry_stub = await this.#registry_stub_for(source, importer, { ssr, resolve });
		if (registry_stub) return registry_stub;

		// Island CLIENT graph: shim `$app/*` for the virtual module AND every module it
		// pulls in (e.g. `$lib/PageUrlProbe.svelte` importing `$app/state`). Kit's alias
		// would otherwise give islands the uninitialized Kit page (`new URL('a:')` → empty
		// pathname). enforce:'pre' wins over Kit's resolveId. SSR keeps real Kit modules.
		const importer_id = importer ? strip_id(importer) : undefined;
		const from_island = importer_id && (registry.has(importer_id) || island_graph.has(importer_id));
		if (!ssr && from_island) {
			const shim = app_shim_for(source, ctx.app_shims);
			if (shim) return shim;
		}

		// Portable wrappers import `ogygia:region/entry/<id>` (and hosts import wrappers).
		// Resolve those BEFORE the "relative to hostPath" branch — that branch uses skipSelf
		// and would bypass this handler, failing to resolve virtual entry ids.
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

		// Virtual island/wrapper module: resolve relative imports to the host file, and mark
		// the resolved id so its own `$app/*` imports hit the shim branch above.
		// Skip ogygia virtual ids (handled above).
		if (importer_id && registry.has(importer_id) && !is_island_path(source)) {
			const host = registry.get(importer_id)!.hostPath ?? '';
			const resolved = await resolve(source, host, { skipSelf: true });
			if (resolved?.id) island_graph.add(strip_id(resolved.id));
			// A BARE specifier a generated island module re-emits (a marked package import like
			// `import TabGroup from 'ogygia/content/tab-group' with { wake: 'load' }`, or a specifier
			// its child synth re-imports) that Vite cannot resolve must fail HERE, loudly — falling
			// through surfaces later as an opaque "Failed to resolve import" with the virtual module
			// as the only context. Relative/absolute/virtual sources keep Vite's own error path.
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
		// Transitive island-graph module (not a virtual entry): mark deps so nested
		// `$app/*` imports stay shimmed. Do NOT resolve island virtual paths via skipSelf.
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

	/** True for a csr=false route host file (`+page`/`+layout` `.svelte`/`.ts`/`.js`). A `+page.ts`
	 *  shares its route's world with the sibling `.svelte` host. */
	/** A route COMPONENT whose client leg links the binding stub — `transform`'s `link_virtual` rule,
	 *  for a host that could not apply it itself: csr=false, and not a layout of an app with a
	 *  csr=true route (Kit can hydrate that layout: a csr=true child page, or an error render). */
	#links_client_stub(importer: string): boolean {
		const importer_abs = strip_id(importer);
		const { root, routes } = this.#ctx;
		const routes_dir = kit_dirs(root).routes_dir;
		if (!importer_abs.startsWith(routes_dir + path.sep)) return false;
		const base = path.basename(importer_abs);
		if (is_route_component(base, 'layout'))
			return (
				routeCsrIsFalse(routes, importer_abs, routes_dir) && !hasAnyCsrTrueRoute(routes, routes_dir)
			);
		return is_route_component(base, 'page') && routeCsrIsFalse(routes, importer_abs, routes_dir);
	}

	#is_csr_false_route_host(importer: string): boolean {
		const importer_abs = strip_id(importer);
		const { root, routes } = this.#ctx;
		const routes_dir = kit_dirs(root).routes_dir;
		if (!importer_abs.startsWith(routes_dir + path.sep)) return false;
		const base = path.basename(importer_abs);
		// a route component (`+page.svelte`, `+page.md`, …) is its own host
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
		// One resolution per (importer, specifier) per build: resolution is deterministic within a
		// build, and every csr=false host and every walked module asks again otherwise.
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
		} catch {
			return null; // ok: an edge the resolver refuses is not forked: the real module stays (bytes, never a missing style); the bundler reports the import
		}
		if (!resolved?.id || resolved.id.startsWith('\0')) return null;
		const target = strip_id(resolved.id);
		if (!TS_REGISTRY_EXT_RE.test(target) || this.#ctx.fs.stat(target) === null) return null;
		// Kit owns these on the client: a `.remote.ts` becomes Kit's fetch stub there (its imports
		// never reach the client graph, and Kit keys its metadata on the exact file id), and a
		// server-only module is refused outright. Neither may fork, and neither leads anywhere.
		// A `.svelte.ts` rune module is compiled by vite-plugin-svelte, keyed on its file name: it
		// never forks either (a registry behind one stays real — a head cost, never a missing style).
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
			// A finished component rooted here: every file parked above it shares this negative.
			for (let i = parked; i < component.length; i++) reach_memo.set(component[i], false);
			component.length = parked;
			return { reaches: false, low: Infinity };
		}
		// Still depends on a file open above: stay parked until that root finishes.
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
		// Every pass below edits by its parser's offsets, and Svelte's parser drops a leading byte-order
		// mark: take it off here so the offsets and the text agree (./bom.ts). A file no pass touches
		// returns `null` and keeps its bytes.
		code = strip_bom(code);

		// Discover islands before any module is transformed so island_graph is populated
		// even when an island entry component is processed before its host page.
		this.prescan();

		// A csr=false client-leg registry variant (link/registry-stub.ts) exists only for its import
		// EDGES (Kit links its plain imports' CSS); its JS never runs. Its id strips to the real
		// registry's path, so the region pipeline below would re-register that host from the
		// blanked source — leave it exactly as emitted.
		if (registry_client_path(id) != null) return null;

		const id_n = strip_id(id);
		// server leg of a build: this module is in the server bundle's real graph (see
		// Program.ssr_transformed / link/emit-gate.ts)
		if (ssr && ctx.is_build) program.ssr_transformed.add(host_key(id_n));
		if (ctx.is_dev && is_script_request(id)) {
			const kind = this.#scans(id_n);
			if (kind) this.#scan_facts(path.normalize(id_n), code, kind);
		}

		// SEED SHAPING: a module that imports Kit's page store is read ONCE here, on the compiler's
		// parsers, for the top-level `page.data` keys it can reach (link/page-keys.ts). Recorded by
		// the query-less id so the client `writeBundle` can find it from a chunk's `moduleIds`; the
		// source form is what this pre-transform sees, before the `$app/*` shim rewrite below.
		if (ctx.is_build && mentions_page_store(code)) {
			const clean = id.split('?')[0].split('\\').join('/');
			const kind = clean.endsWith('.svelte')
				? 'svelte'
				: SCRIPT_MODULE_RE.test(clean)
					? 'script'
					: null;
			if (kind) {
				const { keys, reason, pending } = page_data_keys_answer(code, clean, kind);
				if (keys !== null) program.page_keys.set(clean, keys);
				if (reason) program.page_key_reasons.set(clean, reason);
				if (pending.length) program.page_pending.set(clean, pending);
				else program.page_pending.delete(clean);
			}
		}

		// (There is deliberately NO csr=false route-client stripping here. Kit collects a route's
		// CSS manifest from the CLIENT graph — stubbing those modules silently drops every component
		// stylesheet from the prerendered pages. Keeping the corpus out of client bundles is the
		// `.server.ts` placement rule's job — see the content-placement warning — and Kit enforces
		// it mechanically; a csr=false page never fetches its route JS anyway, so the dead client
		// nodes cost disk, not wire.)
		let out = code;
		let touched = false;
		const chain = new MapChain();
		const edit = (edits: readonly Edit[]): void => {
			const before = out;
			out = splice_text(before, edits);
			chain.step(() => splice_map(before, edits, id_n));
			touched = true;
		};

		// The `import.meta.og.*` module macros — `wire`/`$`/`source`/`store`/auto-brand, then the
		// plugins' macros (`bake` last) — all landing BEFORE either branch (island transform / svelte
		// compile / ts region minting) sees the code, so a computed codec key is a real symbol, a
		// hoisted fn is a ref, a baked call is plain data, and an inlined snippet flows through as a
		// region. Each pass is a no-op unless its exact marker is present. Fills `dollar_hoists` +
		// records plugin macro timing.
		const macroed = await this.macros(out, id_n, watch);
		if (macroed.touched) {
			out = macroed.code;
			chain.steps(macroed.maps);
			touched = true;
		}

		// App `.svelte` always; a node_modules `.svelte` ONLY if it carries an ogygia hint (so a
		// library can declare its own islands — Shell → ShellBar). `is_island_path` still
		// excludes GENERATED island glue (wrappers, region bindings, plain re-export entries) —
		// but a PORTABLE SNIPPET entry is authored markup (a slice of user source) and MUST be
		// re-processed: its `with { wake }` imports become nested islands, and nested snippets
		// re-portable-ize. Normalize the dev `/@id/` prefix so dev and build take the SAME gate
		// (dev previously transformed these only because the prefix slipped past the exclusion —
		// which is why islands inside snippets worked in dev and died in prod).
		const in_node_modules = id_n.includes('/node_modules/');
		const bare_v = id_n.startsWith('/@id/') ? id_n.slice(5) : id_n;

		const portable_entry =
			id_n.endsWith('.svelte') && is_island_path(bare_v) && registry.get(bare_v)?.portable === true;
		if (
			id_n.endsWith('.svelte') &&
			// the component's script only: `Foo.svelte?svelte&type=style&lang.css` is its CSS (the
			// query is gone from `id_n`, so decide on the full id)
			is_script_request(id) &&
			(!is_island_path(bare_v) || portable_entry) &&
			// declared `ogygia.files` surfaces transform unconditionally (full app-source citizenship);
			// undeclared node_modules `.svelte` keeps the legacy hint sniff
			(!in_node_modules || ctx.in_declared_pkg(bare_v) || ctx.has_island_hint(code))
		) {
			// Pass Vite's ssr flag through — client csr=false hosts omit wrapper links.
			// `out`, NOT `code`: the wire/code/md/bake rewrites above already landed in `out`, and
			// the island transform's result REPLACES it — feeding it `code` would silently discard
			// them for any component the host transform touches (import.meta.og.code in a .svelte
			// stayed un-rewritten and exploded at runtime as `undefined.code`).
			const result = this.transform(out, id_n, { ssr }) as TransformResult | null;
			if (result) {
				this.#register(result, id_n);
				this.#mark_registered_closures(result);
				out = result.code;
				chain.step(result_map(result));
				touched = true;

				// Emit the island entry for any hydrate island discovered HERE
				// that the buildStart prescan couldn't see — i.e. declared inside a library component
				// (host outside the app's `src`). Without this no entry carries its identity: the handoff
				// would have no location for the stable name SSR bakes into `<ogygia-region entry>`.
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

			// A transportable class can live in this component's `<script module>` — register it
			// (same tag scheme, keyed by the `.svelte` path) so it travels like a `.svelte.ts` one.
			if (!id_n.startsWith(ctx.pkg_root)) {
				const registration = svelte_module_registration(out, id_n, root);
				if (registration !== null) edit([registration]);
			}
		}

		// `.ts` / `.js` region minting (load / remote functions): rewrite `with { wake: … }`
		// imports. Runs before rolldown's core transform (enforce:'pre') so the attribute is
		// stripped before it would trip the parser.
		const nm_ts =
			id_n.endsWith('.ts') || id_n.endsWith('.js') || id_n.endsWith('.mjs')
				? id_n.includes('/node_modules/')
				: null;
		// A dependency's `.ts`/`.js` with marks but NO `ogygia.files` declaration would die
		// SILENTLY (the import attribute is valid syntax, it just never rewrites) — say so.
		// (ogygia's OWN modules are exempt: in an installed consumer they live in node_modules and
		// flow through the SSR pipeline (noExternal), and compiler/emit sources legitimately CONTAIN
		// `with { wake` as strings — the hint sniff would warn-spam on every build.) The sniff is only
		// the cheap filter: a plugin package's docs comment, generated-code string or error message
		// that mentions `with { wake }` is no mark, so the parse decides.
		if (
			nm_ts === true &&
			!id_n.startsWith(ctx.pkg_root) &&
			!ctx.in_declared_pkg(id_n) &&
			ctx.has_island_hint(out) &&
			ctx.has_marked_import(out, id_n)
		) {
			warn_undeclared_pkg_marks(id_n);
		}
		if (nm_ts !== null && (nm_ts === false || ctx.in_declared_pkg(id_n)) && !is_island_path(id_n)) {
			const result = this.ts_regions(out, id_n) as TransformResult | null;
			if (result) {
				this.#register(result, id_n);
				this.#mark_registered_closures(result);
				if (ctx.is_build && ssr) this.#emit_late_server_regions(leg, emitFile, result);
				out = result.code;
				chain.step(result_map(result));
				touched = true;
			}

			// Transportable classes: append tag registration for `[ogygia.TRANSPORT]` codecs.
			if (!id_n.startsWith(ctx.pkg_root)) {
				const registered = appendTransportRegistrations(out, id_n, root);
				if (registered !== null)
					edit([{ start: out.length, end: out.length, text: registered.slice(out.length) }]);
			}
		}

		// CLIENT: rewrite `$app/(state|stores|navigation)` inside island entry components — and
		// every other module in the island graph, `.svelte` or script — to absolute shim paths.
		// Absolute paths bypass Kit's `$app/*` alias entirely: Vite's alias plugin resolves `$app/*`
		// BEFORE this plugin's resolveId can, so the specifier must already be the shim's when the
		// module leaves the transform. Script modules used to be skipped here: a `.ts` helper in an
		// island's closure kept Kit's real client page (never booted under csr=false), and a
		// customer's shared boot helper read `page.data.user` as empty inside every public-page
		// island. (csr=true hosts still pass virtual islands as `__component`.)
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

		// SERVER: stamp the elements Svelte's hydration never walks into (compiler/ownership-stamps.ts),
		// so the runtime's repair, drift watch and morph leave a web component's own light DOM there
		// alone. App components, plus those of packages that declared their compile surface; never the
		// generated glue, and never a `?svelte&type=…` sub-request (not markup).
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
			dollar_hoists: this.dollar_hoists,
			public_url: (iid) => ctx.island_public_url(iid),
			late_server_regions: leg.late_server_regions,
			chunk_file: bundle.chunk_file,
			file_name: bundle.file_name,
			facade_file: bundle.facade_file,
			graph: bundle.graph,
			module_ids: bundle.module_ids
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
		const { registry, island_graph, by_id, region_kinds, host_index } = this.program;
		const affected = new Set<string>();

		if (this.is_registered_host(file)) {
			for (const vpath of island_vpaths_affected_by_file(file, registry.entries())) {
				affected.add(vpath);
			}
			const prev = host_index.get(host_key(file));
			if (prev) for (const vpath of prev.vpaths) affected.add(vpath);
			// Host re-registers on next transform; clear so emit() can't serve orphans.
			this.program.unregister_host(file);
		}

		if (deleted) {
			const kind = this.#scans(file);
			if (kind) this.#scan_facts(path.normalize(file), null, kind);
			for (const id of this.moved()) invalidate(id);
			// (a copy: the loop deletes from the registry)
			for (const [vpath, entry] of Array.from(registry.entries())) {
				if (!same_module_path(entry.componentPath, file)) continue;
				affected.add(vpath);
				registry.delete(vpath);
				island_graph.delete(vpath);
				by_id.delete(entry.id);
				region_kinds.delete(entry.id);
				const idx = host_index.get(host_key(entry.hostPath ?? ''));
				if (idx) {
					idx.vpaths.delete(vpath);
					idx.ids.delete(entry.id);
				}
			}
		}

		if (affected.size === 0) return false;

		for (const vpath of affected) invalidate(vpath);
		for (const id of this.changed('regions')) invalidate(id);
		return true;
	}
}
