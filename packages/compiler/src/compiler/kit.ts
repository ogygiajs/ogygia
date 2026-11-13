import fs from 'node:fs';
import { dedent } from '@ogygia/core/contract';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ISLAND_DIR } from './region/transform.ts';
import { parse_module, type AstNode } from './parse/oxc.ts';
import { OgygiaError } from './messages.ts';
import { cache } from '@ogygia/machine';
import type { Fs, FsEntry } from './fs.ts';
import { derived, input, queries, type Queries, type Query } from './queries.ts';

/** A file event, as the bundler's watcher names it. */
export type FileEvent = 'create' | 'update' | 'delete';

/** Route config is asked for by route file and by the keys the plugins claim. */
export type Keyed = readonly [file: string, keys: readonly string[]];
const keyed = ([file, keys]: Keyed) => `${file}\0${keys.join(',')}`;
const own = (k: string) => k;

/**
 * Kit's route trees and route config as one file system holds them: each answer is a query
 * (./queries.ts) over the files and directory listings it read, so a file event reads again only
 * what was read of that file, and computes again only the answers that read it (`touch`).
 */
export interface Routes {
	readonly fs: Fs;
	readonly db: Queries;
	/** A file's text (null: none). */
	readonly text: Query<string, string | null>;
	/** A directory's entries as it lists them (null: not a directory). */
	readonly listing: Query<string, readonly FsEntry[] | null>;
	/** What is at a path, links followed. */
	readonly at: Query<string, 'file' | 'dir' | null>;
	/** Each option file's `csr`. */
	readonly csr_of_file: Query<string, boolean | undefined>;
	/** Each module's claimed `config` keys. */
	readonly config_of_file: Query<Keyed, Record<string, unknown>>;
	/** routesDir → Kit's route tree of it (its shape: which nodes, which layouts each page uses). */
	readonly route_tree: Query<string, RouteTree>;
	/** routesDir → each node's csr as Kit's static analysis computes it, by `RouteNode.index`. */
	readonly node_csr: Query<string, readonly (boolean | undefined)[]>;
	/** routesDir + keys → every page's merged config. */
	readonly page_config: Query<Keyed, Record<string, Record<string, unknown>>>;
	/** routesDir → does any page have csr=true. */
	readonly has_csr_true: Query<string, boolean>;
	/**
	 * A file event at `abs`: read again what anything read of it (its text, what is at it, and on an
	 * add or a delete every listing above it). Whether a route answer changed: an edit that leaves
	 * every route's options as they were changes none.
	 */
	touch(abs: string, event: FileEvent): boolean;
}

const routes_by_fs = new WeakMap<Fs, Routes>();

/** The route reader for one file system: the same one each time it is asked for, so the disk has
 *  one set of answers however many compile contexts read it. */
export function route_reader(files: Fs): Routes {
	let r = routes_by_fs.get(files);
	if (r) return r;
	const db = queries('routes');
	const text = input('route text', own, (abs: string) => files.read(abs));
	const listing = input('route listing', own, (dir: string) => files.list(dir));
	const at = input('route stat', own, (abs: string) => files.stat(abs));
	const route_tree = derived(
		'route tree',
		own,
		(_cx, routesDir: string) => build_route_tree(routes, routesDir),
		Object.is
	);
	const routes: Routes = {
		fs: files,
		db,
		text,
		listing,
		at,
		csr_of_file: derived('route csr', own, (cx, file: string) =>
			csr_of_text(cx.get(text, file), file)
		),
		config_of_file: derived('route config', keyed, (cx, [file, keys]: Keyed) =>
			route_config_of_text(cx.get(text, file), file, keys)
		),
		route_tree,
		node_csr: derived('route node csr', own, (cx, routesDir: string) => {
			const tree = cx.get(route_tree, routesDir);
			const out: (boolean | undefined)[] = [];
			const of = (node: RouteNode): boolean | undefined => {
				if (node.index in out) return out[node.index];
				const csr = node_own_csr(routes, node) ?? (node.parent ? of(node.parent) : undefined);
				out[node.index] = csr;
				return csr;
			};
			for (const node of tree.nodes) of(node);
			return out;
		}),
		page_config: derived('page config', keyed, (cx, [routesDir, keys]: Keyed) => {
			const m: Record<string, Record<string, unknown>> = {};
			for (const leaf of cx.get(route_tree, routesDir).nodes)
				if (leaf.kind === 'leaf')
					m[route_id_of(leaf.route, routesDir)] = page_config(routes, leaf, keys);
			return m;
		}),
		has_csr_true: derived(
			'routes csr true',
			own,
			(_cx, routesDir: string) => csrTrueRouteIds(routes, routesDir).length > 0
		),
		touch(abs, event) {
			const before = db.revision;
			db.refresh(text, abs);
			db.refresh(at, abs);
			if (event !== 'update')
				for (let dir = path.dirname(abs); ; dir = path.dirname(dir)) {
					db.refresh(listing, dir);
					db.refresh(at, dir);
					if (path.dirname(dir) === dir) break;
				}
			return db.revision !== before && db.answers_changed_since(before);
		}
	};
	routes_by_fs.set(files, routes);
	return routes;
}

/** The Kit-internal + app paths ogygia deep-imports (resolved off the APP root, not this package). */
export interface KitPaths {
	/** Kit's internal wire-protocol module (deep import), or null → built-in devalue codec fallback. */
	kit_wire_path: string | null;
	/** Kit's client remote-functions entry (Plan A reuse), or null. */
	kit_remote_index: string | null;
	/** The app's universal hooks (`src/hooks.{ts,js}`) for `transport`, or null when absent. */
	universal_hooks: string | null;
	/** The app's CLIENT hooks (`src/hooks.client.{ts,js}`), or null. Kit runs this file only when its
	 *  client app boots — which a csr=false page never does — so ogygia runs its `init` on boot there
	 *  (client-side monitoring, third-party bootstraps otherwise silently never load). */
	client_hooks: string | null;
	/** Kit 3's client codec module (`#app/internal/transport`), or null on Kit 2. Kit 3's remote
	 *  argument encoding reads the app's transport from it, and only Kit's client boot fills it — so on
	 *  a csr=false page a custom-type remote argument failed to encode until ogygia filled it too. */
	kit_transport_init: string | null;
}

/**
 * Locate Kit's internal wire-protocol + client remote-functions modules by resolving `@sveltejs/kit`'s
 * package.json (that IS exported) and joining the src path — deep-importing the file bypasses the exports
 * map. Also finds the app's universal hooks. Resolved from the APP root (`createRequire` off a root path),
 * so a monorepo sub-package still finds Kit. Never throws (a missing Kit → the devalue-codec fallback).
 */
export function resolve_kit_paths(root: string): KitPaths {
	let kit_wire_path: string | null = null;
	let kit_remote_index: string | null = null;
	let universal_hooks: string | null = null;
	let kit_transport_init: string | null = null;
	try {
		const require = createRequire(path.join(root, 'noop.js'));
		const kitRoot = path.dirname(require.resolve('@sveltejs/kit/package.json'));
		const candidate = path.join(kitRoot, 'src', 'runtime', 'shared.js');
		if (fs.existsSync(candidate)) kit_wire_path = candidate;
		const codec = path.join(kitRoot, 'src', 'runtime', 'app', 'internal', 'transport.js');
		if (fs.existsSync(codec)) kit_transport_init = codec;
		const remoteIdx = path.join(
			kitRoot,
			'src',
			'runtime',
			'client',
			'remote-functions',
			'index.js'
		);
		if (fs.existsSync(remoteIdx)) kit_remote_index = remoteIdx;
	} catch {
		kit_wire_path = null; // ok: no Kit resolves (a standalone compile): the built-in devalue codec, no transport
	}
	for (const f of ['hooks.ts', 'hooks.js']) {
		const abs = path.join(root, 'src', f);
		if (fs.existsSync(abs)) {
			universal_hooks = abs;
			break;
		}
	}
	let client_hooks: string | null = null;
	for (const f of ['hooks.client.ts', 'hooks.client.js']) {
		const abs = path.join(root, 'src', f);
		if (fs.existsSync(abs)) {
			client_hooks = abs;
			break;
		}
	}
	return { kit_wire_path, kit_remote_index, universal_hooks, client_hooks, kit_transport_init };
}

/**
 * The app's Kit MAJOR version (resolved off the app root, like {@link resolve_kit_paths}), or null when
 * no Kit resolves. The one fact `kit_asset` needs: Kit 2's `asset()` takes a path with its leading
 * slash, Kit 3's without — and no runtime probe can tell them apart (Kit 2 refuses a slash-less path
 * only in dev; in a build it returns it page-relative, and every island entry on a nested page 404'd).
 */
export function kit_major(root: string): number | null {
	try {
		const require = createRequire(path.join(root, 'noop.js'));
		const pkg = JSON.parse(
			fs.readFileSync(require.resolve('@sveltejs/kit/package.json'), 'utf8')
		) as { version?: string };
		const major = Number.parseInt(pkg.version ?? '', 10);
		return Number.isFinite(major) ? major : null;
	} catch {
		return null; // ok: no Kit resolves from the app root: the documented null (a standalone compile)
	}
}

export interface KitDirs {
	/** absolute `kit.files.routes` (default `<root>/src/routes`) */
	routes_dir: string;
	/** absolute `kit.outDir` (default `<root>/.svelte-kit`) */
	out_dir: string;
}
export const DEFAULT_KIT_DIRS = { routes: 'src/routes', out: '.svelte-kit' } as const;
const KIT_CONFIG_ROOTS_MAX = 10_000;
const _kit_dirs = cache<string, KitDirs>({ name: 'kit dirs', max: KIT_CONFIG_ROOTS_MAX });

export function set_kit_dirs(root: string, dirs: KitDirs): void {
	_kit_dirs.set(root, dirs);
}

export function kit_dirs(root: string): KitDirs {
	return (
		_kit_dirs.get(root) ?? {
			routes_dir: path.join(root, DEFAULT_KIT_DIRS.routes),
			out_dir: path.join(root, DEFAULT_KIT_DIRS.out)
		}
	);
}

const _kit_inline_style_threshold = cache<string, number>({
	name: 'kit inline style threshold',
	max: KIT_CONFIG_ROOTS_MAX
});

export function set_kit_inline_style_threshold(root: string, bytes: number): void {
	_kit_inline_style_threshold.set(root, bytes);
}

export function kit_inline_style_threshold(root: string): number {
	return _kit_inline_style_threshold.get(root) ?? 0;
}

/** Read `export const csr = true|false` from a route options file; `undefined` if unset/absent. */
export function read_csr(r: Routes, file: string): boolean | undefined {
	return r.db.get(r.csr_of_file, file);
}

function csr_of_text(src: string | null, file: string): boolean | undefined {
	if (src === null) return undefined; // ok: no such option file on this level
	if (!src.includes('csr')) return undefined;
	const { program } = parse_module(src, file);
	if (!program) return undefined;
	const value = literal_value(page_option(program, 'csr'));
	return typeof value === 'boolean' ? value : undefined;
}

function unwrap_expression(node: AstNode | null | undefined): AstNode | null {
	let n = node ?? null;
	while (
		n &&
		(n.type === 'TSAsExpression' ||
			n.type === 'TSSatisfiesExpression' ||
			n.type === 'TSTypeAssertion' ||
			n.type === 'TSNonNullExpression' ||
			n.type === 'ParenthesizedExpression')
	)
		n = n.expression;
	return n;
}

function page_option(program: AstNode, name: string): AstNode | null {
	const body: AstNode[] = program.body ?? [];
	const declared = (local: string): AstNode | null => {
		for (const statement of body) {
			const declaration =
				statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
			if (declaration?.type !== 'VariableDeclaration') continue;
			for (const d of declaration.declarations ?? [])
				if (d.id?.type === 'Identifier' && d.id.name === local) return d.init ?? null;
		}
		return null;
	};
	const name_of = (n: AstNode | null | undefined) =>
		n?.type === 'Identifier' ? n.name : typeof n?.value === 'string' ? n.value : null;
	for (const statement of body) {
		if (statement.type !== 'ExportNamedDeclaration') continue;
		for (const d of statement.declaration?.declarations ?? [])
			if (d.id?.type === 'Identifier' && d.id.name === name) return d.init ?? null;
		for (const s of statement.specifiers ?? []) {
			if (name_of(s.exported) !== name) continue;
			const local = name_of(s.local);
			return statement.source || local === null ? null : declared(local);
		}
	}
	return null;
}

function config_object(program: AstNode): AstNode | null {
	const init = unwrap_expression(page_option(program, 'config'));
	return init?.type === 'ObjectExpression' ? init : null;
}

const NOT_LITERAL: unique symbol = Symbol('not-literal');
function literal_value(node: AstNode | null): unknown {
	const n = unwrap_expression(node);
	if (n?.type !== 'Literal' || n.regex || n.bigint !== undefined) return NOT_LITERAL;
	return n.value;
}

/**
 * The claimed keys `export const config = {…}` sets in one route module: its literal-valued top-level
 * properties named in `keys`. `{}` when the file, the export or the keys are absent (a spread or a
 * `config` that is not an object literal is Kit's to read, not ours). A claimed key with a computed
 * value is a build error: it is read at build time, so ogygia could not honour it.
 */
export function read_route_config(
	r: Routes,
	file: string,
	keys: readonly string[]
): Record<string, unknown> {
	return r.db.get(r.config_of_file, [file, keys]);
}

function route_config_of_text(
	src: string | null,
	file: string,
	keys: readonly string[]
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (src === null) return out;
	if (!src.includes('config') || !keys.some((k) => src.includes(k))) return out;
	const { program } = parse_module(src, file);
	const object = program && config_object(program);
	if (!object) return out;
	for (const property of object.properties ?? []) {
		if (property.type !== 'Property' || property.computed) continue;
		const key: unknown =
			property.key?.type === 'Identifier' ? property.key.name : property.key?.value;
		if (typeof key !== 'string' || !keys.includes(key)) continue;
		const value = literal_value(property.value);
		if (value === NOT_LITERAL) throw new OgygiaError('kit_config_not_literal', { file, key });
		out[key] = value;
	}
	return out;
}

const PAGE_UNIVERSAL = ['+page.js', '+page.ts'];
const PAGE_SERVER = ['+page.server.js', '+page.server.ts'];
const LAYOUT_UNIVERSAL = ['+layout.js', '+layout.ts'];
const LAYOUT_SERVER = ['+layout.server.js', '+layout.server.ts'];

function own_csr(r: Routes, dir: string, universal: string[], server: string[]) {
	let csr;
	for (const f of server) csr = read_csr(r, path.join(dir, f)) ?? csr;
	for (const f of universal) csr = read_csr(r, path.join(dir, f)) ?? csr;
	return csr;
}

const ROUTE_COMPONENT_RE = /^\+(?:(page|layout)(?:@(.*))?|(error))\.[^.]+$/;
const SCRIPT_FILE_RE = /\.[cm]?[jt]s$/;
const ROUTE_MODULE_RE = /^\+(page|layout)(\.server)?\.[jt]s$/;

function route_component(
	name: string
): { kind: 'page' | 'layout' | 'error'; reset?: string } | null {
	if (SCRIPT_FILE_RE.test(name)) return null;
	const m = ROUTE_COMPONENT_RE.exec(name);
	if (!m) return null;
	return m[3] ? { kind: 'error' } : { kind: m[1] as 'page' | 'layout', reset: m[2] };
}

/**
 * A route COMPONENT of `kind`: `+page.svelte`, a page with a layout reset (`+page@.svelte`,
 * `+page@(app).svelte`), or either in any other extension the app compiles to a component
 * (`+page.md`, `+page.svx`): every `+page` file but the option scripts, as Kit routes them.
 */
export function is_route_component(name: string, kind: 'page' | 'layout'): boolean {
	return route_component(name)?.kind === kind;
}

type RouteNodeKind = 'layout' | 'error' | 'leaf';
interface RouteNode {
	readonly kind: RouteNodeKind;
	readonly route: Route;
	component: string | null;
	reset: string | undefined;
	parent: RouteNode | null;
	layouts: RouteNode[];
	pages: RouteNode[];
	index: number;
}
interface Route {
	readonly dir: string;
	readonly segment: string;
	readonly parent: Route | null;
	layout: RouteNode | null;
	error: RouteNode | null;
	leaf: RouteNode | null;
}
interface RouteTree {
	readonly routes: Route[];
	readonly nodes: RouteNode[];
}

function route_tree(r: Routes, routesDir: string): RouteTree {
	return r.db.get(r.route_tree, routesDir);
}

function layouts_up(route: Route | null, reset: string | undefined): RouteNode[] {
	const out: RouteNode[] = [];
	for (let current = route; current; current = current.parent) {
		if (reset !== undefined && current.segment !== reset) continue;
		if (current.layout) {
			out.push(current.layout);
			reset = current.layout.reset;
		} else reset = undefined;
	}
	return out;
}

function build_route_tree(r: Routes, routesDir: string): RouteTree {
	const routes: Route[] = [];
	const node = (kind: RouteNodeKind, route: Route): RouteNode => ({
		kind,
		route,
		component: null,
		reset: undefined,
		parent: null,
		layouts: [],
		pages: [],
		index: -1
	});
	const walk = (dir: string, segment: string, parent: Route | null) => {
		const route: Route = { dir, segment, parent, layout: null, error: null, leaf: null };
		routes.push(route);
		const entries = route_entries(r, dir);
		for (const e of entries) {
			if (!e.is_file) continue;
			const component = route_component(e.name);
			const kind = component?.kind ?? ROUTE_MODULE_RE.exec(e.name)?.[1];
			if (kind === 'error') route.error ??= node('error', route);
			else if (kind === 'layout') route.layout ??= node('layout', route);
			else if (kind === 'page') route.leaf ??= node('leaf', route);
			const owner = kind === 'page' ? route.leaf : kind === 'layout' ? route.layout : route.error;
			if (component && owner) {
				owner.component = e.name;
				owner.reset = component.reset;
			}
		}
		for (const e of entries)
			if (e.is_dir && e.name !== KEEP_CLIENT_DIR) walk(path.join(dir, e.name), e.name, route);
	};
	walk(routesDir, '', null);
	const root = routes[0];
	root.layout ??= node('layout', root);

	for (const route of routes) {
		const leaf = route.leaf;
		if (!leaf) continue;
		let at = leaf;
		for (const layout of layouts_up(route, leaf.reset)) {
			leaf.layouts.unshift(layout);
			layout.pages.push(leaf);
			at.parent = at = layout;
		}
	}
	for (const route of routes) {
		if (!route.error) continue;
		for (let current: Route | null = route; current; current = current.parent)
			if (current.layout) {
				route.error.parent = current.layout;
				break;
			}
	}
	const nodes = routes.flatMap((x) => [x.layout, x.error, x.leaf].filter((n) => n !== null));
	nodes.forEach((n, i) => (n.index = i));
	return { routes, nodes };
}

function node_csr(r: Routes, tree: RouteTree, node: RouteNode): boolean | undefined {
	return r.db.get(r.node_csr, tree.routes[0].dir)[node.index];
}

function node_own_csr(r: Routes, node: RouteNode): boolean | undefined {
	const dir = node.route.dir;
	if (node.kind === 'leaf') return own_csr(r, dir, PAGE_UNIVERSAL, PAGE_SERVER);
	if (node.kind === 'layout') return own_csr(r, dir, LAYOUT_UNIVERSAL, LAYOUT_SERVER);
	return undefined;
}

function layout_chain_csr(r: Routes, layout: RouteNode): boolean | undefined {
	let csr;
	for (const node of [...layouts_up(layout.route.parent, layout.reset).reverse(), layout])
		csr = node_own_csr(r, node) ?? csr;
	return csr;
}

function page_leaves(tree: RouteTree): RouteNode[] {
	return tree.nodes.filter((n) => n.kind === 'leaf' && n.component !== null);
}

function host_node(r: Routes, hostFile: string, routesDir: string): RouteNode | null {
	const kind = route_component(path.basename(hostFile))?.kind;
	if (kind !== 'page' && kind !== 'layout') return null;
	const dir = path.dirname(hostFile);
	const route = route_tree(r, routesDir).routes.find((x) => x.dir === dir);
	return (kind === 'page' ? route?.leaf : route?.layout) ?? null;
}

function route_id_of(route: Route, routesDir: string): string {
	const rel = path.relative(routesDir, route.dir);
	return normalize_route_id(`/${rel ? rel.split(path.sep).join('/') : ''}`);
}

/**
 * The ERROR-RENDER csr of every page route: Kit renders a page's `+error.svelte` with the page's
 * layouts only (`PageNodes(layouts)` in its server renderer, the page node dropped), so `csr` for a
 * 404 / 500 under a `csr = false` page is the layouts' answer, usually `true`.
 */
export function errorCsrTrueRouteIds(r: Routes, routesDir: string): string[] {
	const tree = route_tree(r, routesDir);
	const ids = new Set<string>();
	for (const leaf of page_leaves(tree)) {
		const deepest = leaf.layouts.at(-1);
		if (deepest && node_csr(r, tree, deepest) === false) continue;
		ids.add(route_id_of(leaf.route, routesDir));
	}
	return [...ids];
}

/** The error-render csr of a ROUTELESS response (no route matched: Kit renders the root layout and
 *  the root error page) — the root layout's own option, Kit's default `true` when unset. */
export function rootLayoutCsrTrue(r: Routes, routesDir: string): boolean {
	const tree = route_tree(r, routesDir);
	return node_csr(r, tree, tree.routes[0].layout!) !== false;
}

function layout_page_worlds(r: Routes, tree: RouteTree, layout: RouteNode) {
	let any_false = false;
	let any_true = false;
	for (const leaf of layout.pages) {
		if (leaf.component === null) continue;
		if (node_csr(r, tree, leaf) === false) any_false = true;
		else any_true = true;
	}
	return { any_false, any_true };
}

/**
 * Kit-effective `csr === false` for a page or layout host. A page reads Kit's chain: its own
 * option, else the layouts it renders in (a `@` reset skips the ones between). A LAYOUT is
 * csr=false exactly when EVERY page it serves is csr=false; a layout no page renders in reads its
 * own chain.
 * @param hostFile abs path to a route component
 * @param routesDir abs `src/routes`
 */
export function routeCsrIsFalse(r: Routes, hostFile: string, routesDir: string): boolean {
	const node = host_node(r, hostFile, routesDir);
	if (!node) return false;
	const tree = route_tree(r, routesDir);
	if (node.kind === 'leaf') return node_csr(r, tree, node) === false;
	const { any_false, any_true } = layout_page_worlds(r, tree, node);
	if (any_false && !any_true) return true;
	if (any_true) return false;
	return layout_chain_csr(r, node) === false;
}

/**
 * True when `hostFile` is a route host whose islands ogygia must STRIP (Kit hydrates every page
 * this host serves). Pages: Kit's own-chain rule (default true, or an explicit `csr = true` that
 * beats a `false` up the chain). LAYOUTS: strippable ONLY when no page at/below them is
 * csr=false — on a mixed layout both this and {@link routeCsrIsFalse} are false (shared world:
 * islands kept, `documentIsCsrTrue` degrades them per document). `false` for non-route files
 * (shared components): their csr depends on which page renders them, so they keep their islands.
 */
export function routeCsrIsTrue(r: Routes, hostFile: string, routesDir: string): boolean {
	const node = host_node(r, hostFile, routesDir);
	if (!node) return false;
	const tree = route_tree(r, routesDir);
	if (node.kind === 'leaf') return node_csr(r, tree, node) !== false;
	const { any_false, any_true } = layout_page_worlds(r, tree, node);
	if (any_false) return false;
	if (any_true) return true;
	return layout_chain_csr(r, node) !== false;
}

function route_entries(
	r: Routes,
	dir: string
): Array<{ name: string; is_dir: boolean; is_file: boolean }> {
	const out: Array<{ name: string; is_dir: boolean; is_file: boolean }> = [];
	for (const e of r.db.get(r.listing, dir) ?? []) {
		let is_dir = e.kind === 'dir';
		let is_file = e.kind === 'file';
		if (!is_dir && !is_file) {
			const st = r.db.get(r.at, path.join(dir, e.name));
			if (st === null) continue;
			is_dir = st === 'dir';
			is_file = st === 'file';
		}
		out.push({ name: e.name, is_dir, is_file });
	}
	return out;
}

/** Kit's `route.id` for a page host, with layout GROUP segments (`(app)`) stripped — the same
 *  normalization {@link csrTrueRouteIds} applies, so the two sides match whether or not Kit keeps
 *  groups in `route.id`. Root → `/`. */
export function normalize_route_id(id: string): string {
	const segs = id
		.split('/')
		.filter(Boolean)
		.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
	return `/${segs.join('/')}`;
}

/**
 * The set of route ids (Kit `route.id`, group-stripped) whose EFFECTIVE csr is TRUE — i.e. Kit
 * hydrates the whole document there. A csr=false layout's islands rendered under one of these must
 * degrade to inline on BOTH legs (Kit owns hydration); Region reads this map on the server, and
 * `kit_hydrates_page()` is the identical client signal. Empty for a fully csr=false app (the norm);
 * only the csr=true exceptions land here.
 */
export function csrTrueRouteIds(r: Routes, routesDir: string): string[] {
	const tree = route_tree(r, routesDir);
	const ids = new Set<string>();
	for (const leaf of page_leaves(tree))
		if (node_csr(r, tree, leaf) !== false) ids.add(route_id_of(leaf.route, routesDir));
	return [...ids];
}

function page_config(r: Routes, leaf: RouteNode, keys: readonly string[]): Record<string, unknown> {
	let merged: Record<string, unknown> = {};
	for (const node of [...leaf.layouts, leaf]) {
		const files =
			node.kind === 'leaf'
				? [...PAGE_UNIVERSAL, ...PAGE_SERVER]
				: [...LAYOUT_UNIVERSAL, ...LAYOUT_SERVER];
		for (const f of files)
			merged = { ...merged, ...read_route_config(r, path.join(node.route.dir, f), keys) };
	}
	return merged;
}

/** Every page route id (group-stripped) → its merged config, claimed keys only. Every route with a
 *  `+page` file counts, a redirect-only `+page.server.ts` too. A key no level sets is absent, so the
 *  plugin applies its default; a page that sets none maps to `{}`. */
export function page_route_config(
	r: Routes,
	routesDir: string,
	keys: readonly string[]
): Record<string, Record<string, unknown>> {
	return r.db.get(r.page_config, [routesDir, keys]);
}

/**
 * Does the app have ANY csr=true page (Kit hydrates the whole document there)? Drives whether a
 * csr=false LAYOUT must link its island wrapper on the CLIENT leg: on a csr=true child page Kit
 * hydrates the layout, so its chrome islands must be REAL wrappers (Region degrades them inline),
 * not the thin stub the pure-csr=false path uses. A pure-csr=false app keeps the stub (thin client
 * graph); only mixed apps pay for the layout wrappers.
 */
export function hasAnyCsrTrueRoute(r: Routes, routesDir: string): boolean {
	return r.db.get(r.has_csr_true, routesDir);
}

/** The directory of the build-time keepalive layout; the route tree never walks into it. */
export const KEEP_CLIENT_DIR = '.ogygia-keep-client';

/**
 * Replicates Kit's `manifest_data.nodes.every(n => n.page_options?.csr === false)`, the exact
 * condition under which Kit skips the client build, over every node of the route tree (layouts,
 * error pages and pages, Kit's fallback root layout and error page included) with each node's csr
 * resolved as Kit resolves it. A single node whose csr is `true` or unset keeps the build alive.
 * When this is true, ogygia's runtime is never emitted, so index.ts injects the keepalive (its own
 * directory is not part of the tree). A statically unanalysable option file can only err toward a
 * keepalive Kit did not need: a harmless extra client build, never a 404.
 */
export function clientBuildWillSkip(r: Routes, routesDir: string): boolean {
	const tree = route_tree(r, routesDir);
	return tree.nodes.every((node) => node_csr(r, tree, node) === false);
}

/**
 * True when AT LEAST ONE page route is csr=false. A pure csr=true app (this returns false) needs no
 * ogygia runtime at all — Kit hydrates everything itself — so the runtime chunk is skipped entirely.
 */
export function hasAnyCsrFalseRoute(r: Routes, routesDir: string): boolean {
	const tree = route_tree(r, routesDir);
	return page_leaves(tree).some((leaf) => node_csr(r, tree, leaf) === false);
}

/** On-disk path of the injected keepalive route for a given app root. */
export function keep_client_dir(r: string): string {
	return path.join(kit_dirs(r).routes_dir, KEEP_CLIENT_DIR);
}

/** Write the URL-less `csr = true` keepalive layout into the app's routes (removed at process exit). */
export function inject_keep_client_route(r: string): void {
	const dir = keep_client_dir(r);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, '+layout.ts'),
		`${dedent`
			// Generated by ogygia for the duration of the build, then removed. A layout-only node —
			// no +page, so no servable URL — that stops SvelteKit skipping its client build when every
			// real route is csr = false. Safe to delete (gitignored; ogygia self-heals it).
			export const csr = true;
		`}\n`
	);
}

/** Remove leftover on-disk `.ogygia` trees from an earlier materialization approach. */
export function clean_stale_ogygia_dirs(dir: string): void {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return; // ok: a directory that is not there holds nothing stale
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const full = path.join(dir, entry.name);
		if (entry.name === 'node_modules') continue;
		if (entry.name === ISLAND_DIR) {
			fs.rmSync(full, { recursive: true, force: true });
			continue;
		}
		clean_stale_ogygia_dirs(full);
	}
}
