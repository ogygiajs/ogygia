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
import { clock } from './ports.ts';
import { bad_option, machine_error, report } from './messages.ts';
import { noop } from './noop.ts';
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

/** A keyed store, bounded and owned (see the module's comment). */
export function cache<K, V>(o: CacheOptions<K, V>): Cache<K, V> {
	// (a closure, not a class: its state is locals the minifier shortens)
	if (typeof o !== 'object' || o === null) throw bad_option('max', o, 'a number more than 0');
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
		throw bad_option('keep', keep, 'a time in ms of 0 or more, or a function that makes one');
	const name = o.name ?? 'cache';
	const weigh = o.weigh;
	const on_evict = o.onEvict;
	const in_use = o.pinned;
	const world = o.world as World<unknown> | undefined;
	/** Least recently used first. */
	const held = new Map<K, Held<V>>();
	let weight_now = 0;
	/** The age timer's stop, and when it fires (`Infinity`: none set). */
	let stop_timer: () => void = noop;
	let timer_at = Infinity;
	/** When the timer last swept (`-Infinity`: never). */
	let swept_at = -Infinity;
	/** Notices due, and whether they are being told (a notice's own set or delete queues behind). */
	const due: Array<[K, V, EvictWhy]> = [];
	let telling = false;
	const life: Scope = o.owner === undefined ? scope() : o.owner.child();

	/** Lets every value past its age go (but `except`'s, which a set is replacing). */
	const sweep = (now: number, except?: K): void => {
		for (const [key, h] of held) {
			if (h.until > now || (except !== undefined && key === except)) continue;
			held.delete(key);
			weight_now -= h.weight;
			due.push([key, h.value, 'age']);
		}
	};

	/** Room for `weight` in place of what `key` holds: past max, the expired go first, then the
	 *  least recently used that are not pinned. When those cannot make the room, none goes for
	 *  size and the answer is `false`. */
	const room_for = (now: number, key: K, weight: number): boolean => {
		const h0 = held.get(key);
		const room = max - weight + (h0 === undefined ? 0 : h0.weight);
		let over = weight_now - room;
		if (over <= 0) return true;
		// (not `key`'s own: the set replaces it, whatever its age, noticed 'delete')
		sweep(now, key);
		over = weight_now - room;
		if (over <= 0) return true;
		const go: K[] = [];
		for (const [k, h] of held) {
			if (k === key || (in_use !== undefined && in_use(h.value, k))) continue;
			go.push(k);
			over -= h.weight;
			if (over <= 0) break;
		}
		if (over > 0) return false;
		for (const k of go) {
			const h = held.get(k)!;
			held.delete(k);
			weight_now -= h.weight;
			due.push([k, h.value, 'size']);
		}
		return true;
	};

	/** The age timer, set to fire at `at`. */
	const set_timer = (at: number, now: number): void => {
		stop_timer();
		if (life.closed) return;
		timer_at = at;
		stop_timer = life.timeout(
			() => {
				timer_at = Infinity;
				const fired = clock.mono();
				swept_at = fired;
				sweep(fired);
				// the one age timer, for the value due first
				stop_timer();
				timer_at = Infinity;
				let next = Infinity;
				for (const h of held.values()) if (h.until < next) next = h.until;
				// (a sweep walks every value: at most one a second, however spread the ages are. A read
				// past a value's age finds nothing all the same.)
				if (next !== Infinity && !life.closed)
					set_timer(Math.max(next, swept_at + SWEEP_MS), fired);
				tell();
			},
			Math.min(Math.max(timer_at - now, 0), MAX_TIMEOUT_MS)
		);
	};

	const let_all_go = (why: EvictWhy): void => {
		for (const [key, h] of held) due.push([key, h.value, why]);
		held.clear();
		weight_now = 0;
		stop_timer();
		timer_at = Infinity;
		tell();
	};

	/** Tells the notices due, in order; a notice's own calls queue theirs behind. */
	const tell = (): void => {
		if (telling) return;
		if (on_evict === undefined) {
			due.length = 0;
			return;
		}
		telling = true;
		try {
			for (let i = 0; i < due.length; i++) {
				const [key, value, why] = due[i]!;
				try {
					on_evict(key, value, why);
				} catch (error) {
					report('machine_evict_failed', { name, why }, error);
				}
			}
		} finally {
			due.length = 0;
			telling = false;
		}
	};

	life.defer(() => let_all_go('end'));
	if (refused) life.close();

	return {
		get size(): number {
			return held.size;
		},
		get weight(): number {
			return weight_now;
		},
		get(key: K): V | undefined {
			const h = held.get(key);
			if (h === undefined) return undefined;
			// (one past its age goes, noticed 'age')
			if (!(h.until > clock.mono())) {
				sweep(clock.mono());
				tell();
				return undefined;
			}
			held.delete(key);
			held.set(key, h);
			return h.value;
		},
		peek(key: K): V | undefined {
			const h = held.get(key);
			return h === undefined || h.until <= clock.mono() ? undefined : h.value;
		},
		has(key: K): boolean {
			const h = held.get(key);
			return h !== undefined && h.until > clock.mono();
		},
		set(key: K, value: V, options?: SetOptions): boolean {
			if (life.closed) return false;
			let stamp = 0;
			if (options?.stamp !== undefined) {
				if (world === undefined)
					throw bad_option('stamp', options.stamp, 'given only to a cache made with a world');
				stamp = options.stamp;
			} else if (world !== undefined) stamp = world.stamp();
			const now = clock.mono();
			const old = held.get(key);
			if (old !== undefined && old.until > now && old.stamp > stamp) return false;
			const ms = typeof keep === 'function' ? keep(value, key) : keep;
			const weight = weigh === undefined ? 1 : weigh(value, key);
			if (!(ms > 0) || !(weight >= 0 && weight <= max)) return false;
			if (!room_for(now, key, weight)) {
				tell();
				return false;
			}
			if (old !== undefined) {
				held.delete(key);
				weight_now -= old.weight;
				// (a replace, whatever the old value's age: the key goes on holding a value)
				due.push([key, old.value, 'delete']);
			}
			const until = ms === Infinity ? Infinity : now + ms;
			held.set(key, { value, weight, until, stamp });
			weight_now += weight;
			// (the new value due before the timer: the timer moves to it, no walk of the others)
			const at = Math.max(until, swept_at + SWEEP_MS);
			if (at < timer_at) set_timer(at, now);
			tell();
			return true;
		},
		delete(key: K): boolean {
			const h = held.get(key);
			if (h === undefined) return false;
			held.delete(key);
			weight_now -= h.weight;
			due.push([key, h.value, 'delete']);
			tell();
			return true;
		},
		clear(): void {
			let_all_go('delete');
		},
		entries(): Array<[K, V]> {
			const now = clock.mono();
			const out: Array<[K, V]> = [];
			for (const [key, h] of held) if (h.until > now) out.push([key, h.value]);
			return out;
		},
		[DISPOSE](): void {
			life.close();
		}
	};
}
