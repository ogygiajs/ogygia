import { cache, type Cache } from '@ogygia/machine';

/** What a query's body reads other queries through. */
export interface QueryCtx {
	get<A, V>(query: Query<A, V>, arg: A): V;
}

/** A query: an input (read from the outside world, changed by `set` or `refresh`) or a derived
 *  answer (computed from other queries, never from anything else). Plain data: `key` names an
 *  argument, `equal` says when a new answer is the same as the old one. */
export interface Query<A, V> {
	readonly name: string;
	readonly kind: 'input' | 'derived';
	key(arg: A): string;
	run(cx: QueryCtx, arg: A): V;
	equal(a: V, b: V): boolean;
}

/** An input: `read` is how its value is first fetched (a file system read, say). */
export function input<A, V>(
	name: string,
	key: (arg: A) => string,
	read: (arg: A) => V,
	equal: (a: V, b: V) => boolean = same
): Query<A, V> {
	return { name, kind: 'input', key, run: (_cx, arg) => read(arg), equal };
}

/** A derived answer: `run` reads only other queries, through `cx`. */
export function derived<A, V>(
	name: string,
	key: (arg: A) => string,
	run: (cx: QueryCtx, arg: A) => V,
	equal: (a: V, b: V) => boolean = same
): Query<A, V> {
	return { name, kind: 'derived', key, run, equal };
}

type Erased = Query<unknown, unknown>;
const erase = <A, V>(query: Query<A, V>): Erased => query as unknown as Erased;

/** One read: which answer, and the revision it had last changed at when it was read. */
export interface Dep {
	readonly slot: Slot;
	/** the revision the dependency had last changed at when it was read */
	seen: number;
}

/** A reader's reads, in order: an answer's, or a watched reader's. `tail` is how many of `deps` the
 *  run going on now has read (a recompute that reads the same answers in the same order reuses
 *  each `Dep` in place). */
export interface Frame {
	readonly deps: Dep[];
	tail: number;
}

/** What the database remembers of `query(arg)`. */
export interface Slot extends Frame {
	readonly query: Erased;
	readonly arg: unknown;
	readonly key: string;
	value: unknown;
	/** the revision this answer last changed at (`NO_VALUE`: it has none yet) */
	changed: number;
	/** the revision this answer was last checked at; or `MUST_RUN` (it never ran, or its last run
	 *  threw: it runs when next read), `RUNNING` (a read of it now is a cycle), `LET_GO` (the bound
	 *  let it go: a reader that read it runs again) or `RUNNING_LET_GO` (let go while it runs: still a
	 *  cycle to read, and let go when its run ends) */
	verified: number;
}

const NO_VALUE = -1;
const MUST_RUN = -1;
const RUNNING = -2;
const LET_GO = -3;
const RUNNING_LET_GO = -4;

/** What a watched reader read (`watch`), each as it was when read. */
export type Reads = Frame;

const QUERIES_MAX = 100_000;

/**
 * A database of queries. `name` names its store in messages; `max` is how many derived answers it
 * remembers (one let go is computed again when next read). Inputs are never let go: they are the
 * world an answer read, and some (`set`-only ones) have no other copy.
 *
 * An answer the compiler derives from the app's files is a query: a pure function of other
 * queries, down to INPUTS (a file's text, a directory's listing) that only the outside world
 * changes. The database remembers each answer with the queries it read, so after an input changes
 * it computes again only what read it, and an answer that comes out the same stops there (early
 * cutoff): its readers keep theirs. Nothing is cleared by hand, and a dev session's answers are
 * always the ones a cold start on the same files gives (test/queries.test.ts checks exactly that,
 * over random edits).
 *
 * Revisions: every input change is a new revision. An answer records the revision it last changed
 * at and the one it was last checked at; a read in a later revision checks the answer's
 * dependencies first (in the order they were read: a dependency read after one that changed may not
 * be read at all now), and runs it again only if one of them changed. The check walks its own
 * stack, so a chain of answers of any depth never grows the call stack.
 *
 * Internal to the compiler: not exported from the package.
 */
export class Queries implements QueryCtx {
	readonly #table = new Map<Erased, Map<string, Slot>>();
	#last_query: Erased | undefined;
	#last_keyed = new Map<string, Slot>();
	readonly #held: Cache<Slot, Slot>;
	#revision = 0;
	#current: Frame | undefined;

	constructor(name: string, max: number = QUERIES_MAX) {
		this.#held = cache({ name, max, onEvict: (slot) => this.#let_go(slot) });
	}

	/** The current revision: one more for each input change. */
	get revision(): number {
		return this.#revision;
	}

	get<A, V>(query: Query<A, V>, arg: A): V {
		const slot = this.#slot_of(query as unknown as Erased, arg);
		if (slot.verified !== this.#revision) this.#fresh(slot);
		const into = this.#current;
		if (into) link(into, slot);
		return slot.value as V;
	}

	/** Run a reader that is not a query (its answer is not kept: a generated module's load, say):
	 *  what it reads through `cx`, and through any query it reads while it runs, is recorded in
	 *  `reads`. `cx` records even after the reader's first await; a query read then is not. */
	watch<V>(reader: (cx: QueryCtx) => V): { value: V; reads: Reads } {
		const reads: Frame = { deps: [], tail: 0 };
		const outer = this.#current;
		this.#current = reads;
		try {
			return { value: reader({ get: (query, arg) => this.#read(query, arg, reads) }), reads };
		} finally {
			this.#current = outer;
		}
	}

	/** Whether anything a watched reader read is different now (each is checked, and computed again
	 *  if what it read changed: an answer that comes out the same has not moved). */
	moved(reads: Reads): boolean {
		try {
			return !this.#deps_unchanged(reads);
		} catch {
			return true; // ok: an answer that now throws has changed; its reader reports the error
		}
	}

	/** Give an input a value. False (and no new revision) when it equals the one it had. */
	set<A, V>(query: Query<A, V>, arg: A, value: V): boolean {
		return this.#set_input(erase(query), arg, value);
	}

	/** Read an input again from the outside world, if anything read it: whether it changed. */
	refresh<A, V>(typed: Query<A, V>, arg: A): boolean {
		const query = erase(typed);
		if (!this.#find(query, arg)) return false;
		return this.#set_input(query, arg, query.run(this, arg));
	}

	/** Whether anything read this input or answer (and it is still remembered). */
	holds<A, V>(query: Query<A, V>, arg: A): boolean {
		return this.#find(erase(query), arg) !== undefined;
	}

	/** Whether `query(arg)` is different now from what it was at revision `since` (one not held
	 *  is computed now, as of the current revision). */
	changed_since<A, V>(typed: Query<A, V>, arg: A, since: number): boolean {
		return this.#fresh(this.#slot_of(erase(typed), arg)).changed > since;
	}

	/** Whether any derived answer held now is different from what it was at revision `since`
	 *  (each is checked, and computed again if what it read changed). */
	answers_changed_since(since: number): boolean {
		for (const [slot] of this.#held.entries()) {
			if (slot.query.kind === 'input' || slot.verified === LET_GO) continue;
			try {
				if (this.#fresh(slot).changed > since) return true;
			} catch {
				return true; // ok: an answer that now throws has changed; its reader reports the error
			}
		}
		return false;
	}

	/** Read every input anything read again from the outside world (a new session starts from what
	 *  is there now, not from what an earlier one saw): whether any changed. */
	reread(): boolean {
		let moved = false;
		for (const [query, keyed] of this.#table) {
			if (query.kind !== 'input') continue;
			for (const slot of keyed.values())
				if (this.#set_input(query, slot.arg, query.run(this, slot.arg))) moved = true;
		}
		return moved;
	}

	#let_go(slot: Slot): void {
		if (slot.verified === RUNNING) {
			slot.verified = RUNNING_LET_GO;
			return;
		}
		const keyed = this.#table.get(slot.query);
		if (keyed?.get(slot.key) === slot) keyed.delete(slot.key);
		slot.verified = LET_GO;
	}

	#find(query: Erased, arg: unknown): Slot | undefined {
		return this.#table.get(query)?.get(query.key(arg));
	}

	#slot_of(query: Erased, arg: unknown): Slot {
		let keyed = this.#last_keyed;
		if (query !== this.#last_query) {
			const had = this.#table.get(query);
			if (had === undefined) this.#table.set(query, (keyed = new Map()));
			else keyed = had;
			this.#last_query = query;
			this.#last_keyed = keyed;
		}
		const key = query.key(arg);
		let slot = keyed.get(key);
		if (slot === undefined) {
			slot = {
				query,
				arg,
				key,
				value: undefined,
				changed: NO_VALUE,
				verified: MUST_RUN,
				deps: [],
				tail: 0
			};
			keyed.set(key, slot);
			if (query.kind === 'derived') this.#held.set(slot, slot);
		}
		return slot;
	}

	#fresh(slot: Slot): Slot {
		const v = slot.verified;
		if (v === this.#revision) return slot;
		this.#held.get(slot);
		if (v >= 0 && (slot.query.kind === 'input' || this.#deps_unchanged(slot)))
			slot.verified = this.#revision;
		else this.#compute(slot);
		return slot;
	}

	#deps_unchanged(root: Frame): boolean {
		const held = this.#held;
		let node: Frame = root;
		let i = 0;
		let below: Array<Frame | number> | undefined;
		descend: for (;;) {
			const deps = node.deps;
			let same = true;
			for (; i < deps.length; i++) {
				const d = deps[i];
				const s = d.slot;
				const v = s.verified;
				if (v !== this.#revision) {
					if (v === LET_GO) {
						same = false;
						break;
					}
					held.get(s);
					if (v < 0) this.#compute(s);
					else if (s.query.kind === 'input') s.verified = this.#revision;
					else {
						(below ??= []).push(node, i);
						node = s;
						i = 0;
						continue descend;
					}
				}
				if (s.changed !== d.seen) {
					same = false;
					break;
				}
			}
			for (;;) {
				if (node === root) return same;
				const slot = node as Slot;
				if (same) slot.verified = this.#revision;
				else this.#compute(slot);
				i = below!.pop() as number;
				node = below!.pop() as Frame;
				const d = node.deps[i];
				if (d?.slot !== slot || slot.changed !== d.seen) {
					same = false;
					continue;
				}
				i++;
				continue descend;
			}
		}
	}

	#compute(slot: Slot): void {
		if (slot.verified === RUNNING || slot.verified === RUNNING_LET_GO)
			throw new Error(`query cycle: ${slot.query.name} ${slot.key}`);
		const outer = this.#current;
		this.#current = slot;
		slot.tail = 0;
		slot.verified = RUNNING;
		let value: unknown;
		try {
			value = slot.query.run(this, slot.arg);
		} catch (e) {
			const let_go_now = slot.verified === RUNNING_LET_GO;
			slot.verified = MUST_RUN;
			if (let_go_now) this.#let_go(slot);
			else if (slot.changed === NO_VALUE) this.#held.delete(slot);
			throw e;
		} finally {
			this.#current = outer;
		}
		if (slot.deps.length !== slot.tail) slot.deps.length = slot.tail;
		if (slot.verified === RUNNING_LET_GO) {
			slot.verified = MUST_RUN;
			this.#let_go(slot);
		} else slot.verified = this.#revision;
		if (slot.changed !== NO_VALUE && slot.query.equal(slot.value, value)) return;
		slot.value = value;
		slot.changed = this.#revision;
	}

	#set_input(query: Erased, arg: unknown, value: unknown): boolean {
		if (query.kind !== 'input') throw new Error(`query ${query.name} is not an input`);
		const had = this.#find(query, arg);
		if (had && query.equal(had.value, value)) return false;
		const revision = ++this.#revision;
		const slot = had ?? this.#slot_of(query, arg);
		slot.value = value;
		slot.changed = revision;
		slot.verified = revision;
		return true;
	}

	#read<A, V>(typed: Query<A, V>, arg: A, into: Frame | undefined): V {
		const slot = this.#fresh(this.#slot_of(typed as unknown as Erased, arg));
		if (into) link(into, slot);
		return slot.value as V;
	}
}

function link(frame: Frame, slot: Slot): void {
	const deps = frame.deps;
	const i = frame.tail++;
	if (i < deps.length) {
		const d = deps[i];
		if (d.slot === slot) d.seen = slot.changed;
		else deps[i] = { slot, seen: slot.changed };
	} else deps.push({ slot, seen: slot.changed });
}

/** Structural equality over what answers are made of: primitives, arrays, plain objects, Maps and
 *  Sets (in order: an answer's order is part of it). */
export function same(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
		return true;
	}
	if (a instanceof Map || a instanceof Set) {
		if (a.constructor !== b.constructor) return false;
		const x = [...(a as Map<unknown, unknown>)];
		const y = [...(b as Map<unknown, unknown>)];
		return same(x, y);
	}
	if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b) || Array.isArray(b)) return false;
	const ka = Object.keys(a);
	const kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	for (let i = 0; i < ka.length; i++) {
		const k = ka[i];
		if (k !== kb[i]) return false;
		if (!same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
	}
	return true;
}
