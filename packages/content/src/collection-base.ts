/**
 * `Collection` — the browser-safe, stateful core behind `content()`. Holds a catalog of REFS (never
 * bodies), the graph (relations + backlinks), and the live lifecycle. It consumes a single
 * {@link Source} (`{ init?, refs, get, live?, groups? }`).
 *
 * The refs/get split is load-bearing here: the catalog is materialized from `source.refs()` — pure
 * metadata — so nav/outline/graph never fetch a body. A body is fetched exactly once, by `get(id)`, on
 * the read that renders it. Visibility (`filter`) is applied at READ time with an optional request
 * context, so the catalog stays a single unfiltered instance (no per-request cache to poison).
 */
import type { ContentRef, ContentRelations, Entry, RefEntry, SchemaLike } from './index.ts';
import type { GroupMeta, Source, SourceEntry, SourceRef } from './source.ts';
import {
	backoffAfter,
	defining,
	flights,
	machine,
	policy,
	scope,
	world,
	type Flights,
	type Policy,
	type Scope,
	type World
} from '@ogygia/machine';
import { GRAPH } from './graph.ts';
import { parseSchema } from './schema.ts';
import { OgygiaError } from './messages/runtime.ts';

/** How a live connection that dropped is opened again: after 1 s, doubling up to a minute (the last
 *  wait repeats; it never stops trying while the collection runs), each wait cut by up to a fifth
 *  so every instance a source dropped at once does not come back at the same moment. */
const LIVE_RECONNECT: Policy = policy({
	attempts: 1,
	backoff: [1000, 2000, 4000, 8000, 16_000, 32_000, 60_000],
	jitter: 0.2,
	deadline: Infinity
});

/** An open live connection: its changes (none when `live()` threw as it was called: its pull failed),
 *  and the pull out on it now. */
type LiveConnection = {
	changes: AsyncIterator<unknown> | null;
	pending: Promise<IteratorResult<unknown>>;
};

/** A failure seen elsewhere (where it is reported), on a promise nothing else awaits. */
function ignore(): void {}

/** Ends a live connection's changes (a source unsubscribes in its iterator's `return()`). */
function close(changes: AsyncIterator<unknown>): unknown {
	return changes.return?.();
}

/**
 * A collection's life. `idle` until a read needs its catalog; `running` from then: its start (the
 * first full read with the live connection, kept once it succeeds), and the live connection it
 * follows. `disposed` once a newer run of its module (an edit, in dev) built the collection that
 * replaces it: leaving `running` closed its connection and cleared its retry, and it is out of the
 * graph (#247). A module that kept it across runs may read it again: back to `idle`, in the graph.
 */
const collection_life = machine<{
	idle: {};
	running: { start: Flights<void, void> };
	disposed: {};
}>()({
	name: 'content-collection',
	initial: 'idle',
	steps: { idle: ['running', 'disposed'], running: ['disposed'], disposed: ['idle'] }
});
type CollectionLife = ReturnType<typeof collection_life.create>;
type Running = Extract<CollectionLife['now'], { kind: 'running' }>;

/** Back-pointer from a public handle to its underlying `Collection` (relations resolve through it). */
export const COLLECTION: unique symbol = Symbol.for('ogygia.content.collection');

/** The catalog version of a collection (a `content()` handle or a Collection): the stamp of the
 *  world its catalog is in now, which what is read from it takes BEFORE the read. Null for a
 *  collection this package did not make (it has no world: whatever reads it never sees it change). */
export function catalog_version(collection: unknown): number | null {
	return to_collection(collection)?.version() ?? null;
}

/** The catalog version once the collection has loaded: the stamp a read takes before it reads. A
 *  stamp taken before the first load is moved by that load, which is not a change (#545). */
export async function catalog_loaded(collection: unknown): Promise<number | null> {
	const c = to_collection(collection);
	if (c === undefined) return null;
	await c.ready();
	return c.version();
}

/** Whether what was read from `collection` at `version` (`catalog_version`) is still its catalog:
 *  nothing changed since. */
export function catalog_fresh(collection: unknown, version: number | null): boolean {
	const c = to_collection(collection);
	return c === undefined ? version === null : version !== null && world_of(c).fresh(version);
}

/** A collection's world (set by the class, which alone holds it). */
let world_of: (c: Collection<Record<string, unknown>>) => World;

/** Resolve a relation value (a handle or a Collection) to its Collection, or undefined. */
function to_collection(value: unknown): Collection<Record<string, unknown>> | undefined {
	if (value instanceof Collection) return value as Collection<Record<string, unknown>>;
	if (value && typeof value === 'object') {
		const linked = (value as Record<symbol, unknown>)[COLLECTION];
		if (linked instanceof Collection) return linked as Collection<Record<string, unknown>>;
	}
	return undefined;
}

/** A relation frontmatter field is one id (string) or many (string[]). */
function ref_ids(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
	return [];
}
function to_ref(entry: ContentRef): RefEntry {
	return { id: entry.id, data: entry.data };
}

/** A request context threaded into the `filter` at read time (preview, roles). Flat + bounded. */
export type ReadContext = Record<string, unknown>;

/** Options for a `content()` collection. `loader` is a source; formats build the source. */
export type CollectionBaseOptions<
	Data extends Record<string, unknown> = Record<string, unknown>,
	Meta = Record<string, never>
> = {
	loader: Source<Meta>;
	/** One schema, or an ARRAY of schemas layered left→right (outputs merge; later wins on collision). */
	schema?: SchemaLike | SchemaLike[];
	filter?: (entry: ContentRef<Data, Meta>, ctx: ReadContext) => boolean;
	/**
	 * Relations to other collections — always a `(self) => object` callback. `self` is this
	 * collection's own handle, so a SELF relation is `related: self` with no reference to the `const`
	 * being defined (no type cycle, no annotation). One form, always.
	 */
	relations?: (self: unknown) => ContentRelations;
};

// ── the Collection ───────────────────────────────────────────────────────────

export class Collection<
	Data extends Record<string, unknown> = Record<string, unknown>,
	Meta = Record<string, never>
> {
	readonly #opts: CollectionBaseOptions<Data, Meta>;
	readonly #source: Source<Meta>;
	readonly #schema: SchemaLike[];
	readonly #catalog = new Map<string, ContentRef<Data, Meta>>();
	readonly #visible: (entry: ContentRef<Data, Meta>, ctx: ReadContext) => boolean;
	/** This collection's own handle (for the `relations: (self) => …` callback). */
	#self: unknown;
	#relationsDef: Record<string, unknown> = {};
	#relationNames: string[] = [];
	#relationsResolved = false;

	/** The source's `init`, and (in `running`) the first full read with the live connection: each
	 *  runs once, and a failure is never kept (one source outage once broke the collection until a
	 *  restart, #189). */
	readonly #init = flights({
		name: 'content-collection init',
		run: async () => {
			await this.#source.init?.();
		}
	});
	readonly #life: CollectionLife = collection_life.create();
	/** Its time in the graph: from when it joins (made, or read again after a dispose) until it is
	 *  disposed. The graph holds it under this scope. */
	#in_graph: Scope = scope();
	/** The live connection, while it is open: one per collection. A read that fails leaves it open
	 *  (an async iterator's `return()` waits behind its pull, so it cannot be closed while the source
	 *  is quiet), and the next read listens on it again instead of opening another. */
	#connection: LiveConnection | null = null;
	/** The world the catalog is in: each change to it moves it (`#notify`). */
	readonly #world = world();
	static {
		world_of = (c) => c.#world;
	}
	/** How many times it was disposed: a watcher started before the last one has ended. */
	#disposals = 0;
	readonly #waiters = new Set<() => void>();
	#backlinkIndex: Map<string, RefEntry[]> | null = null;
	/** The worlds the backlink index was built from, each at its stamp: it stands while the same
	 *  collections (by identity: a dev reload's replacement has its own world) are all still fresh. */
	#backlinkFrom: readonly { world: World; stamp: number }[] = [];

	constructor(opts: CollectionBaseOptions<Data, Meta>) {
		if (!opts || opts.loader == null) throw new OgygiaError('content_loader_missing');
		if (typeof opts.loader.refs !== 'function' || typeof opts.loader.get !== 'function') {
			throw new OgygiaError('content_loader_not_source');
		}
		this.#opts = opts;
		this.#source = opts.loader;
		this.#schema =
			opts.schema == null ? [] : Array.isArray(opts.schema) ? opts.schema : [opts.schema];
		this.#visible = opts.filter ?? (() => true);
		// Dev: the run of the module whose content() call builds it (core marks each call: `content` is
		// this plugin's definer). The module's next run ends it, and the collection with it: the new
		// run builds the one that replaces it, and one deleted from the code is gone. In the graph
		// first: a run already ended disposes it at once, which takes it out again (lifecycle.test.ts).
		GRAPH.all.add(this as unknown as Collection<Record<string, unknown>>, this.#in_graph);
		defining()?.defer(() => this.#dispose());
	}

	/**
	 * Dev: a newer run of this collection's module built the one that replaces it. It stops
	 * following its source (the live connection closed, a pending retry cleared) and leaves the
	 * graph. Reading it again (its module kept it) puts it back, and starts it again.
	 */
	#dispose(): void {
		if (this.#life.now.kind === 'disposed') return;
		this.#life.go('disposed');
		this.#in_graph.close(); // (it leaves the graph)
		// its watchers end (see watchChanges)
		this.#disposals++;
		for (const wake of this.#waiters) wake();
	}

	/** A disposed collection read again: back in the graph, to start when its catalog is needed. */
	#awake(): void {
		if (this.#life.move('disposed', 'idle')) {
			this.#in_graph = scope();
			GRAPH.all.add(this as unknown as Collection<Record<string, unknown>>, this.#in_graph);
		}
	}

	/** Leaving `running`: the live connection closed (its pull may never answer: nothing waits on
	 *  it). (A pending retry is the visit's timer: it goes with it.) */
	#stop_following(): void {
		const connection = this.#connection;
		this.#connection = null;
		const changes = connection?.changes;
		if (changes) void Promise.resolve(changes).then(close).catch(ignore);
	}

	/** Supply the collection's own handle for the `relations: (self) => …` callback. */
	bindSelf(self: unknown): void {
		this.#self = self;
	}

	#resolveRelations(): void {
		if (this.#relationsResolved) return;
		this.#relationsResolved = true;
		if (this.#opts.relations) {
			this.#relationsDef = this.#opts.relations(this.#self) as Record<string, unknown>;
			this.#relationNames = Object.keys(this.#relationsDef);
		}
	}

	get streaming(): boolean {
		return !!this.#source.live;
	}
	get fromIsFunction(): boolean {
		return !!this.#source.live || !!(this.#source as { dynamic?: boolean }).dynamic;
	}

	/** Directory/section decoration from the source, if it exposes any (`folder()` / a CMS folders API). */
	groups(): Promise<Map<string, GroupMeta>> {
		return this.#source.groups?.() ?? Promise.resolve(new Map());
	}

	/** AND-compose a per-remote filter onto collection visibility (narrow only). */
	compose(
		extra?: (entry: ContentRef<Data, Meta>) => boolean,
		ctx: ReadContext = {}
	): (e: ContentRef<Data, Meta>) => boolean {
		return extra
			? (e: ContentRef<Data, Meta>) => this.#visible(e, ctx) && extra(e)
			: (e: ContentRef<Data, Meta>) => this.#visible(e, ctx);
	}

	#notify() {
		this.#world.bump();
		for (const wake of this.#waiters) wake();
	}

	snapshot(): ContentRef<Data, Meta>[] {
		return [...this.#catalog.values()];
	}
	version(): number {
		return this.#world.stamp();
	}

	/** Each new catalog version, from `from` on (default: the version now). Pass the version of the
	 *  snapshot already handed out, so a change made while it was being used is yielded at once
	 *  (taking the version on the first pull missed it, #191). It ends once the collection is
	 *  disposed: a replaced collection changes no more, so a live remote streaming it ends instead of
	 *  waiting forever (#247). */
	async *watchChanges(from?: number): AsyncGenerator<number> {
		const w = this.#world;
		let seen = from ?? w.stamp();
		const disposals = this.#disposals;
		while (this.#disposals === disposals) {
			if (!w.fresh(seen)) {
				seen = w.stamp();
				yield seen;
				continue;
			}
			await new Promise<void>((resolve) => {
				const wake = () => {
					this.#waiters.delete(wake);
					resolve();
				};
				this.#waiters.add(wake);
			});
		}
	}

	/** Validate one source ref into a catalog ref. Schema layers (a genre stack like `fields.post` =
	 *  `[page, post_only]`) each validate the ORIGINAL frontmatter and their outputs MERGE left→right —
	 *  NOT chained. Chaining would let an early layer that returns only its own fields (e.g. `page`)
	 *  strip a field a later layer needs (e.g. `post`'s `date`) before it ever sees it. */
	async #normalizeRef(row: SourceRef<Meta>, seen?: Set<string>): Promise<ContentRef<Data, Meta>> {
		if (!row?.id || typeof row.id !== 'string') {
			throw new OgygiaError('content_ref_missing_id');
		}
		if (seen) {
			if (seen.has(row.id)) throw new OgygiaError('content_duplicate_id', { id: row.id });
			seen.add(row.id);
		}
		const original = (row.data ?? {}) as Record<string, unknown>;
		let data: Record<string, unknown> = original;
		if (this.#schema.length) {
			data = {};
			for (const schema of this.#schema) {
				data = { ...data, ...(await parseSchema(schema, original, `content/${row.id}`)) };
			}
		}
		return {
			id: row.id,
			data: data as Data,
			meta: (row.meta ?? {}) as Meta,
			...(row.order !== undefined ? { order: row.order } : {}),
			...(row.filePath !== undefined ? { filePath: row.filePath } : {})
		};
	}

	/**
	 * Materialize the whole source (refs) into the catalog. Re-run on each live change.
	 *
	 * The first read is strict: an entry that fails its schema fails the read (and the start, which a
	 * later read tries again). A LIVE reread is lenient: such an entry keeps its last good version (or
	 * stays out) and is reported, and every other entry updates. One editor saving one bad field once
	 * froze the whole catalog (#190).
	 */
	async #reload(lenient = false): Promise<void> {
		const rows = await this.#source.refs();
		const seen = new Set<string>();
		const next: ContentRef<Data, Meta>[] = [];
		const refused: unknown[] = [];
		for (const row of rows) {
			try {
				next.push(await this.#normalizeRef(row, seen));
			} catch (err) {
				if (!lenient) throw err;
				refused.push(err);
				const kept = typeof row?.id === 'string' ? this.#catalog.get(row.id) : undefined;
				if (kept && !next.some((e) => e.id === kept.id)) next.push(kept);
			}
		}
		this.#catalog.clear();
		for (const e of next) this.#catalog.set(e.id, e);
		this.#backlinkIndex = null;
		this.#notify();
		for (const err of refused) console.error(new OgygiaError('content_live_change_failed'), err);
	}

	/** Incremental live update: refetch just the changed ids (drop the ones the source no longer has).
	 *  An entry that fails its schema keeps its last good version, and is reported; the rest update. */
	async #reloadIds(ids: string[]): Promise<void> {
		for (const id of ids) {
			try {
				const row = await this.#source.get(id);
				if (row) this.#catalog.set(id, await this.#normalizeRef(row));
				else this.#catalog.delete(id);
			} catch (err) {
				console.error(new OgygiaError('content_live_change_failed'), err);
			}
		}
		this.#backlinkIndex = null;
		this.#notify();
	}

	/** The source started, read in full, and (a live source) followed for as long as the collection
	 *  stays in this visit to `running`. */
	async #begin(visit: Running): Promise<void> {
		await this.#init.get();
		// the live connection opens BEFORE the first read starts: a source that announces a change
		// only to whoever listens at that moment would tell nobody about one made during the read (#191)
		const follow = this.#source.live && this.#life.now === visit;
		await (follow ? this.#follow(visit, () => this.#reload(), 0) : this.#reload());
	}

	/**
	 * Follow the live connection. Its first pull starts now (that is when a source subscribes); the
	 * changes it brings apply once `ready` (the read they follow) has. A change that fails to apply is
	 * reported and the next one still applies. A connection that drops is opened again after a wait
	 * that doubles, reading the whole source again first (what changed meanwhile has no event). A
	 * connection that ends (the source says there is nothing more) is not.
	 */
	#follow(
		visit: Running,
		read: () => Promise<void>,
		attempt: number,
		reconnecting = false
	): Promise<void> {
		const connection = this.#connect();
		// the read starts only now: the connection is already listening
		const ready = read();
		// (once the collection left this visit, its connection is closed: nothing more applies)
		const following = () => this.#life.now === visit;
		// oxlint-disable-next-line ogygia/no-silent-failures -- never rejects, each failure in it is said with a code
		void (async () => {
			try {
				await ready;
			} catch (err) {
				// The connection stays open for the next read (this.#connection). A reconnect's read
				// failed (the source is still down): try again after a longer wait. The FIRST read
				// failing fails the start instead, and the next read starts it (and this) again.
				if (reconnecting && following()) {
					console.error(new OgygiaError('content_live_source_failed'), err);
					this.#reconnect(visit, attempt);
				}
				return;
			}
			let failures = attempt;
			try {
				while (following()) {
					const step = await connection.pending;
					if (!following()) return;
					if (step.done) {
						this.#connection = null;
						return;
					}
					failures = 0;
					try {
						await this.#apply(step.value);
					} catch (err) {
						console.error(new OgygiaError('content_live_change_failed'), err);
					}
					// (a pull that answered came from the iterator `live()` returned)
					if (following()) connection.pending = connection.changes!.next();
				}
			} catch (err) {
				if (!following()) return;
				this.#connection = null;
				console.error(new OgygiaError('content_live_source_failed'), err);
				this.#reconnect(visit, failures);
			}
		})();
		return ready;
	}

	/** The open live connection, or a new one: its first pull starts now (when a source subscribes). */
	#connect(): LiveConnection {
		if (this.#connection) return this.#connection;
		const live = this.#source.live!;
		let changes: AsyncIterator<unknown> | null = null;
		// (the source is called, and pulled, right now: an async function runs to its first await.
		// A `live()` that throws as it is called is a pull that failed: the connection dropped.)
		const pending = (async () => {
			changes = live.call(this.#source)[Symbol.asyncIterator]();
			return changes.next();
		})();
		pending.catch(ignore); // (seen by #follow, once a read has run)
		return (this.#connection = { changes, pending });
	}

	/** Open a dropped connection again after its wait, reading the whole source again first. The
	 *  wait is the visit's: leaving `running` clears it. */
	#reconnect(visit: Running, attempt: number): void {
		const wait = backoffAfter(LIVE_RECONNECT, attempt + 1);
		// (only ever called in that visit; a server shutting down does not wait for a reconnect)
		this.#life.scope.timeout(() => {
			// (a failed read is reported, and retried, by #follow; the connection listens first)
			void this.#follow(visit, () => this.#reload(true), attempt + 1, true).catch(ignore);
		}, wait);
	}

	/** One change the live connection brought: the ids it names, else everything. */
	async #apply(change: unknown): Promise<void> {
		if (Array.isArray(change) && change.every((x) => typeof x === 'string'))
			await this.#reloadIds(change as string[]);
		else await this.#reload(true);
	}

	/** The catalog, loaded: the start of this visit to `running` (entered on the first read). */
	#loaded(): Promise<unknown> {
		this.#awake();
		if (this.#life.now.kind !== 'running') {
			this.#life.go('running', {
				start: flights({
					name: 'content-collection start',
					run: () => this.#begin(this.#life.now as Running)
				})
			});
			this.#life.scope.defer(() => this.#stop_following());
		}
		// (its callers only wait: nothing drops a visit's start, so it never answers STALE)
		return (this.#life.now as Running).start.get();
	}

	async ready(): Promise<ContentRef<Data, Meta>[]> {
		await this.#loaded();
		return this.snapshot();
	}

	// ── graph ──────────────────────────────────────────────────────────────────

	relationTargets(): Record<string, Collection<Record<string, unknown>> | undefined> {
		this.#resolveRelations();
		const out: Record<string, Collection<Record<string, unknown>> | undefined> = {};
		for (const name of this.#relationNames) out[name] = to_collection(this.#relationsDef[name]);
		return out;
	}

	/** Visible ref by id (default context), or null. */
	lookup(id: string, ctx: ReadContext = {}): ContentRef<Data, Meta> | null {
		const e = this.#catalog.get(id);
		return e && this.#visible(e, ctx) ? e : null;
	}
	visibleRefs(ctx: ReadContext = {}): ContentRef<Data, Meta>[] {
		return this.snapshot().filter((e) => this.#visible(e, ctx));
	}

	async resolveGraph(entry: ContentRef<Data, Meta>): Promise<{
		rel: Record<string, RefEntry | RefEntry[] | null>;
		backlinks: RefEntry[];
	}> {
		const rel: Record<string, RefEntry | RefEntry[] | null> = {};
		const targets = this.relationTargets();
		for (const name of this.#relationNames) {
			const target = targets[name];
			const field = (entry.data as Record<string, unknown>)[name];
			const many = Array.isArray(field);
			if (!target) {
				rel[name] = many ? [] : null;
				continue;
			}
			await target.#loaded();
			const refs: RefEntry[] = [];
			for (const id of ref_ids(field)) {
				const e = target.lookup(id);
				if (e) refs.push(to_ref(e as ContentRef));
			}
			rel[name] = many ? refs : (refs[0] ?? null);
		}
		const index = await this.#backlinks();
		return { rel, backlinks: index.get(entry.id) ?? [] };
	}

	async #backlinks(): Promise<Map<string, RefEntry[]>> {
		const contributors: { src: Collection<Record<string, unknown>>; names: string[] }[] = [];
		for (const src of GRAPH.all) {
			const st = src.relationTargets();
			const names = Object.keys(st).filter((n) => (st[n] as unknown) === (this as unknown));
			if (names.length) contributors.push({ src, names });
		}
		await Promise.all(contributors.map((c) => c.src.#loaded()));
		const from = contributors.map((c) => world_of(c.src));
		const was = this.#backlinkFrom;
		if (
			this.#backlinkIndex &&
			was.length === from.length &&
			was.every((w, i) => w.world === from[i] && w.world.fresh(w.stamp))
		)
			return this.#backlinkIndex;
		const index = new Map<string, RefEntry[]>();
		for (const { src, names } of contributors) {
			for (const se of src.visibleRefs()) {
				const ref = to_ref(se);
				for (const rname of names) {
					for (const id of new Set(ref_ids((se.data as Record<string, unknown>)[rname]))) {
						const list = index.get(id);
						if (list) list.push(ref);
						else index.set(id, [ref]);
					}
				}
			}
		}
		this.#backlinkFrom = from.map((world) => ({ world, stamp: world.stamp() }));
		this.#backlinkIndex = index;
		return index;
	}

	#hasGraph(): boolean {
		this.#resolveRelations();
		if (this.#relationNames.length > 0) return true;
		for (const src of GRAPH.all) {
			if ((src as unknown) === (this as unknown)) continue;
			const t = src.relationTargets();
			for (const name in t) if ((t[name] as unknown) === (this as unknown)) return true;
		}
		return false;
	}

	async withGraph(entry: ContentRef<Data, Meta>): Promise<ContentRef<Data, Meta>> {
		if (!this.#hasGraph()) return entry;
		const { rel, backlinks } = await this.resolveGraph(entry);
		return { ...entry, rel, backlinks };
	}

	// ── read paths (browser-safe) ────────────────────────────────────────────────

	/** All visible refs (each graphed) — the corpus as metadata, never bodies. */
	async refs(ctx: ReadContext = {}): Promise<ContentRef<Data, Meta>[]> {
		return Promise.all(
			(await this.ready()).filter((e) => this.#visible(e, ctx)).map((e) => this.withGraph(e))
		);
	}

	/** Build a full {@link Entry} (ref + body + source + graph) from a source `get`. */
	async #entryFrom(
		ref: ContentRef<Data, Meta>,
		full: SourceEntry<Meta> | null,
		rel: Record<string, RefEntry | RefEntry[] | null>,
		backlinks: RefEntry[]
	): Promise<Entry<Data, Meta>> {
		return {
			id: ref.id,
			data: ref.data,
			meta: ref.meta,
			...(full?.body !== undefined ? { body: full.body } : {}),
			...(full?.source !== undefined ? { source: full.source } : {}),
			rel,
			backlinks
		};
	}

	/** Resolve one entry to `{ id, data, meta, body, source, rel, backlinks }`, or `null`. */
	async get(id: string, ctx: ReadContext = {}): Promise<Entry<Data, Meta> | null> {
		if (!this.#hasGraph()) {
			// On-demand: a graph-less collection needs no catalog — fetch ONE full record.
			this.#awake();
			await this.#init.get();
			let ref = this.#catalog.get(id) ?? null;
			const full = await this.#source.get(id);
			if (!ref) {
				if (!full) return null;
				ref = await this.#normalizeRef(full);
			}
			if (!this.#visible(ref, ctx)) return null;
			return this.#entryFrom(ref, full, {}, []);
		}
		await this.#loaded();
		const ref = this.lookup(id, ctx);
		if (!ref) return null;
		const [full, graph] = await Promise.all([this.#source.get(id), this.resolveGraph(ref)]);
		return this.#entryFrom(ref, full, graph.rel, graph.backlinks);
	}
}
