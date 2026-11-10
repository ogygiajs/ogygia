/**
 * A registry of live entries, each owned. What a cache is for values made again on demand, a
 * registry is for things that are alive: a watcher, a module, a collection. Nothing in it is ever evicted; an
 * entry leaves when its owner ends, or when the removal `add` returned runs.
 *
 *   const watchers = registry<Watcher>();
 *   const stop = watchers.add(watcher, visit.scope); // gone with the visit, or at `stop()`
 *   for (const w of watchers) w(event); // in add order
 *
 * - `add(entry, owner)`: the entry is held for as long as `owner` is open. Adding with an owner that
 *   already ended is refused: nothing is added, and the removal is a no-op.
 * - Each entry is its own child scope of its owner, so a removal that runs early leaves nothing
 *   behind in the owner.
 * - Iteration is in add order, and an entry removed while it is walked is not walked after.
 */
import type { Scope } from './scope.ts';

export interface Registry<T> {
	/** Holds `entry` while `owner` is open; returns its removal. */
	add(entry: T, owner: Scope): () => void;
	/** How many entries it holds now. */
	readonly size: number;
	/** The entries, in add order. */
	[Symbol.iterator](): Iterator<T>;
}

class Held<T> implements Registry<T> {
	/** By each add's own scope (one per add: the same value added twice is two entries). */
	_entries = new Map<Scope, T>();

	get size(): number {
		return this._entries.size;
	}

	add(entry: T, owner: Scope): () => void {
		if (owner.closed) return () => {};
		const life = owner.child();
		this._entries.set(life, entry);
		life.defer(() => this._entries.delete(life));
		return () => life.close();
	}

	[Symbol.iterator](): Iterator<T> {
		return this._entries.values();
	}
}

/** A registry of live entries, each owned by a scope (see the module's comment). Its keyed form,
 *  for definitions by name, is `keyedRegistry()` (./keyed-registry.ts). */
export function registry<T>(): Registry<T> {
	return new Held<T>();
}
