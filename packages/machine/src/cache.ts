/**
 * A keyed store that is always bounded, always owned, and says when it lets a value go.
 *
 *   const pages = cache<string, string>({
 *     max: 5_000_000,                          // the most total weight it keeps (required)
 *     weigh: (html) => html.length,            // default 1: max then counts values
 *     keep: 60_000,                            // ms a value stays (or made from the value and key)
 *     owner: request,                          // a scope: its end ends the cache
 *     onEvict: (href, html, why) => {}         // 'age' | 'size' | 'delete' | 'end'
 *   });
 *   pages.set('/docs', html);
 *   pages.get('/docs'); // a use: the least recently used go first past max
 *
 * - `max` has no default: a cache with no bound is written out (`max: Infinity`), never assumed.
 *   Past it, the expired go first ('age'), then the least recently used ('size'). A `get` is a use,
 *   a `peek` is not. A value heavier than `max` (or whose weight or age is not a number of 0 or
 *   more) is not kept: `set` says `false`, and what the key held stays.
 * - `keep`: how long a value stays, in ms (default `Infinity`; 0 keeps nothing). The ages are kept
 *   by one timer of the cache's own scope, for the value due first.
 * - `onEvict(key, value, why)` hears every value that goes, after the cache let it go, in the order
 *   they went: 'age' (past its keep), 'size' (past max), 'delete' (`delete`, `clear`, or a `set`
 *   that replaced it), 'end' (the owner ended, or the cache was disposed). A notice that throws is
 *   reported (`machine_evict_failed`) and the others still run. A `set` or `delete` inside a notice
 *   is a normal call: what it lets go is heard after the notices already due.
 * - Owned: by `owner` (its end ends the cache), or by itself (`[Symbol.dispose]`, for a scope to
 *   adopt). An ended cache keeps nothing: `set` says `false`, every read finds nothing.
 * - Freshness: with a `world`, each value carries the stamp it was made at (`set(key, value,
 *   { stamp })`, default the world now), and a value made before the one a key holds never
 *   replaces it.
 */
import { machine_error, report } from './messages.ts';
import { DISPOSE, MAX_TIMEOUT_MS, scope, type Scope } from './scope.ts';
import type { World } from './world.ts';

/** Why a value left a cache. */
export type EvictWhy = 'age' | 'size' | 'delete' | 'end';

export interface CacheOptions<K, V> {
	/** Names the cache in messages. Default `cache`. */
	name?: string;
	/** The most total weight it keeps. Required: `Infinity` is a choice written out. */
	max: number;
	/** A value's weight against `max` (bytes, say). Default 1: `max` then counts values. */
	weigh?: (value: V, key: K) => number;
	/** How long a value stays, in ms: a number, or made from the value and key. 0 keeps nothing.
	 *  Default `Infinity`. */
	keep?: number | ((value: V, key: K) => number);
	/** Hears each value that leaves, after it left (see the module's comment). */
	onEvict?: (key: K, value: V, why: EvictWhy) => void;
	/** The scope it lives in: when it ends, the cache ends, and every value is noticed 'end'. */
	owner?: Scope;
	/** The world its values are made in: a value made before the one a key holds never replaces it. */
	world?: World<never> | World<unknown>;
}

export interface SetOptions {
	/** When the value was made (`world.stamp()` when its work started). Default: the world now. */
	stamp?: number;
}

export interface Cache<K, V> {
	/** The value for `key`, as a use (it becomes the most recently used). */
	get(key: K): V | undefined;
	/** The value for `key`, without counting as a use. */
	peek(key: K): V | undefined;
	/** `key` holds a value (not past its age). */
	has(key: K): boolean;
	/** Keeps `value` for `key`: `false` when it was not kept (too heavy, kept for 0 ms, made before
	 *  what the key holds, or the cache ended), and then what the key held stays. */
	set(key: K, value: V, options?: SetOptions): boolean;
	/** Lets `key` go (noticed 'delete'): whether it held a value. */
	delete(key: K): boolean;
	/** Lets every value go, oldest first (each noticed 'delete'). */
	clear(): void;
	/** The live values, least recently used first (not a use). */
	entries(): Array<[K, V]>;
	/** How many values it holds. */
	readonly size: number;
	/** Their total weight. */
	readonly weight: number;
	/** Ends it: every value noticed 'end', and nothing kept after. */
	[Symbol.dispose](): void;
}

type Held<V> = { value: V; weight: number; until: number; stamp: number };

/** The least time between two sweeps of the ages, in ms. */
const SWEEP_MS = 1000;

/**
 * The package's own option, not the public shape: a value in use now counts against `max` but does
 * not go for size (the next least recently used goes instead). A flights' answer kept beside a
 * refresh still out is one. Not exported from the package.
 */
export const IN_USE: unique symbol = Symbol('ogygia.cache.in_use');

/** The options the package itself may pass (./flights.ts). */
export type InternalCacheOptions<K, V> = CacheOptions<K, V> & {
	[IN_USE]?: (value: V, key: K) => boolean;
};

class Store<K, V> implements Cache<K, V> {
	_name: string;
	_max: number;
	_weigh: ((value: V, key: K) => number) | undefined;
	_keep: number | ((value: V, key: K) => number);
	_on_evict: ((key: K, value: V, why: EvictWhy) => void) | undefined;
	_in_use: ((value: V, key: K) => boolean) | undefined;
	_world: World<unknown> | undefined;
	/** Least recently used first. */
	_held = new Map<K, Held<V>>();
	_weight = 0;
	_scope: Scope;
	/** The age timer's stop, and when it fires (`Infinity`: none set). */
	_stop_timer: () => void = () => {};
	_timer_at = Infinity;
	/** When the timer last swept (`-Infinity`: never). */
	_swept_at = -Infinity;
	/** Notices due, and whether they are being told (a notice's own set or delete queues behind). */
	_due: Array<[K, V, EvictWhy]> = [];
	_telling = false;

	constructor(o: CacheOptions<K, V>) {
		if (typeof o !== 'object' || o === null) throw bad('max', String(o), 'a number more than 0');
		const max = o.max;
		if (!(typeof max === 'number' && max > 0))
			throw bad('max', String(max), 'a number more than 0 (`Infinity` for no bound, written out)');
		const keep = o.keep ?? Infinity;
		if (typeof keep !== 'function' && !(typeof keep === 'number' && keep >= 0))
			throw bad('keep', String(keep), 'a time in ms of 0 or more, or a function that makes one');
		this._name = o.name ?? 'cache';
		this._max = max;
		this._weigh = o.weigh;
		this._keep = keep;
		this._on_evict = o.onEvict;
		this._in_use = (o as InternalCacheOptions<K, V>)[IN_USE];
		this._world = o.world as World<unknown> | undefined;
		this._scope = o.owner === undefined ? scope() : o.owner.child();
		this._scope.defer(() => this._end());
	}

	get size(): number {
		return this._held.size;
	}

	get weight(): number {
		return this._weight;
	}

	get(key: K): V | undefined {
		const h = this._live(key);
		if (h === undefined) return undefined;
		this._held.delete(key);
		this._held.set(key, h);
		return h.value;
	}

	peek(key: K): V | undefined {
		const h = this._held.get(key);
		return h === undefined || h.until <= Date.now() ? undefined : h.value;
	}

	has(key: K): boolean {
		const h = this._held.get(key);
		return h !== undefined && h.until > Date.now();
	}

	set(key: K, value: V, options?: SetOptions): boolean {
		if (this._scope.closed) return false;
		let stamp = 0;
		if (options?.stamp !== undefined) {
			if (this._world === undefined)
				throw bad('stamp', String(options.stamp), 'given only to a cache made with a world');
			stamp = options.stamp;
		} else if (this._world !== undefined) stamp = this._world.stamp();
		const now = Date.now();
		const old = this._held.get(key);
		if (old !== undefined && old.until > now && old.stamp > stamp) return false;
		const ms = typeof this._keep === 'function' ? this._keep(value, key) : this._keep;
		const weight = this._weigh === undefined ? 1 : this._weigh(value, key);
		if (!(ms > 0) || !(weight >= 0 && weight <= this._max)) return false;
		if (old !== undefined) {
			this._held.delete(key);
			this._weight -= old.weight;
			// (a replace, whatever the old value's age: the key goes on holding a value)
			this._due.push([key, old.value, 'delete']);
		}
		const until = ms === Infinity ? Infinity : now + ms;
		this._held.set(key, { value, weight, until, stamp });
		this._weight += weight;
		if (this._weight > this._max) this._evict(now);
		// (the new value due before the timer: the timer moves to it, no walk of the others)
		const due = Math.max(until, this._swept_at + SWEEP_MS);
		if (due < this._timer_at) this._set_timer(due, now);
		this._tell();
		return true;
	}

	delete(key: K): boolean {
		const h = this._held.get(key);
		if (h === undefined) return false;
		this._held.delete(key);
		this._weight -= h.weight;
		this._due.push([key, h.value, 'delete']);
		this._tell();
		return true;
	}

	clear(): void {
		this._let_all_go('delete');
	}

	entries(): Array<[K, V]> {
		const now = Date.now();
		const out: Array<[K, V]> = [];
		for (const [key, h] of this._held) if (h.until > now) out.push([key, h.value]);
		return out;
	}

	[DISPOSE](): void {
		this._scope.close();
	}

	/** `key`'s value when it is not past its age (one past it goes, noticed 'age'). */
	_live(key: K): Held<V> | undefined {
		const h = this._held.get(key);
		if (h === undefined) return undefined;
		if (h.until > Date.now()) return h;
		this._sweep(Date.now());
		this._tell();
		return undefined;
	}

	/** Lets every value past its age go. */
	_sweep(now: number): void {
		for (const [key, h] of this._held) {
			if (h.until > now) continue;
			this._held.delete(key);
			this._weight -= h.weight;
			this._due.push([key, h.value, 'age']);
		}
	}

	/** Past max: the expired go first, then the least recently used. */
	_evict(now: number): void {
		this._sweep(now);
		const in_use = this._in_use;
		for (const [key, h] of this._held) {
			if (this._weight <= this._max) return;
			if (in_use !== undefined && in_use(h.value, key)) continue;
			this._held.delete(key);
			this._weight -= h.weight;
			this._due.push([key, h.value, 'size']);
		}
	}

	/** The one age timer, for the value due first. */
	_arm(now: number): void {
		this._stop_timer();
		this._timer_at = Infinity;
		let next = Infinity;
		for (const h of this._held.values()) if (h.until < next) next = h.until;
		if (next === Infinity || this._scope.closed) return;
		// (a sweep walks every value: at most one a second, however spread the ages are. A read
		// past a value's age finds nothing all the same.)
		this._set_timer(Math.max(next, this._swept_at + SWEEP_MS), now);
	}

	/** The age timer, set to fire at `at`. */
	_set_timer(at: number, now: number): void {
		this._stop_timer();
		if (this._scope.closed) return;
		this._timer_at = at;
		this._stop_timer = this._scope.timeout(
			() => {
				this._timer_at = Infinity;
				const fired = Date.now();
				this._swept_at = fired;
				this._sweep(fired);
				this._arm(fired);
				this._tell();
			},
			Math.min(Math.max(this._timer_at - now, 0), MAX_TIMEOUT_MS)
		);
	}

	_let_all_go(why: EvictWhy): void {
		for (const [key, h] of this._held) this._due.push([key, h.value, why]);
		this._held.clear();
		this._weight = 0;
		this._stop_timer();
		this._timer_at = Infinity;
		this._tell();
	}

	/** The owner ended. */
	_end(): void {
		this._let_all_go('end');
	}

	/** Tells the notices due, in order; a notice's own calls queue theirs behind. */
	_tell(): void {
		if (this._telling) return;
		const hear = this._on_evict;
		if (hear === undefined) {
			this._due.length = 0;
			return;
		}
		this._telling = true;
		try {
			for (let i = 0; i < this._due.length; i++) {
				const [key, value, why] = this._due[i]!;
				try {
					hear(key, value, why);
				} catch (error) {
					report('machine_evict_failed', { name: this._name, why }, error);
				}
			}
		} finally {
			this._due.length = 0;
			this._telling = false;
		}
	}
}

function bad(option: string, value: string, rule: string): Error {
	return machine_error('machine_bad_option', { option, value, rule });
}

/** A keyed store, bounded and owned (see the module's comment). */
export function cache<K, V>(options: CacheOptions<K, V>): Cache<K, V> {
	return new Store(options);
}
