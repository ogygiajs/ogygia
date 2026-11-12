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
//     started (a fetch, a batch's part) or when it was written (a streamed or mutation frame);
//     `write` drops one not newer than what is applied, so a slow response that started earlier can
//     never overwrite one that started, or landed, later. A frame that carries a data version
//     (`region(C, props, { version })`) is ordered by it first, so an answer decoded late (no
//     request to stamp it by: a command's) cannot paint older data either. Each write, applied or
//     dropped, is a move of the address's stored answer (a machine).
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
	machine,
	scope,
	STALE,
	world,
	type Cache,
	type Flights,
	type InFlight,
	type Scope,
	type Stale,
	type World
} from '@ogygia/machine';
import { older_by, stands_at, type DropWhy, type Frame } from '../frame.ts';
import type { VerifiedHtml } from './html-sink.ts';
import { watch, notify, watcher_count } from '../ref-watch.ts';

/** The store's fetch at an address. `flight` is the address's flight: its priority is the most
 *  urgent caller's, raised as callers join (a queued download follows it: load-scheduler.ts). */
export type FrameFetcher = (signal: AbortSignal, flight: InFlight) => Promise<VerifiedHtml>;

/** A frame as the store holds it: its HTML vouched for (./html-sink.ts), as everything the store
 *  hands on goes into a region's DOM. */
export type StoredFrame = Frame & { html: VerifiedHtml };

/** Frame addresses live in the hub's watcher space under a namespace, so region binders subscribe
 *  through the ONE hub `watch`/`notify` primitive (hub v2 phase W) — the frame store no longer owns
 *  a parallel subscriber set. */
const frame_id = (a: string): string => `frame:${a}`;

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
type FrameAsk = { a: string; work: FrameFetcher | Promise<VerifiedHtml> };

/** An applied answer: its stamp `v`, its data version `d` (`Frame.d`, when it had one), and its
 *  HTML, vouched for (./html-sink.ts): the stored answer holds verified HTML only. */
type Shown = { v: number; d: number | undefined; html: VerifiedHtml };

type AnswerStates = {
	/** Nothing applied at the address yet. */
	empty: {};
	/** An answer is applied. Each newer one is a step of its own. */
	shown: Shown;
	/** The answer written last was dropped (`dropped`, and why): the applied one stays. */
	kept: Shown & { dropped: { v: number; d: number | undefined; why: DropWhy } };
};

/** The address's stored answer: every write is a move, applied (`shown`) or dropped (`kept`), so
 *  `observe()` (devtools, a test's trace) hears each decision. */
const answer_definition = () =>
	machine<AnswerStates>()({
		name: 'stored-answer',
		initial: 'empty',
		steps: { empty: ['shown'], shown: ['shown', 'kept'], kept: ['shown', 'kept'] }
	});

type StoredAnswer = ReturnType<ReturnType<typeof answer_definition>['create']>;

type Entry = {
	/** What is applied at the address, as a machine. */
	answer: StoredAnswer;
	/** A batch's part promised here: ANY frame written at the address (the batch's part, or a forced
	 *  fetch that landed first) settles it, and `release()` fails it when the batch ends with no
	 *  frame there. */
	batch: { settle: (html: VerifiedHtml) => void; fail: (err: unknown) => void } | null;
	/** The fresh capability a renewal at this address answered (an expired one is re-signed once):
	 *  the address's, so every element bound here moves onto it, not only the one that fetched. */
	renewed: string | null;
	/** A refused answer that no element asked for yet (the page's early start read it before any hole
	 *  woke: ./early-holes.ts): handed, once, to the first caller that asks here, which is refused as
	 *  if it had asked itself. A frame written here, or a forced fetch, ends it. */
	refused: Error | null;
	/** The store let it go (another entry took the address, or it lingered out): never held again. */
	gone: boolean;
};

/** Entries with no subscribers linger this long (ms) so quick remounts / SPA swaps reuse content. */
const EVICT_TTL = 60_000;

/** The most addresses the store keeps: past it the least recently used idle one goes (a bound or
 *  fetched one never does). A page binds a few dozen; a long session's idle ones are what goes. */
const MAX_ADDRESSES = 2000;

/** A set by a caller that knows the entry is in use (bound or fetched), or idle. */
const HELD = { keep: Infinity };
const LINGER = { keep: EVICT_TTL };

type FrameFlights = Flights<FrameAsk, VerifiedHtml, Pick<FrameAsk, 'a'>>;

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
// to a global. Falls back to a plain value off-DOM (SSR / unit tests). The stored answers' definition
// is the document's too, so every entry's moves reach the same copy's observers.
const STORE_KEY = '__ogygia_frame_store__';
const ANSWER_KEY = '__ogygia_frame_answer__';
const store_host = (typeof globalThis !== 'undefined' ? globalThis : {}) as {
	[STORE_KEY]?: Store;
	[ANSWER_KEY]?: ReturnType<typeof answer_definition>;
};
const answers = (store_host[ANSWER_KEY] ??= answer_definition());

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
			// its linger ran out while something bound it again or fetches it: it stays
			if (why === 'age' && live(a) && entries.set(a, e, HELD)) return;
			// (a set of the entry it holds is not a leave: a notice is of an entry the store let go)
			e.gone = true;
			// the store ends: a binder joined to a reservation must not hang
			if (why === 'end') e.batch?.fail(new Error('reset'));
			e.answer.stop();
		}
	});
	const s: Store = {
		life,
		world: world(),
		entries,
		flights: life.adopt(
			flights.keyed<FrameAsk>()({
				name: 'frames',
				key: ['a'],
				ignore: { work: 'one flight per address: a fetch or a batch part out there is joined' },
				keep: 0,
				run: ({ a, work }, signal, flight): Promise<VerifiedHtml> =>
					typeof work === 'function' ? fetch_frame(a, work, signal, flight) : work
			})
		)
	};
	return s;
}

/** The answer applied at an entry, if any. */
function shown_of(e: Entry): Shown | null {
	const now = e.answer.now;
	return now.kind === 'empty' ? null : now;
}

/** A new stamp of the store's world, newer than every one before it: a fetch or a batch's part
 *  takes one when it is asked for, and a channel that writes from elsewhere (a streamed or mutation
 *  frame) when it writes. */
export function stamp(): number {
	const w = store().world;
	w.bump();
	return w.stamp();
}

/** Where an answer asked for now stands at an address: a new stamp, its entry made. External
 *  channels (streaming, mutations, a live tick) take one too. */
export function ticket(a: string): number {
	entry(a);
	return stamp();
}

/** A fetch at an address takes its stamp at its start, and writes what it got (a newer write may
 *  have raced past it: the answer is whatever the store then holds). */
async function fetch_frame(
	a: string,
	fetcher: FrameFetcher,
	signal: AbortSignal,
	flight: InFlight
): Promise<VerifiedHtml> {
	const t = stamp();
	const html = await fetcher(signal, flight);
	if (!signal.aborted) write({ a, v: t, html });
	const e = store().entries.peek(a);
	return (e && shown_of(e)?.html) ?? html;
}

/** A fetch or a batch's part is out at this address. */
const flying = (a: string): boolean => store_host[STORE_KEY]?.flights.peek({ a }) !== undefined;

/** Something binds the address, or fetches it: its entry stays. */
const live = (a: string): boolean => watcher_count(frame_id(a)) > 0 || flying(a);

function entry(a: string): Entry {
	const entries = store().entries;
	let e = entries.peek(a);
	if (!e) {
		e = { answer: answers.create(), batch: null, renewed: null, refused: null, gone: false };
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
	if (live(a) || e.gone) return;
	store().entries.set(a, e, LINGER); // (set again: its linger starts now)
}

/** Applied content for an address, if any. */
export function peek(a: string): Shown | null {
	const e = store().entries.peek(a);
	const s = e && shown_of(e);
	return s ? { v: s.v, d: s.d, html: s.html } : null;
}

/** The data version of the content applied at an address, if it had one. */
export function shown_version(a: string): number | undefined {
	const e = store().entries.peek(a);
	return e && shown_of(e)?.d;
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
	return !e || (shown_of(e) === null && !flying(a));
}

/**
 * Write a frame. Applied only if newer than the current content (`older_by`); older writes are
 * dropped (a `kept` move) and reported `false`. Subscribers are notified on apply.
 */
export function write(f: StoredFrame): boolean {
	const e = entry(f.a);
	const s = shown_of(e);
	const why = older_by(f, s);
	if (why !== null) {
		const shown = s as Shown;
		e.answer.go('kept', {
			v: shown.v,
			d: shown.d,
			html: shown.html,
			dropped: { v: f.v, d: f.d, why }
		});
		return false;
	}
	e.answer.go('shown', { ...stands_at(s, f), html: f.html });
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
	if (shown_of(e) !== null || flying(a)) return;
	const batch = new Promise<VerifiedHtml>((settle, fail) => {
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
	const miss = new Error(`ogygia batch: no frame for ${a}`);
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
export function subscribe(a: string, cb: (f: StoredFrame) => void): () => void {
	const e = entry(a);
	// Ongoing notifications ride the hub's watcher set; immediate replay of already-applied
	// content stays here (a late binder catching a frame that landed before it mounted).
	const off = watch(frame_id(a), cb as (v: unknown) => void);
	store().entries.set(a, e, HELD); // (bound now: it stays while bound)
	const s = shown_of(e);
	if (s !== null) cb({ a, v: s.v, d: s.d, html: s.html });
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
 *
 * `priority` is how soon this caller needs it (its load class, ./load-class.ts): a fetch out at a
 * lower one, a warm still waiting for a background turn, is raised to it, never lowered.
 */
export async function ensure(
	a: string,
	fetcher: FrameFetcher,
	opts: { force?: boolean; signal?: AbortSignal; priority?: number } = {}
): Promise<VerifiedHtml | Stale> {
	const { signal, priority } = opts;
	const st = store();
	const e = entry(a);
	let fresh = opts.force === true;
	try {
		for (;;) {
			const s = fresh ? null : shown_of(e);
			if (s !== null) return s.html;
			const refused = e.refused;
			e.refused = null;
			if (!fresh && refused !== null) throw refused;
			const html = await st.flights.get({ a, work: fetcher }, { signal, fresh, priority });
			// STALE: this caller left, the store ended, or a forced fetch took the place of the one it
			// waited on: then it asks again (and joins that one)
			if (html !== STALE || signal?.aborted || st.life.closed) return html;
			fresh = false;
		}
	} finally {
		schedule_evict(a, e);
	}
}

/** Test/HMR hook — end the store (every reservation fails, every caller of a fetch gets STALE, every
 *  stored answer stops); the next use makes a new one. */
export function _reset(): void {
	const old = store_host[STORE_KEY];
	store_host[STORE_KEY] = undefined;
	old?.life.close();
}
