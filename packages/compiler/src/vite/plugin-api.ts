/**
 * The BUILD side of a plugin (design: internal/notes/packages.md, plugin API v2): `definePlugin` and
 * the build context. Loads in plain node — vite.config imports it before any bundler runs.
 *
 *   export const postrender = (options: PostrenderOptions = {}) =>
 *     definePlugin({
 *       name: '@ogygia/postrender',                    // the package name: the plugin's identity
 *       options,                                        // JSON; reaches the server realm as `app.options`
 *       server: import.meta.resolve('./server.ts'),     // the server realm (`defineServer`)
 *       build(b) { b.routeConfig('postrender'); }
 *     });
 *
 * A plugin IS a Vite plugin: the app lists it beside `ogygia()` (`plugins: [ogygia(), postrender(),
 * sveltekit()]`), and `ogygia()` finds it there by the definition it carries under {@link PLUGIN} —
 * never by its name. A factory that needs Vite hooks of its own returns them beside it, as an array.
 *
 * REALMS are named by the plugin: `server` and `client` point at the modules themselves, resolved
 * next to the factory (`import.meta.resolve`), so they are the same files the package's own imports
 * reach and a plugin's modules exist once. A package's export names stay its own.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type MagicString from 'magic-string';
import type { Plugin as VitePlugin } from 'vite';
import type { ExportMap, Policy } from '../compiler/exports/index.ts';
import type { ClientRealmFile, ServerRealm } from '../compiler/link/caps.ts';
import {
	RUNTIME_HOOK_CONSTANTS,
	type BarrelLeftReason,
	type CompileEventInput,
	type RuntimeHookName
} from '@ogygia/core/contract';
import { OgygiaError } from '../compiler/messages.ts';
import type { Definers } from './definers.ts';
import { parse_module, type AstNode } from '../compiler/parse/oxc.ts';
import type { MacroContext } from '../compiler/macros/pipeline.ts';
import type { PrescanHook } from '../compiler/ctx.ts';

/** Where `definePlugin` puts the definition on the Vite plugin it returns. A registered symbol, so a
 *  second copy of ogygia in one app still recognizes the first's plugins. */
export const PLUGIN: unique symbol = Symbol.for('ogygia.plugin');

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

export type { MacroContext, PrescanHook };

/** A source format that becomes Svelte only through a preprocessor (markdown → Svelte): how its
 *  islands and its modules' CSS reach the build. */
export interface MarkupSource {
	/** The format's file extensions (`['.svx', '.md']`). */
	extensions: readonly string[];
	/** Discover the format's islands up front (build start, dev included): read each file, turn it
	 *  into Svelte, and hand that to `transform` so its islands are registered before chunks emit. */
	scan?(ctx: { root: string; readFile(abs: string): string | null }): void | Promise<void>;
	/** The format's modules, absolute path → their post-preprocess Svelte source. A module only ever
	 *  renders on the server, so no client chunk carries its CSS: the build ships, as one client asset
	 *  per module, the scoped CSS of its own `<style>` and of every component it imports (and plain
	 *  style imports). The plugin keeps filling it ([path, source] pairs); the build reads it late. */
	modules?: Iterable<readonly [string, string]>;
}

/** What the build hands back for a markup source: run the region transform on preprocessed Svelte. */
export interface MarkupRegions {
	/** Rewrite the marked imports in already-preprocessed Svelte and register its regions. The code,
	 *  or null when nothing changed. */
	transform(source: string, filename: string): string | null;
}

/** Where a plugin's transform runs: on the module as written, before the region transform
 *  (`'source'`), or on what the region transform made of it (`'post'`). */
export type TransformStage = 'source' | 'post';

/** One module, as a stage transform sees it. */
export interface TransformContext {
	/** The module id, query included. */
	readonly id: string;
	/** The module's code as the stage received it (no byte-order mark). */
	readonly code: string;
	/** The stage's edits, by offsets into `code`: every transform of a stage edits the code it
	 *  received, and the stage emits one result and one source map. */
	readonly edit: MagicString;
	/** The bundler's environment (`client`, `ssr`). */
	readonly environment: string;
	/** A specifier resolved from `importer` as the bundler resolves it now; null when it cannot be
	 *  (unresolvable, or external). */
	resolve(spec: string, importer: string): Promise<string | null>;
	/** Re-transform this module when `file` changes (dev). */
	watch(file: string): void;
	/** Tell the build what the transform did to this module (it is the event's importer): read back
	 *  by the findings, and forgotten when the module is transformed again. */
	emit(event: TransformEvent): void;
}

/** What a stage transform tells the build about the module it transformed. */
export type TransformEvent = Omit<
	Extract<CompileEventInput, { name: 'compile.barrel.left' }>,
	'importer'
>;

/** A transform at a stage around the region transform: ordering is the stage, not list position. */
export interface StageTransform {
	stage: TransformStage;
	/** Which modules (by full id); every module when absent. */
	filter?(id: string): boolean;
	transform(t: TransformContext): void | Promise<void>;
}

/** The app's export index: each barrel's names to the modules that define them, over one parse of
 *  each module for the whole app, resolved as the module being transformed resolves. */
export interface ExportsSeam {
	/** The map of the barrel at `file` (as `spec` named it), or null when `policy` does not go
	 *  through it. */
	map(file: string, spec: string, policy: Policy, t: TransformContext): Promise<ExportMap | null>;
}

/** An import declaration, as {@link BuildContext.pinnedImports} reads it. */
export interface PinnedDecl {
	readonly attribute_keys: readonly string[];
	readonly specs: readonly { readonly local: string }[];
}

/** The build, as one plugin sees it (handed to `build`). */
export interface BuildContext {
	/** Run `transform` on every module (that `filter` takes) at its `stage`. */
	transform(transform: StageTransform): void;
	/** The app's export index (`compiler/exports/`), for a transform that follows names through
	 *  barrels. */
	readonly exports: ExportsSeam;
	/** For a module's code: the imports that carry a region's identity (a region mark, on a default
	 *  or a named import). A transform that rewrites imports leaves them as written, so the region
	 *  the prescan keys on the raw import is the region the transform sees. */
	pinnedImports(code: string): (decl: PinnedDecl) => boolean;
	/** The app's regions as the build knows them now, for a tool that names or weighs them. */
	readonly regions: RegionsSeam;
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
	 *  every island ~185 B gz and a preload. It also says this app's pages carry other apps'
	 *  regions, so its runtime ships every feature a region in the HTML can need. */
	foreignHydrate(): void;
	/** An `import.meta.og.<name>(…)` construct this plugin compiles (`'code'`, `'loader'`). Plugin
	 *  macros run after core's own (`wire`, `$`, `source`, `store`), in plugin order; `last`: after
	 *  every other plugin's (`bake`: it runs code the others may still rewrite). They
	 *  run on the app's own source only: elsewhere a call fails the build (`macro_outside_app`). */
	macro(name: string, handler: MacroHandler, options?: { last?: boolean }): void;
	/** Read the modules the build's prescan reads (the app's source and the files packages declare,
	 *  every one, used or not) that import one of `hook.imports`; `hook.written()` after a
	 *  `vite build` wrote its client output. An inventory (`flags()`'s flag sites) is built here. */
	prescan(hook: PrescanHook): void;
	/** A source format that becomes Svelte through a preprocessor (markdown): register it, get the
	 *  island transform to call from that preprocessor. */
	markup(source: MarkupSource): MarkupRegions;
	/** Calls that define things for the life of the module making them (`content`, `flag`): exported
	 *  as `names` from `module`. In dev each such call in a server module is marked with its module's
	 *  run (./definers.ts), so a definition deleted from the code leaves when the module reloads; the
	 *  definer reads the run with `defining()` from @ogygia/machine. */
	definers(module: string, names: readonly string[]): void;
	/** Compile core's EVENT emits in, browser and server (`ogygia/events`: island wakes, server renders,
	 *  hub mints, navigations) — off, every emit folds away. `lazy`: measure only once a viewer opens a
	 *  tool (the page carries a launcher; a preview build). */
	events(options?: { lazy?: boolean }): void;
	/** Record the build's MEASUREMENT data: per-island detail, chunk contents, server source maps, the
	 *  module map, the embedded maps, the request stats' detail — what a profiler reads. */
	measure(): void;
	/** Compile a package's files as app source (their islands, router-css roots): `dirs` / `files`
	 *  absolute, under `root` (the package's directory). For a plugin's own pages (a UI it serves). */
	files(scan: { root: string; dirs?: string[]; files?: string[] }): void;
	/** Modules that render pages outside Kit's routes (a programmatic router): every component they
	 *  import gets its whole-tree CSS linked when it renders (`componentCssHead()` from
	 *  `ogygia/plugin/css`). `importers`: any compiled module importing one of these specifiers is a
	 *  page module; `files`: absolute paths that are page modules themselves (compiled ones: app source,
	 *  or a `files()` / `ogygia.files` surface). */
	pageModules(modules: { importers?: string[]; files?: string[] }): void;
	/** SEED SHAPING: this plugin answers which top-level `page.data` keys a module reads
	 *  (`@ogygia/page-keys`). One plugin at most. Without one, every region that reads the page gets
	 *  all of `page.data`, and every server hole looks it up. */
	pageReads(reads: PageReads): void;
}

/** A specifier resolved from an importer, as the bundler resolves it (null: it does not). */
export type PageReadsResolve = (
	specifier: string,
	importer: string
) => Promise<{ id: string } | null | undefined>;

/** Why a module answers `'unknown'`: the construct, and its line. */
export interface PageReadWhy {
	readonly why: string;
	readonly line: number | null;
}

/**
 * What a seed-shaping plugin answers (handed to {@link BuildContext.pageReads}). Module ids are
 * query-less, with forward slashes. Core unions the answers over each island's closure and walks
 * each server hole's graph; `'unknown'` anywhere ships (or looks up) all of `page.data`.
 */
export interface PageReads {
	/** A module the build compiles, in its source form (before ogygia's own rewrites). Build only. */
	module(id: string, code: string): void;
	/** Once in the client leg, before core asks `keys`: settle what needs the bundler (a helper in
	 *  another module that the page is handed to). */
	settle(resolve: PageReadsResolve): Promise<void>;
	/** The keys a module reads, `'unknown'`, or null (it was never seen reading the page). */
	keys(id: string): ReadonlySet<string> | 'unknown' | null;
	/** Why a module answers `'unknown'` (the build's seed report, the profiler). */
	why(id: string): PageReadWhy | null;
	/** Dev, for the profiler: what these files read together (an island's component and the app
	 *  modules below it), as the build would answer; null when none reads the page. */
	dev(
		files: readonly string[],
		resolve: PageReadsResolve
	): Promise<{
		keys: string[] | 'unknown' | null;
		why: { file: string; line: number | null; why: string }[];
	}>;
}

/** The name of `ogygia()`'s own Vite plugin: what a listed plugin looks for beside it. */
const OGYGIA_VITE_PLUGIN = 'ogygia';

/** A plugin, as the Vite plugin the app lists beside `ogygia()`. */
export function definePlugin<Options = undefined>(
	definition: PluginDefinition<Options>
): OgygiaPlugin<Options> {
	return {
		name: definition.name,
		[PLUGIN]: definition,
		configResolved(config) {
			if (!config.plugins.some((p) => p.name === OGYGIA_VITE_PLUGIN))
				throw new OgygiaError('plugin_without_ogygia', { plugin: definition.name });
		}
	};
}

/** The prefix of SvelteKit's own Vite plugins' names (`sveltekit()` returns several). */
const KIT_VITE_PLUGIN_PREFIX = 'vite-plugin-sveltekit';

/** The plugin definitions in the app's Vite plugin list (nested arrays and promises included), in
 *  list order, shape-checked. `ogygia()` and its plugins come before `sveltekit()`: Vite runs
 *  same-stage hooks in list order, and theirs (the content pre-transforms, the config ogygia hands
 *  Kit) must see a module before Kit's do. */
export async function find_plugins(list: unknown): Promise<PluginDefinition[]> {
	const found: unknown[] = [];
	let kit_seen = false;
	const walk = async (entry: unknown): Promise<void> => {
		const value = await entry;
		if (Array.isArray(value)) {
			for (const item of value) await walk(item);
			return;
		}
		if (typeof value === 'function') throw new OgygiaError('plugin_factory_not_called');
		const plugin = value as { name?: unknown; [PLUGIN]?: { name?: unknown } } | null;
		const name = typeof plugin?.name === 'string' ? plugin.name : '';
		const definition = plugin?.[PLUGIN];
		if (name.startsWith(KIT_VITE_PLUGIN_PREFIX)) kit_seen = true;
		const own = name === OGYGIA_VITE_PLUGIN;
		if ((own || definition) && kit_seen)
			throw new OgygiaError('plugin_after_sveltekit', {
				plugin: own ? 'ogygia()' : String(definition?.name)
			});
		if (definition) found.push(definition);
	};
	await walk(list);
	return check_plugins(found);
}

/** What the build takes from the app's plugins. */
export interface ResolvedPlugins {
	/** each server realm, in plugin order (`enforce` applied) */
	servers: ServerRealm[];
	/** each browser realm (its plugin's name, its absolute path), in plugin order */
	clients: ClientRealmFile[];
	/** every runtime hook some browser realm subscribes to */
	client_hooks: RuntimeHookName[];
	/** every key any plugin claims inside Kit's `config` page option */
	route_config: string[];
	/** a plugin asked for island entries' foreign-hydrate exports */
	foreign_hydrate: boolean;
	/** plugin macros, in plugin order */
	macros: { name: string; handler: MacroHandler }[];
	/** prescan readers (`b.prescan()`), in plugin order */
	prescans: PrescanHook[];
	/** markup sources (a preprocessor format with islands) */
	markup: MarkupSource[];
	/** the definer calls plugins named (`b.definers()`): marked in dev with their module's run */
	definers: Definers[];
	/** a plugin asked for core's events (`lazy`: measure once a tool opens), or false */
	events: false | { lazy: boolean };
	/** a plugin asked for the build's measurement data */
	measure: boolean;
	/** package files compiled as app source, per plugin */
	files: { name: string; root: string; dirs: string[]; files: string[] }[];
	/** page modules (`b.pageModules()`): the specifiers whose importers are page modules, and files
	 *  that are page modules themselves */
	page_modules: { importers: string[]; files: string[] };
	/** stage transforms (`b.transform()`), in plugin order */
	transforms: StageTransform[];
	/** the plugin that answers seed shaping (`b.pageReads()`), or null: every region gets all */
	page_reads: PageReads | null;
}

/** What core hands every plugin's build context: the export index and the pinned-import check. */
/** The live region table (read at call time, so it is complete once the app's islands are known). */
export interface RegionsSeam {
	/** island id → its component's name */
	names(): Record<string, string>;
	/** Why `barrels()` left the barrel at `file` as these modules import it (none: it was rewritten,
	 *  or no rewrite was asked for). */
	barrelWhy(file: string, importers: Iterable<string>): BarrelLeftReason[];
}

export interface BuildSeams {
	exports: ExportsSeam;
	pinned_imports(code: string): (decl: PinnedDecl) => boolean;
	regions: RegionsSeam;
}

const MACRO_NAME_RE = /^[a-z][A-Za-z0-9]*$/;
/** core's own `import.meta.og.*` constructs: a plugin may never claim one */
// static: the macros core defines
const CORE_MACROS = new Set(['wire', '$', 'source', 'store']);

function order(plugins: readonly PluginDefinition[]): PluginDefinition[] {
	return [
		...plugins.filter((p) => p.enforce === 'pre'),
		...plugins.filter((p) => p.enforce !== 'pre' && p.enforce !== 'post'),
		...plugins.filter((p) => p.enforce === 'post')
	];
}

const ROUTE_CONFIG_KEY_RE = /^[a-z][A-Za-z0-9]*$/;

/** The seams outside a configured `ogygia()` (a unit test of the plugin list): asking for one is a
 *  mistake in that test, said loudly. */
const NO_SEAMS: BuildSeams = {
	exports: {
		map: () => Promise.reject(new Error('resolve_plugins: no export index without ogygia()'))
	},
	pinned_imports: () => {
		throw new Error('resolve_plugins: no pinned imports without ogygia()');
	},
	regions: {
		names: () => {
			throw new Error('resolve_plugins: no region table without ogygia()');
		},
		barrelWhy: () => {
			throw new Error('resolve_plugins: no region table without ogygia()');
		}
	}
};

/**
 * Config-time shape check of the definitions found: each named once, its realms locations, its
 * options JSON.
 */
export function check_plugins(plugins: readonly unknown[]): PluginDefinition[] {
	const seen = new Set<string>();
	for (const p of plugins) {
		const plugin = p as Partial<PluginDefinition> | null;
		if (
			!plugin ||
			typeof plugin !== 'object' ||
			typeof plugin.name !== 'string' ||
			plugin.name === ''
		)
			throw new OgygiaError('plugin_name_missing');
		if (seen.has(plugin.name))
			throw new OgygiaError('plugin_listed_twice', { plugin: plugin.name });
		seen.add(plugin.name);
		for (const realm of ['server', 'client'] as const)
			if (plugin[realm] !== undefined && typeof plugin[realm] !== 'string')
				throw new OgygiaError('plugin_realm_not_location', { plugin: plugin.name, realm });
		if (plugin.options !== undefined) {
			try {
				JSON.stringify(plugin.options);
			} catch {
				throw new OgygiaError('plugin_options_not_json', { plugin: plugin.name });
			}
		}
	}
	return plugins as PluginDefinition[];
}

/** A realm's module as an absolute POSIX path (what the generated imports name), or null when the
 *  plugin has none. A location that is not a file is a mistake, said loudly. */
function realm_path(plugin: PluginDefinition, realm: 'server' | 'client'): string | null {
	const where = plugin[realm];
	if (where === undefined) return null;
	const abs = where.startsWith('file:') ? fileURLToPath(where) : where;
	if (!path.isAbsolute(abs) || !fs.existsSync(abs))
		throw new OgygiaError('plugin_realm_not_file', {
			plugin: plugin.name,
			realm,
			location: where
		});
	return abs.split(path.sep).join('/');
}

/** The runtime hooks a client realm subscribes to: the keys of the `hooks` object literal in its
 *  default `defineClient({ … })`, read from the file. */
export function client_hook_names(plugin: string, file: string): RuntimeHookName[] {
	const unread = () => new OgygiaError('plugin_client_hooks_unread', { plugin, location: file });
	const { program } = parse_module(fs.readFileSync(file, 'utf8'), file);
	if (!program) throw unread();
	const body = program.body as AstNode[];
	const consts = new Map<string, AstNode>();
	for (const s of body)
		if (s.type === 'VariableDeclaration' && s.kind === 'const')
			for (const d of s.declarations as AstNode[])
				if (d.id?.type === 'Identifier' && d.init) consts.set(d.id.name as string, d.init);
	// what a value is, as written: through casts, parentheses and the module's own `const` names
	const unwrap = (n: AstNode | null | undefined): AstNode | null | undefined => {
		const seen = new Set<string>();
		while (n) {
			if (
				n.type === 'TSAsExpression' ||
				n.type === 'TSSatisfiesExpression' ||
				n.type === 'ParenthesizedExpression'
			)
				n = n.expression;
			else if (
				n.type === 'Identifier' &&
				consts.has(n.name as string) &&
				!seen.has(n.name as string)
			) {
				seen.add(n.name as string);
				n = consts.get(n.name as string);
			} else break;
		}
		return n;
	};
	// a bundler writes `export { client as default }` where the source had `export default client`
	const default_local = body
		.filter((s) => s.type === 'ExportNamedDeclaration' && !s.source)
		.flatMap((s) => s.specifiers as AstNode[])
		.find((sp) => (sp.exported?.name ?? sp.exported?.value) === 'default')?.local;
	let value = unwrap(
		(body.find((s) => s.type === 'ExportDefaultDeclaration')?.declaration as AstNode | undefined) ??
			default_local
	);
	if (value?.type === 'CallExpression') value = unwrap(value.arguments?.[0]);
	if (value?.type !== 'ObjectExpression') throw unread();
	const key_of = (p: AstNode): string | null =>
		p.type !== 'Property' || p.computed
			? null
			: p.key.type === 'Identifier'
				? p.key.name
				: p.key.type === 'Literal' && typeof p.key.value === 'string'
					? p.key.value
					: null;
	const props = value.properties as AstNode[];
	if (props.some((p) => key_of(p) === null)) throw unread();
	const hooks = unwrap(props.find((p) => key_of(p) === 'hooks')?.value);
	if (!hooks) return [];
	if (hooks.type !== 'ObjectExpression') throw unread();
	const names: RuntimeHookName[] = [];
	for (const p of hooks.properties as AstNode[]) {
		const key = key_of(p);
		if (key === null) throw unread();
		if (!Object.hasOwn(RUNTIME_HOOK_CONSTANTS, key))
			throw new OgygiaError('plugin_client_hook_unknown', { plugin, hook: key });
		names.push(key as RuntimeHookName);
	}
	return names;
}

function package_resolves(req: NodeJS.Require, name: string): boolean {
	try {
		req.resolve(`${name}/package.json`);
		return true;
	} catch (e) {
		// a package whose exports do not list package.json still resolves (the error says so)
		return (e as { code?: string }).code === 'ERR_PACKAGE_PATH_NOT_EXPORTED';
	}
}

/**
 * When the app's root and mode are known (the `config` hook): order the plugins (`enforce`), check their
 * realms, run their `build` hooks. `markup_transform` is the configured compiler's island
 * transform for preprocessed markup (what `b.markup()` hands back).
 */
export function resolve_plugins(
	plugins: readonly PluginDefinition[],
	root: string,
	dev: boolean,
	markup_transform: MarkupRegions['transform'] = () => null,
	seams: BuildSeams = NO_SEAMS
): ResolvedPlugins {
	const ordered = order(plugins);
	const req = createRequire(path.join(root, 'package.json'));
	const out: ResolvedPlugins = {
		servers: [],
		clients: [],
		client_hooks: [],
		route_config: [],
		foreign_hydrate: false,
		macros: [],
		prescans: [],
		markup: [],
		definers: [],
		events: false,
		measure: false,
		files: [],
		page_modules: { importers: [], files: [] },
		transforms: [],
		page_reads: null
	};
	let page_reads_owner: string | null = null;
	const config_owner = new Map<string, string>();
	const macro_owner = new Map<string, string>();
	const last_macros: ResolvedPlugins['macros'] = [];
	for (const plugin of ordered) {
		if (!package_resolves(req, plugin.name))
			throw new OgygiaError('plugin_package_unresolved', { plugin: plugin.name, root });
		const server = realm_path(plugin, 'server');
		if (server)
			out.servers.push({ name: plugin.name, module: server, options: plugin.options ?? {} });
		const client = realm_path(plugin, 'client');
		if (client) {
			out.clients.push({ name: plugin.name, module: client });
			for (const name of client_hook_names(plugin.name, client))
				if (!out.client_hooks.includes(name)) out.client_hooks.push(name);
		}
		plugin.build?.({
			root,
			dev,
			exports: seams.exports,
			pinnedImports: seams.pinned_imports,
			regions: seams.regions,
			transform(t) {
				out.transforms.push(t);
			},
			routeConfig(key) {
				if (!ROUTE_CONFIG_KEY_RE.test(key))
					throw new OgygiaError('route_config_key_invalid', { plugin: plugin.name, key });
				const owner = config_owner.get(key);
				if (owner && owner !== plugin.name)
					throw new OgygiaError('route_config_key_claimed', { key, owner, plugin: plugin.name });
				if (!owner) {
					config_owner.set(key, plugin.name);
					out.route_config.push(key);
				}
			},
			foreignHydrate() {
				out.foreign_hydrate = true;
			},
			macro(name, handler, options) {
				if (!MACRO_NAME_RE.test(name) || CORE_MACROS.has(name))
					throw new OgygiaError('plugin_macro_name_invalid', { plugin: plugin.name, name });
				const owner = macro_owner.get(name);
				if (owner)
					throw new OgygiaError('plugin_macro_claimed', { name, owner, plugin: plugin.name });
				macro_owner.set(name, plugin.name);
				(options?.last ? last_macros : out.macros).push({ name, handler });
			},
			prescan(hook) {
				out.prescans.push(hook);
			},
			markup(source) {
				out.markup.push(source);
				return { transform: markup_transform };
			},
			definers(module, names) {
				out.definers.push({ module, names: [...names] });
			},
			events(options) {
				// eager wins: one plugin measuring from boot outranks another's launcher-only ask
				const lazy = options?.lazy === true;
				out.events = out.events ? { lazy: out.events.lazy && lazy } : { lazy };
			},
			measure() {
				out.measure = true;
			},
			files(scan) {
				out.files.push({
					name: plugin.name,
					root: scan.root,
					dirs: scan.dirs ?? [],
					files: scan.files ?? []
				});
			},
			pageModules(modules) {
				for (const spec of modules.importers ?? [])
					if (!out.page_modules.importers.includes(spec)) out.page_modules.importers.push(spec);
				for (const file of modules.files ?? []) {
					if (!path.isAbsolute(file))
						throw new OgygiaError('page_modules_not_absolute', { plugin: plugin.name, file });
					if (!out.page_modules.files.includes(file)) out.page_modules.files.push(file);
				}
			},
			pageReads(reads) {
				if (page_reads_owner !== null)
					throw new OgygiaError('page_reads_claimed', {
						owner: page_reads_owner,
						plugin: plugin.name
					});
				page_reads_owner = plugin.name;
				out.page_reads = reads;
			}
		});
	}
	// the `last` macros after every other one, each in plugin order
	out.macros.push(...last_macros);
	return out;
}
