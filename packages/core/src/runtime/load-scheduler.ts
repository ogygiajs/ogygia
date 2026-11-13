import { after_document_painted, yield_task } from './schedule.ts';
import { kit_hydrates_page } from './kit-boot.ts';
import { clock, flights, machine, type InFlight, type Stale } from '@ogygia/machine';
import { emit as dt_emit } from '../events/bus.ts';
import { class_at, CLASSES, PRIORITY, type LoadClass } from './load-class.ts';
import { on_screen, watch_viewport } from './viewport.ts';
import type { CriticalOutcome } from '../contract/runtime-hooks.ts';
import { slots } from './slots.ts';

export { fetch_priority_of, type LoadClass } from './load-class.ts';

const HOOK_CRITICAL_SETTLED =
	typeof __OGYGIA_HOOK_CRITICAL_SETTLED__ !== 'undefined' ? __OGYGIA_HOOK_CRITICAL_SETTLED__ : true;
const HOOK_LOAD_STARTED =
	typeof __OGYGIA_HOOK_LOAD_STARTED__ !== 'undefined' ? __OGYGIA_HOOK_LOAD_STARTED__ : true;

const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;

/** `code`: an island's modules. `content`: HTML (a hole's answer, a prefetched page). */
export type LoadKind = 'code' | 'content';

/** How long background work waits for the page's critical resources at most. */
export const CRITICAL_CAP_MS = 2500;
/** Background (`ahead` + `speculative`) downloads in flight at once. */
export const BACKGROUND_WINDOW = 3;
/** Hole answers in flight at once, whatever their class: what one page asks of the origin. */
export const HOLE_WINDOW = 3;

/**
 * `visible` when `el` is on screen now, else `ahead`: the one viewport tracker's answer
 * (./viewport.ts), so a download's class agrees with the region's `visible` wake and its hydrate
 * turn. A region with no box of its own is decided by what it renders.
 */
export function viewport_class(el: Element): 'visible' | 'ahead' {
	return on_screen(el) ? 'visible' : 'ahead';
}

export type { CriticalOutcome };
type CriticalReport = { outcome: CriticalOutcome; resources: number; waited_ms: number };

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

const critical = flights({ name: 'critical resources', run: () => until_critical() });

const critical_done = () => gate.now.kind === 'settled';

/** The critical wait's outcome once it settled (the profiler's beacon reads it), else `null`. */
export function critical_outcome(): CriticalReport | null {
	const s = gate.now;
	return s.kind === 'settled' ? s.report : null;
}

function settle_critical(outcome: CriticalOutcome): void {
	const s = gate.now;
	if (s.kind === 'settled') return;
	const report: CriticalReport =
		s.kind === 'waiting'
			? { outcome, resources: s.resources, waited_ms: Math.round(now() - s.t0) }
			: { outcome, resources: 0, waited_ms: 0 };
	gate.go('settled', { report });
	if (DEVTOOLS) dt_emit({ domain: 'runtime', name: 'load.critical', ...report });
	if (HOOK_CRITICAL_SETTLED)
		slots.hooks?.criticalSettled?.({
			outcome: report.outcome,
			resources: report.resources,
			waitedMs: report.waited_ms
		});
	drain();
}

function pending_critical(): Element[] {
	const out: Element[] = [];
	for (const img of document.querySelectorAll<HTMLImageElement>('img[fetchpriority="high" i]')) {
		if (img.loading === 'lazy' || img.complete) continue;
		out.push(img);
	}
	for (const link of document.querySelectorAll<HTMLLinkElement>(
		'link[rel~="preload"][fetchpriority="high" i]'
	)) {
		if (link.media && !matchMedia(link.media).matches) continue;
		const urls = preload_urls(link);
		if (!urls.length) continue;
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
		while (end < candidate.length && candidate.charCodeAt(end) > 32) end++;
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

class LoadQueue {
	readonly slots: LoadSlot[] = [];
}
const Q = new LoadQueue();
let waiting = 0;
let in_flight_background = 0;
let in_flight_holes = 0;

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
	/** `holes`: a hole's answer, one of {@link HOLE_WINDOW} in flight. */
	readonly window: 'holes' | undefined;
	readonly queued_at: number = now();
	readonly ready: Promise<() => void>;
	/** Still in the queue: a drain takes it out when it starts. */
	queued = true;
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
		window?: 'holes';
	}) {
		this.kind = o.kind;
		this.label = o.label;
		this.window = o.window;
		this.#read = typeof o.cls === 'function' ? o.cls : () => o.cls as LoadClass;
		this.#flight = o.flight ?? null;
		this.ready = new Promise<() => void>((r) => (this.#resolve = r));
		Q.slots.push(this);
		waiting++;
		if (o.el) this.unwatch = watch_viewport(o.el, '0px', drain);
		this.#flight?.onRaise(() => {
			if (this.queued) drain();
		});
		if (!critical_done() && waits_for_critical(this.kind, this.cls())) void critical_settled(); // ok: the critical wait only waits on timers and resources' events; it never rejects
		drain();
	}

	/** Its class now: the getter's, or its flight's when that is more urgent. */
	cls(): LoadClass {
		const c = this.#read();
		const flight = this.#flight;
		return flight !== null && flight.priority > PRIORITY[c] ? class_at(flight.priority) : c;
	}

	/** Out of the queue: the holder's `ready` resolves, counted in the background window when it
	 *  is one of the guesses. */
	start(cls: LoadClass, background: boolean): void {
		this.unwatch();
		if (background) in_flight_background++;
		const hole = this.window === 'holes';
		if (hole) in_flight_holes++;
		let released = false;
		if (DEVTOOLS)
			dt_emit({
				domain: 'runtime',
				name: 'load.started',
				class: cls,
				kind: this.kind,
				label: this.label,
				waited_ms: Math.round(now() - this.queued_at)
			});
		if (HOOK_LOAD_STARTED)
			slots.hooks?.loadStarted?.({
				class: cls,
				kind: this.kind,
				...(this.label !== undefined ? { label: this.label } : {}),
				waitedMs: Math.round(now() - this.queued_at)
			});
		this.#resolve(() => {
			if (released) return;
			released = true;
			if (background) in_flight_background--;
			if (hole) in_flight_holes--;
			drain();
		});
	}
}

function waits_for_critical(kind: LoadKind, cls: LoadClass): boolean {
	if (cls === 'user') return false;
	if (kit_hydrates_page()) return false;
	return !(kind === 'content' && cls === 'visible');
}

const START_BUDGET_MS = 16;
const drain_definition = machine<{ idle: {}; draining: {}; again: {} }>()({
	name: 'load-drain',
	initial: 'idle',
	steps: { idle: ['draining'], draining: ['idle', 'again'], again: ['idle', 'draining'] }
});
let drainer = drain_definition.create();

function drain(): void {
	const kind = drainer.now.kind;
	if (kind !== 'idle') {
		if (kind === 'draining') drainer.go('again');
		return;
	}
	if (!waiting) return;
	drainer.go('draining');
	const mine = drainer;
	void drain_queue().finally(() => {
		if (drainer !== mine) return;
		const again = drainer.now.kind === 'again';
		drainer.go('idle');
		if (again) drain();
	}); // ok: a drain only hands out slots and yields; it never rejects
}

/** @heisenbench linear */
async function drain_queue(): Promise<void> {
	let until = now() + START_BUDGET_MS;
	for (;;) {
		if (drainer.now.kind === 'again') drainer.go('draining');
		const asked = Q.slots.length;
		const by_class: LoadSlot[][] = [[], [], [], []];
		for (let i = 0; i < asked; i++) by_class[3 - PRIORITY[Q.slots[i].cls()]].push(Q.slots[i]);
		let ran = false;
		let started = false;
		let yielded = false;
		pass: for (let r = 0; r <= 4; r++) {
			const list = r < 4 ? by_class[r] : Q.slots;
			for (let i = r < 4 ? 0 : asked; i < list.length; i++) {
				const e = list[i];
				if (!e.queued) continue;
				const cls = r < 4 && !ran ? CLASSES[r] : e.cls();
				if (!critical_done() && waits_for_critical(e.kind, cls)) continue;
				const background = cls === 'ahead' || cls === 'speculative';
				if (background && in_flight_background >= BACKGROUND_WINDOW) continue;
				if (e.window === 'holes' && in_flight_holes >= HOLE_WINDOW) continue;
				e.queued = false;
				waiting--;
				started = true;
				e.start(cls, background);
				await Promise.resolve();
				ran = true;
				if (now() >= until) {
					leave_queue();
					await yield_task();
					until = now() + START_BUDGET_MS;
					yielded = true;
					break pass;
				}
			}
		}
		if (!yielded) {
			if (started) leave_queue();
			if (drainer.now.kind !== 'again') return;
		}
	}
}

function leave_queue(): void {
	let w = 0;
	for (let i = 0; i < Q.slots.length; i++) if (Q.slots[i].queued) Q.slots[w++] = Q.slots[i];
	Q.slots.length = w;
}

function noop(): void {}

const now = clock.mono;

/** Test seam: a fresh document. */
export function reset_load_scheduler(): void {
	for (const s of Q.slots) {
		s.queued = false;
		s.unwatch();
	}
	Q.slots.length = 0;
	waiting = 0;
	in_flight_background = 0;
	in_flight_holes = 0;
	drainer.stop();
	drainer = drain_definition.create();
	critical.drop(() => true);
	gate.stop();
	gate = gate_definition.create();
}
