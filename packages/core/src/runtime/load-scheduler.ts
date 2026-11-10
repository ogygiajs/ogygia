/**
 * THE LOAD SCHEDULER — every download ogygia starts on its own goes through one queue.
 *
 * Island code, a hole's HTML, a hole's prefetch, the module warm on hover, the router's page
 * prefetch: each used to pick its own moment, and on a fast-parsing page they all started together,
 * beside the page's own LCP image — a country home page's hero took 2.27 s instead of 1.19 s while
 * 206 island requests (888 KB) shared its bandwidth. Priority hints alone do not fix that (a
 * throttled or priority-blind connection splits bandwidth evenly); waiting for the right moment,
 * and capping how much background work is in flight, does.
 *
 * Every download carries a CLASS, decided by who is waiting for it:
 *  - `user`        — a visitor's gesture (an `interaction` wake, a click-time navigation, an explicit
 *                    `preload()`): never waits, fetched at high priority.
 *  - `visible`     — on screen now (an island or hole in the viewport): fetched at default priority.
 *  - `ahead`       — not on screen yet (an `idle` island, one screen ahead, a hole prefetch): low
 *                    priority, a small window.
 *  - `speculative` — a guess about the future (the router's page prefetch, its module warm): low
 *                    priority, the same window, behind every `ahead`.
 *
 * And a GATE, decided by signals, not timers ({@link critical_settled}): island CODE and every
 * background class wait until the document is parsed and painted AND the page's critical resources
 * have arrived — the image or preload its author marked `fetchpriority="high"` (the LCP resource;
 * nothing to guess) — or the visitor's first click / key (the browser stops measuring LCP there), or
 * a cap. Visible CONTENT (a hole's HTML on screen) does not wait: it IS what the visitor sees.
 *
 * A queued download's class is re-read when the queue drains, and its element moving on screen
 * drains it, so an island scrolling into view moves from `ahead` to `visible`. A shared download (a `flights()` flight: a page prefetch, a hole's warm,
 * a module warm) queues with its flight, and a caller that joins it at a higher class raises the
 * flight (load-class.ts): the queued slot then drains at that class (a click on a link whose prefetch
 * still waits). On a Kit-hydrated document Kit's own start sets the pace, so nothing waits on the
 * critical resources there (the window still applies).
 */
import { after_document_painted, yield_task } from './schedule.ts';
import { kit_hydrates_page } from './kit-boot.ts';
import {
	flights,
	machine,
	queue,
	scope,
	type InFlight,
	type Queue,
	type Scope,
	type Stale,
	type Started
} from '@ogygia/machine';
import { emit as dt_emit } from '../events/bus.ts';
import { class_at, PRIORITY, type LoadClass } from './load-class.ts';
import { on_screen, watch_viewport } from './viewport.ts';

export { fetch_priority_of, type LoadClass } from './load-class.ts';

const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;

/** `code`: an island's modules. `content`: HTML (a hole's answer, a prefetched page). */
export type LoadKind = 'code' | 'content';

/** How long background work waits for the page's critical resources at most. */
export const CRITICAL_CAP_MS = 2500;
/** Background (`ahead` + `speculative`) downloads in flight at once. */
export const BACKGROUND_WINDOW = 3;

/**
 * `visible` when `el` is on screen now, else `ahead`: the one viewport tracker's answer
 * (./viewport.ts), so a download's class agrees with the region's `visible` wake and its hydrate
 * turn. A region with no box of its own is decided by what it renders.
 */
export function viewport_class(el: Element): 'visible' | 'ahead' {
	return on_screen(el) ? 'visible' : 'ahead';
}

// ── the critical-resources gate ─────────────────────────────────────────────────────────────────

/** How the critical-resources wait ended: they `arrived` (or failed), the visitor's first `input`,
 *  the `cap`, or `none` were pending. */
export type CriticalOutcome = 'arrived' | 'input' | 'cap' | 'none';
type CriticalReport = { outcome: CriticalOutcome; resources: number; waited_ms: number };

/**
 * The gate, as a machine:
 *
 *   fresh ─ waiting{t0, resources} ─ settled{report}
 *       ╲ touched ───────────────────╱
 *
 * `fresh`: no wait yet. `touched`: the visitor clicked or typed before the wait began, so it waits on
 * nothing. `waiting`: the wait is up; its visit owns the cap and the resources' listeners, so they go
 * as it settles, however it settles. `settled`: open for good, with how it ended (the beacon reads
 * it). One state in place of `input_seen`, `critical_done`, `release_critical` and the report.
 */
const gate_definition = machine<{
	fresh: {};
	touched: {};
	waiting: { t0: number; resources: number };
	settled: { report: CriticalReport };
}>()({
	name: 'critical-gate',
	initial: 'fresh',
	steps: {
		fresh: ['touched', 'waiting', 'settled'],
		touched: ['settled'],
		waiting: ['settled'],
		settled: []
	}
});
let gate = gate_definition.create();

const on_first_input = () => {
	const kind = gate.now.kind;
	if (kind === 'fresh') gate.go('touched');
	else if (kind === 'waiting') settle_critical('input');
};
if (typeof document !== 'undefined') {
	for (const type of ['pointerdown', 'keydown'] as const)
		// oxlint-disable-next-line ogygia/owned-effects -- the visitor's first click or key, once for the document (`once`): it ends whichever critical wait is up
		addEventListener(type, on_first_input, { capture: true, passive: true, once: true });
}

/** The critical wait below, once for the document (a test's reset drops it). */
const critical = flights({ name: 'critical resources', run: () => until_critical() });

/** The gate is open: the critical wait settled. */
const critical_done = () => gate.now.kind === 'settled';

/** The critical wait's outcome once it settled (the profiler's beacon reads it), else `null`. */
export function critical_outcome(): CriticalReport | null {
	const s = gate.now;
	return s.kind === 'settled' ? s.report : null;
}

/** The wait ends (once: a gate already settled stays as it settled). */
function settle_critical(outcome: CriticalOutcome): void {
	const s = gate.now;
	if (s.kind === 'settled') return;
	const report: CriticalReport =
		s.kind === 'waiting'
			? { outcome, resources: s.resources, waited_ms: Math.round(now() - s.t0) }
			: { outcome, resources: 0, waited_ms: 0 };
	gate.go('settled', { report });
	if (DEVTOOLS) dt_emit({ domain: 'runtime', name: 'load.critical', ...report });
	drain();
}

/** Elements carrying the page's critical resources that have not arrived yet: an eager
 *  `img[fetchpriority=high]` not complete, a `link[rel=preload][fetchpriority=high]` not fetched. */
function pending_critical(): Element[] {
	const out: Element[] = [];
	for (const img of document.querySelectorAll<HTMLImageElement>('img[fetchpriority="high" i]')) {
		if (img.loading === 'lazy' || img.complete) continue;
		out.push(img);
	}
	for (const link of document.querySelectorAll<HTMLLinkElement>(
		'link[rel~="preload"][fetchpriority="high" i]'
	)) {
		// one preload per breakpoint: the browser fetches only the one whose `media` matches, and the
		// others never fire `load` or `error` — waiting on them ran every such page into the cap
		if (link.media && !matchMedia(link.media).matches) continue;
		const urls = preload_urls(link);
		if (!urls.length) continue;
		// a resource-timing entry exists once the response is complete (an `imagesrcset` preload
		// fetches one of its candidates: any of them having arrived means it did)
		if (urls.some((u) => performance.getEntriesByName?.(u).length)) continue;
		out.push(link);
	}
	return out;
}

/** The URLs a preload link may fetch: its `href`, else each `imagesrcset` candidate's. */
export function preload_urls(link: HTMLLinkElement): string[] {
	if (link.href) return [link.href];
	const set = link.getAttribute('imagesrcset');
	if (!set) return [];
	const out: string[] = [];
	for (const part of set.split(',')) {
		const candidate = part.trim();
		let end = 0;
		while (end < candidate.length && candidate.charCodeAt(end) > 32) end++; // up to the descriptor
		const url = candidate.slice(0, end);
		if (!url) continue;
		try {
			out.push(new URL(url, document.baseURI).href);
		} catch {
			// ok: not a URL: the candidate is skipped
		}
	}
	return out;
}

/**
 * Resolves once the document is parsed and painted AND its author-marked critical resources have
 * arrived (or failed) — or at the visitor's first click or key, or {@link CRITICAL_CAP_MS} into the
 * wait. A page with no marked resource resolves right after the paint. Once resolved it stays so.
 */
export function critical_settled(): Promise<void | Stale> {
	return critical.get();
}
function until_critical(): Promise<void> {
	return after_document_painted().then(async () => {
		const s = gate.now;
		if (s.kind === 'settled') return;
		const waiting =
			s.kind === 'touched' || document.visibilityState === 'hidden' ? [] : pending_critical();
		if (!waiting.length) return settle_critical('none');
		gate.go('waiting', { t0: now(), resources: waiting.length });
		// the wait's cap and its resources' listeners: its visit's, so all go as it settles
		const wait = gate.scope;
		wait.timeout(() => settle_critical('cap'), CRITICAL_CAP_MS);
		let left = waiting.length;
		const one = () => {
			if (--left === 0) settle_critical('arrived');
		};
		for (const el of waiting) {
			wait.on(el, 'load', one, { once: true });
			wait.on(el, 'error', one, { once: true });
		}
		await gate.wait('settled');
	});
}

// ── the queue ───────────────────────────────────────────────────────────────────────────────────

/**
 * A queued download: asking for one queues it. `ready` resolves with a `release` to call when the
 * download is done (settled, success or not). `cls` may be a getter, re-read whenever the queue
 * drains; when it follows an element's place on screen, `el` names it: while the slot is queued the
 * element is watched (./viewport.ts, the one tracker), and its moving on or off screen drains the
 * queue. A slot that serves a shared download is given its `flight`: it is at least at the class of
 * the flight's priority, and a raise of the flight drains it at the new class.
 */
export class LoadSlot {
	readonly kind: LoadKind;
	readonly label: string | undefined;
	readonly queued_at: number = now();
	readonly ready: Promise<() => void>;
	#read: () => LoadClass;
	#flight: InFlight | null;
	#resolve!: (release: () => void) => void;
	/** Stops watching its element (on start, or a test's reset). */
	unwatch: () => void = noop;

	constructor(o: {
		kind: LoadKind;
		cls: LoadClass | (() => LoadClass);
		label?: string;
		el?: Element;
		flight?: InFlight;
	}) {
		this.kind = o.kind;
		this.label = o.label;
		this.#read = typeof o.cls === 'function' ? o.cls : () => o.cls as LoadClass;
		this.#flight = o.flight ?? null;
		this.ready = new Promise<() => void>((r) => (this.#resolve = r));
		// its element moved on or off screen: its class may have moved with it
		if (o.el) this.unwatch = watch_viewport(o.el, '0px', drain);
		if (!critical_done() && waits_for_critical(this.kind, this.cls())) void critical_settled(); // ok: the critical wait only waits on timers and resources' events; it never rejects
		// (a caller joining its flight at a higher class drains the queue: it moves up while queued)
		const cls = o.cls;
		const priority = typeof cls === 'function' ? () => PRIORITY[cls()] : PRIORITY[cls];
		loads.push(this, { priority, flight: o.flight });
	}

	/** Its class now: the getter's, or its flight's when that is more urgent. */
	cls(): LoadClass {
		const c = this.#read();
		const flight = this.#flight;
		return flight !== null && flight.priority > PRIORITY[c] ? class_at(flight.priority) : c;
	}

	/** Out of the queue, at the class it started at: the holder's `ready` resolves. What it returns
	 *  lets the holder's own start-up run before the next start. */
	start(s: Started): Promise<void> {
		this.unwatch();
		const cls = class_at(s.priority);
		if (DEVTOOLS)
			dt_emit({
				domain: 'runtime',
				name: 'load.started',
				class: cls,
				kind: this.kind,
				label: this.label,
				waited_ms: Math.round(now() - this.queued_at)
			});
		this.#resolve(() => s.release());
		return Promise.resolve();
	}
}

function waits_for_critical(kind: LoadKind, cls: LoadClass): boolean {
	if (cls === 'user') return false;
	if (kit_hydrates_page()) return false;
	return !(kind === 'content' && cls === 'visible');
}

/**
 * Starts go out across tasks: a start's holder runs its own start-up synchronously (an island adds
 * its graph links and starts its imports; the first one also the runtime's lazy chunks), so when the
 * gate opened on a page of 21 islands, every one of those ran in the task that opened it — one long
 * task (52 ms on a 4×-throttled runner). After this much work in one task the drain yields.
 */
const START_BUDGET_MS = 16;

/** The document's loads: closing it (a test's fresh document) settles every queued slot. */
let documents = scope();

/**
 * The queue (@ogygia/machine `queue()`): by class, then in the order asked; only the guesses
 * (`ahead`, `speculative`) count in the background window; one that waits for the critical
 * resources keeps its place until the gate opens; past {@link START_BUDGET_MS} the drain yields a
 * task, and each start's holder runs its own start-up before the next start.
 */
function make_loads(owner: Scope): Queue<LoadSlot> {
	return queue<LoadSlot>({
		name: 'loads',
		max: BACKGROUND_WINDOW,
		holds: (p) => p <= PRIORITY.ahead,
		admit: (slot, p) => critical_done() || !waits_for_critical(slot.kind, class_at(p)),
		start: (slot, s) => slot.start(s),
		stale: (slot) => slot.unwatch(), // a fresh document (its owner closed): it never starts
		budget: START_BUDGET_MS,
		pause: (resume) => void yield_task().then(resume), // ok: a yield never rejects
		now,
		owner
	});
}
let loads = make_loads(documents);

/** The queue looks again: an element moved on or off screen, or the gate opened. */
function drain(): void {
	loads.drain();
}

function noop(): void {}

function now(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Test seam: a fresh document. */
export function reset_load_scheduler(): void {
	documents.close(); // (every queued slot stops watching its element, and never starts)
	documents = scope();
	loads = make_loads(documents);
	critical.drop(() => true);
	gate.stop();
	gate = gate_definition.create();
}
