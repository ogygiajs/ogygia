/**
 * The barrel index: for a resolved module id, the map `exported name → leaf` — the module and
 * name an importer can go to directly. Built by walking the barrel's re-exports through nested
 * barrels, `export *` fan-outs and `import … ; export { … }` bindings, with a cycle guard and an
 * `opaque` flag for the parts it cannot see (a star into something it cannot parse).
 *
 * Pure over an injected HOST (read a file, resolve a specifier, decide candidacy), so it is
 * unit-tested against fixture files with a tiny resolver and runs unchanged inside the Vite plugin
 * with `this.resolve`.
 *
 * CONCURRENCY: a bundler transforms hundreds of importers at once, and most of them ask for the same
 * few barrels. The barrels are one flights keyed by id: one build per barrel is in flight and every
 * concurrent caller awaits it. An edit (`invalidate`) drops a barrel whose build or map depends on
 * the changed file: a build in flight then ends STALE, stores nothing, and its callers build again
 * from the files as they are now (dev: a barrel saved while a transform resolves through it). A cycle is detected against the WALK STACK of the build that is running (a → b → a), never
 * against another build's in-flight state; when a walk meets a barrel some other walk is still
 * building, it does not wait (two walks waiting on each other would never finish) — it leaves that
 * name unresolved and marks its own map PROVISIONAL, so the map is served once but not cached, and
 * the next importer rebuilds it against the finished neighbour.
 */
import { flights, STALE } from '@ogygia/machine';
import { analyze_exports, type ModuleShape } from './parse.ts';

/** `Caller`: who asked for the map (`map(id, spec, caller)`), handed to every resolve of its walk —
 *  the Vite plugin's transform context, whose own `resolve` knows its environment's conditions. */
export interface Host<Caller = void> {
	/** The module's source, or null when it cannot be read (virtual, binary, missing). */
	read(id: string): string | null;
	/** Resolve `spec` from `importer` to a file id, as `caller` resolves it; null when Vite cannot. */
	resolve(spec: string, importer: string, caller: Caller): Promise<string | null>;
	/** May this resolved module be treated as a barrel at all? (matchers + node_modules policy) */
	candidate(id: string, spec: string): boolean;
	/** Is this module forced even though impure? */
	forced(id: string, spec: string): boolean;
	/** Is this module kept whatever it looks like? */
	kept(id: string, spec: string): boolean;
	/** Follow a star into node_modules? */
	follow_packages: boolean;
}

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
	/** rewriting allowed at all (candidate, and pure or forced, and not kept) */
	rewritable: boolean;
	/** some names could not be seen (a star into the unparsable): unknown names stay on the barrel */
	opaque: boolean;
	/** every module this map depends on — a change to any of them invalidates the map */
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

/** The walk in progress: the ids on the current recursion path (cycle detection), and the caller
 *  whose resolve it walks with (a nested build started on the way walks with it too). */
interface Walk<Caller> {
	stack: ReadonlySet<string>;
	caller: Caller;
}

/** What a barrel's flight does: build its map (`shape`: the module, parsed; `walk`: the walk that
 *  asked), or answer that it is not a barrel we rewrite (`build: null`). */
type BuildAsk<Caller> = {
	id: string;
	build: { shape: ModuleShape; walk: Walk<Caller> } | null;
};

/** One index caches the maps its callers' walks built, so every caller of one index must resolve
 *  alike: the Vite plugin keeps one index per environment (a leaf may resolve to another file for
 *  the client than for the server). */
export class BarrelIndex<Caller = void> {
	#host: Host<Caller>;
	/** One build per barrel: its map is kept until an edit to the barrel or to one of its deps
	 *  (null: not a barrel we rewrite); a provisional map, or one that lacks a ring's names, is
	 *  served to the callers of its build, not kept. */
	#barrels = flights<BuildAsk<Caller>>()({
		name: 'debarrel-barrel',
		key: ['id'],
		ignore: {
			build: 'what the ask that starts the flight found of the file: a barrel is built once, as that caller resolves'
		},
		run: async ({ id, build }): Promise<ExportMap | null> =>
			build === null ? null : this.#build_of(id, build.shape, build.walk),
		keep: (map) => (map !== null && (map.provisional || map.cycles.size > 0) ? 0 : Infinity)
	});
	/** The map each build in flight has met so far (its deps among it), for `invalidate`. */
	#building = new Map<string, ExportMap>();
	#shapes = new Map<string, ModuleShape | null>();

	constructor(host: Host<Caller>) {
		this.#host = host;
	}

	/** Drop every cached map/shape that depends on `id` (the file changed), and every build in flight
	 *  that has met it so far (one it meets later reads the file as it is now). */
	invalidate(id: string): void {
		const clean = id.replace(STRIP_QUERY_RE, '');
		this.#shapes.delete(clean);
		this.#barrels.drop(({ id: k }, entry) => {
			if (k === clean) return true;
			const map = entry.kind === 'kept' ? entry.answer : this.#building.get(k);
			return map != null && map.deps.has(clean);
		});
	}

	/** The parsed shape of a module (cached), or null when it cannot be read/parsed. */
	shape(id: string): ModuleShape | null {
		const clean = id.replace(STRIP_QUERY_RE, '');
		if (this.#shapes.has(clean)) return this.#shapes.get(clean)!;
		let shape: ModuleShape | null = null;
		if (PARSABLE_RE.test(clean)) {
			const code = this.#host.read(clean);
			if (code != null) shape = analyze_exports(code, clean); // syntax error / not ESM → null → opaque
		}
		this.#shapes.set(clean, shape);
		return shape;
	}

	/**
	 * The export map of a barrel, or null when the module is not a barrel the plugin may rewrite
	 * (not a candidate, impure and not forced, kept, unreadable). `spec` is the specifier the
	 * importer wrote — matchers see both. Concurrent callers share one build; a build resolves as
	 * the `caller` that started it.
	 */
	async map(id: string, spec: string, caller: Caller): Promise<ExportMap | null> {
		const clean = id.replace(STRIP_QUERY_RE, '');
		if (clean !== id) return null; // `?raw`, `?url`, a virtual query — never a barrel
		if (this.#host.kept(clean, spec)) return null;
		if (!this.#host.candidate(clean, spec)) return null;
		// (again while an edit drops the build it waited on: the next one reads the files as they are)
		for (;;) {
			const got = await this.#barrels.get(this.#ask(clean, spec, caller));
			if (got !== STALE) return got;
		}
	}

	/** What a caller of `map()` asks for: the barrel's build, or (it is not one) null. Only the ask
	 *  that starts the barrel's flight runs; a built or building barrel is not looked at again. */
	#ask(id: string, spec: string, caller: Caller): BuildAsk<Caller> {
		if (this.#barrels.peek({ id }) !== undefined) return { id, build: null };
		const shape = this.shape(id);
		if (!shape || (!shape.pure && !this.#host.forced(id, spec))) return { id, build: null };
		return { id, build: { shape, walk: { stack: new Set(), caller } } };
	}

	/** One build of `id` (a barrel's flight): kept once built unless provisional; STALE to its
	 *  callers when an edit drops it first (it stores nothing then). */
	async #build_of(id: string, shape: ModuleShape, walk: Walk<Caller>): Promise<ExportMap> {
		const map: ExportMap = {
			id,
			entries: new Map(),
			pure: shape.pure,
			rewritable: true,
			opaque: false,
			deps: new Set([id]),
			provisional: false,
			cycles: new Set()
		};
		this.#building.set(id, map);
		try {
			return await this.#build(map, shape, walk);
		} finally {
			if (this.#building.get(id) === map) this.#building.delete(id);
		}
	}

	async #build(map: ExportMap, shape: ModuleShape, outer: Walk<Caller>): Promise<ExportMap> {
		const id = map.id;
		const walk: Walk<Caller> = { stack: new Set([...outer.stack, id]), caller: outer.caller };
		// Explicit exports first (they win over stars: the spec shadows a star's name with a local
		// export), stars after — a star never overrides an explicit name, and two stars with different
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
				const leaf = await this.#leaf(id, rec.source, rec.imported, map, walk);
				if (leaf) map.entries.set(rec.exported, leaf);
				else map.opaque = true; // the target could not be resolved: that name stays on the barrel
			} else if (rec.kind === 'star_ns') {
				explicit.add(rec.exported);
				const target = await this.#host.resolve(rec.source, id, walk.caller);
				if (target)
					map.entries.set(rec.exported, {
						id: target.replace(STRIP_QUERY_RE, ''),
						namespace: true
					});
				else map.opaque = true;
			} else stars.push({ source: rec.source, type_only: rec.type_only });
		}
		for (const star of stars) {
			const target = await this.#host.resolve(star.source, id, walk.caller);
			if (!target || target !== target.replace(STRIP_QUERY_RE, '')) {
				map.opaque = true;
				continue;
			}
			if (!this.#host.follow_packages && NODE_MODULES_RE.test(target)) {
				map.opaque = true;
				continue;
			}
			map.deps.add(target);
			const names = await this.#star_names(target, map, walk);
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
		walk: Walk<Caller>
	): Promise<Leaf | null> {
		const target = await this.#host.resolve(source, from, walk.caller);
		if (!target) return null;
		if (target !== target.replace(STRIP_QUERY_RE, '')) return null; // `?raw` etc. — leave it
		map.deps.add(target);
		// The target may itself be a barrel: look THROUGH it. Its map, if it is one we may build
		// (pure), tells us the real leaf; otherwise the target IS the leaf.
		const inner = await this.#through(target, map, walk);
		if (inner) {
			const e = inner.entries.get(imported);
			if (e && e !== 'own' && e !== 'ambiguous') return e;
			if (e === 'ambiguous') return null;
			// 'own' or unknown: the target module is where the name lives (or the best we know)
		}
		return { id: target, name: imported };
	}

	/**
	 * Look through a nested module while building a map. Unlike `map()`, this does not require
	 * the nested module to be a CANDIDATE (an importer's rewrite policy) — only that it is pure:
	 * a pure nested barrel is transparent, an impure one is a leaf in its own right (its own code
	 * must run for the name to exist). On our own walk stack = a cycle (null); in flight on another
	 * walk = do not wait (null, and the parent becomes provisional).
	 */
	async #through(id: string, parent: ExportMap, walk: Walk<Caller>): Promise<ExportMap | null> {
		if (this.#host.kept(id, id)) return null;
		const s = this.#barrels.peek({ id });
		if (s?.kind === 'kept') {
			const m = s.answer;
			if (m) for (const d of m.deps) parent.deps.add(d);
			return m;
		}
		if (walk.stack.has(id)) {
			// a ring: the parent lacks this module's names until the build that owns it closes the
			// ring (a self-star is the trivial ring — nothing is missing)
			if (id !== parent.id) parent.cycles.add(id);
			return null;
		}
		if (s !== undefined) {
			// building on another walk
			parent.provisional = true;
			return null;
		}
		const shape = this.shape(id);
		if (!shape || !shape.pure) return null;
		const built = await this.#barrels.get({ id, build: { shape, walk } });
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

	/** Every non-default name `export * from target` contributes, mapped to its leaf. */
	async #star_names(
		target: string,
		parent: ExportMap,
		walk: Walk<Caller>
	): Promise<Map<string, Leaf> | null> {
		const shape = this.shape(target);
		if (!shape) return null;
		const out = new Map<string, Leaf>();
		if (shape.pure) {
			const inner = await this.#through(target, parent, walk);
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
				const leaf = await this.#leaf(target, rec.source, rec.imported, parent, walk);
				if (leaf) out.set(rec.exported, leaf);
				else parent.opaque = true;
			} else if (rec.kind === 'star_ns') {
				const t = await this.#host.resolve(rec.source, target, walk.caller);
				if (t) out.set(rec.exported, { id: t.replace(STRIP_QUERY_RE, ''), namespace: true });
			} else {
				// a star inside an impure module: follow it too
				const t = await this.#host.resolve(rec.source, target, walk.caller);
				if (!t) {
					parent.opaque = true;
					continue;
				}
				parent.deps.add(t);
				const names = await this.#star_names(t, parent, walk);
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
