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

function make_registry<T>(): Registry<T> {
	return new Held<T>();
}

/**
 * A registry of definitions by key: `set(key, value, owner)` holds `value` under `key` while
 * `owner` is open, replacing what the key held. The owner is the defining module's run, so
 * a module's reload ends its definitions: one deleted from its code is gone, one kept is set again
 * by its new run. Another owner's end never takes a definition it does
 * not hold. Setting with an ended owner is refused.
 */
export interface KeyedRegistry<K, V> {
	/** Holds `value` under `key` while `owner` is open; returns its removal. */
	set(key: K, value: V, owner: Scope): () => void;
	get(key: K): V | undefined;
	has(key: K): boolean;
	readonly size: number;
	/** The definitions, in the order they were last set. */
	entries(): IterableIterator<[K, V]>;
	/** The values, in the same order. */
	values(): IterableIterator<V>;
}

class Keyed<K, V> implements KeyedRegistry<K, V> {
	_held = new Map<K, { value: V; life: Scope }>();

	get size(): number {
		return this._held.size;
	}

	set(key: K, value: V, owner: Scope): () => void {
		if (owner.closed) return () => {};
		const old = this._held.get(key);
		this._held.delete(key);
		old?.life.close();
		const life = owner.child();
		const held = { value, life };
		this._held.set(key, held);
		// (only its own: a later set under the key holds another)
		life.defer(() => {
			if (this._held.get(key) === held) this._held.delete(key);
		});
		return () => life.close();
	}

	get(key: K): V | undefined {
		return this._held.get(key)?.value;
	}

	has(key: K): boolean {
		return this._held.has(key);
	}

	*entries(): IterableIterator<[K, V]> {
		for (const [key, held] of this._held) yield [key, held.value];
	}

	*values(): IterableIterator<V> {
		for (const held of this._held.values()) yield held.value;
	}
}

/** A registry of live entries, each owned by a scope (see the module's comment). `registry.keyed()`
 *  is its keyed form, for definitions by name (see {@link KeyedRegistry}). */
export const registry: { <T>(): Registry<T>; keyed<K, V>(): KeyedRegistry<K, V> } =
	/* @__PURE__ */ Object.assign(make_registry, {
		keyed: <K, V>(): KeyedRegistry<K, V> => new Keyed<K, V>()
	});
