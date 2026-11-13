/**
 * A SIMULATED DOCUMENT'S PERFORMANCE TIMELINE: its own `performance` and `PerformanceObserver`, as
 * a browser gives each document. happy-dom hands every window Node's one `performance`, so every
 * tab read one clock (the newest document's: each set its `now` on the shared object), saw the
 * host's entries, and none of its own: no navigation entry (ogygia's paint gate never read when
 * DOMContentLoaded ended), no resource entry (its critical wait and import-again never read a
 * download's arrival or status), and its observer was the host's.
 *
 * - The clock: `now()` is virtual time since the document's navigation started, `timeOrigin` the
 *   wall time it started at (the realm's own `Date`), as in a browser.
 * - The navigation entry: the document's address and how it was reached (`navigate`, `reload`,
 *   `back_forward`), stamped as its parse and its events run (happy.ts: `domInteractive`,
 *   DOMContentLoaded's start and end, `domComplete`, load's start and end). It is in the timeline
 *   from the start and reaches observers once load has ended.
 * - Resource entries: one per download, when its body has come (or broke off, or none came), in a
 *   buffer of {@link BUFFER} by default; past it, `resourcetimingbufferfull` fires, its listener may
 *   make room, and what still does not fit reaches observers only. Two engines' ways, the world's
 *   draw (`Engine`): `status` (Chromium, Firefox): every download gets an entry with its
 *   `responseStatus`, a dropped one too, with 0; `start` (WebKit): no `responseStatus`, an answered
 *   download has a `responseStart`, a dropped one gets no entry at all.
 * - User timing: `mark`, `measure`, `clearMarks`, `clearMeasures`, as the User Timing spec has them.
 *
 * An observer's callback is a task of the document's realm (its `setTimeout`), so it runs on the
 * loop, in the seed's order, and dies with the document. `buffered: true` hands an observer what the
 * timeline already holds of its type. test/timeline.test.ts, test/performance.test.ts.
 */

export type Engine = 'status' | 'start';

/** A browser's default resource timing buffer: entries past it reach observers only. */
export const BUFFER = 250;

/** How a document was reached (a navigation entry's `type`). */
export type NavigationType = 'navigate' | 'reload' | 'back_forward';

/** The moments of a document's load its navigation entry keeps, stamped as they happen. */
export type NavigationMoment =
	| 'responseStart'
	| 'responseEnd'
	| 'domInteractive'
	| 'domContentLoadedEventStart'
	| 'domContentLoadedEventEnd'
	| 'domComplete'
	| 'loadEventStart'
	| 'loadEventEnd';

/** Every navigation timing attribute a `measure` may name (a time, or 0 when it has not come). */
const NAVIGATION_ATTRIBUTES = new Set([
	'navigationStart',
	'unloadEventStart',
	'unloadEventEnd',
	'redirectStart',
	'redirectEnd',
	'fetchStart',
	'domainLookupStart',
	'domainLookupEnd',
	'connectStart',
	'connectEnd',
	'secureConnectionStart',
	'requestStart',
	'responseStart',
	'responseEnd',
	'domLoading',
	'domInteractive',
	'domContentLoadedEventStart',
	'domContentLoadedEventEnd',
	'domComplete',
	'loadEventStart',
	'loadEventEnd'
]);

type Entry = {
	readonly name: string;
	readonly entryType: string;
	readonly startTime: number;
} & Record<string, unknown>;

interface List {
	getEntries(): Entry[];
	getEntriesByType(type: string): Entry[];
	getEntriesByName(name: string, type?: string): Entry[];
}
type Callback = (list: List, observer: unknown) => void;
interface Watch {
	readonly callback: Callback;
	readonly types: Set<string>;
	readonly pending: Entry[];
	readonly self: unknown;
}

interface Timeline {
	readonly window: Window;
	readonly now: () => number;
	readonly navigation: Entry & Record<NavigationMoment, number>;
	/** Navigation, marks, measures (never full). */
	readonly entries: Entry[];
	readonly resources: Entry[];
	size: number;
	/** Resource entries that came while the buffer was full, waiting on its full event. */
	readonly waiting: Entry[];
	readonly observers: Set<Watch>;
}

const TIMELINES = new WeakMap<object, Timeline>();

interface Window {
	setTimeout(fn: () => void, ms: number): unknown;
	performance: { now(): number };
	location?: { href: string };
	EventTarget?: typeof EventTarget;
	Event?: typeof Event;
	DOMException?: typeof DOMException;
	TypeError?: typeof TypeError;
	structuredClone?: typeof structuredClone;
}

/** A document's timeline, from the start of its navigation. */
export interface TimelineOptions {
	/** ms since the navigation started (the realm's `performance.now`). */
	readonly now: () => number;
	/** The wall time the navigation started at. */
	readonly origin: number;
	/** The document's address. */
	readonly url: string;
	readonly type: NavigationType;
}

const by_start = (a: Entry, b: Entry): number => a.startTime - b.startTime;
const json = (e: Entry) => () => ({ ...e });
const sorted = (all: readonly Entry[], name?: string, type?: string): Entry[] =>
	all
		.filter(
			(e) => (name === undefined || e.name === name) && (type === undefined || e.entryType === type)
		)
		.sort(by_start);

/**
 * Gives `window` its own `performance` and `PerformanceObserver` (in place of the DOM library's).
 * Call before the document's first script. Without `o`, its clock is the window's own `now` and
 * its address the window's.
 */
export function install_timeline(window: object, o?: TimelineOptions): void {
	const w = window as Window;
	const now = o?.now ?? w.performance.now.bind(w.performance);
	const origin = o?.origin ?? Date.now() - now();
	const DOMEx = w.DOMException ?? DOMException;
	const TypeErr = w.TypeError ?? TypeError;
	const clone = w.structuredClone ?? structuredClone;
	const navigation = {
		name: o?.url ?? w.location?.href ?? '',
		entryType: 'navigation',
		startTime: 0,
		initiatorType: 'navigation',
		type: o?.type ?? 'navigate',
		redirectCount: 0,
		workerStart: 0,
		redirectStart: 0,
		redirectEnd: 0,
		fetchStart: 0,
		domainLookupStart: 0,
		domainLookupEnd: 0,
		connectStart: 0,
		connectEnd: 0,
		secureConnectionStart: 0,
		requestStart: 0,
		responseStart: 0,
		responseEnd: 0,
		unloadEventStart: 0,
		unloadEventEnd: 0,
		domInteractive: 0,
		domContentLoadedEventStart: 0,
		domContentLoadedEventEnd: 0,
		domComplete: 0,
		loadEventStart: 0,
		loadEventEnd: 0
	} as Entry & Record<NavigationMoment, number>;
	Object.defineProperties(navigation, {
		duration: { get: () => navigation.loadEventEnd, enumerable: true },
		toJSON: { value: json(navigation) }
	});
	const timeline: Timeline = {
		window: w,
		now,
		navigation,
		entries: [navigation],
		resources: [],
		size: BUFFER,
		waiting: [],
		observers: new Set()
	};
	TIMELINES.set(window, timeline);

	const all = (): Entry[] => [...timeline.entries, ...timeline.resources];
	/** A mark's or a measure's time, by name or number (the User Timing spec's conversion). */
	const time_of = (at: unknown): number => {
		if (typeof at === 'string') {
			if (NAVIGATION_ATTRIBUTES.has(at)) {
				if (at === 'navigationStart') return 0;
				const t = (navigation as Record<string, unknown>)[at];
				if (typeof t !== 'number' || t === 0)
					throw new DOMEx(`'${at}' is empty: the event has not happened yet`, 'InvalidAccessError');
				return t;
			}
			const mark = timeline.entries.findLast((e) => e.entryType === 'mark' && e.name === at);
			if (mark === undefined) throw new DOMEx(`The mark '${at}' does not exist.`, 'SyntaxError');
			return mark.startTime;
		}
		const t = Number(at);
		if (t < 0) throw new TypeErr(`'${t}' is a negative time`);
		return t;
	};
	const user = (entry: Entry): Entry => {
		Object.defineProperty(entry, 'toJSON', { value: json(entry) });
		timeline.entries.push(entry);
		notify(timeline, entry);
		return entry;
	};

	const Target = w.EventTarget ?? EventTarget;
	const performance = Object.assign(new Target(), {
		now,
		toJSON: () => ({ timeOrigin: origin }),
		getEntries: () => sorted(all()),
		getEntriesByType: (type: string) => sorted(all(), undefined, String(type)),
		getEntriesByName: (name: string, type?: string) =>
			sorted(all(), String(name), type === undefined ? undefined : String(type)),
		mark(name: string, options?: { startTime?: number; detail?: unknown }): Entry {
			name = String(name);
			if (NAVIGATION_ATTRIBUTES.has(name))
				throw new DOMEx(`'${name}' is a navigation timing attribute`, 'SyntaxError');
			const startTime = options?.startTime ?? now();
			if (startTime < 0) throw new TypeErr(`'${startTime}' is a negative time`);
			return user({
				name,
				entryType: 'mark',
				startTime,
				duration: 0,
				detail: options?.detail === undefined ? null : clone(options.detail)
			});
		},
		measure(
			name: string,
			from?: string | { start?: unknown; end?: unknown; duration?: number; detail?: unknown },
			to?: string
		): Entry {
			const opts =
				typeof from === 'object' &&
				from !== null &&
				['start', 'end', 'duration', 'detail'].some(
					(k) => (from as Record<string, unknown>)[k] !== undefined
				)
					? from
					: null;
			if (opts !== null) {
				if (to !== undefined) throw new TypeErr('measure options and an end mark were both given');
				if (opts.start === undefined && opts.end === undefined)
					throw new TypeErr('measure options name neither a start nor an end');
				if (opts.start !== undefined && opts.end !== undefined && opts.duration !== undefined)
					throw new TypeErr('measure options name a start, an end and a duration');
			}
			const end =
				to !== undefined
					? time_of(to)
					: opts?.end !== undefined
						? time_of(opts.end)
						: opts?.start !== undefined && opts.duration !== undefined
							? time_of(opts.start) + time_of(opts.duration)
							: now();
			const start =
				opts?.start !== undefined
					? time_of(opts.start)
					: opts?.duration !== undefined && opts.end !== undefined
						? end - time_of(opts.duration)
						: typeof from === 'string'
							? time_of(from)
							: 0;
			return user({
				name: String(name),
				entryType: 'measure',
				startTime: start,
				duration: end - start,
				detail: opts?.detail === undefined ? null : clone(opts.detail)
			});
		},
		clearMarks: (name?: string) => clear(timeline.entries, 'mark', name),
		clearMeasures: (name?: string) => clear(timeline.entries, 'measure', name),
		clearResourceTimings: () => void timeline.resources.splice(0),
		setResourceTimingBufferSize: (n: number) => void (timeline.size = Math.max(0, n >>> 0))
	});
	Object.defineProperty(performance, 'timeOrigin', { value: origin, enumerable: true });
	Object.defineProperty(window, 'performance', {
		value: performance,
		writable: true,
		configurable: true
	});

	class PerformanceObserver {
		static readonly supportedEntryTypes = ['mark', 'measure', 'navigation', 'resource'];
		readonly #callback: Callback;
		#watch: Watch | null = null;
		constructor(callback: Callback) {
			this.#callback = callback;
		}
		observe(options: { type?: string; entryTypes?: string[]; buffered?: boolean }): void {
			const known = PerformanceObserver.supportedEntryTypes;
			const types = (options.entryTypes ?? (options.type ? [options.type] : [])).filter((t) =>
				known.includes(t)
			);
			if (types.length === 0) return;
			const watch = (this.#watch ??= {
				callback: this.#callback,
				types: new Set(),
				pending: [],
				self: this
			});
			// (a list of types replaces what it watched; one type adds to it)
			if (options.entryTypes) watch.types.clear();
			for (const t of types) watch.types.add(t);
			timeline.observers.add(watch);
			if (options.type && options.buffered) {
				const held = sorted(all(), undefined, options.type).filter(
					// (the navigation entry is the timeline's once load has ended)
					(e) => e !== navigation || navigation.loadEventEnd > 0
				);
				if (held.length > 0) queue(w, watch, held);
			}
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

function clear(entries: Entry[], type: string, name?: string): void {
	for (let i = entries.length - 1; i >= 0; i--)
		if (entries[i].entryType === type && (name === undefined || entries[i].name === name))
			entries.splice(i, 1);
}

/** Hands `entry` to each observer watching its type. */
function notify(timeline: Timeline, entry: Entry): void {
	for (const watch of timeline.observers)
		if (watch.types.has(entry.entryType)) queue(timeline.window, watch, [entry]);
}

/** Hands `entries` to one observer in a task of the document (one task for a batch). */
function queue(window: Window, watch: Watch, entries: readonly Entry[]): void {
	const first = watch.pending.length === 0;
	watch.pending.push(...entries);
	if (!first) return;
	window.setTimeout(() => {
		const list = watch.pending.splice(0);
		if (list.length > 0)
			watch.callback(
				{
					getEntries: () => sorted(list),
					getEntriesByType: (type) => sorted(list, undefined, type),
					getEntriesByName: (name, type) => sorted(list, name, type)
				},
				watch.self
			);
	}, 0);
}

/** Stamps moment `what` of `window`'s document's load now (happy.ts, as each comes). Once load has
 *  ended, the navigation entry reaches observers. */
export function stamp(window: object, what: NavigationMoment): void {
	const timeline = TIMELINES.get(window);
	if (timeline === undefined) return;
	timeline.navigation[what] = timeline.now();
	if (what === 'loadEventEnd') notify(timeline, timeline.navigation);
}

/**
 * Records one download of `window`'s document, once its body came or broke off: its answer's
 * status, or `null` when none came (a dropped download). Under `start` (WebKit) a dropped one leaves
 * no entry.
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
	const now = timeline.now();
	const entry: Entry = {
		name: url,
		entryType: 'resource',
		initiatorType: 'other',
		startTime: started,
		duration: now - started,
		fetchStart: started,
		responseStart: status === null ? 0 : now,
		responseEnd: now,
		...(engine === 'status' ? { responseStatus: status ?? 0 } : {})
	};
	Object.defineProperty(entry, 'toJSON', { value: json(entry) });
	add_resource(timeline, entry);
	notify(timeline, entry);
}

/** Puts a resource entry in the buffer; when it is full, the entry waits on the buffer's full
 *  event, whose listener may make room (the Resource Timing spec's secondary buffer). */
function add_resource(timeline: Timeline, entry: Entry): void {
	if (timeline.waiting.length === 0 && timeline.resources.length < timeline.size) {
		timeline.resources.push(entry);
		return;
	}
	timeline.waiting.push(entry);
	if (timeline.waiting.length > 1) return;
	const w = timeline.window;
	w.setTimeout(() => {
		const perf = w.performance as unknown as EventTarget;
		const E = w.Event ?? Event;
		perf.dispatchEvent(new E('resourcetimingbufferfull'));
		const room = Math.max(0, timeline.size - timeline.resources.length);
		timeline.resources.push(...timeline.waiting.splice(0, room));
		// (what still does not fit is dropped from the buffer: its observers had it already)
		timeline.waiting.splice(0);
	}, 0);
}
