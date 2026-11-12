/**
 * A simulated document's RESOURCE TIMING: one entry per download it made, as a browser's
 * performance timeline holds them, heard through a `PerformanceObserver`. happy-dom records no
 * resource entries (its window's observer is the host's, which hears none of a page's downloads),
 * so a page that reads its downloads' statuses (ogygia's import-again: did a failed chunk's own file
 * come?) read nothing in the sim, and its branches that hang on an entry never ran.
 *
 * Two engines' ways, the world's draw (`Engine`):
 * - `status` (Chromium, Firefox): every download gets an entry with its `responseStatus`, a dropped
 *   one too, with 0.
 * - `start` (WebKit): no `responseStatus`; an answered download has a `responseStart`, a dropped
 *   one gets no entry at all.
 *
 * An observer's callback is a task of the document's realm (its `setTimeout`), so it runs on the
 * loop, in the seed's order, and dies with the document. `buffered: true` hands an observer what the
 * timeline already holds: the first {@link BUFFER} entries, as a browser's default buffer keeps.
 */

export type Engine = 'status' | 'start';

/** A browser's default resource timing buffer: entries past it reach observers only. */
export const BUFFER = 250;

interface Entry {
	readonly name: string;
	readonly entryType: 'resource';
	readonly startTime: number;
	readonly duration: number;
	readonly responseStart: number;
	readonly responseStatus?: number;
}

type Callback = (list: { getEntries(): Entry[] }, observer: unknown) => void;

interface Timeline {
	readonly buffer: Entry[];
	readonly observers: Set<{ callback: Callback; pending: Entry[]; self: unknown }>;
}

const TIMELINES = new WeakMap<object, Timeline>();

interface Window {
	setTimeout(fn: () => void, ms: number): unknown;
	performance: { now(): number };
}

/**
 * Gives `window` a resource timeline and its `PerformanceObserver` (in place of the DOM library's).
 * Call before the document's first script.
 */
export function install_timeline(window: object): void {
	const timeline: Timeline = { buffer: [], observers: new Set() };
	TIMELINES.set(window, timeline);
	class PerformanceObserver {
		static readonly supportedEntryTypes = ['resource'];
		readonly #callback: Callback;
		#watch: { callback: Callback; pending: Entry[]; self: unknown } | null = null;
		constructor(callback: Callback) {
			this.#callback = callback;
		}
		observe(options: { type?: string; entryTypes?: string[]; buffered?: boolean }): void {
			const types = options.entryTypes ?? (options.type ? [options.type] : []);
			if (!types.includes('resource') || this.#watch !== null) return;
			this.#watch = { callback: this.#callback, pending: [], self: this };
			timeline.observers.add(this.#watch);
			if (options.type && options.buffered && timeline.buffer.length > 0)
				queue(window as Window, this.#watch, timeline.buffer);
		}
		disconnect(): void {
			if (this.#watch) timeline.observers.delete(this.#watch);
			this.#watch = null;
		}
		takeRecords(): Entry[] {
			return this.#watch ? this.#watch.pending.splice(0) : [];
		}
	}
	Object.defineProperty(window, 'PerformanceObserver', {
		value: PerformanceObserver,
		writable: true,
		configurable: true
	});
}

/** Hands `entries` to one observer in a task of the document (one task for a batch). */
function queue(
	window: Window,
	watch: { callback: Callback; pending: Entry[]; self: unknown },
	entries: readonly Entry[]
): void {
	const first = watch.pending.length === 0;
	watch.pending.push(...entries);
	if (!first) return;
	window.setTimeout(() => {
		const list = watch.pending.splice(0);
		if (list.length > 0) watch.callback({ getEntries: () => list }, watch.self);
	}, 0);
}

/**
 * Records one download of `window`'s document: its answer's status, or `null` when none came (a
 * dropped download). Under `start` (WebKit) a dropped one leaves no entry.
 */
export function record_download(
	window: object,
	engine: Engine,
	url: string,
	status: number | null,
	started: number
): void {
	const timeline = TIMELINES.get(window);
	if (timeline === undefined) return;
	if (status === null && engine === 'start') return;
	const now = (window as Window).performance.now();
	const entry: Entry =
		engine === 'status'
			? {
					name: url,
					entryType: 'resource',
					startTime: started,
					duration: now - started,
					responseStart: status === null ? 0 : now,
					responseStatus: status ?? 0
				}
			: {
					name: url,
					entryType: 'resource',
					startTime: started,
					duration: now - started,
					responseStart: now
				};
	if (timeline.buffer.length < BUFFER) timeline.buffer.push(entry);
	for (const watch of timeline.observers) queue(window as Window, watch, [entry]);
}
