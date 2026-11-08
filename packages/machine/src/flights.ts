/**
 * Keyed async work that callers share: one flight per key at a time, its answer kept for as long
 * as you say, and never a failure.
 *
 *   const pages = flights({
 *     run: (href: string, signal) => fetch(href, { signal }).then((r) => r.text()),
 *     keep: 8_000
 *   });
 *   const html = await pages.get('/docs', { signal }); // joins the fetch already out for it
 *   if (html === STALE) return; // dropped, or this caller left
 *
 *   const core = flights({ run: () => import('./hydrate-core.ts'), retries: 1 }); // one key
 *   const mod = await core.get();
 *
 *   const checkouts = flights<Spec>()({            // an object input, keyed by some of its fields
 *     key: ['owner', 'repo', 'ref', 'sub'],
 *     ignore: { depth: 'how much history to fetch, not which files' },
 *     run: ({ owner, repo, ref, sub, depth }, signal) => checkout(owner, repo, ref, sub, depth, signal)
 *   });
 *
 * - `get` joins the flight out for its key, else gives the kept answer, else starts a flight, and
 *   `run` starts inside that `get`. The key is the input itself (by `Map` identity), or, keyed, the
 *   fields `key` names: `run` (and `keep`, `weigh`) is handed the input typed to those fields only,
 *   so work that reads a field its key leaves out does not compile, unless `ignore` names that field
 *   with the reason (the input of the call that started the flight is then the one that runs).
 *   `peek` and `drop` name a keyed flights' keys by those fields too (`peek({ href })`). The fields
 *   are spelled into one string one way everywhere: a string by its text, an object by identity.
 * - A failure (after `retries`, tried again at once) fails every caller that joined it, and is
 *   never kept: the next `get` starts a new flight. A failing key costs one try per wave of
 *   callers, not one per caller.
 * - `keep` is how long an answer stays (ms: a number, or made from the answer; 0 keeps nothing,
 *   the default keeps it for as long as the flights lives). `max` caps the total `weigh` of what is
 *   kept: the least recently used go first.
 * - `drop` takes kept answers out and ends the flights in progress: their signal aborts, every
 *   caller that joined them gets `STALE`, and nothing they answer is kept.
 * - A caller may bring a `signal`: when it aborts, that caller alone gets `STALE` at once, and the
 *   work is aborted only once the last caller has left. A caller with no signal holds the flight
 *   until it lands.
 * - `fresh` starts a new flight even when an answer is kept; the kept one stays (and `peek` shows
 *   it) until the new one lands, and stays when the new one fails or is not kept.
 * - A `world` (`world()`) is what its answers are made in. A move of it is a `drop` of what the
 *   move touches; and an answer whose world moved while it was out is `STALE` for every caller that
 *   joined it, and never kept. With a keyed world, `touches` says which keys an answer was made
 *   from: a move of other keys leaves it be, and a flight with nothing kept yet goes on, judged by
 *   its answer when it lands.
 *
 * Each key's entry is a machine (`flying`, `kept`, `gone`), and the work of a flight is its
 * `flying` visit's `scope.task`: leaving the visit (a drop, the last caller gone, a fresh flight in
 * its place) is what aborts the work and turns its answer into STALE. `observe()` hears every
 * flight's moves, under the flights' `name`.
 */
import { machine, type Machine } from './machine.ts';
import { machine_error } from './messages.ts';
import { DISPOSE } from './scope.ts';
import { STALE, type Stale } from './stale.ts';
import { watch_world, type World } from './world.ts';

/** What every flights takes; `R` is what `run` (and `keep`, `weigh`) may read of an input. */
interface FlightsCommon<R, V, W> {
	/** Names its flights in messages and to observers. Default `flights`. */
	name?: string;
	/** The work for an input: started by the `get` that finds no flight and no kept answer. */
	run: (input: R, signal: AbortSignal) => V;
	/** How long an answer stays, in ms: a number, or made from the answer and its input. 0 keeps
	 *  nothing (callers share the flight while it is out); the default, `Infinity`, keeps it for as
	 *  long as the flights lives. A failure is never kept. */
	keep?: number | ((answer: Awaited<V>, input: R) => number);
	/** The most total weight it keeps; past it, the least recently used answers go. Default
	 *  `Infinity`. */
	max?: number;
	/** An answer's weight against `max` (bytes, say). Default 1: `max` then counts answers. An
	 *  answer heavier than `max` is not kept. */
	weigh?: (answer: Awaited<V>, input: R) => number;
	/** Tries again at once this many times, inside one flight, before it fails. Default 0. */
	retries?: number;
	/** The world the answers are made in (`world()`): when it moves, what the move touches goes (a
	 *  kept answer, and the flight out for it), and an answer whose world moved while it was out is
	 *  `STALE` for every caller that joined it, and never kept. */
	world?: World<W>;
	/** The keys of a keyed `world` an answer was made from: a move of other keys leaves it (and a
	 *  flight out, judged by its answer once it lands) be. Without it, any move touches every answer. */
	touches?: (answer: Awaited<V>) => Iterable<W>;
}

/** A flights whose key is its whole input (by `Map` identity: a string, a number, an object
 *  itself), or of one key when it takes none. */
export interface FlightsOptions<I, V, W = never> extends FlightsCommon<I, V, W> {}

/** A flights over an object input whose key is some of its fields (`flights<I>()({ key, … })`):
 *  `run` reads only the fields its key names, and those `ignore` names with the reason it may. */
export interface KeyedFlightsOptions<
	I,
	F extends keyof I,
	G extends Exclude<keyof I, F>,
	V,
	W = never
> extends FlightsCommon<Pick<I, F | G>, V, W> {
	/** The fields that make the key: two inputs that agree on them are one flight. It must list
	 *  every field the work reads (`run`'s input holds no other), unless `ignore` says why not. */
	key: readonly F[];
	/** Fields the work reads that are left out of the key on purpose, each with its reason (the
	 *  input of the call that started the flight is the one that runs): `{ retries: 'how hard to
	 *  try, not what is made' }`. */
	ignore?: { readonly [field in G]: string };
}

export interface GetOptions {
	/** This caller leaves when it aborts: it gets `STALE` at once, and the work is aborted once
	 *  every caller of its flight has left. */
	signal?: AbortSignal;
	/** Start a new flight even when an answer is kept (a revalidation): the kept answer stays until
	 *  the new one lands. A flight already out for the key is ended (its callers get `STALE`). */
	fresh?: boolean;
}

/** What a key holds now: a flight with nothing kept yet, or a kept answer (`flying`: a fresh flight
 *  for it is out). `at` is when the answer landed (`Date.now()`). */
export type FlightEntry<V> =
	| { readonly kind: 'flying' }
	| { readonly kind: 'kept'; readonly answer: V; readonly at: number; readonly flying: boolean };

/** `get`'s arguments: no input for a flights of one key (`flights({ run: () => … })`). */
export type GetArgs<I> = [I] extends [void]
	? [input?: undefined, options?: GetOptions]
	: [input: I, options?: GetOptions];

export interface Flights<I, V, K = I> {
	/** The answer for `input`: joined, kept, or from a new flight. `STALE` when it was dropped (or
	 *  superseded by a fresh one) before it landed, or this caller's `signal` aborted. */
	get(...args: GetArgs<I>): Promise<V | Stale>;
	/** What `key` holds now, without starting anything or counting as a use. */
	peek(key: K): FlightEntry<V> | undefined;
	/** Takes `key` out (or every key `which` says yes to): a kept answer goes, a flight out is ended
	 *  and its callers get `STALE`. (A key that is itself a function is dropped with a predicate.) */
	drop(which: K | ((key: K, entry: FlightEntry<V>) => boolean)): void;
	/** Drops every key, and every later `get` gives `STALE` without running: for a scope to adopt. */
	[Symbol.dispose](): void;
}

type Kept = {
	answer: unknown;
	at: number;
	until: number;
	weight: number;
	/** The settled promise every later `get` of it is handed (so `get() === get()`). */
	promise: Promise<unknown>;
};
/** One flight: its shared answer, and who still waits on it. */
type Flight = {
	shared: Promise<unknown>;
	/** Callers with a signal still waiting. */
	holders: number;
	/** A caller with no signal joined: it holds the flight until it lands. */
	pinned: boolean;
	/** The world when it started (`world.stamp()`): its answer is judged against it. */
	stamp: number;
};
type EntryStates = {
	flying: { flight: Flight; prior: Kept | null };
	kept: Kept;
	gone: {};
};
const entry_steps = {
	flying: ['flying', 'kept', 'gone'],
	kept: ['flying', 'gone'],
	gone: []
} as const;
type Entry = Machine<EntryStates, typeof entry_steps>;

const STALE_NOW: Promise<Stale> = Promise.resolve(STALE);
const noop = (): void => {};
const FLYING: FlightEntry<never> = Object.freeze({ kind: 'flying' });

async function attempt<I, V>(
	run: (input: I, signal: AbortSignal) => V,
	input: I,
	signal: AbortSignal,
	retries: number
): Promise<Awaited<V>> {
	for (let left = retries; ; left--) {
		try {
			return await run(input, signal);
		} catch (error) {
			if (left <= 0 || signal.aborted) throw error;
		}
	}
}

/** Ids for the objects (and symbols) a key holds: a key field compares by identity. */
const object_ids = new WeakMap<object, number>();
const symbol_ids = new Map<symbol, number>();
let next_id = 0;

/** One field of a key, spelled so that two different values never spell one string: a string is
 *  its length, then itself; any other value its kind, then itself, then `;`. */
function key_part(v: unknown): string {
	switch (typeof v) {
		case 'string':
			return 's' + v.length + ':' + v;
		case 'number':
			return 'n' + v + ';'; // (0 and -0 are one key, as in a Map)
		case 'bigint':
			return 'g' + v + ';';
		case 'boolean':
			return v ? 't;' : 'f;';
		case 'undefined':
			return 'u;';
		case 'symbol': {
			let id = symbol_ids.get(v);
			if (id === undefined) symbol_ids.set(v, (id = next_id++));
			return 'y' + id + ';';
		}
		default: {
			if (v === null) return 'z;';
			const o = v as object;
			let id = object_ids.get(o);
			if (id === undefined) object_ids.set(o, (id = next_id++));
			return 'o' + id + ';';
		}
	}
}

/** The key of a keyed flights' input: its key fields, in their order, spelled one way. */
export function key_of(fields: readonly PropertyKey[], input: unknown): string {
	const of = input as Record<PropertyKey, unknown>;
	let key = '';
	for (const f of fields) key += key_part(of[f]);
	return key;
}

function bad_option(option: string, value: unknown, rule: string): Error {
	return machine_error('machine_bad_option', { option, value: String(value), rule });
}

function kept_of(s: Readonly<Kept>): Kept {
	return { answer: s.answer, at: s.at, until: s.until, weight: s.weight, promise: s.promise };
}

const expired = (k: Readonly<Kept>, now: number): boolean => k.until !== Infinity && now >= k.until;

class Flown<I, V, K> implements Flights<I, V, K> {
	_def: { create(data: EntryStates['flying']): Entry };
	_run: (input: I, signal: AbortSignal) => unknown;
	/** A keyed flights' key fields (`null`: the input itself is the key). */
	_fields: readonly PropertyKey[] | null;
	/** A keyed flights' keys as callers name them (its key fields), by the spelled key. */
	_keys: Map<string, K> | null;
	_keep: number | ((answer: V, input: I) => number);
	_max: number;
	_weigh: ((answer: V, input: I) => number) | undefined;
	_retries: number;
	_world: World<unknown> | undefined;
	_touches: ((answer: V) => Iterable<unknown>) | undefined;
	/** Stops hearing the world (on dispose). */
	_unwatch: () => void = noop;
	/** Some answer can expire: a new flight sweeps the expired ones out. */
	_expires: boolean;
	/** By key: the input itself, or (keyed) the spelled key. */
	_entries = new Map<unknown, Entry>();
	_weight = 0;
	_disposed = false;

	constructor(
		o: FlightsCommon<I, unknown, unknown> & {
			key?: readonly PropertyKey[];
			ignore?: Record<PropertyKey, string>;
		}
	) {
		if (typeof o.run !== 'function') throw bad_option('run', typeof o.run, 'a function');
		this._fields = null;
		this._keys = null;
		if (o.key !== undefined) {
			const fields = o.key;
			if (!Array.isArray(fields) || new Set(fields).size !== fields.length)
				throw bad_option('key', String(fields), 'a list of the input fields that make the key');
			for (const [field, why] of Object.entries(o.ignore ?? {})) {
				if (fields.includes(field))
					throw bad_option('ignore', field, 'a field the key leaves out, not one of its fields');
				if (typeof why !== 'string' || why.trim() === '')
					throw bad_option('ignore', field, 'the reason the key leaves it out');
			}
			this._fields = Object.freeze([...fields]);
			this._keys = new Map();
		} else if (o.ignore !== undefined) throw bad_option('ignore', 'without key', 'beside a key');
		const retries = o.retries ?? 0;
		if (!Number.isInteger(retries) || retries < 0)
			throw bad_option('retries', retries, 'a whole number of 0 or more');
		const keep = o.keep ?? Infinity;
		if (typeof keep !== 'function' && !(typeof keep === 'number' && keep >= 0))
			throw bad_option('keep', keep, 'a time in ms of 0 or more, or a function that makes one');
		const max = o.max ?? Infinity;
		if (!(typeof max === 'number' && max > 0)) throw bad_option('max', max, 'more than 0');
		this._def = machine<EntryStates>()({
			name: o.name ?? 'flights',
			initial: 'flying',
			steps: entry_steps
		});
		this._run = o.run;
		this._keep = keep as number | ((answer: V, input: I) => number);
		this._max = max;
		this._weigh = o.weigh as ((answer: V, input: I) => number) | undefined;
		this._retries = retries;
		this._expires = keep !== Infinity;
		this._world = o.world;
		this._touches = o.touches as ((answer: V) => Iterable<unknown>) | undefined;
		if (o.world !== undefined) {
			const unwatch = watch_world(o.world, (keys) => this._moved(keys));
			if (unwatch === null) throw bad_option('world', typeof o.world, 'a world from world()');
			this._unwatch = unwatch;
		}
	}

	/** The world moved: what the move touches goes. With no `touches` (or the whole world moved),
	 *  that is everything; else the kept answers made from a moved key (a flight out beside one
	 *  goes with it; one with nothing kept yet is judged by its answer when it lands). */
	_moved(keys: ReadonlySet<unknown> | null): void {
		const touches = this._touches;
		if (keys === null || touches === undefined) return this.drop(() => true);
		this.drop((_, entry) => {
			if (entry.kind !== 'kept') return false;
			let read: Iterable<unknown>;
			try {
				read = touches(entry.answer);
			} catch {
				return true; // (what it read cannot be told: made again, never kept past the move)
			}
			for (const k of read) if (keys.has(k)) return true;
			return false;
		});
	}

	/** Whether an answer that landed is still of the world its flight started in. */
	_current(flight: Flight, answer: V): boolean {
		const w = this._world;
		if (w === undefined) return true;
		const touches = this._touches;
		return touches === undefined ? w.fresh(flight.stamp) : w.fresh(flight.stamp, touches(answer));
	}

	get(input?: I, options?: GetOptions): Promise<V | Stale> {
		if (this._disposed) return STALE_NOW;
		const signal = options?.signal;
		if (signal?.aborted) return STALE_NOW;
		const fields = this._fields;
		const key = fields === null ? input : key_of(fields, input);
		let m = this._entries.get(key);
		let prior: Kept | null = null;
		if (m !== undefined) {
			const s = m.now;
			if (s.kind === 'kept') {
				if (expired(s, s.until === Infinity ? 0 : Date.now())) {
					this._remove(key, m);
					m = undefined;
				} else if (options?.fresh !== true) {
					if (this._max !== Infinity) {
						this._entries.delete(key);
						this._entries.set(key, m);
					}
					return s.promise as Promise<V>;
				} else prior = kept_of(s);
			} else if (s.kind === 'flying') {
				if (options?.fresh !== true) return this._join(key, m, s.flight, signal);
				prior = s.prior;
			}
		}
		return this._join(key, ...this._fly(key, m, input as I, prior), signal);
	}

	/** The entry key of a key as callers name it (keyed: its fields, spelled). */
	_entry_key(key: K): unknown {
		return this._fields === null ? key : key_of(this._fields, key);
	}

	peek(key: K): FlightEntry<V> | undefined {
		const m = this._entries.get(this._entry_key(key));
		return m === undefined ? undefined : this._view(m, Date.now());
	}

	drop(which: K | ((key: K, entry: FlightEntry<V>) => boolean)): void {
		if (typeof which !== 'function') {
			const key = this._entry_key(which);
			const m = this._entries.get(key);
			if (m !== undefined) this._remove(key, m);
			return;
		}
		const test = which as (key: K, entry: FlightEntry<V>) => boolean;
		const keys = this._keys;
		const now = Date.now();
		// (a Map lets an entry be deleted while it is walked)
		for (const [key, m] of this._entries) {
			const view = this._view(m, now);
			if (view === undefined || test(keys === null ? (key as K) : keys.get(key as string)!, view))
				this._remove(key, m);
		}
	}

	[DISPOSE](): void {
		this._disposed = true;
		this._unwatch();
		this.drop(() => true);
	}

	/** What an entry shows (`undefined`: its answer expired). */
	_view(m: Entry, now: number): FlightEntry<V> | undefined {
		const s = m.now;
		if (s.kind === 'kept')
			return expired(s, now)
				? undefined
				: { kind: 'kept', answer: s.answer as V, at: s.at, flying: false };
		if (s.kind === 'flying') {
			const p = s.prior;
			return p === null || expired(p, now)
				? FLYING
				: { kind: 'kept', answer: p.answer as V, at: p.at, flying: true };
		}
		return undefined;
	}

	/** Starts a flight for `key` (the entry's `flying` visit), keeping `prior` beside it. */
	_fly(key: unknown, m: Entry | undefined, input: I, prior: Kept | null): [Entry, Flight] {
		if (this._expires) this._sweep(Date.now());
		const stamp = this._world === undefined ? 0 : this._world.stamp();
		const flight: Flight = { shared: STALE_NOW, holders: 0, pinned: false, stamp };
		let entry: Entry;
		if (m !== undefined && this._entries.get(key) === m) {
			entry = m;
			entry.go('flying', { flight, prior });
		} else {
			entry = this._def.create({ flight, prior });
			this._entries.set(key, entry);
			const fields = this._fields;
			if (fields !== null) {
				// the key as callers name it (drop's predicate): its fields only, never the rest
				const named: Record<PropertyKey, unknown> = {};
				for (const f of fields) named[f] = (input as Record<PropertyKey, unknown>)[f];
				this._keys!.set(key as string, named as K);
			}
		}
		const visit = entry.now;
		const run = this._run;
		const retries = this._retries;
		const work = entry.scope.task((signal) => attempt(run, input, signal, retries));
		flight.shared = work.then(
			(answer) => {
				if (answer === STALE || entry.now !== visit) return STALE;
				let current: boolean;
				try {
					current = this._current(flight, answer as V);
				} catch (error) {
					this._back(key, entry, prior);
					throw error;
				}
				// its world moved while it was out: made from facts that are gone, so no caller has it
				if (!current) {
					this._back(key, entry, prior);
					return STALE;
				}
				this._land(key, entry, input, answer as V, prior, flight.shared);
				return answer;
			},
			(error: unknown) => {
				if (entry.now !== visit) return STALE;
				this._back(key, entry, prior);
				throw error;
			}
		);
		// (the callers handle its failure; this one is the flights' own, so it is never unhandled)
		flight.shared.then(undefined, noop);
		return [entry, flight];
	}

	/** A flight's answer landed: kept, or (not kept) the entry goes back to what it kept before. */
	_land(
		key: unknown,
		m: Entry,
		input: I,
		answer: V,
		prior: Kept | null,
		promise: Promise<unknown>
	): void {
		let ms: number;
		let weight: number;
		try {
			ms = typeof this._keep === 'function' ? this._keep(answer, input) : this._keep;
			weight = this._weigh === undefined ? 1 : this._weigh(answer, input);
		} catch (error) {
			this._back(key, m, prior);
			throw error;
		}
		if (!(ms > 0) || !(weight <= this._max)) return this._back(key, m, prior);
		const at = Date.now();
		this._weight += weight - (prior?.weight ?? 0);
		m.go('kept', { answer, at, until: ms === Infinity ? Infinity : at + ms, weight, promise });
		if (this._max !== Infinity) {
			// the newest use last: the least recently used are first in line to go
			this._entries.delete(key);
			this._entries.set(key, m);
			this._evict();
		}
	}

	/** Back to the answer kept before this flight, or gone when there was none. */
	_back(key: unknown, m: Entry, prior: Kept | null): void {
		if (prior !== null) m.go('kept', prior);
		else this._remove(key, m);
	}

	/** A caller joins `flight`: with no signal, the shared answer; with one, its own stake in it. */
	_join(
		key: unknown,
		m: Entry,
		flight: Flight,
		signal: AbortSignal | undefined
	): Promise<V | Stale> {
		const shared = flight.shared as Promise<V | Stale>;
		if (signal === undefined) {
			flight.pinned = true;
			return shared;
		}
		flight.holders++;
		return new Promise((resolve, reject) => {
			const leave = () => {
				resolve(STALE);
				// the last caller left: nobody wants the answer, so the work stops
				if (--flight.holders > 0 || flight.pinned) return;
				const s = m.now;
				if (s.kind === 'flying' && s.flight === flight) this._back(key, m, s.prior);
			};
			signal.addEventListener('abort', leave, { once: true });
			shared.then(
				(answer) => {
					signal.removeEventListener('abort', leave);
					resolve(answer);
				},
				(error: unknown) => {
					signal.removeEventListener('abort', leave);
					reject(error);
				}
			);
		});
	}

	/** Takes `key`'s entry out: its kept answer goes, its flight (if out) ends. */
	_remove(key: unknown, m: Entry): void {
		if (this._entries.get(key) === m) {
			this._entries.delete(key);
			this._keys?.delete(key as string);
		}
		const s = m.now;
		if (s.kind === 'gone') return;
		this._weight -= s.kind === 'kept' ? s.weight : (s.prior?.weight ?? 0);
		m.go('gone');
	}

	_sweep(now: number): void {
		for (const [key, m] of this._entries) {
			const s = m.now;
			if (s.kind === 'kept' && expired(s, now)) this._remove(key, m);
		}
	}

	_evict(): void {
		for (const [key, m] of this._entries) {
			if (this._weight <= this._max) return;
			if (m.now.kind === 'kept') this._remove(key, m);
		}
	}
}

/** Makes a keyed flights over input `I` (`flights<I>()({ key, ignore?, run, … })`). */
export type KeyedFlights<I> = <
	const F extends keyof I,
	G extends Exclude<keyof I, F> = never,
	V = unknown,
	W = never
>(
	options: KeyedFlightsOptions<I, F, G, V, W>
) => Flights<I, Awaited<V>, Pick<I, F>>;

/** Keyed shared async work (see the module's comment). With no options, a maker of a flights over
 *  object input `I` keyed by some of its fields: `flights<Ask>()({ key: ['href'], run })`. */
export function flights<I extends object>(): KeyedFlights<I>;
export function flights<I = void, V = unknown, W = never>(
	options: FlightsOptions<I, V, W>
): Flights<I, Awaited<V>, I>;
export function flights(options?: object): unknown {
	if (options === undefined) return keyed;
	return new Flown(options as FlightsOptions<unknown, unknown, unknown>);
}

function keyed(options: KeyedFlightsOptions<object, never, never, unknown>): unknown {
	if (typeof options !== 'object' || options === null || options.key === undefined)
		throw bad_option('key', 'none', 'the input fields that make the key');
	return new Flown(options);
}
