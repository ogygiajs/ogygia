// ─────────────────────────────────────────────────────────────────────────────
// Navigation frame stream — the client half of out-of-order streaming on navigation.
//
// Given a set of signed region endpoints (the calls a route needs), POST them to the batch endpoint
// and read ONE streamed response, writing each `<template data-ogygia-slot>` frame into the store the
// moment it arrives (out of order — the slot routes it). Regions bound to those addresses apply via
// their store subscription. No per-region round trip, no fetch waterfall.
//
// This is Ryan's test made concrete: request new server-component data on navigation, flush part of
// the response, let the rest come in as the server's async settles.
// ─────────────────────────────────────────────────────────────────────────────
import { cache, machine, STALE, type MachineGraph, type Scope } from '@ogygia/machine';
import { frameAddress } from '../frame.ts';
import { stream } from '../policies.ts';
import { is_idle, reserve, release, stamp, write } from './frame-store.ts';
import { runtime_session } from './session.ts';
import { emit as dt_emit } from '../events/bus.ts';
import { OG_LEN, OGYGIA_SLOT } from '../wire-markup.ts';
import { slots } from './slots.ts';

// DEVTOOLS gate — module-local const from the Vite `define` (proven DCE pattern); off → folds out.
const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;
const HOOK_HOLE_ANSWERED =
	typeof __OGYGIA_HOOK_HOLE_ANSWERED__ !== 'undefined' ? __OGYGIA_HOOK_HOLE_ANSWERED__ : true;
const HOOK_HOLE_BATCH_MISSED =
	typeof __OGYGIA_HOOK_HOLE_BATCH_MISSED__ !== 'undefined'
		? __OGYGIA_HOOK_HOLE_BATCH_MISSED__
		: true;
/** this page's batches, numbered (the devtools join a batch's parts and its end to it) */
let batch_seq = 0;

/** A batched hole's timing, for the hole's own report of its answer (beacon `holes_answered`): the
 *  batch left at `left`, this hole's part landed at `at` (page time), `size` holes rode it. Bounded:
 *  the newest 64 endpoints (the measuring browser only). */
const batched = cache<string, { left: number; at: number; size: number }>({
	name: 'batched hole timings',
	max: 64
});

/** How the batch that carried `endpoint` timed it, or undefined (it rode no batch). */
export function batch_times(
	endpoint: string
): { left: number; at: number; size: number } | undefined {
	return batched.get(endpoint);
}

const STREAM_DONE_SLOT = '__ogygia_done__';
const OPEN = `<template ${OGYGIA_SLOT}="`;
const LEN = `" ${OG_LEN}="`;
const CLOSE = '</template>';

type Parcel = { slot: string; html: string; end: number };

/**
 * The next whole parcel in `buf` from `from` (server/stream-regions.ts), or `null` when it has not
 * fully arrived yet. A plain parcel ends at the first `</template>` (the server length-frames any
 * answer carrying one of its own); a length-framed one is exactly `data-og-len` characters.
 */
export function read_parcel(buf: string, from: number): Parcel | null {
	// (a loop, not a call per opening skipped: any number of them reads in constant stack, #835)
	for (;;) {
		const open = buf.indexOf(OPEN, from);
		if (open === -1) return null;
		const slot_at = open + OPEN.length;
		const quote = buf.indexOf('"', slot_at);
		if (quote === -1) return null;
		const slot = buf.slice(slot_at, quote);
		if (buf.startsWith('">', quote)) {
			const close = buf.indexOf(CLOSE, quote + 2);
			if (close === -1) return null;
			return { slot, html: buf.slice(quote + 2, close), end: close + CLOSE.length };
		}
		// (not a shape the server writes: skip past this opening, or wait for the rest of it)
		from = slot_at;
		if (!buf.startsWith(LEN, quote)) {
			if (buf.length - quote < LEN.length) return null;
			continue;
		}
		let i = quote + LEN.length;
		let len = 0;
		for (let c = buf.charCodeAt(i); c >= 48 && c <= 57; c = buf.charCodeAt(++i))
			len = len * 10 + (c - 48);
		if (i + 2 > buf.length) return null;
		if (!buf.startsWith('">', i)) continue;
		const start = i + 2;
		const end = start + len + CLOSE.length;
		if (end > buf.length) return null;
		return { slot, html: buf.slice(start, start + len), end };
	}
}

/** A batch stream quiet this long is given up, and the holes still waiting on it fetch on their own:
 *  the `stream` policy's deadline (../policies.ts, where its reason lives). */
const STALL_MS = stream.deadline;

/**
 * A BATCH STREAM'S LIFE, one machine: `sending` (the POST, until its answer starts), `reading` (each
 * read that brings bytes is a new visit, so the quiet time starts again). Its end, however it ends,
 * is the machine's `stop()`. Quiet for STALL_MS in either, it steps to `stalled` on its own: the
 * request is aborted and every reservation it did not fill is released, as at any other end.
 */
const batch_stream = machine<{ sending: {}; reading: {}; stalled: {} }>()({
	name: 'batch-stream',
	initial: 'sending',
	steps: {
		sending: ['reading', 'stalled'],
		reading: ['reading', 'stalled'],
		stalled: []
	},
	after: {
		sending: { ms: STALL_MS, to: 'stalled' },
		reading: { ms: STALL_MS, to: 'stalled' }
	}
});

/** The batch stream's machine as data (test/machine-steps.test.ts holds each step to where it is
 *  taken). */
export function batch_stream_graph(): MachineGraph {
	return batch_stream.graph();
}

function sigOf(endpoint: string): string | null {
	const q = endpoint.indexOf('?');
	return q === -1 ? null : new URLSearchParams(endpoint.slice(q + 1)).get('sig');
}

/**
 * Stream a batch of region calls into the frame store. Endpoints must share an endpoint path, read
 * here off the first URL: `send_batches` groups them so (#987). Frames apply as they land; the
 * promise resolves when the response ends.
 *
 * `visit`: the scope of the page whose holes these are (the page on screen by default; a navigation
 * hands the next page's, runtime/session.ts `PageVisit`). The batch is its: the visit ending stops
 * the request and lets go of its body. Every other end lets go of the body too (the end mark, a
 * stall, a refusal), and the holes it did not carry fetch on their own.
 *
 * `page`: the page the holes are for, sent as the request's referrer, which is how the server knows
 * the page a hole renders for (server/render-page.ts `page_url_of`). A navigation's batch leaves
 * before its swap, from the page being left: it names its destination (#995).
 */
export async function streamFrames(
	endpoints: string[],
	kind: 'page' | 'nav' = 'nav',
	visit: Scope = runtime_session.visit.scope,
	page?: string
): Promise<void> {
	if (!endpoints.length) return;
	const first = endpoints[0];
	const q = first.indexOf('?');
	const path = q === -1 ? first : first.slice(0, q);

	// slot (sig) → store address, so an arriving parcel routes to the right call. RESERVE each address
	// up front: a region binder that connects (body swap) before its frame lands joins this batch via
	// ensure() instead of firing its own fetch — one request for the whole route, no waterfall. Each
	// part takes its stamp NOW, as it is asked for, like any fetch: a refresh asked after the batch
	// is newer, and the batch's part landing after it is dropped (test/sim/frame-order.test.ts).
	const bySig = new Map<string, { a: string; v: number }>();
	// (a measuring browser: slot → endpoint, to name and time each part as it lands)
	const endpoint_of = DEVTOOLS || HOOK_HOLE_ANSWERED ? new Map<string, string>() : null;
	const reserved: string[] = [];
	for (const e of endpoints) {
		const s = sigOf(e);
		if (s) {
			const a = frameAddress(e);
			bySig.set(s, { a, v: stamp() });
			endpoint_of?.set(s, e);
			reserved.push(a);
			reserve(a);
		}
	}
	const batch = DEVTOOLS ? ++batch_seq : 0;
	if (DEVTOOLS)
		dt_emit({
			domain: 'runtime',
			name: 'region.batch.sent',
			batch,
			kind,
			endpoints: endpoints.slice()
		});
	const left = HOOK_HOLE_ANSWERED ? performance.now() : 0;
	let delivered = 0;
	let status = 0;
	let refused: 'redirected' | 'document' | undefined;
	let final_url: string | undefined;
	const stream = batch_stream.create();
	// The batch's own owner, under its page's visit: closed at its end, whichever (the request and
	// its body stop; the reservations are released below)
	const batch_scope = visit.child();
	void stream.wait('stalled').then((s) => s !== STALE && batch_scope.close()); // ok: a machine's wait never rejects

	try {
		let res: Response | typeof STALE;
		try {
			res = await stream.scope.task(() =>
				fetch(path, {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(endpoints),
					// (none named: the page on screen, the browser's own referrer)
					...(page !== undefined ? { referrer: page } : {}),
					signal: batch_scope.signal
				})
			);
		} catch {
			return; // network error — release() in finally lets bound regions fall back to their own fetch
		}
		if (res === STALE) return; // no answer at all for STALL_MS
		stream.go('reading');
		status = res.status;
		if ((DEVTOOLS || HOOK_HOLE_BATCH_MISSED) && res.redirected) {
			refused = 'redirected';
			final_url = res.url;
		}
		if (!res.ok || !res.body) {
			void res.body?.cancel().catch(() => {}); // ok: an answer not read; its cancel failing has nothing to stop
			return;
		}

		const reader = res.body.getReader();
		batch_scope.defer(() => void reader.cancel().catch(() => {})); // ok: the batch ended; a failed cancel has nothing left to stop
		const decoder = new TextDecoder();
		let buffer = '';
		let parcels = false;
		for (;;) {
			// (STALE: quiet for STALL_MS; the holes it still owes fetch on their own)
			const read = await stream.scope.task(() => reader.read());
			if (read === STALE) return;
			const { done, value } = read;
			// (done once the page left: its owner cancelled the body)
			if (batch_scope.closed) return;
			if (done) break;
			stream.go('reading'); // bytes: the quiet time starts again
			buffer += decoder.decode(value, { stream: true });
			let consumed = 0;
			for (let p = read_parcel(buffer, 0); p; p = read_parcel(buffer, consumed)) {
				consumed = p.end;
				parcels = true;
				if (p.slot === STREAM_DONE_SLOT) return; // sentinel — batch complete
				const part = bySig.get(p.slot);
				if (part) {
					// (timed BEFORE the write: the write applies the part, and the hole reports its answer then)
					if (HOOK_HOLE_ANSWERED) {
						const ep = endpoint_of!.get(p.slot)!;
						batched.set(ep, { left, at: performance.now(), size: reserved.length });
					}
					write({ ...part, html: p.html });
					delivered++;
					if (DEVTOOLS)
						dt_emit({
							domain: 'runtime',
							name: 'region.batch.part',
							batch,
							endpoint: endpoint_of!.get(p.slot)!
						});
				}
			}
			if (consumed) buffer = buffer.slice(consumed);
		}
		// (a 200 with no parcel at all: something in front of ogygia answered with a page)
		if ((DEVTOOLS || HOOK_HOLE_BATCH_MISSED) && !parcels && !refused) {
			refused = 'document';
			final_url = res.url;
		}
	} finally {
		stream.stop();
		// (whichever way it ended: the request and its body are let go)
		batch_scope.close();
		// Any address the batch never delivered (dropped/forged/errored/stalled) has its reservation
		// failed, so a bound binder retries with its own fetch. release() is a no-op once the frame has
		// landed.
		for (const a of reserved) release(a);
		// a batch that did not carry all its holes: the profiler's report says what answered (each
		// hole then fetched on its own). Not when its page was left: nothing missed it.
		if (HOOK_HOLE_BATCH_MISSED && delivered < reserved.length && !visit.closed)
			slots.hooks?.holeBatchMissed?.({
				sent: reserved.length,
				delivered,
				status,
				...(refused ? { refused, ...(final_url ? { finalUrl: final_url } : {}) } : {}),
				endpoints
			});
		if (DEVTOOLS)
			dt_emit({
				domain: 'runtime',
				name: 'region.batch.done',
				batch,
				sent: reserved.length,
				delivered,
				status,
				...(refused ? { refused, ...(final_url ? { final_url } : {}) } : {})
			});
	}
}

/** The server renders at most this many calls per batch (hooks.ts `render_batch`). */
const MAX_BATCH = 32;
let queued: string[] | null = null;
let flushed: Promise<void> = Promise.resolve();

/**
 * THE PAGE'S HOLES, ONE REQUEST. Holes that start fetching together (the above-the-fold `visible`
 * ones fire in one observer callback; `idle` and media ones in one task) join here
 * and, at the end of that task, go out as ONE batch — reserved in the store first, so each hole's
 * own fetch then JOINS its address instead of starting a request. One request instead of N: one pass
 * through the app's handle chain (its session lookup, its auth) instead of N, and no per-hole slot in
 * the browser's own few-at-a-time gate. A lone hole goes out on its own (a GET, as before); so does
 * any hole the batch does not deliver (release → its fetch runs). Resolves when the batch is on its
 * way, never with its content.
 */
export function join_batch(endpoint: string): Promise<void> {
	if (!queued) {
		queued = [];
		flushed = new Promise<void>((resolve) =>
			queueMicrotask(() => {
				const list = queued!;
				queued = null;
				// (every hole that joined waits on this: it resolves however the gathering goes, and a
				// hole the batch does not take runs its own fetch)
				try {
					gather(list);
				} finally {
					resolve();
				}
			})
		);
	}
	queued.push(endpoint);
	return flushed;
}

/** A region call of an islands endpoint (`?id=…`, `&id=…`): what a batch POST to its path answers. */
const REGION_CALL_RE = /[?&]id=/;

function gather(list: string[]): void {
	void send_batches(list, 'page'); // ok: a batch says its own failure, and its holes fall back to their own fetch
}

/**
 * THE BATCHES OF A SET OF HOLES, for the page's first holes (`join_batch`) and a navigation's alike
 * (frames.ts `stream`): the ones a batch can carry go out in batches of MAX_BATCH, one endpoint path
 * per batch (it is POSTed there). A hole that is no region call (a plugin's endpoint, a peer
 * widget) goes on its own, as does a path's lone hole: test/browser/hole-batch.test.ts (#917, #987).
 * Each batch names `page`, the page its holes are for (`streamFrames`, #995). Resolves when every
 * batch's response ended.
 */
export function send_batches(
	list: readonly string[],
	kind: 'page' | 'nav',
	visit: Scope = runtime_session.visit.scope,
	page?: string
): Promise<unknown> {
	const by_path = new Map<string, string[]>();
	const seen = new Set<string>();
	// (a hole whose request the page's head started is in flight at its address, so not idle:
	// ./early-holes.ts)
	for (const e of list) {
		if (!REGION_CALL_RE.test(e)) continue;
		const a = frameAddress(e);
		if (seen.has(a) || !is_idle(a)) continue;
		seen.add(a);
		const q = e.indexOf('?');
		const path = e.slice(0, q);
		const fresh = by_path.get(path);
		if (fresh) fresh.push(e);
		else by_path.set(path, [e]);
	}
	// (reserve happens synchronously inside streamFrames, before this returns)
	const sent: Promise<void>[] = [];
	for (const fresh of by_path.values())
		if (fresh.length >= 2)
			for (let i = 0; i < fresh.length; i += MAX_BATCH)
				sent.push(streamFrames(fresh.slice(i, i + MAX_BATCH), kind, visit, page));
	return Promise.all(sent);
}
