// ─────────────────────────────────────────────────────────────────────────────
// The frame store — the ONLY meeting point between the network and region DOM.
//
// Invariant (see internal/notes/frames.md): no code path from network arrival to DOM. Every channel
// (defer fetch, streamed parcel, mutation fragment, live refresh) WRITES a frame here; region
// elements are BINDERS that subscribe to their address and apply store state to themselves.
//
// What the mechanics buy:
//   • dedupe   — N regions with the same address share one in-flight fetch (`ensure`).
//   • staleness — versions are ticketed at REQUEST time; `write` drops v <= applied, so a slow
//     response that started earlier can never overwrite one that started later.
//   • safety   — a prefetch warms an address nothing is bound to; it cannot touch the wrong DOM.
//   • lifecycle — the shared fetch aborts only when the LAST waiter leaves; entries evict on a
//     TTL after the last subscriber unbinds.
//
// Subscription is NOT owned here (hub v2 phase W): binders subscribe/notify through the hub's ONE
// `watch`/`notify` primitive, keyed `frame:<address>`. This module keeps the versioned store and its
// fetches in flight (one flights(), keyed by address). No DOM, no Svelte. Unit-tested in
// test/frame-store.test.ts.
// ─────────────────────────────────────────────────────────────────────────────
import {
	flights,
	scope,
	STALE,
	type Flights,
	type InFlight,
	type Scope,
	type Stale
} from '@ogygia/machine';
import type { Frame } from '../frame.ts';
import { watch, notify, watcher_count } from '../ref-watch.ts';

/** The store's fetch at an address. `flight` is the address's flight: its priority is the most
 *  urgent caller's, raised as callers join (a queued download follows it: load-scheduler.ts). */
export type FrameFetcher = (signal: AbortSignal, flight: InFlight) => Promise<string>;

/** Frame addresses live in the hub's watcher space under a namespace, so region binders subscribe
 *  through the ONE hub `watch`/`notify` primitive (hub v2 phase W) — the frame store no longer owns
 *  a parallel subscriber set. */
const frame_id = (a: string): string => 'frame:' + a;

/** The name of a refused answer's error (./region-endpoint-url.ts): by name, since the store is one
 *  per document across bundle copies, and a copy's class is not another's. */
const REFUSED = 'RegionAnswerRefused';

/** A refused answer nobody asked for yet (the page's early start: ./early-holes.ts), held at its
 *  address for the first caller that asks there (see `Entry.refused`). Any other failure is not. */
export function hold_refusal(a: string, err: unknown): void {
	if ((err as { name?: string } | null)?.name === REFUSED) entry(a).refused = err as Error;
}

/** What a flight at an address runs: the store's own fetch, or a batch's part arriving through an
 *  external stream (the batch's promise, settled by the frame written there or failed by the
 *  batch's end). The input of the call that started the flight is the one that runs. */
type FrameAsk = { a: string; work: FrameFetcher | Promise<string> };

type Entry = {
	/** Version of the applied content (0 = nothing applied yet). */
	v: number;
	html: string | null;
	/** Monotonic ticket source — every fetch START takes the next ticket. */
	seq: number;
	/** A batch's part promised here: ANY frame written at the address (the batch's part, or a forced
	 *  fetch that landed first) settles it, and `release()` fails it when the batch ends with no
	 *  frame there. */
	batch: { settle: (html: string) => void; fail: (err: unknown) => void } | null;
	/** Its idle linger (EVICT_TTL), while it lingers: the scope that owns the timer. */
	evict: Scope | null;
	/** The fresh capability a renewal at this address answered (an expired one is re-signed once):
	 *  the address's, so every element bound here moves onto it, not only the one that fetched. */
	renewed: string | null;
	/** A refused answer that no element asked for yet (the page's early start read it before any hole
	 *  woke: ./early-holes.ts): handed, once, to the first caller that asks here, which is refused as
	 *  if it had asked itself. A frame written here, or a forced fetch, ends it. */
	refused: Error | null;
};

/** Entries with no subscribers linger this long (ms) so quick remounts / SPA swaps reuse content. */
const EVICT_TTL = 60_000;

// ONE store per document, even when this module is duplicated across bundles. The transport hook
// (decode → write) ships in the app's UNIVERSAL hooks graph, while the region binder (subscribe) ships
// in the separately-loaded ogygia RUNTIME chunk — two module instances. A single-flight mutation
// writes in the transport copy and must notify a subscriber registered in the runtime copy, so the
// `entries` map is pinned to a global, and so are the fetches in flight (STALE is one symbol across
// copies). Falls back to plain values off-DOM (SSR / unit tests).
const GLOBAL_KEY = '__ogygia_frames__';
const FLIGHTS_KEY = '__ogygia_frame_flights__';
type FrameFlights = Flights<FrameAsk, string, Pick<FrameAsk, 'a'>>;
type FramesHost = {
	[GLOBAL_KEY]?: Map<string, Entry>;
	[FLIGHTS_KEY]?: FrameFlights;
};
const store_host = (typeof globalThis !== 'undefined' ? globalThis : {}) as FramesHost;
const entries: Map<string, Entry> = (store_host[GLOBAL_KEY] ??= new Map());

/** The fetches in flight, one per address, shared by every caller of it. Nothing is kept: the
 *  versioned store holds what landed. A flight's work aborts once its last caller left. */
function frame_flights(): FrameFlights {
	return (store_host[FLIGHTS_KEY] ??= flights.keyed<FrameAsk>()({
		name: 'frames',
		key: ['a'],
		ignore: { work: 'one flight per address: a fetch or a batch part out there is joined' },
		keep: 0,
		run: ({ a, work }, signal, flight): Promise<string> =>
			typeof work === 'function' ? fetch_frame(a, work, signal, flight) : work
	}));
}

/** A fetch at an address takes its ticket at its start, and writes what it got (a newer write may
 *  have raced past it: the answer is whatever the store then holds). */
async function fetch_frame(
	a: string,
	fetcher: FrameFetcher,
	signal: AbortSignal,
	flight: InFlight
): Promise<string> {
	const t = ticket(a);
	const html = await fetcher(signal, flight);
	if (!signal.aborted) write({ a, v: t, html });
	return entries.get(a)?.html ?? html;
}

/** A fetch or a batch's part is out at this address. */
const flying = (a: string): boolean => store_host[FLIGHTS_KEY]?.peek({ a }) !== undefined;

function entry(a: string): Entry {
	let e = entries.get(a);
	if (!e) {
		e = { v: 0, html: null, seq: 0, batch: null, evict: null, renewed: null, refused: null };
		entries.set(a, e);
	}
	return e;
}

/**
 * Let an idle entry (no subscribers, nothing in flight) linger EVICT_TTL, then drop it. A late binder
 * that mounts inside the window still catches its content (prefetch / batch-stream ahead of the DOM);
 * nothing bound means nothing to keep. Idempotent — resets the timer. Every channel that leaves an
 * entry idle calls this: a subscriber unbinding, a flight that settled, AND a `write()` that lands
 * where nothing is listening (a single-flight mutation for an unmounted region, or a live tick whose
 * address keeps changing). Without the write path, those orphan entries would accumulate forever —
 * they never had a subscriber to trigger eviction.
 */
function schedule_evict(a: string, e: Entry): void {
	if (watcher_count(frame_id(a)) > 0 || flying(a)) return; // still live — keep it
	e.evict?.close();
	// (the entry's own linger in the document's one store: no region owns an unbound entry)
	(e.evict = scope()).timeout(() => {
		const cur = entries.get(a);
		if (cur === e && watcher_count(frame_id(a)) === 0 && !flying(a)) entries.delete(a);
	}, EVICT_TTL);
}

/** Applied content for an address, if any. */
export function peek(a: string): { v: number; html: string } | null {
	const e = entries.get(a);
	return e && e.html != null ? { v: e.v, html: e.html } : null;
}

/** A renewal at this address answered `fresh`, the capability its elements fetch with from now on. */
export function renew(a: string, fresh: string): void {
	entry(a).renewed = fresh;
}

/** The fresh capability a renewal at this address answered, if any. */
export function renewal(a: string): string | null {
	return entries.get(a)?.renewed ?? null;
}

/** Nothing applied and nothing in flight at this address (a batch may take it on). */
export function is_idle(a: string): boolean {
	const e = entries.get(a);
	return !e || (e.html == null && !flying(a));
}

/** Next request ticket for an address. External channels (streaming, mutations) use this too. */
export function ticket(a: string): number {
	return ++entry(a).seq;
}

/**
 * Write a frame. Applied only if strictly newer than the current content; stale writes are
 * dropped and reported `false`. Subscribers are notified on apply.
 */
export function write(f: Frame): boolean {
	const e = entry(f.a);
	if (f.v <= e.v) return false; // stale — a newer write already landed
	if (f.v > e.seq) e.seq = f.v; // foreign ticket (streamed/mutation frame) — keep seq monotonic
	e.v = f.v;
	e.html = f.html;
	e.refused = null;
	// Fulfil a batch's part, whoever wrote the frame (the batch, or a forced fetch that landed
	// first): a binder that joined via ensure() unblocks, and no per-region fetch ever starts. The
	// subscription (set in the binder) is what actually paints — settle just unblocks.
	const held = e.batch;
	if (held) {
		e.batch = null;
		held.settle(f.html);
	}
	notify(frame_id(f.a), f); // region binders subscribe through the hub (watch), not a local set
	schedule_evict(f.a, e); // no-op while subscribed; arms the TTL when the write lands unbound
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
	e.evict?.close();
	e.evict = null;
	const batch = new Promise<string>((settle, fail) => {
		e.batch = { settle, fail };
	});
	batch.catch(() => {}); // ok: a part no flight waits on (a forced fetch took its place) is not unhandled
	const settled = () => schedule_evict(a, e);
	frame_flights().get({ a, work: batch }).then(settled, settled);
}

/**
 * Fail an unfulfilled batch part (the batch ended and no frame was written at this address, by it or
 * by anyone). Joined binders reject out of `ensure()` and retry with their own fetch. No-op once a
 * frame has landed (it settled the part).
 */
export function release(a: string): void {
	const e = entries.get(a);
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
 * never evicts; after the last unsubscribe it lingers EVICT_TTL then drops (unless re-bound).
 */
export function subscribe(a: string, cb: (f: Frame) => void): () => void {
	const e = entry(a);
	e.evict?.close();
	e.evict = null;
	// Ongoing notifications ride the hub's watcher set; immediate replay of already-applied
	// content stays here (a late binder catching a frame that landed before it mounted).
	const off = watch(frame_id(a), cb as (v: unknown) => void);
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
 * - Otherwise starts `fetcher` with a fresh ticket; on success the response is WRITTEN (subject to
 *   the staleness check) and the resolved value is whatever the store now holds.
 * - `force` (SWR revalidate) always starts a new fetch, and ends the one out before it: whoever
 *   waited on that one joins the new one. The ticket ordering still guarantees an older response
 *   can't overwrite a newer one.
 *
 * `signal` is the caller's: when it aborts, this caller alone gets `STALE` at once, and the shared
 * fetch is aborted only once its LAST caller left — one unmounting element must not kill a fetch
 * its twin still awaits. Rejections propagate to every joined caller; retry policy stays with the
 * caller (the element).
 *
 * `priority` is how soon this caller needs it (its load class, ./load-class.ts): a fetch out at a
 * lower one, a warm still waiting for a background turn, is raised to it, never lowered.
 */
export async function ensure(
	a: string,
	fetcher: FrameFetcher,
	opts: { force?: boolean; signal?: AbortSignal; priority?: number } = {}
): Promise<string | Stale> {
	const { signal, priority } = opts;
	const f = frame_flights();
	const e = entry(a);
	let fresh = opts.force === true;
	try {
		for (;;) {
			if (!fresh && e.html != null) return e.html;
			const refused = e.refused;
			e.refused = null;
			if (!fresh && refused !== null) throw refused;
			const html = await f.get({ a, work: fetcher }, { signal, fresh, priority });
			// STALE: this caller left, the store was reset, or a forced fetch took the place of the
			// one it waited on: then it asks again (and joins that one)
			if (html !== STALE || signal?.aborted || frame_flights() !== f) return html;
			fresh = false;
		}
	} finally {
		schedule_evict(a, e);
	}
}

/** Test/HMR hook — drop everything. */
export function _reset(): void {
	for (const e of entries.values()) {
		e.evict?.close();
		e.batch?.fail(new Error('reset')); // reject any joined reservation waiters (no hung promises)
	}
	// (a new flights: a caller of a dropped one sees it was replaced, and does not ask again)
	const old = store_host[FLIGHTS_KEY];
	store_host[FLIGHTS_KEY] = undefined;
	old?.drop(() => true);
	entries.clear();
}
