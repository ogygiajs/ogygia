/**
 * The export index: for a resolved module id, the map `exported name → leaf`, the module and name an
 * importer can go to directly. Built by walking the barrel's re-exports through nested barrels,
 * `export *` fan-outs and `import … ; export { … }` bindings, with a cycle guard and an `opaque` flag
 * for the parts it cannot see (a star into something it cannot parse).
 *
 * Two caches, split by what they depend on:
 * - {@link Shapes}: each module's parsed export/import shape. It depends on the file's text only, so
 *   one app keeps one, shared by every index (each file is parsed once).
 * - {@link ExportIndex}: one per RESOLVER. It caches each specifier's resolved target (per importer and
 *   specifier) and, per {@link Policy}, each barrel's map. Two resolvers answer the same specifier
 *   differently (the CSS walk's and a stage transform's skip different plugins), so they never share
 *   resolutions.
 *
 * CONCURRENCY: a bundler transforms hundreds of importers at once, and most of them ask for the same
 * few barrels. A policy's barrels are one flights keyed by id: one build per barrel is in flight and
 * every concurrent caller awaits it. An edit (`Shapes.invalidate`) drops a barrel whose build or map
 * depends on the changed file: a build in flight then ends STALE, stores nothing, and its callers
 * build again from the files as they are now. A cycle is detected against the WALK STACK of the build
 * that is running (a → b → a), never against another build's in-flight state; when a walk meets a
 * barrel some other walk is still building, it does not wait (two walks waiting on each other would
 * never finish): it leaves that name unresolved and marks its own map PROVISIONAL, so the map is
 * served once but not cached, and the next importer rebuilds it against the finished neighbour.
 */
import { flights, STALE } from '@ogygia/machine';
import { analyze_exports, type ModuleShape } from './parse.ts';

/** Which barrels a caller may go through, and how far. */
export interface Policy {
	/** May this resolved module be treated as a barrel at all? */
	candidate(id: string, spec: string): boolean;
	/** Is this module a barrel even though it is impure? */
	forced(id: string, spec: string): boolean;
	/** Is this module kept whatever it looks like? */
	kept(id: string, spec: string): boolean;
	/** Follow a star into node_modules? */
	follow_packages: boolean;
}

/** Every barrel, through packages too: what reaches a component's CSS (compiler/fouc-css.ts). */
export const EVERY_BARREL: Policy = {
	candidate: () => true,
	forced: () => false,
	kept: () => false,
	follow_packages: true
};

/** Resolve `spec` from `importer` to a file id, as `caller` resolves it; null when it cannot. */
export type Resolve<Caller> = (
	spec: string,
	importer: string,
	caller: Caller
) => Promise<string | null>;

/** What a file change did: an edit leaves resolutions alone, a file added or removed does not. */
export type Change = 'create' | 'update' | 'delete';

export type Leaf =
	/** `import { name } from id` (or `import local from id` when name is `default`) */
	| { id: string; name: string }
	/** `import * as local from id` */
	| { id: string; namespace: true };

export type Entry = Leaf | 'own' | 'ambiguous';

export interface ExportMap {
	id: string;
	/** the barrel's usable names */
	entries: Map<string, Entry>;
	/** pure barrel → the import can be dropped once every name moved; impure → kept for effects */
	pure: boolean;
	/** null: a barrel the policy goes through; else why it does not (`entries` is then empty) */
	left: null | 'impure' | 'kept' | 'outside-project';
	/** some names could not be seen (a star into the unparsable): unknown names stay on the barrel */
	opaque: boolean;
	/** every module this map depends on: a change to any of them invalidates the map */
	deps: Set<string>;
	/** built while a neighbour was still being built by another walk: served, not cached */
	provisional: boolean;
	/** ids on the walk stack this build ran into (a cycle): the map lacks THEIR names, so it is
	 *  cached only once the walk that owns them has closed the ring (the set is empty there) */
	cycles: Set<string>;
}

const STRIP_QUERY_RE = /[?#].*$/;
const NODE_MODULES_RE = /[\\/]node_modules[\\/]/;
const PARSABLE_RE = /\.(?:[cm]?[jt]sx?|svelte\.[jt]s)$/;
const BACKSLASH_G = /\\/g;

/** One spelling of a file id whichever resolver produced it (a walk's own ids keep theirs). */
const slashed = (id: string): string => id.replace(BACKSLASH_G, '/');

/** Something that caches what a file says, told when the file changes. */
interface Dependent {
	changed(id: string, change: Change): void;
}

/** One app's parsed module shapes, read once each and shared by every {@link ExportIndex}. */
export class Shapes {
	#read: (id: string) => string | null;
	#shapes = new Map<string, ModuleShape | null>();
	/** the indexes built over these shapes: they live as long as the app does */
	#dependents = new Set<Dependent>();

	/** `read`: the module's source, or null when it cannot be read (virtual, binary, missing). */
	constructor(read: (id: string) => string | null) {
		this.#read = read;
	}

	/** The parsed shape of a module (cached), or null when it cannot be read or parsed. */
	get(id: string): ModuleShape | null {
		const clean = id.replace(STRIP_QUERY_RE, '');
		const key = slashed(clean);
		if (this.#shapes.has(key)) return this.#shapes.get(key)!;
		let shape: ModuleShape | null = null;
		if (PARSABLE_RE.test(clean)) {
			const code = this.#read(clean);
			if (code != null) shape = analyze_exports(code, clean); // syntax error / not ESM → null → opaque
		}
		this.#shapes.set(key, shape);
		return shape;
	}

	/** The file `id` changed: drop its shape, and everything every index built from it. */
	invalidate(id: string, change: Change = 'update'): void {
		const key = slashed(id.replace(STRIP_QUERY_RE, ''));
		this.#shapes.delete(key);
		for (const d of this.#dependents) d.changed(key, change);
	}

	/** (an index registers itself as it is built) */
	depend(d: Dependent): void {
		this.#dependents.add(d);
	}
}

/** One resolver's export index: its resolutions, and each policy's barrel maps. */
export class ExportIndex<Caller = void> implements Dependent {
	readonly shapes: Shapes;
	#resolve: Resolve<Caller>;
	/** One resolution per importer and specifier, as the caller that asked first resolves it. */
	#resolved = flights.keyed<{ importer: string; spec: string; caller: Caller }>()({
		name: 'exports-resolve',
		key: ['importer', 'spec'],
		ignore: {
			caller:
				'every caller of one index resolves alike (the index is per resolver), so the first one answers'
		},
		run: ({ importer, spec, caller }) => this.#resolve(spec, importer, caller),
		keep: () => Infinity
	});
	/** each policy's walk over this index's shapes and resolutions, memoized per barrel id (a policy
	 *  is one object per caller kind, made once: fouc-css's, and each plugin's through `b.exports`) */
	#walks = new Map<Policy, Walk<Caller>>();

	constructor(resolve: Resolve<Caller>, shapes: Shapes) {
		this.#resolve = resolve;
		this.shapes = shapes;
		shapes.depend(this);
	}

	/** A specifier resolved from `importer` (cached per importer and specifier). */
	async resolve(spec: string, importer: string, caller: Caller): Promise<string | null> {
		for (;;) {
			const got = await this.#resolved.get({ importer, spec, caller });
			if (got !== STALE) return got;
		}
	}

	/**
	 * The export map of a barrel, or null when the module is not a barrel `policy` lets the caller go
	 * through (not a candidate, impure and not forced, kept, unreadable). `spec` is the specifier the
	 * importer wrote: the policy sees both. Concurrent callers share one build.
	 */
	map(id: string, spec: string, policy: Policy, caller: Caller): Promise<ExportMap | null> {
		let walk = this.#walks.get(policy);
		if (walk === undefined) {
			walk = new Walk(this, policy);
			this.#walks.set(policy, walk);
		}
		return walk.map(id, spec, caller);
	}

	changed(id: string, change: Change): void {
		// a file added or removed can change what any specifier resolves to, and so any map (one that
		// could not resolve the new file never listed it); an edit changes only the maps that read it
		const any = change !== 'update';
		if (any) this.#resolved.drop(() => true);
		for (const walk of this.#walks.values()) walk.changed(id, any);
	}
}

/** The walk in progress: the ids on the current recursion path (cycle detection), and the caller
 *  whose resolve it walks with (a nested build started on the way walks with it too). */
interface Path<Caller> {
	stack: ReadonlySet<string>;
	caller: Caller;
}

/** What a barrel's flight does: build its map (`shape`: the module, parsed; `path`: the walk that
 *  asked), or answer that it is not a barrel this policy goes through (`build: null`). */
type BuildAsk<Caller> = {
	id: string;
	build: { shape: ModuleShape; path: Path<Caller> } | null;
};

/** One policy's barrel maps over one index. */
class Walk<Caller> {
	#index: ExportIndex<Caller>;
	#policy: Policy;
	/** One build per barrel: its map is kept until an edit to the barrel or to one of its deps
	 *  (null: not a barrel this policy goes through); a provisional map, or one that lacks a ring's
	 *  names, is served to the callers of its build, not kept. */
	#barrels = flights.keyed<BuildAsk<Caller>>()({
		name: 'exports-barrel',
		key: ['id'],
		ignore: {
			build:
				'what the ask that starts the flight found of the file: a barrel is built once, as that caller resolves'
		},
		run: async ({ id, build }): Promise<ExportMap | null> =>
			build === null ? null : this.#build_of(id, build.shape, build.path),
		keep: (map) => (map !== null && (map.provisional || map.cycles.size > 0) ? 0 : Infinity)
	});
	/** The map each build in flight has met so far (its deps among it), for `changed`. */
	#building = new Map<string, ExportMap>();

	constructor(index: ExportIndex<Caller>, policy: Policy) {
		this.#index = index;
		this.#policy = policy;
	}

	/** Drop every cached map that depends on `id` (slashed), or every map at all (`any`), and every
	 *  build in flight that has met it so far (one it meets later reads the file as it is now). */
	changed(id: string, any: boolean): void {
		this.#barrels.drop(({ id: k }, entry) => {
			if (any || slashed(k) === id) return true;
			const map = entry.kind === 'kept' ? entry.answer : this.#building.get(k);
			if (map == null) return false;
			if (map.deps.has(id)) return true;
			for (const d of map.deps) if (slashed(d) === id) return true;
			return false;
		});
	}

	async map(id: string, spec: string, caller: Caller): Promise<ExportMap | null> {
		const clean = id.replace(STRIP_QUERY_RE, '');
		if (clean !== id) return null; // `?raw`, `?url`, a virtual query: never a barrel
		if (this.#policy.kept(clean, spec)) return this.#left(clean, 'kept');
		if (!this.#policy.candidate(clean, spec)) return this.#left(clean, 'outside-project');
		// (again while an edit drops the build it waited on: the next one reads the files as they are)
		for (;;) {
			const got = await this.#barrels.get(this.#ask(clean, spec, caller));
			// (null from a parsed module: impure and not forced)
			if (got !== STALE) return got ?? this.#left(clean, 'impure');
		}
	}

	/** The answer for a barrel this policy does not go through: a map that says why, or null when the
	 *  module re-exports nothing (it is no barrel, nothing to say) or cannot be parsed. */
	#left(id: string, left: NonNullable<ExportMap['left']>): ExportMap | null {
		const shape = this.#index.shapes.get(id);
		if (!shape || !shape.exports.some((e) => e.kind !== 'own')) return null;
		return {
			id,
			entries: new Map(),
			pure: shape.pure,
			left,
			opaque: false,
			deps: new Set([id]),
			provisional: false,
			cycles: new Set()
		};
	}

	/** What a caller of `map()` asks for: the barrel's build, or (it is not one) null. Only the ask
	 *  that starts the barrel's flight runs; a built or building barrel is not looked at again. */
	#ask(id: string, spec: string, caller: Caller): BuildAsk<Caller> {
		if (this.#barrels.peek({ id }) !== undefined) return { id, build: null };
		const shape = this.#index.shapes.get(id);
		if (!shape || (!shape.pure && !this.#policy.forced(id, spec))) return { id, build: null };
		return { id, build: { shape, path: { stack: new Set(), caller } } };
	}

	#resolve(spec: string, importer: string, path: Path<Caller>): Promise<string | null> {
		return this.#index.resolve(spec, importer, path.caller);
	}

	/** One build of `id` (a barrel's flight): kept once built unless provisional; STALE to its
	 *  callers when an edit drops it first (it stores nothing then). */
	async #build_of(id: string, shape: ModuleShape, path: Path<Caller>): Promise<ExportMap> {
		const map: ExportMap = {
			id,
			entries: new Map(),
			pure: shape.pure,
			left: null,
			opaque: false,
			deps: new Set([id]),
			provisional: false,
			cycles: new Set()
		};
		this.#building.set(id, map);
		try {
			return await this.#build(map, shape, path);
		} finally {
			if (this.#building.get(id) === map) this.#building.delete(id);
		}
	}

	async #build(map: ExportMap, shape: ModuleShape, outer: Path<Caller>): Promise<ExportMap> {
		const id = map.id;
		const path: Path<Caller> = { stack: new Set([...outer.stack, id]), caller: outer.caller };
		// Explicit exports first (they win over stars: the spec shadows a star's name with a local
		// export), stars after: a star never overrides an explicit name, and two stars with different
		// leaves for one name make it ambiguous (a SyntaxError to import per spec; we leave it on the
		// barrel). `explicit` also covers a name a re-export could not resolve: unknown, not star-filled.
		const stars: { source: string; type_only: boolean }[] = [];
		const explicit = new Set<string>();
		for (const rec of shape.exports) {
			if (rec.kind === 'own') {
				map.entries.set(rec.exported, 'own');
				explicit.add(rec.exported);
			} else if (rec.kind === 'reexport') {
				explicit.add(rec.exported);
				const leaf = await this.#leaf(id, rec.source, rec.imported, map, path);
				if (leaf) map.entries.set(rec.exported, leaf);
				else map.opaque = true; // the target could not be resolved: that name stays on the barrel
			} else if (rec.kind === 'star_ns') {
				explicit.add(rec.exported);
				const target = await this.#resolve(rec.source, id, path);
				if (target)
					map.entries.set(rec.exported, {
						id: target.replace(STRIP_QUERY_RE, ''),
						namespace: true
					});
				else map.opaque = true;
			} else stars.push({ source: rec.source, type_only: rec.type_only });
		}
		for (const star of stars) {
			const target = await this.#resolve(star.source, id, path);
			if (!target || target !== target.replace(STRIP_QUERY_RE, '')) {
				map.opaque = true;
				continue;
			}
			if (!this.#policy.follow_packages && NODE_MODULES_RE.test(target)) {
				map.opaque = true;
				continue;
			}
			map.deps.add(target);
			const names = await this.#star_names(target, map, path);
			if (!names) {
				map.opaque = true;
				continue;
			}
			for (const [name, leaf] of names) {
				if (name === 'default') continue; // a star never re-exports default
				if (explicit.has(name)) continue;
				const existing = map.entries.get(name);
				if (existing === undefined) map.entries.set(name, leaf);
				else if (existing !== leaf && !same_leaf(existing, leaf))
					map.entries.set(name, 'ambiguous');
			}
		}
		return map;
	}

	/** The leaf behind `import { imported } from source` written inside barrel `from`. */
	async #leaf(
		from: string,
		source: string,
		imported: string,
		map: ExportMap,
		path: Path<Caller>
	): Promise<Leaf | null> {
		const target = await this.#resolve(source, from, path);
		if (!target) return null;
		if (target !== target.replace(STRIP_QUERY_RE, '')) return null; // `?raw` etc.: leave it
		map.deps.add(target);
		// The target may itself be a barrel: look THROUGH it. Its map, if it is one we may build
		// (pure), tells us the real leaf; otherwise the target IS the leaf.
		const inner = await this.#through(target, map, path);
		if (inner) {
			const e = inner.entries.get(imported);
			if (e && e !== 'own' && e !== 'ambiguous') return e;
			if (e === 'ambiguous') return null;
			// 'own' or unknown: the target module is where the name lives (or the best we know)
		}
		return { id: target, name: imported };
	}

	/**
	 * Look through a nested module while building a map. Unlike `map()`, this does not require the
	 * nested module to be a CANDIDATE (an importer's policy), only that it is pure: a pure nested
	 * barrel is transparent, an impure one is a leaf in its own right (its own code must run for the
	 * name to exist). On our own walk stack = a cycle (null); in flight on another walk = do not wait
	 * (null, and the parent becomes provisional).
	 */
	async #through(id: string, parent: ExportMap, path: Path<Caller>): Promise<ExportMap | null> {
		if (this.#policy.kept(id, id)) return null;
		const s = this.#barrels.peek({ id });
		if (s?.kind === 'kept') {
			const m = s.answer;
			if (m) for (const d of m.deps) parent.deps.add(d);
			return m;
		}
		if (path.stack.has(id)) {
			// a ring: the parent lacks this module's names until the build that owns it closes the
			// ring (a self-star is the trivial ring: nothing is missing)
			if (id !== parent.id) parent.cycles.add(id);
			return null;
		}
		if (s !== undefined) {
			// building on another walk
			parent.provisional = true;
			return null;
		}
		const shape = this.#index.shapes.get(id);
		if (!shape || !shape.pure) return null;
		const built = await this.#barrels.get({ id, build: { shape, path } });
		// an edit dropped the nested build mid-walk: its names stay on the parent, served once
		if (built === STALE) {
			parent.provisional = true;
			return null;
		}
		if (built === null) return null;
		if (built.provisional) parent.provisional = true;
		for (const c of built.cycles) if (c !== parent.id) parent.cycles.add(c);
		for (const d of built.deps) parent.deps.add(d);
		return built;
	}

	/** Every non-default name `export * from target` contributes, mapped to its leaf. A star walk
	 *  visits each module once, as the spec's `GetExportedNames` does (`seen`): a module already on
	 *  it adds nothing (test: exports-index `a ring of impure modules`). */
	async #star_names(
		target: string,
		parent: ExportMap,
		path: Path<Caller>,
		seen: Set<string> = new Set([parent.id])
	): Promise<Map<string, Leaf> | null> {
		const out = new Map<string, Leaf>();
		if (seen.has(target)) return out;
		seen.add(target);
		const shape = this.#index.shapes.get(target);
		if (!shape) return null;
		if (shape.pure) {
			const inner = await this.#through(target, parent, path);
			if (!inner) return null;
			if (inner.opaque) parent.opaque = true;
			for (const [name, e] of inner.entries) {
				if (e === 'own') out.set(name, { id: target, name });
				else if (e !== 'ambiguous') out.set(name, e);
			}
			return out;
		}
		// an impure module: its own names live here; its re-exports still resolve through it
		for (const rec of shape.exports) {
			if (rec.kind === 'own') out.set(rec.exported, { id: target, name: rec.exported });
			else if (rec.kind === 'reexport') {
				const leaf = await this.#leaf(target, rec.source, rec.imported, parent, path);
				if (leaf) out.set(rec.exported, leaf);
				else parent.opaque = true;
			} else if (rec.kind === 'star_ns') {
				const t = await this.#resolve(rec.source, target, path);
				if (t) out.set(rec.exported, { id: t.replace(STRIP_QUERY_RE, ''), namespace: true });
			} else {
				// a star inside an impure module: follow it too
				const t = await this.#resolve(rec.source, target, path);
				if (!t) {
					parent.opaque = true;
					continue;
				}
				parent.deps.add(t);
				const names = await this.#star_names(t, parent, path, seen);
				if (!names) {
					parent.opaque = true;
					continue;
				}
				for (const [n, leaf] of names) if (n !== 'default' && !out.has(n)) out.set(n, leaf);
			}
		}
		return out;
	}
}

function same_leaf(a: Entry, b: Entry): boolean {
	if (typeof a === 'string' || typeof b === 'string') return a === b;
	if ('namespace' in a || 'namespace' in b)
		return 'namespace' in a && 'namespace' in b && a.id === b.id;
	return a.id === b.id && a.name === b.name;
}
