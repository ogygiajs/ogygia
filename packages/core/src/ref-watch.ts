import { report_thrown } from './report-thrown.ts';

type Watcher = (live: unknown) => void;

const WATCHERS_KEY = Symbol.for('ogygia.hub.watchers');

/** Each hub id's watchers. One map per realm: a second bundle that evaluates this module shares it. */
export function watchers(): Map<string, Set<Watcher>> {
	const g = globalThis as Record<symbol, unknown>;
	return ((g[WATCHERS_KEY] as Map<string, Set<Watcher>> | undefined) ??= new Map());
}

/**
 * Subscribe to fresh data settling for `id`; returns the unsubscribe. The one channel for "a value
 * arrives later for this identity" (region frames, streamed page data, live refresh), split out of
 * `ref.ts` so a module that needs only the channel (the region frame store) never carries the
 * identity hub. `ref.ts` re-exports it.
 */
export function watch(id: string, cb: Watcher): () => void {
	const all = watchers();
	let set = all.get(id);
	if (set === undefined) all.set(id, (set = new Set()));
	set.add(cb);
	return () => {
		const s = all.get(id);
		if (s === undefined) return;
		s.delete(cb);
		if (s.size === 0) all.delete(id);
	};
}

/**
 * Notify watchers that fresh data settled for `id`. Called by resolve's live-merge path AND
 * directly by subsystems that push a value in (a region frame landing, a streamed promise
 * resolving) — those pass the settled value; resolve's path passes the merged live instance.
 * Watchers run over a copy: one added while they run waits for the next notify, one removed still
 * runs this time. A throwing watcher is reported and never blocks the others. Inside {@link batch},
 * the notify waits for the outermost batch to end.
 */
export function notify(id: string, live: unknown): void {
	if (batch_depth > 0) {
		(batch_pending ??= new Map()).set(id, live);
		return;
	}
	notify_now(id, live);
}

function notify_now(id: string, live: unknown): void {
	const set = watchers().get(id);
	if (set === undefined) return;
	for (const cb of Array.from(set)) {
		try {
			cb(live);
		} catch (error) {
			report_thrown(error);
		}
	}
}

let batch_depth = 0;
let batch_pending: Map<string, unknown> | null = null;

/**
 * Run `fn` with watch notifications BUFFERED, flushing them once when the outermost batch exits.
 * Wrap any operation that resolves several refs at once (a context parse, a props decode, a nav's
 * ref bag) so no watcher sees one ref merged and the next not yet. Batches nest: only the outermost
 * one notifies, each id once with its last value, even when `fn` throws. Returns `fn`'s result.
 */
export function batch<T>(fn: () => T): T {
	batch_depth++;
	try {
		return fn();
	} finally {
		batch_depth--;
		if (batch_depth === 0) {
			const pending = batch_pending;
			batch_pending = null;
			if (pending !== undefined && pending !== null) {
				for (const [id, live] of pending) notify_now(id, live);
			}
		}
	}
}

/** How many watchers are registered for `id` — lets a subsystem that owns lifecycle around a
 *  hub id (fetch dedupe, eviction TTL) make refcount decisions without a parallel subscriber set. */
export function watcher_count(id: string): number {
	return watchers().get(id)?.size ?? 0;
}
