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

// (closures, not classes: their state is locals the minifier shortens)
function make_registry<T>(): Registry<T> {
	/** By each add's own scope (one per add: the same value added twice is two entries). */
	const entries = new Map<Scope, T>();
	return {
		get size(): number {
			return entries.size;
		},
		add(entry: T, owner: Scope): () => void {
			if (owner.closed) return () => {};
			const life = owner.child();
			entries.set(life, entry);
			life.defer(() => entries.delete(life));
			return () => life.close();
		},
		[Symbol.iterator](): Iterator<T> {
			return entries.values();
		}
	};
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

function make_keyed<K, V>(): KeyedRegistry<K, V> {
	const map = new Map<K, { value: V; life: Scope }>();
	return {
		get size(): number {
			return map.size;
		},
		set(key: K, value: V, owner: Scope): () => void {
			if (owner.closed) return () => {};
			const old = map.get(key);
			map.delete(key);
			old?.life.close();
			const life = owner.child();
			const held = { value, life };
			map.set(key, held);
			// (only its own: a later set under the key holds another)
			life.defer(() => {
				if (map.get(key) === held) map.delete(key);
			});
			return () => life.close();
		},
		get(key: K): V | undefined {
			return map.get(key)?.value;
		},
		has(key: K): boolean {
			return map.has(key);
		},
		*entries(): IterableIterator<[K, V]> {
			for (const [key, held] of map) yield [key, held.value];
		},
		*values(): IterableIterator<V> {
			for (const held of map.values()) yield held.value;
		}
	};
}

/** A registry of live entries, each owned by a scope (see the module's comment). `registry.keyed()`
 *  is its keyed form, for definitions by name (see {@link KeyedRegistry}). */
export const registry: { <T>(): Registry<T>; keyed<K, V>(): KeyedRegistry<K, V> } =
	/* @__PURE__ */ Object.assign(make_registry, { keyed: make_keyed });
