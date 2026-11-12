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
 * - `max` has no default, and is a finite number: a cache is bounded (`Infinity` throws in dev; in
 *   production the cache is refused, keeps nothing, and `machine_bad_option` is printed).
 *   Past it, the expired go first ('age'), then the least recently used ('size'). A `get` is a use,
 *   a `peek` is not. A value heavier than `max` (or whose weight or age is not a number of 0 or
 *   more), or one only pinned values could make room for, is not kept: `set` says `false`, nothing
 *   goes for size, and what the key held stays.
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
import { DEV } from 'esm-env';
import { clock } from './clock.ts';
import { machine_error, report } from './messages.ts';
import { DISPOSE, MAX_TIMEOUT_MS, scope, type Scope } from './scope.ts';
import type { World } from './world.ts';

/** Why a value left a cache. */
export type EvictWhy = 'age' | 'size' | 'delete' | 'end';

export interface CacheOptions<K, V> {
	/** Names the cache in messages. Default `cache`. */
	name?: string;
	/** The most total weight it keeps: a finite number more than 0. Required. */
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
	/** A value in use now: it counts against `max`, but is never let go for size (the next least
	 *  recently used goes instead). Bound or still-loading values, say. */
	pinned?: (value: V, key: K) => boolean;
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
	/** Keeps `value` for `key`: `false` when it was not kept (too heavy, room only pinned values
	 *  could make, kept for 0 ms, made before what the key holds, or the cache ended), and then
	 *  what the key held stays. */
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
		// a bound is a finite number more than 0: Infinity is no bound. In dev it throws; in production
		// the cache is refused (it keeps nothing) and the code is printed
		let max = o.max;
		let refused = false;
		if (!(typeof max === 'number' && max > 0 && Number.isFinite(max))) {
			const args = { option: 'max', value: String(max), rule: 'a finite number more than 0' };
			if (DEV) throw machine_error('machine_bad_option', args);
			report('machine_bad_option', args);
			max = 1;
			refused = true;
		}
		const keep = o.keep ?? Infinity;
		if (typeof keep !== 'function' && !(typeof keep === 'number' && keep >= 0))
			throw bad('keep', String(keep), 'a time in ms of 0 or more, or a function that makes one');
		this._name = o.name ?? 'cache';
		this._max = max;
		this._weigh = o.weigh;
		this._keep = keep;
		this._on_evict = o.onEvict;
		this._in_use = o.pinned;
		this._world = o.world as World<unknown> | undefined;
		this._scope = o.owner === undefined ? scope() : o.owner.child();
		this._scope.defer(() => this._end());
		if (refused) this._scope.close();
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
		return h === undefined || h.until <= clock.mono() ? undefined : h.value;
	}

	has(key: K): boolean {
		const h = this._held.get(key);
		return h !== undefined && h.until > clock.mono();
	}

	set(key: K, value: V, options?: SetOptions): boolean {
		if (this._scope.closed) return false;
		let stamp = 0;
		if (options?.stamp !== undefined) {
			if (this._world === undefined)
				throw bad('stamp', String(options.stamp), 'given only to a cache made with a world');
			stamp = options.stamp;
		} else if (this._world !== undefined) stamp = this._world.stamp();
		const now = clock.mono();
		const old = this._held.get(key);
		if (old !== undefined && old.until > now && old.stamp > stamp) return false;
		const ms = typeof this._keep === 'function' ? this._keep(value, key) : this._keep;
		const weight = this._weigh === undefined ? 1 : this._weigh(value, key);
		if (!(ms > 0) || !(weight >= 0 && weight <= this._max)) return false;
		if (!this._room(now, key, weight)) {
			this._tell();
			return false;
		}
		if (old !== undefined) {
			this._held.delete(key);
			this._weight -= old.weight;
			// (a replace, whatever the old value's age: the key goes on holding a value)
			this._due.push([key, old.value, 'delete']);
		}
		const until = ms === Infinity ? Infinity : now + ms;
		this._held.set(key, { value, weight, until, stamp });
		this._weight += weight;
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
		const now = clock.mono();
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
		if (h.until > clock.mono()) return h;
		this._sweep(clock.mono());
		this._tell();
		return undefined;
	}

	/** Lets every value past its age go (but `except`'s, which a set is replacing). */
	_sweep(now: number, except?: K): void {
		for (const [key, h] of this._held) {
			if (h.until > now || (except !== undefined && key === except)) continue;
			this._held.delete(key);
			this._weight -= h.weight;
			this._due.push([key, h.value, 'age']);
		}
	}

	/** Room for `weight` in place of what `key` holds: past max, the expired go first, then the
	 *  least recently used that are not pinned. When those cannot make the room, none goes for
	 *  size and the answer is `false`. */
	_room(now: number, key: K, weight: number): boolean {
		const held = this._held.get(key);
		const room = this._max - weight + (held === undefined ? 0 : held.weight);
		let over = this._weight - room;
		if (over <= 0) return true;
		// (not `key`'s own: the set replaces it, whatever its age, noticed 'delete')
		this._sweep(now, key);
		over = this._weight - room;
		if (over <= 0) return true;
		const in_use = this._in_use;
		const go: K[] = [];
		for (const [k, h] of this._held) {
			if (k === key || (in_use !== undefined && in_use(h.value, k))) continue;
			go.push(k);
			over -= h.weight;
			if (over <= 0) break;
		}
		if (over > 0) return false;
		for (const k of go) {
			const h = this._held.get(k)!;
			this._held.delete(k);
			this._weight -= h.weight;
			this._due.push([k, h.value, 'size']);
		}
		return true;
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
				const fired = clock.mono();
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
