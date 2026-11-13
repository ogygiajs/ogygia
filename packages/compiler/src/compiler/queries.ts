/**
 * QUERIES: incremental computation. An answer the compiler derives from the app's files is a
 * query: a pure function of other queries, down to INPUTS (a file's text, a directory's listing)
 * that only the outside world changes. The database remembers each answer with the queries it read,
 * so after an input changes it computes again only what read it, and an answer that comes out the
 * same stops there (early cutoff): its readers keep theirs. Nothing is cleared by hand, and a dev
 * session's answers are always the ones a cold start on the same files gives (test/queries.test.ts
 * checks exactly that, over random edits).
 *
 * Revisions: every input change is a new revision. An answer records the revision it last changed
 * at and the one it was last checked at; a read in a later revision checks the answer's
 * dependencies first (in the order they were read: a dependency read after one that changed may not
 * be read at all now), and runs it again only if one of them changed.
 *
 * Internal to the compiler (study G.6): not exported from the package.
 */
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

/** A query with its types let go: the database keeps every kind side by side. */
type Erased = Query<unknown, unknown>;
const erase = <A, V>(query: Query<A, V>): Erased => query as unknown as Erased;

/** One read: which answer, and the revision it had last changed at when it was read. */
export interface Dep {
	readonly id: string;
	readonly query: Erased;
	readonly arg: unknown;
	/** the revision the dependency had last changed at when it was read */
	readonly seen: number;
}

interface Slot {
	readonly query: Erased;
	readonly arg: unknown;
	value: unknown;
	/** the revision this answer last changed at */
	changed: number;
	/** the revision this answer was last checked at */
	verified: number;
	/** what it read, in order (an input reads nothing) */
	deps: readonly Dep[];
}

export interface Queries extends QueryCtx {
	/** The current revision: one more for each input change. */
	readonly revision: number;
	/** Give an input a value. False (and no new revision) when it equals the one it had. */
	set<A, V>(query: Query<A, V>, arg: A, value: V): boolean;
	/** Read an input again from the outside world, if anything read it: whether it changed. */
	refresh<A, V>(query: Query<A, V>, arg: A): boolean;
	/** Whether anything read this input or answer (and it is still remembered). */
	holds<A, V>(query: Query<A, V>, arg: A): boolean;
	/** Whether `query(arg)` is different now from what it was at revision `since` (one not held
	 *  is computed now, as of the current revision). */
	changed_since<A, V>(query: Query<A, V>, arg: A, since: number): boolean;
	/** Whether any derived answer held now is different from what it was at revision `since`
	 *  (each is checked, and computed again if what it read changed). */
	answers_changed_since(since: number): boolean;
	/** Read every input anything read again from the outside world (a new session starts from what
	 *  is there now, not from what an earlier one saw): whether any changed. */
	reread(): boolean;
	/** Run a reader that is not a query (its answer is not kept: a generated module's load, say):
	 *  what it reads through `cx`, and through any query it reads while it runs, is recorded in
	 *  `reads`. `cx` records even after the reader's first await; a query read then is not. */
	watch<V>(read: (cx: QueryCtx) => V): { value: V; reads: Reads };
	/** Whether anything a watched reader read is different now (each is checked, and computed again
	 *  if what it read changed: an answer that comes out the same has not moved). */
	moved(reads: Reads): boolean;
}

/** What a watched reader read (`watch`), each as it was when read. */
export interface Reads {
	readonly deps: readonly Dep[];
}

/** Answers a process remembers per database (an evicted one is computed again when next read). */
const QUERIES_MAX = 100_000;

/** A database of queries. `name` names its store in messages. */
export function queries(name: string, max: number = QUERIES_MAX): Queries {
	const slots: Cache<string, Slot> = cache({ name, max });
	let revision = 0;
	/** the deps of each answer being computed, innermost last */
	const frames: Dep[][] = [];
	/** the ids being computed (a query that reads itself, however deep, is a bug) */
	const running = new Set<string>();

	const id_of = (query: Erased, arg: unknown) => `${query.name}\0${query.key(arg)}`;

	/** The slot for `query(arg)`, checked for this revision. */
	function fresh(query: Erased, arg: unknown, id: string): Slot {
		const held = slots.get(id);
		if (held && held.verified === revision) return held;
		if (query.kind === 'input') {
			if (held) {
				held.verified = revision;
				return held;
			}
			const value = query.run(db, arg);
			const slot: Slot = { query, arg, value, changed: revision, verified: revision, deps: [] };
			slots.set(id, slot);
			return slot;
		}
		if (held && deps_unchanged(held)) {
			held.verified = revision;
			return held;
		}
		return compute(query, arg, id, held);
	}

	function deps_unchanged(reader: { readonly deps: readonly Dep[] }): boolean {
		for (const d of reader.deps) {
			// (a dependency let go is unknown: read again, so the answer is computed again)
			if (!slots.has(d.id)) return false;
			if (fresh(d.query, d.arg, d.id).changed !== d.seen) return false;
		}
		return true;
	}

	function compute(query: Erased, arg: unknown, id: string, old: Slot | undefined): Slot {
		if (running.has(id)) throw new Error(`query cycle: ${id.replace('\0', ' ')}`);
		running.add(id);
		const deps: Dep[] = [];
		frames.push(deps);
		let value: unknown;
		try {
			value = query.run(db, arg);
		} finally {
			frames.pop();
			running.delete(id);
		}
		if (old && query.equal(old.value, value)) {
			// early cutoff: the same answer keeps its revision, so its readers keep theirs
			old.deps = deps;
			old.verified = revision;
			return old;
		}
		const slot: Slot = { query, arg, value, changed: revision, verified: revision, deps };
		slots.set(id, slot);
		return slot;
	}

	function set_input(query: Erased, arg: unknown, value: unknown): boolean {
		if (query.kind !== 'input') throw new Error(`query ${query.name} is not an input`);
		const id = id_of(query, arg);
		const held = slots.peek(id);
		if (held && query.equal(held.value, value)) return false;
		revision++;
		slots.set(id, { query, arg, value, changed: revision, verified: revision, deps: [] });
		return true;
	}

	/** Read `query(arg)` for this revision, recording it in `into` (the reader's deps). */
	function read<A, V>(typed: Query<A, V>, arg: A, into: Dep[] | undefined): V {
		const query = erase(typed);
		const id = id_of(query, arg);
		const slot = fresh(query, arg, id);
		into?.push({ id, query, arg, seen: slot.changed });
		return slot.value as V;
	}

	const db: Queries = {
		get revision() {
			return revision;
		},
		get: (query, arg) => read(query, arg, frames.at(-1)),
		watch(reader) {
			const deps: Dep[] = [];
			frames.push(deps);
			try {
				return { value: reader({ get: (query, arg) => read(query, arg, deps) }), reads: { deps } };
			} finally {
				frames.pop();
			}
		},
		moved(reads) {
			try {
				return !deps_unchanged(reads);
			} catch {
				return true; // ok: an answer that now throws has changed; its reader reports the error
			}
		},
		set: (query, arg, value) => set_input(erase(query), arg, value),
		refresh(typed, arg) {
			const query = erase(typed);
			if (!slots.has(id_of(query, arg))) return false; // nothing read it: nothing to tell
			return set_input(query, arg, query.run(db, arg));
		},
		holds: (query, arg) => slots.has(id_of(erase(query), arg)),
		changed_since(typed, arg, since) {
			const query = erase(typed);
			return fresh(query, arg, id_of(query, arg)).changed > since;
		},
		answers_changed_since(since) {
			for (const [id, slot] of slots.entries()) {
				if (slot.query.kind === 'input') continue;
				try {
					if (fresh(slot.query, slot.arg, id).changed > since) return true;
				} catch {
					return true; // ok: an answer that now throws has changed; its reader reports the error
				}
			}
			return false;
		},
		reread() {
			let moved = false;
			for (const [, slot] of slots.entries())
				if (
					slot.query.kind === 'input' &&
					set_input(slot.query, slot.arg, slot.query.run(db, slot.arg))
				)
					moved = true;
			return moved;
		}
	};
	return db;
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
