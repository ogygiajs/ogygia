/**
 * A registry of definitions by key: `set(key, value, owner)` holds `value` under `key` while
 * `owner` is open, replacing what the key held. The owner is the defining module's run, so
 * a module's reload ends its definitions: one deleted from its code is gone, one kept is set again
 * by its new run. Another owner's end never takes a definition it does
 * not hold. Setting with an ended owner is refused.
 *
 *   const shapes = keyedRegistry<string, Shape>();
 *   shapes.set('circle', circle, run); // gone when `run` ends, or replaced by the next set
 */
import type { Scope } from './scope.ts';

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

/** The keyed form of {@link registry}, for definitions by name. Its own export, so a bundle that
 *  uses only `registry()` does not carry it (test/registry-shaking.node.test.ts). */
export function keyedRegistry<K, V>(): KeyedRegistry<K, V> {
	return new Keyed<K, V>();
}
