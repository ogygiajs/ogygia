// ─────────────────────────────────────────────────────────────────────────────
// The frame store — the ONLY meeting point between the network and region DOM.
//
// Invariant (see internal/notes/frames.md): no code path from network arrival to DOM. Every channel
// (defer fetch, streamed parcel, mutation fragment, live refresh) WRITES a frame here; region
// elements are BINDERS that subscribe to their address and apply store state to themselves.
//
// What the mechanics buy:
//   • dedupe   — N regions with the same address share one in-flight fetch (`ensure`).
//   • staleness — every frame carries a stamp of the store's one world, taken when its request
//     started (a fetch) or when it was written (a batch's part, a streamed or mutation frame);
//     `write` drops one not newer than what is applied, so a slow response that started earlier can
//     never overwrite one that started, or landed, later.
//   • safety   — a prefetch warms an address nothing is bound to; it cannot touch the wrong DOM.
//   • lifecycle — the shared fetch aborts only when the LAST waiter leaves; an entry nothing binds or
//     fetches lingers EVICT_TTL, then goes (the store's cache, its age).
//
// The store is owned: its entries (a `cache()`), its fetches in flight (a `flights()`) and its world
// live in one scope, and `_reset` ends that scope (every reservation fails, every caller of a fetch
// gets STALE). Subscription is NOT owned here (hub v2 phase W): binders subscribe/notify through the
// hub's ONE `watch`/`notify` primitive, keyed `frame:<address>`. No DOM, no Svelte. Unit-tested in
// test/frame-store.test.ts.
// ─────────────────────────────────────────────────────────────────────────────
import {
	cache,
	flights,
	scope,
	STALE,
	world,
	type Cache,
	type Flights,
	type Scope,
	type Stale,
	type World
} from '@ogygia/machine';
import type { Frame } from '../frame.ts';
import { watch, notify, watcher_count } from '../ref-watch.ts';

export type FrameFetcher = (signal: AbortSignal) => Promise<string>;

/** Frame addresses live in the hub's watcher space under a namespace, so region binders subscribe
 *  through the ONE hub `watch`/`notify` primitive (hub v2 phase W) — the frame store no longer owns
 *  a parallel subscriber set. */
const frame_id = (a: string): string => 'frame:' + a;

/** What a flight at an address runs: the store's own fetch, or a batch's part arriving through an
 *  external stream (the batch's promise, settled by the frame written there or failed by the
 *  batch's end). The input of the call that started the flight is the one that runs. */
type FrameAsk = { a: string; work: FrameFetcher | Promise<string> };

type Entry = {
	/** The stamp of the applied content (0 = nothing applied yet). */
	v: number;
	html: string | null;
	/** A batch's part promised here: ANY frame written at the address (the batch's part, or a forced
	 *  fetch that landed first) settles it, and `release()` fails it when the batch ends with no
	 *  frame there. */
	batch: { settle: (html: string) => void; fail: (err: unknown) => void } | null;
	/** The fresh capability a renewal at this address answered (an expired one is re-signed once):
	 *  the address's, so every element bound here moves onto it, not only the one that fetched. */
	renewed: string | null;
};

/** Entries with no subscribers linger this long (ms) so quick remounts / SPA swaps reuse content. */
const EVICT_TTL = 60_000;

/** The most addresses the store keeps: past it the least recently used idle one goes (a bound or
 *  fetched one never does). A page binds a few dozen; a long session's idle ones are what goes. */
const MAX_ADDRESSES = 2000;

type FrameFlights = Flights<FrameAsk, string, Pick<FrameAsk, 'a'>>;

/** The store: its entries, its fetches in flight and its world, in one scope. */
type Store = {
	life: Scope;
	/** Every stamp is this world's: a fetch's when it starts, a write from elsewhere when it writes. */
	world: World;
	entries: Cache<string, Entry>;
	flights: FrameFlights;
};

// ONE store per document, even when this module is duplicated across bundles. The transport hook
// (decode → write) ships in the app's UNIVERSAL hooks graph, while the region binder (subscribe) ships
// in the separately-loaded ogygia RUNTIME chunk — two module instances. A single-flight mutation
// writes in the transport copy and must notify a subscriber registered in the runtime copy, so the
// store (its entries, its fetches in flight, its world: STALE is one symbol across copies) is pinned
// to a global. Falls back to a plain value off-DOM (SSR / unit tests).
const STORE_KEY = '__ogygia_frame_store__';
const store_host = (typeof globalThis !== 'undefined' ? globalThis : {}) as {
	[STORE_KEY]?: Store;
};

function store(): Store {
	return (store_host[STORE_KEY] ??= make_store());
}

function make_store(): Store {
	const life = scope();
	const entries = cache<string, Entry>({
		name: 'frames',
		// (an entry nothing binds or fetches lingers EVICT_TTL, and past MAX_ADDRESSES the least
		// recently used of those goes; a bound or fetched one is in use, never let go for size)
		max: MAX_ADDRESSES,
		keep: (_e, a) => (live(a) ? Infinity : EVICT_TTL),
		pinned: (_e, a) => live(a),
		owner: life,
		onEvict: (a, e, why) => {
			// the store ends: a binder joined to a reservation must not hang
			if (why === 'end') e.batch?.fail(new Error('reset'));
			// its linger ran out while something bound it again or fetches it: it stays
			else if (why === 'age' && live(a)) entries.set(a, e);
		}
	});
	const s: Store = {
		life,
		world: world(),
		entries,
		flights: life.adopt(
			flights<FrameAsk>()({
				name: 'frames',
				key: ['a'],
				ignore: { work: 'one flight per address: a fetch or a batch part out there is joined' },
				keep: 0,
				run: ({ a, work }, signal): Promise<string> =>
					typeof work === 'function' ? fetch_frame(a, work, signal) : work
			})
		)
	};
	return s;
}

/** A new stamp of the store's world, newer than every one before it: a fetch takes one when it
 *  starts, and a channel that writes from elsewhere (a batch's part, a streamed or mutation frame)
 *  when it writes. */
export function stamp(): number {
	const w = store().world;
	w.bump();
	return w.stamp();
}

/** A fetch at an address takes its stamp at its start, and writes what it got (a newer write may
 *  have raced past it: the answer is whatever the store then holds). */
async function fetch_frame(a: string, fetcher: FrameFetcher, signal: AbortSignal): Promise<string> {
	const t = stamp();
	const html = await fetcher(signal);
	if (!signal.aborted) write({ a, v: t, html });
	return store().entries.peek(a)?.html ?? html;
}

/** A fetch or a batch's part is out at this address. */
const flying = (a: string): boolean => store_host[STORE_KEY]?.flights.peek({ a }) !== undefined;

/** Something binds the address, or fetches it: its entry stays. */
const live = (a: string): boolean => watcher_count(frame_id(a)) > 0 || flying(a);

function entry(a: string): Entry {
	const entries = store().entries;
	let e = entries.peek(a);
	if (!e) {
		e = { v: 0, html: null, batch: null, renewed: null };
		entries.set(a, e);
	}
	return e;
}

/**
 * An entry nothing binds or fetches any more lingers EVICT_TTL from now, then goes. A late binder
 * that mounts inside the window still catches its content (prefetch / batch-stream ahead of the DOM).
 * Every channel that leaves an entry idle calls this: a subscriber unbinding, a flight that settled,
 * AND a `write()` that lands where nothing is listening (a single-flight mutation for an unmounted
 * region, or a live tick whose address keeps changing).
 */
function schedule_evict(a: string, e: Entry): void {
	if (live(a)) return;
	const entries = store().entries;
	if (entries.peek(a) === e) entries.set(a, e); // (set again: its linger starts now)
}

/** Applied content for an address, if any. */
export function peek(a: string): { v: number; html: string } | null {
	const e = store().entries.peek(a);
	return e && e.html != null ? { v: e.v, html: e.html } : null;
}

/** A renewal at this address answered `fresh`, the capability its elements fetch with from now on. */
export function renew(a: string, fresh: string): void {
	entry(a).renewed = fresh;
}

/** The fresh capability a renewal at this address answered, if any. */
export function renewal(a: string): string | null {
	return store().entries.peek(a)?.renewed ?? null;
}

/** Nothing applied and nothing in flight at this address (a batch may take it on). */
export function is_idle(a: string): boolean {
	const e = store().entries.peek(a);
	return !e || (e.html == null && !flying(a));
}

/**
 * Write a frame. Applied only if its stamp is newer than the applied content's; an older or equal
 * one is dropped and reported `false`. Subscribers are notified on apply.
 */
export function write(f: Frame): boolean {
	const e = entry(f.a);
	if (f.v <= e.v) return false; // stale — a newer write already landed
	e.v = f.v;
	e.html = f.html;
	// Fulfil a batch's part, whoever wrote the frame (the batch, or a forced fetch that landed
	// first): a binder that joined via ensure() unblocks, and no per-region fetch ever starts. The
	// subscription (set in the binder) is what actually paints — settle just unblocks.
	const held = e.batch;
	if (held) {
		e.batch = null;
		held.settle(f.html);
	}
	notify(frame_id(f.a), f); // region binders subscribe through the hub (watch), not a local set
	schedule_evict(f.a, e); // no-op while subscribed; starts the linger when the write lands unbound
	return true;
}

/**
 * Reserve an address whose content is arriving via an EXTERNAL batch stream (single-flight navigation). A region
 * binder that mounts before its frame lands calls `ensure()`, finds the batch's flight there, and JOINS it
 * instead of starting its own fetch — so a navigation that pulls N regions makes ONE batch request,
 * not N. `write()` fulfils it when the frame arrives; `release()` fails it if the batch ends without
 * one (the binder then falls back to its own fetch). The flight is the batch's: a binder leaving never
 * ends it. No-op if content or a fetch is already present.
 */
export function reserve(a: string): void {
	const e = entry(a);
	if (e.html != null || flying(a)) return;
	const batch = new Promise<string>((settle, fail) => {
		e.batch = { settle, fail };
	});
	batch.catch(() => {}); // ok: a part no flight waits on (a forced fetch took its place) is not unhandled
	const settled = () => schedule_evict(a, e);
	store().flights.get({ a, work: batch }).then(settled, settled);
}

/**
 * Fail an unfulfilled batch part (the batch ended and no frame was written at this address, by it or
 * by anyone). Joined binders reject out of `ensure()` and retry with their own fetch. No-op once a
 * frame has landed (it settled the part).
 */
export function release(a: string): void {
	const e = store().entries.peek(a);
	const held = e?.batch;
	if (!e || !held) return;
	e.batch = null;
	const miss = new Error('ogygia batch: no frame for ' + a);
	miss.name = BATCH_MISS;
	held.fail(miss);
}

/** The error a joined reservation rejects with when its batch ended without its frame: the binder's
 *  own fetch runs at once (nothing failed — the batch just did not carry it). */
export const BATCH_MISS = 'OgygiaBatchMiss';

/**
 * Subscribe to writes at an address. If content is ALREADY applied, the callback fires immediately
 * with it (a late binder — e.g. a region that mounts after a batch stream already delivered its
 * frame — catches up without a request). Returns an unsubscribe fn. While subscribed the entry
 * stays; after the last unsubscribe it lingers EVICT_TTL then goes (unless re-bound).
 */
export function subscribe(a: string, cb: (f: Frame) => void): () => void {
	const e = entry(a);
	// Ongoing notifications ride the hub's watcher set; immediate replay of already-applied
	// content stays here (a late binder catching a frame that landed before it mounted).
	const off = watch(frame_id(a), cb as (v: unknown) => void);
	store().entries.set(a, e); // (bound now: it stays while bound)
	if (e.html != null) cb({ a, v: e.v, html: e.html });
	return () => {
		off();
		schedule_evict(a, e);
	};
}

/**
 * Ensure an address has content, deduping concurrent callers onto one fetch.
 *
 * - Content already applied (and not `force`): resolves immediately with it.
 * - A fetch (or a batch's part) is in flight (and not `force`): joins it — N regions, ONE request.
 * - Otherwise starts `fetcher` with a fresh stamp; on success the response is WRITTEN (subject to
 *   the staleness check) and the resolved value is whatever the store now holds.
 * - `force` (SWR revalidate) always starts a new fetch, and ends the one out before it: whoever
 *   waited on that one joins the new one. The stamps still guarantee an older response can't
 *   overwrite a newer one.
 *
 * `signal` is the caller's: when it aborts, this caller alone gets `STALE` at once, and the shared
 * fetch is aborted only once its LAST caller left — one unmounting element must not kill a fetch
 * its twin still awaits. Rejections propagate to every joined caller; retry policy stays with the
 * caller (the element).
 */
export async function ensure(
	a: string,
	fetcher: FrameFetcher,
	opts: { force?: boolean; signal?: AbortSignal } = {}
): Promise<string | Stale> {
	const { signal } = opts;
	const s = store();
	const e = entry(a);
	let fresh = opts.force === true;
	try {
		for (;;) {
			if (!fresh && e.html != null) return e.html;
			const html = await s.flights.get({ a, work: fetcher }, { signal, fresh });
			// STALE: this caller left, the store ended, or a forced fetch took the place of the one it
			// waited on: then it asks again (and joins that one)
			if (html !== STALE || signal?.aborted || s.life.closed) return html;
			fresh = false;
		}
	} finally {
		schedule_evict(a, e);
	}
}

/** Test/HMR hook — end the store (every reservation fails, every caller of a fetch gets STALE); the
 *  next use makes a new one. */
export function _reset(): void {
	const old = store_host[STORE_KEY];
	store_host[STORE_KEY] = undefined;
	old?.life.close();
}
