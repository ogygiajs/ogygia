/**
 * THE SESSION RECORDER — press record, use the page, press stop. Everything the browser can tell
 * about that stretch is collected here (session-insights.ts turns it into findings):
 *  - every interaction (Event Timing, from 16 ms): its target, input delay / processing / paint;
 *  - long tasks, and long animation frames with the scripts that ran in them (where supported);
 *  - the main thread sampled (JS Self-Profiling, where the document allows it);
 *  - layout shifts, with whether input caused them, and the element that moved;
 *  - every request made (resource timing: size, time, status);
 *  - DOM changes per island (a MutationObserver), errors and rejections, console errors;
 *  - the heap before and after (where the browser exposes it);
 *  - the runtime hooks: islands woken, hydrations, failures, recoveries, navigations, hole fetches.
 * Elements are kept by WeakRef so the tab can point at them without holding the page alive.
 */
import { OG_FP, OGYGIA_DEVTOOLS_HOST } from '@ogygia/core/internal/instruments';
import { flights, machine, STALE } from '@ogygia/machine';
import { all_regions, region_name } from './regions.ts';
import { on_hook } from './hook-entries.ts';
import type {
	HookEntry,
	SessionClick,
	SessionData,
	SessionFrame,
	SessionInteraction,
	SessionNav,
	SessionRequest,
	SessionShift
} from '@ogygia/insights';

export type {
	SessionClick,
	SessionData,
	SessionFrame,
	SessionInteraction,
	SessionNav,
	SessionRequest,
	SessionShift
} from '@ogygia/insights';

const CLICKABLE =
	'a[href],button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"],[role="option"],[onclick],[tabindex]:not([tabindex="-1"])';
/** What a visitor takes for a control: one in its ancestry, or a pointer cursor where they clicked. */
function looks_clickable(el: Element): boolean {
	if (el.closest(CLICKABLE)) return true;
	try {
		return getComputedStyle(el).cursor === 'pointer';
	} catch {
		return false;
	}
}

/** Names for a session's islands: its own record first, then the page as it is now. */
export function session_names(s: SessionData, now: (fp: string) => string): (fp: string) => string {
	return (fp) => s.names?.[fp] || now(fp);
}

/** A page's part of a session, saved on page hide so the next document picks the session up. */
export interface SavedPart {
	origin: number;
	data: SessionData;
}
const SAVED_KEY = 'ogygia:devtools:session';

/** Shift every time in a part by `d` ms (another document's clock onto this one's). */
function shift_part(s: SessionData, d: number): SessionData {
	const t = <T extends { t: number }>(xs: T[]) =>
		xs.map((x) => ({ ...x, t: Math.round((x.t + d) * 10) / 10 }));
	return {
		...s,
		from: s.from + d,
		to: s.to + d,
		interactions: t(s.interactions),
		longtasks: t(s.longtasks),
		frames: t(s.frames),
		shifts: t(s.shifts),
		requests: t(s.requests),
		mut_log: t(s.mut_log),
		clicks: t(s.clicks),
		errors: t(s.errors),
		navs: t(s.navs ?? []),
		hooks: (s.hooks ?? []).map((e) => ({ ...e, at: e.at + d })),
		pages: t(s.pages)
	};
}

/** Several pages' parts as one session on the current document's clock. */
function merge_parts(parts: SavedPart[], current: SessionData): SessionData {
	const here = performance.timeOrigin;
	const all = [...parts.map((p) => shift_part(p.data, p.origin - here)), current];
	const cat = <K extends keyof SessionData>(k: K) =>
		all.flatMap((p) => p[k] as unknown as unknown[]) as unknown as SessionData[K];
	const muts = new Map<string, { fp: string | null; count: number; el: WeakRef<Element> | null }>();
	for (const p of all)
		for (const m of p.mutations) {
			const k = m.fp ?? '';
			const prev = muts.get(k);
			muts.set(k, { fp: m.fp, count: (prev?.count ?? 0) + m.count, el: m.el ?? prev?.el ?? null });
		}
	return {
		...current,
		from: all[0].from,
		interactions: cat('interactions'),
		longtasks: cat('longtasks'),
		frames: cat('frames'),
		shifts: cat('shifts'),
		requests: cat('requests'),
		mut_log: cat('mut_log'),
		clicks: cat('clicks'),
		errors: cat('errors'),
		navs: all.flatMap((p) => p.navs ?? []),
		hooks: cat('hooks'),
		pages: cat('pages'),
		mutations: [...muts.values()].sort((a, b) => b.count - a.count),
		heap: current.heap,
		names: Object.assign({}, ...all.map((p) => p.names ?? {}))
	};
}

/** The parts a previous page saved, taken (so no other copy of this module resumes them too). */
export function take_saved_session(): SavedPart[] | null {
	let parts: SavedPart[] | null = null;
	try {
		const raw = sessionStorage.getItem(SAVED_KEY);
		if (raw) parts = JSON.parse(raw) as SavedPart[];
		sessionStorage.removeItem(SAVED_KEY);
	} catch {
		parts = null;
	}
	return parts?.length ? parts : null;
}

/** A session the parts of earlier pages began goes on here (needs the document's body). */
export function resume_session(parts: SavedPart[]): boolean {
	if (page_recording.active) return false;
	start_session(parts);
	return true;
}

/** On a devtools boot: a session a previous page was recording goes on here. */
export function resume_session_if_any(): boolean {
	const parts = take_saved_session();
	return parts ? resume_session(parts) : false;
}

/** Was a session saved by the page before (without resuming it). */
export function session_waiting(): boolean {
	try {
		return !!sessionStorage.getItem(SAVED_KEY);
	} catch {
		return false;
	}
}

const ISLAND = `ogygia-region[${OG_FP}]`;
const r1 = (n: number) => Math.round(n * 10) / 10;

function island_of(node: Node | null | undefined): Element | null {
	const el = node && node.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
	return el?.closest?.(ISLAND) ?? null;
}

/** `button#buy.primary` — a short readable name for an element. */
export function describe_el(el: Element | null | undefined): string {
	if (!el) return '(unknown)';
	let s = el.localName;
	if (el.id) s += '#' + el.id;
	const cls =
		typeof el.className === 'string'
			? el.className
					.trim()
					.split(' ')
					.filter((c) => c && !c.startsWith('svelte-'))
					.slice(0, 2)
			: [];
	if (cls.length) s += '.' + cls.join('.');
	const text = (el.textContent ?? '').trim().slice(0, 24);
	return text ? `${s} "${text}${(el.textContent ?? '').trim().length > 24 ? '…' : ''}"` : s;
}

interface Recorder {
	/** Ends this recording, once: a second call gets the first call's data, and touches nothing of
	 *  a recording started after it. */
	stop(): Promise<SessionData>;
	started: number;
}

type RunStates = {
	/** Watching the page. */
	recording: {};
	/** The page went away mid-session: its part is saved for the next document. */
	saved: {};
	/** Stopped: its data handed back. */
	stopped: {};
};

/** One recording's run. Leaving `recording`, whichever way, takes its watchers off, once. */
const run_definition = machine<RunStates>()({
	name: 'session-recorder',
	initial: 'recording',
	steps: { recording: ['saved', 'stopped'], saved: [], stopped: [] }
});

/** The recording now: the newest started and not yet stopped, one for the page. */
// @why the dock's Record tab and the injected testing engine are two copies of this module, and each patches the page's console (test: e2e/devtools.spec.ts › #240)
const page_recording: { active: Recorder | null } = ((
	globalThis as { [k: symbol]: { active: Recorder | null } }
)[Symbol.for('ogygia.session.recording')] ??= { active: null });

/** the last finished session (its data + report), for every tab: the Record tab writes it, the
 *  island detail reads its island's part (the report type lives in session-insights.ts) */
let last_session: { data: SessionData; report: unknown } | null = null;
let last_version = 0;
export function set_last_session(s: { data: SessionData; report: unknown } | null): void {
	last_session = s;
	last_version++;
}
export function get_last_session(): { data: SessionData; report: unknown } | null {
	return last_session;
}
export function last_session_version(): number {
	return last_version;
}

export function recording(): Recorder | null {
	return page_recording.active;
}

/** Start recording (or go on with the parts earlier pages saved — `resume_session_if_any`). */
export function start_session(prior?: SavedPart[]): Recorder {
	if (page_recording.active) return page_recording.active;
	// the run's visit to `recording` owns every watcher below: leaving it (a stop, the page going
	// away) takes them all off, once
	const run = run_definition.create();
	const s = run.scope;
	const from = performance.now();
	const hooks: HookEntry[] = [];
	const interactions: SessionInteraction[] = [];
	const longtasks: { t: number; ms: number }[] = [];
	const frames: SessionFrame[] = [];
	const shifts: SessionShift[] = [];
	const errors: { t: number; message: string }[] = [];
	const muts = new Map<Element | null, number>();
	// ISLAND NAMES as the session goes: an in-app navigation swaps the page, and the islands that
	// were clicked leave the DOM — named now, at the start and just before each swap (navStarted is
	// called synchronously, before the new page goes in), they keep their names in the report
	const names: Record<string, string> = {};
	const note_names = () => {
		for (const r of all_regions()) if (r.fp && !names[r.fp]) names[r.fp] = region_name(r.entry);
	};
	note_names();
	s.defer(
		on_hook((e) => {
			hooks.push(e);
			if (e.hook === 'navStarted') note_names();
		})
	);
	const watch = (
		type: string,
		cb: (entries: PerformanceEntryList) => void,
		extra: Record<string, unknown> = {}
	) => {
		try {
			const po = s.watch(new PerformanceObserver((l) => cb(l.getEntries())));
			po.observe({ type, ...extra } as PerformanceObserverInit);
			// (newest first: the entries still queued count too, before it disconnects)
			s.defer(() => {
				try {
					const left = po.takeRecords();
					if (left.length) cb(left);
				} catch {
					// ok: no takeRecords here; the entries already delivered count
				}
			});
		} catch {
			// ok: an entry type this browser does not have; the session records without it
		}
	};
	watch(
		'event',
		(es) => {
			for (const e of es as (PerformanceEventTiming & { interactionId?: number })[]) {
				if (e.startTime < from || interactions.length >= 2000) continue;
				const target = (e as { target?: Node | null }).target ?? null;
				const el = target && target.nodeType === 1 ? (target as Element) : null;
				const island = island_of(target);
				interactions.push({
					t: r1(e.startTime),
					name: e.name,
					duration: r1(e.duration),
					input_delay: r1(Math.max(0, e.processingStart - e.startTime)),
					processing: r1(Math.max(0, e.processingEnd - e.processingStart)),
					presentation: r1(Math.max(0, e.startTime + e.duration - e.processingEnd)),
					id: e.interactionId ?? 0,
					target: describe_el(el),
					fp: island?.getAttribute(OG_FP) ?? null,
					el: el ? new WeakRef(el) : null
				});
			}
		},
		{ durationThreshold: 16 }
	);
	watch('longtask', (es) => {
		for (const e of es)
			if (e.startTime >= from && longtasks.length < 2000)
				longtasks.push({ t: r1(e.startTime), ms: r1(e.duration) });
	});
	watch('long-animation-frame', (es) => {
		for (const e of es as (PerformanceEntry & {
			blockingDuration?: number;
			scripts?: {
				sourceURL?: string;
				sourceFunctionName?: string;
				invoker?: string;
				duration?: number;
			}[];
		})[]) {
			if (e.startTime < from || frames.length >= 1000) continue;
			frames.push({
				t: r1(e.startTime),
				ms: r1(e.duration),
				blocking: r1(e.blockingDuration ?? 0),
				scripts: (e.scripts ?? []).slice(0, 8).map((s) => ({
					source: s.sourceURL ?? '',
					fn: s.sourceFunctionName ?? '',
					invoker: s.invoker ?? '',
					ms: r1(s.duration ?? 0)
				}))
			});
		}
	});
	watch('layout-shift', (es) => {
		for (const e of es as (PerformanceEntry & {
			value?: number;
			hadRecentInput?: boolean;
			sources?: { node?: Node | null }[];
		})[]) {
			if (e.startTime < from || shifts.length >= 500) continue;
			const node = e.sources?.[0]?.node ?? null;
			const el = node && node.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
			shifts.push({
				t: r1(e.startTime),
				value: Math.round((e.value ?? 0) * 10000) / 10000,
				input: !!e.hadRecentInput,
				fp: island_of(node)?.getAttribute(OG_FP) ?? null,
				el: el ? new WeakRef(el) : null
			});
		}
	});
	// the DOM, per island (and outside any): a lot of changes = something re-renders
	const mut_log: { t: number; fp: string | null }[] = [];
	const mo = s.watch(
		new MutationObserver((records) => {
			const now = r1(performance.now());
			const seen = new Set<string | null>();
			for (const m of records) {
				const island = island_of(m.target);
				muts.set(island, (muts.get(island) ?? 0) + 1);
				const fp = island?.getAttribute(OG_FP) ?? null;
				if (!seen.has(fp) && mut_log.length < 20_000) {
					seen.add(fp);
					mut_log.push({ t: now, fp });
				}
			}
		})
	);
	// EVERY click (the browser's interaction timing reports only those over 16 ms: a quick click on a
	// dead button would never show) — for dead clicks and repeated clicks
	const clicks: SessionClick[] = [];
	const on_click = (e: MouseEvent) => {
		if (clicks.length >= 2000) return;
		const el = e.target instanceof Element ? e.target : null;
		if (el?.closest(`[${OGYGIA_DEVTOOLS_HOST}]`)) return;
		clicks.push({
			t: r1(e.timeStamp),
			target: describe_el(el),
			fp: island_of(el)?.getAttribute(OG_FP) ?? null,
			el: el ? new WeakRef(el) : null,
			...(el && looks_clickable(el) ? { clickable: true as const } : {})
		});
	};
	s.on(globalThis, 'click', on_click, { capture: true, passive: true });
	// EVERY NAVIGATION as it starts, with what started it: the link or form the browser names, else the
	// input being handled at that moment (a reload in a click handler) — read when it fires, not
	// guessed later from the last input (Chromium's Navigation API; elsewhere none are noted)
	const navs: SessionNav[] = [];
	let handling: { target: string; fp: string | null; until: number } | null = null;
	const on_input = (e: Event) => {
		const el = e.target instanceof Element ? e.target : null;
		if (!el || el.closest(`[${OGYGIA_DEVTOOLS_HOST}]`)) return;
		handling = {
			target: describe_el(el),
			fp: island_of(el)?.getAttribute(OG_FP) ?? null,
			until: performance.now() + 50
		};
	};
	const INPUTS = ['click', 'submit', 'keydown', 'change'] as const;
	for (const type of INPUTS) s.on(globalThis, type, on_input, { capture: true, passive: true });
	const navigation = (globalThis as { navigation?: EventTarget }).navigation;
	const on_navigate = (e: Event) => {
		const n = e as Event & {
			destination?: { url: string };
			sourceElement?: Element | null;
			navigationType?: string;
		};
		if (!n.destination || navs.length >= 200) return;
		const now = performance.now();
		const by = n.sourceElement ?? null;
		const input = handling && now <= handling.until ? handling : null;
		navs.push({
			url: n.destination.url,
			t: r1(now),
			type: n.navigationType ?? '',
			source: by ? describe_el(by) : (input?.target ?? null),
			fp: by ? (island_of(by)?.getAttribute(OG_FP) ?? null) : (input?.fp ?? null)
		});
	};
	if (navigation) s.on(navigation, 'navigate', on_navigate);
	// every request (a PerformanceObserver: the resource buffer holds only 250, a dev page fills it)
	const requests: SessionRequest[] = [];
	watch('resource', (es) => {
		for (const r of es as (PerformanceResourceTiming & { responseStatus?: number })[]) {
			if (
				r.startTime < from ||
				requests.length >= 2000 ||
				r.name.includes('/__profiler/') ||
				r.name.includes('/__ogygia_devtools')
			)
				continue;
			const st: readonly PerformanceServerTiming[] = r.serverTiming ?? [];
			requests.push({
				url: r.name,
				type: r.initiatorType,
				t: r1(r.startTime),
				ms: r1(r.duration),
				bytes: r.transferSize || r.decodedBodySize || 0,
				status:
					typeof r.responseStatus === 'number' && r.responseStatus > 0 ? r.responseStatus : null,
				...(st.length
					? {
							server: st
								.slice(0, 8)
								.map((x) => ({ name: x.name, ms: r1(x.duration), desc: x.description }))
						}
					: {})
			});
		}
	});
	try {
		mo.observe(document.body, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true
		});
	} catch {
		// ok: no body yet: no DOM changes to count
	}
	// (a window's `onerror` is typed for the legacy string form too: a listener gets the event)
	const on_error = (e: Event | string) =>
		errors.length < 200 &&
		errors.push({
			t: r1(performance.now()),
			message: String((e as ErrorEvent).message || (e as ErrorEvent).error || 'error').slice(0, 300)
		});
	const on_rej = (e: PromiseRejectionEvent) =>
		errors.length < 200 &&
		errors.push({
			t: r1(performance.now()),
			message:
				'unhandled rejection: ' +
				String((e.reason as { message?: string })?.message ?? e.reason).slice(0, 280)
		});
	s.on(globalThis, 'error', on_error);
	s.on(globalThis, 'unhandledrejection', on_rej);
	const console_error = console.error;
	s.defer(() => (console.error = console_error));
	console.error = (...args: unknown[]) => {
		if (errors.length < 200)
			errors.push({
				t: r1(performance.now()),
				message:
					'console.error: ' +
					args
						.map((a) => (a instanceof Error ? a.message : String(a)))
						.join(' ')
						.slice(0, 280)
			});
		console_error.apply(console, args);
	};
	// the main thread, sampled
	let prof: { stop(): Promise<unknown> } | null = null;
	let cpu_off: string | null = null;
	const Ctor = (
		globalThis as {
			Profiler?: new (o: { sampleInterval: number; maxBufferSize: number }) => {
				stop(): Promise<unknown>;
			};
		}
	).Profiler;
	if (!Ctor) cpu_off = 'unsupported';
	else
		try {
			prof = new Ctor({ sampleInterval: 10, maxBufferSize: 60_000 });
		} catch {
			cpu_off = 'no-policy';
		}
	const heap0 =
		(performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;

	/** this document's part of the session */
	const collect = (cpu: unknown): SessionData => {
		const heap1 =
			(performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
		return {
			from,
			to: performance.now(),
			interactions,
			longtasks,
			frames,
			shifts,
			requests,
			mutations: [...muts]
				.map(([el, count]) => ({
					fp: el?.getAttribute(OG_FP) ?? null,
					count,
					el: el ? new WeakRef(el) : null
				}))
				.sort((a, b) => b.count - a.count),
			mut_log,
			clicks,
			errors,
			navs,
			heap: heap0 !== null && heap1 !== null ? { from: heap0, to: heap1 } : null,
			hooks: [...hooks],
			cpu,
			cpu_off,
			page: location.pathname,
			pages: [{ url: location.pathname + location.search, t: from }],
			names: (note_names(), { ...names })
		};
	};
	// A FULL PAGE LOAD mid-session: save this page's part (no CPU — the sampler cannot be stopped
	// while the page goes away), the next document's devtools boot picks the session up
	const on_hide = (e: PageTransitionEvent) => {
		if (e.persisted || !run.move('recording', 'saved')) return;
		const strip = (s: SessionData): SessionData =>
			JSON.parse(
				JSON.stringify({ ...s, cpu: null }, (k, v) => (k === 'el' ? null : v))
			) as SessionData;
		try {
			sessionStorage.setItem(
				SAVED_KEY,
				JSON.stringify([
					...(prior ?? []),
					{ origin: performance.timeOrigin, data: strip(collect(null)) }
				])
			);
		} catch {
			// ok: no storage: the session ends with this page
		}
	};
	s.on(globalThis, 'pagehide', on_hide);

	// out of `recording` (a stop, or the page going away): the watchers come off (the scope's), and
	// the module's recording is let go only while it is still this one (a newer one may have started
	// since)
	s.defer(() => {
		if (page_recording.active === rec) page_recording.active = null;
	});
	const stopping = flights({
		name: 'session stop',
		run: async () => {
			run.move('recording', 'stopped');
			let cpu: unknown = null;
			if (prof) {
				try {
					cpu = await prof.stop();
				} catch {
					cpu = null;
				}
			}
			const here = collect(cpu);
			try {
				sessionStorage.removeItem(SAVED_KEY);
			} catch {
				// ok: no storage: nothing was saved to remove
			}
			return prior?.length ? merge_parts(prior, here) : here;
		}
	});
	// (nothing drops the stop, so it is never STALE; were it, it is asked for again)
	const stop = async (): Promise<SessionData> => {
		const data = await stopping.get();
		return data === STALE ? stop() : data;
	};
	const rec: Recorder = {
		// (a resumed session: its first page's start, on this document's clock)
		started: prior?.length ? prior[0].data.from + (prior[0].origin - performance.timeOrigin) : from,
		stop
	};
	page_recording.active = rec;
	return rec;
}
