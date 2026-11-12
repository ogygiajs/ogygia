/**
 * The profiler's store of what ogygia's handle did for each request (core's emit points hand it
 * over through `set_request_stats_sink`). Keyed by the `Request` in a WeakMap: the record dies with
 * the request and nothing is deleted.
 */
import {
	set_request_stats_sink,
	type BatchHoleStats,
	type HoleRequestStats,
	type OgygiaRequestStats,
	type RequestStatsSink
} from '@ogygia/core/internal/server';
import { registry, scope, type Scope } from '@ogygia/machine';

const stats = new WeakMap<Request, OgygiaRequestStats>();
const hole_stats = new WeakMap<Request, HoleRequestStats>();
let batch_listener: ((request: Request, s: BatchHoleStats) => void) | null = null;
/** Who asked for detail, each until its own release (or its owner's end: by default the process's,
 *  for a caller that lets go itself). */
const detail_holds = registry<object>();
const process_holds = scope();

/** The sink core's handle writes into. */
export const request_stats_store: RequestStatsSink = {
	page(request, s) {
		stats.set(request, s);
	},
	hole(request, s) {
		hole_stats.set(request, s);
	},
	batchHole: (request, s) => batch_listener?.(request, s),
	wantsBatchHoles: () => batch_listener !== null,
	detailed: () => detail_holds.size > 0
};

/** The profiler is configured: the handle records each request's totals from now on. */
export function install_request_stats(): void {
	set_request_stats_sink(request_stats_store);
}

export function request_stats_of(request: Request): OgygiaRequestStats | undefined {
	return stats.get(request);
}

export function hole_stats_of(request: Request): HoleRequestStats | undefined {
	return hole_stats.get(request);
}

/** A batch's holes settle after the handle returned (and the profiler logged the request), so each
 *  is handed on as it lands: to the profiler that asked, or nowhere. */
export function set_batch_hole_listener(
	fn: ((request: Request, s: BatchHoleStats) => void) | null
): void {
	batch_listener = fn;
}

/**
 * The profiler asks for detail for a recording; with nobody asking, the handle records totals only.
 * Held, not a switch: two profilers can record at once (the dev server re-runs the app's hooks on an
 * edit while the old profiler's timers still record), so detail stays on while any hold stands, and
 * each release lets go of its own hold only, once (a second call does nothing).
 */
export function hold_request_stats_detail(owner: Scope = process_holds): () => void {
	return detail_holds.add({}, owner);
}
