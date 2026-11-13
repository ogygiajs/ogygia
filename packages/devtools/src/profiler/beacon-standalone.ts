/**
 * THE PAGE BEACON: one per document, for the profiler's own user and for a browser the devtools
 * measure. An inline classic script (made with ogygia's own `script()`, so `standalone_beacon` is
 * inlined through `Function.prototype.toString`: browser globals only, every helper inside it). It
 * runs whether or not the ogygia runtime boots, and owns the page: the vitals, the long tasks, the
 * long frames, the slowest interaction, the CPU sampler (the browser runs one at a time), the marks
 * and the visit. The runtime's half (beacon.ts) only adds the regions' data through `join`.
 * Payloads: `{page, vitals}`, `{page, visit}`, `{page, cpu}`, `{page, islands, marks}`.
 */
import type { AttrChange } from '@ogygia/core/internal/instruments';

/** A layout shift, as the visit lists it. */
export interface PageShift {
	t: number;
	value: number;
	fp?: string;
	tag?: string;
	from?: [number, number, number, number];
	to?: [number, number, number, number];
}

/** A kept CPU trace (the dock's); an interaction's carries its spans. */
export interface CpuKept {
	trace: unknown;
	from: number;
	to: number;
	label: string;
	spans?: { t: number; wait: [number, number]; handler: [number, number] };
}

/** The page's own parts, for the devtools Page tab. */
export interface PagePart {
	vitals: { ttfb?: number; fcp?: number; lcp?: number; cls?: number; inp?: number };
	visit: Record<string, unknown> | null;
	firsts: { fp: string; t: number; type: string }[];
	shifts: PageShift[];
	longtasks: { t: number; ms: number }[];
	longtasks_from?: 'frames';
	marks: { name: string; ms: number; t0?: number }[];
	cpu: { state: 'recording' | 'done' | 'off'; off?: string | null; traces: CpuKept[] };
}

/** What the runtime's half adds to the page's visit. */
export interface RegionPart {
	/** the regions' fields of the visit (`held`: the critical wait, which goes in its paints) */
	visit(): { islands: unknown[]; held?: unknown } & Record<string, unknown>;
	/** the regions' markup before and after hydration, for the browser store (`final`: the hide's) */
	snapshots(final: boolean): { fp: string }[];
	/** a region is still waking: the load's CPU trace waits for it */
	waking(now: number): boolean;
}

/** The page beacon, at `globalThis[Symbol.for('ogygia.beacon')]`. */
export interface PageBeacon {
	/** the profiler's endpoint is on the page: what is recorded is also sent */
	readonly sends: boolean;
	beacon_mark(
		name: string,
		ms: number,
		attrs?: Record<string, string | number | boolean>,
		t0?: number
	): void;
	join(part: RegionPart): void;
	/** a region hydrated: its sample (when sent) joins the next batch */
	hydrated(sample: Record<string, unknown> | null): void;
	/** the regions' data changed: the visit goes again shortly (`always`: even before the early one) */
	changed(always?: boolean): void;
	shift(s: PageShift): void;
	room<T>(list: T[], cap: number, t_of: (x: T) => number): boolean;
	/** the document's first in-app navigation started */
	nav_at(t: number): void;
	/** the input that landed inside `el` between `from` and `to`, if any */
	input_on(el: Element, from: number, to: number): string | undefined;
	/** markup without comments and the runtime's own marks: what a visitor could see change */
	bare(html: string): string;
	/** core's `attr_changes` (contract/markup-text.ts), here so the boot carries no shared chunk */
	attr_changes(a: string, b: string): AttrChange[] | null;
	/** core's `hole_copy_of` (contract/hash.ts), for the same reason */
	copy_of(endpoint: string): string;
	page(): PagePart;
	record_cpu(ms: number, label: string): Promise<boolean>;
	keep_traces(): void;
	/** the page's one send path, by size and by whether the page is leaving (`hiding`) */
	send(body: string, slim?: () => string, hiding?: boolean): void;
	stop(): void;
	state(): { target: string | null; queued: number; marks: number; scheduled: boolean };
}

/** The beacon itself. Runs in the browser, as an inline classic script. */
export function standalone_beacon(): void {
	type Timed = PerformanceEntry & {
		value?: number;
		hadRecentInput?: boolean;
		interactionId?: number;
		processingStart?: number;
		processingEnd?: number;
		target?: Node | null;
		url?: string;
		element?: Element | null;
		sources?: {
			node?: Node | null;
			previousRect?: DOMRectReadOnly;
			currentRect?: DOMRectReadOnly;
		}[];
		scripts?: {
			sourceURL?: string;
			duration?: number;
			startTime?: number;
			invoker?: string;
			sourceFunctionName?: string;
			forcedStyleAndLayoutDuration?: number;
		}[];
	};
	type Visit = Record<string, unknown>;
	type Shift = PageShift;
	interface SelfProfiler {
		stop(): Promise<unknown>;
	}
	interface Interaction {
		name: string;
		t: number;
		ms: number;
		delay: number;
		processing: number;
		presentation: number;
		target: string;
		fp?: string;
	}
	interface Frame {
		start: number;
		end: number;
		scripts: {
			url: string;
			fn: string;
			invoker: string;
			start: number;
			ms: number;
			forced?: number;
		}[];
	}
	interface Mark {
		name: string;
		ms: number;
		t0?: number;
		attrs?: Record<string, string | number | boolean>;
	}
	type DomShape = {
		nodes: number;
		depth: number;
		deepest: string;
		widest: { at: string; children: number };
		islands: { fp: string; nodes: number }[];
	};
	type Resource = PerformanceResourceTiming & {
		renderBlockingStatus?: string;
		responseStatus?: number;
	};

	const KEY = Symbol.for('ogygia.beacon');
	const WAITING_KEY = Symbol.for('ogygia.beacon.waiting');
	const g = globalThis as unknown as Record<symbol, unknown> & {
		Profiler?: new (o: { sampleInterval: number; maxBufferSize: number }) => SelfProfiler;
		requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void;
	};
	if (g[KEY] || typeof document === 'undefined') return;

	// oxlint-disable-next-line ogygia/markup-from-vocabulary -- inlined through toString(): it names nothing outside itself
	const ISLAND_SEL = 'ogygia-region[data-og-fp]';
	const KEEPALIVE_MAX = 60000;
	const MAX_SEEN_RESOURCES = 3000;
	const MAX_DETAIL_RESOURCES = 200;
	const MAX_REFETCHED = 40;
	const UNCOMPRESSED_MIN = 4096;
	const MAX_UNCOMPRESSED = 10;
	const MAX_FRAMES = 40;
	const RESEND_MAX = 8;
	const CPU_WINDOW_MS = 8000;
	const CPU_WINDOW_MAX_MS = 20000;
	const CPU_QUIET_MS = 1500;
	const ICPU_MAX_MS = 60000;
	const ICPU_SLOW_MS = 200;
	const FRAME_MS = 1000 / 60;
	const STALL_MS = 50;
	const MEASURED_TYPES = [
		'layout-shift',
		'longtask',
		'event',
		'largest-contentful-paint',
		'long-animation-frame'
	];
	const TEXT_EXT = ['js', 'mjs', 'css', 'html', 'htm', 'json', 'svg', 'txt', 'xml', 'map', 'wasm'];
	const FONT_EXT = ['woff', 'woff2', 'ttf', 'otf'];
	const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'];
	const LINK_AS: Record<string, string> = {
		style: 'css',
		script: 'script',
		font: 'font',
		image: 'img',
		fetch: 'fetch'
	};

	// The target comes only from the head the server wrote, and only on the page's own origin: a
	// tag elsewhere, or naming another origin, sends nothing (test: beacon-own-origin).
	const target = ((): string | null => {
		const raw = document
			.querySelector('head > meta[name="ogygia-profiler-beacon"]')
			?.getAttribute('content');
		if (!raw) return null;
		try {
			return new URL(raw, location.href).origin === location.origin ? raw : null;
		} catch {
			return null; // ok: an address that does not parse is no target
		}
	})();
	const landing = location.pathname;
	const r2 = (n: number) => Math.round(n * 100) / 100;
	const spent = (g[Symbol.for('ogygia.own-cost')] ??= {}) as Record<string, number>;
	const charge = (phase: string, t0: number) => {
		spent[phase] = (spent[phase] ?? 0) + (performance.now() - t0);
	};

	let off = false;
	let part: RegionPart | null = null;
	let keep = false;
	const vitals: PagePart['vitals'] = {};
	const paints: {
		fcp?: number;
		lcp?: number;
		lcp_fp?: string;
		lcp_url?: string;
		lcp_tag?: string;
		lcp_lazy?: true;
		lcp_priority?: 'high' | 'low';
	} = {};
	let lcp_el: Element | null = null;
	let lcp_region: Element | null = null;
	let cls = 0;
	const seen: PerformanceResourceTiming[] = [];
	const shifts: Shift[] = [];
	const longtasks: { t: number; ms: number }[] = [];
	let longtasks_from_frames = false;
	const firsts: { fp: string; t: number; type: string }[] = [];
	const recent_inputs: { t: number; el: WeakRef<Element>; type: string }[] = [];
	const scripts = new Map<string, { ms: number; count: number }>();
	const forced: { start: number; end: number; ms: number; url: string; fn: string }[] = [];
	const scroll_jank: {
		start: number;
		ms: number;
		scripts: { url: string; fn: string; invoker: string; ms: number }[];
	}[] = [];
	const scroll_times: number[] = [];
	const frames: Frame[] = [];
	let interaction: Interaction | null = null;
	let interaction_id = 0;
	let interaction_span: { start: number; ps: number; pe: number; end: number } | null = null;
	const visit_marks: { name: string; ms: number; t0?: number }[] = [];
	let marks: Mark[] = [];
	let samples: Record<string, unknown>[] = [];
	let first_nav_t: number | undefined;
	let visit_state: 'open' | 'sent' | 'reopened' = 'open';
	let early_done = false;
	let resend: ReturnType<typeof setTimeout> | undefined;
	let resends = 0;
	let scheduled = false;
	let leaving = false;
	let queued = 0;
	let cpu: SelfProfiler | null = null;
	let cpu_sent = false;
	let cpu_off: string | null = null;
	let cpu_started_at = 0;
	let cpu_kept: CpuKept[] = [];
	let icpu: SelfProfiler | null = null;
	let icpu_timer: ReturnType<typeof setTimeout> | null = null;
	let icpu_done = false;
	let icpu_caught: { t: number; wait: [number, number]; handler: [number, number] } | null = null;
	let faces_memo: {
		key: string;
		faces: { family: string; display: string; urls: string[] }[];
	} | null = null;
	let preloads_memo: { url: string; as: string; bytes: number }[] | null = null;
	let dom_memo: { n: number; shape: DomShape | null } | null = null;
	const observers: PerformanceObserver[] = [];

	const supports = (type: string) => {
		try {
			return (PerformanceObserver.supportedEntryTypes ?? []).includes(type);
		} catch {
			return false;
		}
	};
	const nav_entry = () => {
		try {
			return performance.getEntriesByType('navigation')[0] as
				| PerformanceNavigationTiming
				| undefined;
		} catch {
			return undefined;
		}
	};
	const fp_of = (node: unknown): string | undefined => {
		const n = node as Node | null | undefined;
		const el =
			n && n.nodeType === 1 ? (n as Element) : n && n.nodeType === 3 ? n.parentElement : null;
		// oxlint-disable-next-line ogygia/markup-from-vocabulary -- inlined through toString(): it names nothing outside itself
		return el?.closest?.(ISLAND_SEL)?.getAttribute('data-og-fp') ?? undefined;
	};
	const describe_target = (node: Node | null | undefined): string => {
		const el = node && node.nodeType === 1 ? (node as Element) : node?.parentElement;
		if (!el) return '';
		const tag = el.tagName.toLowerCase();
		const id = el.id ? `#${el.id.slice(0, 30)}` : '';
		const name = el.getAttribute('name');
		const label =
			el.getAttribute('aria-label') ??
			(tag === 'input' || tag === 'select' || tag === 'textarea'
				? ''
				: (el.textContent ?? '').trim().slice(0, 30));
		return `${tag}${id}${name ? `[name=${name.slice(0, 30)}]` : ''}${label ? ` "${label}"` : ''}`;
	};
	const rect_of = (r: DOMRectReadOnly | undefined): [number, number, number, number] | undefined =>
		r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : undefined;
	const ext_of = (name: string): string => {
		const q = name.indexOf('?');
		const path = q === -1 ? name : name.slice(0, q);
		const dot = path.lastIndexOf('.');
		return dot > path.lastIndexOf('/') ? path.slice(dot + 1).toLowerCase() : '';
	};
	const unquote = (s: string) => s.trim().split('"').join('').split("'").join('');

	function tag_attrs(tag: string): Map<string, string> {
		const out = new Map<string, string>();
		let i = 1;
		while (i < tag.length && tag[i] !== ' ' && tag[i] !== '>' && tag[i] !== '/') i++;
		while (i < tag.length) {
			while (
				i < tag.length &&
				(tag[i] === ' ' || tag[i] === '\n' || tag[i] === '\t' || tag[i] === '/')
			)
				i++;
			if (i >= tag.length || tag[i] === '>') break;
			const start = i;
			while (i < tag.length && tag[i] !== '=' && tag[i] !== ' ' && tag[i] !== '>') i++;
			const name = tag.slice(start, i);
			let value = '';
			if (tag[i] === '=') {
				i++;
				const q = tag[i];
				if (q === '"' || q === "'") {
					const end = tag.indexOf(q, i + 1);
					value = tag.slice(i + 1, end === -1 ? tag.length : end);
					i = end === -1 ? tag.length : end + 1;
				} else {
					const s = i;
					while (i < tag.length && tag[i] !== ' ' && tag[i] !== '>') i++;
					value = tag.slice(s, i);
				}
			}
			if (name) out.set(name, value);
		}
		return out;
	}
	function tag_name(tag: string): string {
		let i = 1;
		while (i < tag.length && tag[i] !== ' ' && tag[i] !== '>' && tag[i] !== '/' && tag[i] !== '\n')
			i++;
		return tag.slice(1, i).toLowerCase();
	}
	function attr_changes(a: string, b: string): AttrChange[] | null {
		const out: AttrChange[] = [];
		let i = 0;
		let j = 0;
		while (i < a.length || j < b.length) {
			const ti = a.indexOf('<', i);
			const tj = b.indexOf('<', j);
			if (a.slice(i, ti === -1 ? a.length : ti) !== b.slice(j, tj === -1 ? b.length : tj))
				return null;
			if (ti === -1 || tj === -1) return ti === tj ? out : null;
			const ei = a.indexOf('>', ti);
			const ej = b.indexOf('>', tj);
			const x = a.slice(ti, ei === -1 ? a.length : ei + 1);
			const y = b.slice(tj, ej === -1 ? b.length : ej + 1);
			i = ti + x.length;
			j = tj + y.length;
			if (x === y) continue;
			const tag = tag_name(x);
			if (tag !== tag_name(y) || x[1] === '/' || y[1] === '/') return null;
			const xa = tag_attrs(x);
			const ya = tag_attrs(y);
			for (const [name, v] of xa)
				if (ya.get(name) !== v && out.length < 20)
					out.push({ tag, name, from: v, to: ya.has(name) ? ya.get(name)! : null });
			for (const [name, v] of ya)
				if (!xa.has(name) && out.length < 20) out.push({ tag, name, from: null, to: v });
		}
		return out;
	}
	function bare(html: string): string {
		let at = html.indexOf('<!--');
		if (at !== -1) {
			let out = '';
			let from = 0;
			while (at !== -1) {
				out += html.slice(from, at);
				const end = html.indexOf('-->', at + 4);
				if (end === -1) {
					from = html.length;
					break;
				}
				from = end + 3;
				at = html.indexOf('<!--', from);
			}
			html = `${out}${html.slice(from)}`;
		}
		for (const m of [
			' data-nested=""',
			' data-hydrated=""',
			// oxlint-disable-next-line ogygia/markup-from-vocabulary -- inlined through toString(): it names nothing outside itself
			' data-og-kept=""',
			' data-revalidated=""'
		])
			if (html.includes(m)) html = html.split(m).join('');
		return html;
	}
	function copy_of(endpoint: string): string {
		let at = endpoint.indexOf('&props=');
		if (at === -1) at = endpoint.indexOf('?props=');
		if (at === -1) return '';
		at += 7;
		const end = endpoint.indexOf('&', at);
		const payload = endpoint.slice(at, end === -1 ? endpoint.length : end);
		// hash: core's hole_copy_of, copied: this script is inlined by toString and can import nothing
		let h = 0x811c9dc5;
		for (let i = 0; i < payload.length; i++) {
			h ^= payload.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		return (h >>> 0).toString(36);
	}

	function room<T>(list: T[], cap: number, t_of: (x: T) => number): boolean {
		if (list.length < cap) return true;
		if (first_nav_t === undefined) return false;
		const from = first_nav_t;
		const i = list.findIndex((x) => t_of(x) >= from);
		if (i === -1) return false;
		list.splice(i, 1);
		return true;
	}

	function resend_soon(): void {
		if (!target || off || visit_state === 'sent' || resends >= RESEND_MAX) return;
		clearTimeout(resend);
		// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: the open visit's re-send, cleared on re-arm and by the hide
		resend = setTimeout(() => {
			resend = undefined;
			resends++;
			flush_visit(false);
		}, 1500);
	}
	const again = () => {
		if (early_done) resend_soon();
	};

	function watch(type: string, on: (entries: Timed[]) => void): void {
		try {
			// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: the document's, disconnected by stop()
			const po = new PerformanceObserver((list) => {
				if (!off) on(list.getEntries() as Timed[]);
			});
			po.observe({
				type,
				buffered: true,
				...(type === 'event' ? { durationThreshold: 16 } : {})
			} as PerformanceObserverInit);
			observers.push(po);
		} catch {
			// ok: an entry type this browser does not have: its numbers are left out
		}
	}

	function observe(): void {
		const nav = nav_entry();
		if (nav && nav.responseStart > 0) vitals.ttfb = r2(nav.responseStart);
		watch('paint', (es) => {
			for (const e of es)
				if (e.name === 'first-contentful-paint') vitals.fcp = paints.fcp = r2(e.startTime);
		});
		try {
			performance.setResourceTimingBufferSize(MAX_SEEN_RESOURCES);
		} catch {
			// ok: a browser that cannot grow the buffer keeps its default
		}
		watch('resource', (es) => {
			for (const e of es)
				if (seen.length < MAX_SEEN_RESOURCES) seen.push(e as unknown as PerformanceResourceTiming);
		});
		watch('largest-contentful-paint', (es) => {
			const last = es[es.length - 1];
			if (!last) return;
			vitals.lcp = paints.lcp = r2(last.startTime);
			paints.lcp_fp = fp_of(last.element);
			paints.lcp_url = last.url || undefined;
			paints.lcp_tag = last.element?.tagName?.toLowerCase();
			paints.lcp_lazy = last.element?.getAttribute?.('loading') === 'lazy' ? true : undefined;
			const pri = last.element?.getAttribute?.('fetchpriority');
			paints.lcp_priority = pri === 'high' || pri === 'low' ? pri : undefined;
			lcp_el = last.element ?? null;
			lcp_region = lcp_el?.closest('ogygia-region') ?? null;
			again();
		});
		if (supports('layout-shift')) vitals.cls = 0;
		watch('layout-shift', (es) => {
			for (const e of es) {
				if (e.hadRecentInput || typeof e.value !== 'number') continue;
				cls += e.value;
				if (room(shifts, 60, (s) => s.t)) {
					const src = e.sources?.[0];
					const tag = src?.node ? describe_target(src.node) : '';
					shifts.push({
						t: r2(e.startTime),
						value: Math.round(e.value * 10000) / 10000,
						...(src?.node ? { fp: fp_of(src.node) } : {}),
						...(tag ? { tag } : {}),
						...(src?.previousRect ? { from: rect_of(src.previousRect) } : {}),
						...(src?.currentRect ? { to: rect_of(src.currentRect) } : {})
					});
				}
			}
			vitals.cls = Math.round(cls * 1000) / 1000;
			again();
		});
		watch('event', (es) => {
			for (const e of es) {
				if (!e.interactionId) continue;
				const d = r2(e.duration);
				const same = interaction_id === e.interactionId;
				if (!same && vitals.inp !== undefined && d <= vitals.inp) continue;
				if (vitals.inp === undefined || d > vitals.inp) {
					vitals.inp = d;
					resend_soon();
				}
				const ps = e.processingStart ?? e.startTime;
				const pe = e.processingEnd ?? ps;
				const fold = same ? interaction_span : null;
				const span = (interaction_span = {
					start: fold ? Math.min(fold.start, e.startTime) : e.startTime,
					ps: fold ? Math.min(fold.ps, ps) : ps,
					pe: fold ? Math.max(fold.pe, pe) : pe,
					end: fold ? Math.max(fold.end, e.startTime + e.duration) : e.startTime + e.duration
				});
				interaction_id = e.interactionId;
				const named = !same || e.name === 'click' || e.name === 'keydown' ? e : null;
				const fp = named ? fp_of(e.target) : interaction?.fp;
				interaction = {
					name: named ? e.name : interaction!.name,
					t: r2(span.start),
					ms: r2(span.end - span.start),
					delay: r2(Math.max(0, span.ps - span.start)),
					processing: r2(Math.max(0, span.pe - span.ps)),
					presentation: r2(Math.max(0, span.end - span.pe)),
					target: named
						? describe_target(e.target) || interaction?.target || ''
						: interaction!.target,
					...(fp ? { fp } : {})
				};
			}
			if (interaction) interaction_seen(interaction);
		});
		watch('longtask', (es) => {
			for (const e of es)
				if (room(longtasks, 100, (l) => l.t))
					longtasks.push({ t: r2(e.startTime), ms: r2(e.duration) });
		});
		if (!supports('longtask')) watch_frame_gaps();
		watch('long-animation-frame', (es) => {
			for (const e of es) {
				again();
				const list = e.scripts ?? [];
				if (
					e.duration >= 50 &&
					scroll_times.some((s) => s >= e.startTime - 150 && s <= e.startTime + 50) &&
					room(scroll_jank, 20, (j) => j.start)
				)
					scroll_jank.push({
						start: r2(e.startTime),
						ms: r2(e.duration),
						scripts: list
							.slice()
							.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
							.slice(0, 2)
							.map((s) => ({
								url: (s.sourceURL ?? '').slice(0, 300),
								fn: (s.sourceFunctionName ?? '').slice(0, 80),
								invoker: (s.invoker ?? '').slice(0, 120),
								ms: r2(s.duration ?? 0)
							}))
					});
				for (const s of list)
					if ((s.forcedStyleAndLayoutDuration ?? 0) >= 5 && room(forced, 30, (f) => f.start)) {
						const start = s.startTime ?? e.startTime;
						forced.push({
							start: r2(start),
							end: r2(start + (s.duration ?? 0)),
							ms: r2(s.forcedStyleAndLayoutDuration ?? 0),
							url: (s.sourceURL ?? '').slice(0, 300),
							fn: (s.sourceFunctionName ?? '').slice(0, 80)
						});
					}
				frames.push({
					start: r2(e.startTime),
					end: r2(e.startTime + e.duration),
					scripts: list.slice(0, 8).map((s) => ({
						url: (s.sourceURL ?? '').slice(0, 300),
						fn: (s.sourceFunctionName ?? '').slice(0, 80),
						invoker: (s.invoker ?? '').slice(0, 120),
						start: r2(s.startTime ?? e.startTime),
						ms: r2(s.duration ?? 0),
						...((s.forcedStyleAndLayoutDuration ?? 0) >= 1
							? { forced: r2(s.forcedStyleAndLayoutDuration!) }
							: {})
					}))
				});
				if (frames.length > MAX_FRAMES) frames.shift();
				for (const s of list) {
					const url = s.sourceURL ?? '';
					if (!url || !(s.duration && s.duration > 0)) continue;
					const q = url.indexOf('?');
					const key = (q === -1 ? url : url.slice(0, q)).slice(0, 300);
					const cur = scripts.get(key);
					if (cur) {
						cur.ms += s.duration;
						cur.count++;
					} else if (scripts.size < 100) scripts.set(key, { ms: s.duration, count: 1 });
				}
			}
		});
		const note_input = (type: string) => (ev: Event) => {
			if (off || !(ev.target instanceof Element)) return;
			recent_inputs.push({ t: performance.now(), el: new WeakRef(ev.target), type });
			if (recent_inputs.length > 64) recent_inputs.shift();
		};
		const first_seen = new Set<string>();
		const first = (type: string) => (ev: Event) => {
			const fp = off ? undefined : fp_of(ev.target);
			if (!fp || first_seen.has(fp)) return;
			first_seen.add(fp);
			const at =
				ev.timeStamp > 0 && ev.timeStamp <= performance.now() ? ev.timeStamp : performance.now();
			firsts.push({ fp, t: r2(at), type });
		};
		const opts = { capture: true, passive: true };
		for (const type of ['pointerover', 'pointerdown', 'keydown', 'focusin'])
			// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: the document's, idle after stop()
			document.addEventListener(type, note_input(type), opts);
		// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: the document's, idle after stop()
		document.addEventListener('pointerdown', first('pointer'), opts);
		// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: the document's, idle after stop()
		document.addEventListener('keydown', first('key'), opts);
		// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: the document's, idle after stop()
		document.addEventListener(
			'scroll',
			() => {
				const t = performance.now();
				if (scroll_times.length && t - scroll_times[scroll_times.length - 1] < 50) return;
				scroll_times.push(t);
				if (scroll_times.length > 200) scroll_times.shift();
			},
			opts
		);
	}

	function watch_frame_gaps(): void {
		if (longtasks_from_frames || typeof requestAnimationFrame === 'undefined') return;
		longtasks_from_frames = true;
		let last = 0;
		const tick = (now: number) => {
			if (off) return;
			if (document.visibilityState !== 'visible') last = 0;
			else {
				const late = last ? now - last - FRAME_MS : 0;
				if (late > STALL_MS && room(longtasks, 100, (l) => l.t))
					longtasks.push({ t: r2(last + FRAME_MS), ms: r2(late) });
				last = now;
			}
			const loaded = nav_entry()?.loadEventEnd || 0;
			if (now >= 20000 || (loaded && now >= loaded + 3000)) return;
			// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: the frame watch ends itself a few seconds after load
			requestAnimationFrame(tick);
		};
		// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: the frame watch ends itself a few seconds after load
		requestAnimationFrame(tick);
	}

	function hold(bytes: number, settled?: Promise<unknown>): void {
		queued += bytes;
		const release = () => {
			queued = Math.max(0, queued - bytes);
		};
		if (settled) void settled.finally(release); // ok: settled never rejects (its catch is the post's)
		// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: one-shot, ends the task that sent the beacon
		else setTimeout(release, 0);
	}
	function post(body: string, keepalive: boolean): void {
		try {
			const settled = fetch(target!, {
				method: 'POST',
				body,
				keepalive,
				credentials: 'same-origin',
				headers: { 'content-type': 'text/plain' }
			}).catch(() => {}); // ok: a dropped beacon is a missing measurement, never a page error
			if (keepalive) hold(body.length, settled);
		} catch {
			// ok: no fetch in this browser: no beacon
		}
	}
	function send(body: string, slim?: () => string): void {
		if (!target) return;
		const left = KEEPALIVE_MAX - queued;
		if (body.length > left) {
			if (!leaving && document.visibilityState === 'visible') return post(body, false);
			const s = slim?.();
			if (!s || s.length > left) return;
			body = s;
		}
		try {
			if (navigator.sendBeacon?.(target, body)) return hold(body.length);
		} catch {
			// ok: no sendBeacon; the fetch below sends it
		}
		post(body, true);
	}

	function resource_type(r: PerformanceResourceTiming, link_as: Map<string, string>): string {
		const ext = ext_of(r.name);
		const by = r.initiatorType;
		if (FONT_EXT.includes(ext)) return 'font';
		if (ext === 'css') return 'css';
		if (ext === 'js' || ext === 'mjs') return 'script';
		if (IMG_EXT.includes(ext)) return 'img';
		if (by === 'link') {
			const as = link_as.get(r.name);
			return (as && LINK_AS[as]) || (as ? 'other' : 'css');
		}
		if (by === 'css' || by === 'script' || by === 'img') return by;
		if (by === 'fetch' || by === 'xmlhttprequest' || by === 'beacon') return 'fetch';
		return 'other';
	}
	function tool_made(r: PerformanceResourceTiming): boolean {
		if (r.initiatorType !== 'fetch') return false;
		const at = (g[Symbol.for('ogygia.tool-fetches')] as Map<string, number[]> | undefined)?.get(
			r.name
		);
		if (!at) return false;
		for (const t of at) if (r.startTime >= t - 1 && r.startTime - t < 1000) return true;
		return false;
	}
	function paint_blocker(): (r: PerformanceResourceTiming) => boolean {
		if (
			typeof PerformanceResourceTiming !== 'undefined' &&
			'renderBlockingStatus' in PerformanceResourceTiming.prototype
		)
			return (r) => (r as Resource).renderBlockingStatus === 'blocking';
		const head = new Set<string>();
		for (const el of document.head?.querySelectorAll('link[href],script[src]') ?? []) {
			const marked = (el.getAttribute('blocking') ?? '').split(' ').includes('render');
			if (el instanceof HTMLLinkElement) {
				if (!el.relList.contains('stylesheet') || el.disabled) continue;
				const media = el.media.trim();
				if (marked || !media || media === 'all' || matchMedia(media).matches) head.add(el.href);
			} else if (el instanceof HTMLScriptElement) {
				const type = el.type.trim().toLowerCase();
				const classic = !type || type === 'text/javascript' || type === 'application/javascript';
				if (marked || (classic && !el.async && !el.defer)) head.add(el.src);
			}
		}
		const parsed = nav_entry()?.domInteractive || Infinity;
		return (r) => head.has(r.name) && r.startTime < parsed;
	}

	function nav_phases(n: PerformanceNavigationTiming): { phases?: Record<string, number> } {
		const p: Record<string, number> = {};
		const put = (k: string, v: number) => {
			if (v > 0.5) p[k] = r2(v);
		};
		put('redirect', n.redirectEnd - n.redirectStart);
		if (n.workerStart > 0) put('worker', n.fetchStart - n.workerStart);
		put('dns', n.domainLookupEnd - n.domainLookupStart);
		const tls = n.secureConnectionStart > 0 ? n.connectEnd - n.secureConnectionStart : 0;
		put('connect', n.connectEnd - n.connectStart - tls);
		put('tls', tls);
		put('wait', n.responseStart - n.requestStart);
		return Object.keys(p).length ? { phases: p } : {};
	}

	function interaction_with_scripts(i: Interaction): Visit {
		const end = i.t + i.ms;
		const handlers_at = i.t + i.delay;
		const paint_at = handlers_at + i.processing;
		const out: Record<string, unknown>[] = [];
		for (const f of frames) {
			if (f.end < i.t || f.start > end) continue;
			for (const s of f.scripts) {
				if (s.start + s.ms < i.t || s.start > end || !(s.ms > 0)) continue;
				out.push({
					url: s.url,
					fn: s.fn,
					invoker: s.invoker,
					ms: s.ms,
					phase: s.start < handlers_at ? 'delay' : s.start <= paint_at ? 'handler' : 'paint',
					...(s.forced ? { forced: s.forced } : {})
				});
			}
		}
		out.sort((a, b) => (b.ms as number) - (a.ms as number));
		return out.length ? { ...i, scripts: out.slice(0, 6) } : { ...i };
	}

	function font_urls(src: string, base: string): string[] {
		const urls: string[] = [];
		let at = src.indexOf('url(');
		while (at !== -1) {
			const end = src.indexOf(')', at);
			if (end === -1) break;
			try {
				urls.push(new URL(unquote(src.slice(at + 4, end)), base).href);
			} catch {
				// ok: not a URL, so not a file the page loaded
			}
			at = src.indexOf('url(', end);
		}
		return urls;
	}
	function font_faces_of(
		fetched: Set<string>
	): { family: string; display: string; urls: string[] }[] {
		if (!fetched.size) return [];
		const key = [...fetched].join('\n');
		if (faces_memo?.key === key) return faces_memo.faces;
		const out: { family: string; display: string; urls: string[] }[] = [];
		faces_memo = { key, faces: out };
		for (const sheet of document.styleSheets) {
			let rules: CSSRuleList;
			try {
				rules = sheet.cssRules;
			} catch {
				continue; // ok: a cross-origin sheet cannot be read
			}
			for (const rule of rules) {
				if (out.length >= 12) return out;
				if (!(rule instanceof CSSFontFaceRule)) continue;
				const urls = font_urls(rule.style.getPropertyValue('src'), sheet.href ?? location.href)
					.map((u) => u.slice(0, 500))
					.filter((u) => fetched.has(u))
					.slice(0, 6);
				if (!urls.length) continue;
				out.push({
					family: unquote(rule.style.getPropertyValue('font-family')).slice(0, 80),
					display: rule.style.getPropertyValue('font-display').trim() || 'auto',
					urls
				});
			}
		}
		return out;
	}

	function oversized_images(): Visit[] {
		const out: Visit[] = [];
		const dpr = devicePixelRatio || 1;
		const imgs = document.images;
		for (let i = 0; i < imgs.length && i < 300 && out.length < 10; i++) {
			const img = imgs[i];
			if (!img.complete || !img.naturalWidth || !img.naturalHeight) continue;
			const url = img.currentSrc || img.src;
			if (!url || url.startsWith('data:')) continue;
			const q = url.indexOf('?');
			if ((q === -1 ? url : url.slice(0, q)).toLowerCase().endsWith('.svg')) continue;
			const w = img.clientWidth;
			const h = img.clientHeight;
			if (!w || !h) continue;
			if (img.naturalWidth * img.naturalHeight < w * h * dpr * dpr * 4) continue;
			const e = performance.getEntriesByName(url, 'resource')[0] as
				| PerformanceResourceTiming
				| undefined;
			const bytes = e ? e.encodedBodySize || e.transferSize : 0;
			if (bytes < 50000) continue;
			const fp = fp_of(img);
			out.push({
				url: url.slice(0, 500),
				natural: [img.naturalWidth, img.naturalHeight],
				shown: [w, h],
				dpr: r2(dpr),
				bytes,
				...(fp ? { fp } : {})
			});
		}
		return out;
	}

	function preloads_never_used(
		load_end: number
	): { url: string; as: string; bytes: number }[] | null {
		if (preloads_memo) return preloads_memo;
		if (!(load_end > 0) || performance.now() - load_end < 3000) return null;
		const out: { url: string; as: string; bytes: number }[] = [];
		const links = document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][href][as]');
		const css: string[] = [];
		let opaque = false;
		const faces = new Set<string>();
		let sheets_read = false;
		const read_sheets = () => {
			if (sheets_read) return;
			sheets_read = true;
			for (const sheet of document.styleSheets) {
				let rules: CSSRuleList;
				try {
					rules = sheet.cssRules;
				} catch {
					opaque = true;
					continue;
				}
				for (const rule of rules)
					if (rule instanceof CSSFontFaceRule)
						for (const u of font_urls(
							rule.style.getPropertyValue('src'),
							sheet.href ?? location.href
						))
							faces.add(u);
					else css.push(rule.cssText);
			}
		};
		for (let i = 0; i < links.length && i < 30; i++) {
			const l = links[i];
			const as = l.getAttribute('as') ?? '';
			if ((as !== 'image' && as !== 'font' && as !== 'style') || l.hasAttribute('imagesrcset'))
				continue;
			const url = l.href;
			const e = performance.getEntriesByName(url, 'resource')[0] as
				| PerformanceResourceTiming
				| undefined;
			if (!e) continue;
			const raw = l.getAttribute('href') ?? url;
			let used = false;
			if (as === 'style') {
				for (const s of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'))
					if (s.href === url) used = true;
			} else if (as === 'image') {
				for (const img of document.images)
					if (img.currentSrc === url || img.src === url || (img.srcset && img.srcset.includes(raw)))
						used = true;
				if (!used)
					for (const s of document.querySelectorAll('source[srcset]'))
						if ((s.getAttribute('srcset') ?? '').includes(raw)) used = true;
				if (!used) {
					read_sheets();
					used = opaque || css.some((t) => t.includes(url) || t.includes(raw));
				}
			} else {
				read_sheets();
				used = opaque || faces.has(url);
			}
			if (!used)
				out.push({ url: url.slice(0, 500), as, bytes: e.encodedBodySize || e.transferSize || 0 });
		}
		preloads_memo = out;
		return out;
	}

	function dom_shape(): DomShape | null {
		const n = document.getElementsByTagName('*').length;
		if (dom_memo?.n === n) return dom_memo.shape;
		let shape: DomShape | null = null;
		if (n >= 60000)
			shape = { nodes: n, depth: 0, deepest: '', widest: { at: '', children: 0 }, islands: [] };
		else if (n >= 1500) {
			const brief = (el: Element) => {
				let c = '';
				for (const x of el.classList)
					if (!x.startsWith('svelte-')) {
						c = x;
						break;
					}
				return `${el.tagName.toLowerCase()}${el.id ? `#${el.id.slice(0, 30)}` : c ? `.${c.slice(0, 30)}` : ''}`;
			};
			let depth = 0;
			const root = document.documentElement;
			let deepest: Element = root;
			let widest: Element = root;
			let widest_n = root.childElementCount;
			let el: Element | null = root;
			let d = 1;
			while (el) {
				if (d > depth) {
					depth = d;
					deepest = el;
				}
				if (el.childElementCount > widest_n) {
					widest_n = el.childElementCount;
					widest = el;
				}
				const child: Element | null = el.firstElementChild;
				if (child) {
					el = child;
					d++;
					continue;
				}
				while (el && el !== root && !el.nextElementSibling) {
					el = el.parentElement;
					d--;
				}
				el = el && el !== root ? el.nextElementSibling : null;
			}
			const islands: { fp: string; nodes: number }[] = [];
			for (const r of document.querySelectorAll(ISLAND_SEL)) {
				// oxlint-disable-next-line ogygia/markup-from-vocabulary -- inlined through toString(): it names nothing outside itself
				const fp = r.getAttribute('data-og-fp');
				if (fp) islands.push({ fp, nodes: r.getElementsByTagName('*').length });
			}
			islands.sort((a, b) => b.nodes - a.nodes);
			shape = {
				nodes: n,
				depth,
				deepest: brief(deepest),
				widest: { at: brief(widest), children: widest_n },
				islands: islands.slice(0, 3)
			};
		}
		dom_memo = { n, shape };
		return shape;
	}

	function images_unsized(): string[] {
		const out: string[] = [];
		const imgs = document.images;
		for (let i = 0; i < imgs.length && i < 300 && out.length < 8; i++) {
			const img = imgs[i];
			if (img.hasAttribute('width') && img.hasAttribute('height')) continue;
			if (!img.getClientRects().length) continue;
			if (getComputedStyle(img).aspectRatio !== 'auto') continue;
			const src = img.currentSrc || img.src;
			if (src && !src.startsWith('data:')) out.push(src.slice(0, 300));
		}
		return out;
	}

	function images_eager_below(load_end: number): Visit[] {
		const out: Visit[] = [];
		const fold = innerHeight * 1.5;
		const imgs = document.images;
		for (let i = 0; i < imgs.length && i < 300 && out.length < 10; i++) {
			const img = imgs[i];
			if (img.loading === 'lazy') continue;
			const url = img.currentSrc || img.src;
			if (!url || url.startsWith('data:')) continue;
			const r = img.getBoundingClientRect();
			if (!r.width || !r.height) continue;
			const top = Math.round(r.top + scrollY);
			if (top < fold) continue;
			const e = performance.getEntriesByName(url, 'resource')[0] as
				| PerformanceResourceTiming
				| undefined;
			if (!e || (load_end > 0 && e.startTime > load_end)) continue;
			const bytes = e.encodedBodySize || e.transferSize || 0;
			if (bytes < 20000) continue;
			const fp = fp_of(img);
			out.push({ url: url.slice(0, 500), top, bytes, ...(fp ? { fp } : {}) });
		}
		return out;
	}

	function unsupported_types(): { unsupported?: string[] } {
		let types: readonly string[] = [];
		try {
			types = PerformanceObserver.supportedEntryTypes ?? [];
		} catch {
			return { unsupported: MEASURED_TYPES.slice() };
		}
		const missing = MEASURED_TYPES.filter((t) => !types.includes(t));
		return missing.length ? { unsupported: missing } : {};
	}

	function build_visit(): Visit | null {
		const c0 = performance.now();
		try {
			return build_visit_now();
		} finally {
			charge('visit', c0);
		}
	}
	function build_visit_now(): Visit | null {
		const nav = nav_entry();
		if (!nav || !(nav.responseEnd > 0 || nav.domInteractive > 0)) return null;
		const start_hidden = !(nav.responseStart > 0);
		const link_as = new Map<string, string>();
		const link_co = new Map<string, string | null>();
		try {
			for (const l of document.querySelectorAll<HTMLLinkElement>(
				'link[href][as], link[rel="modulepreload"][href]'
			)) {
				link_as.set(l.href, l.getAttribute('as') ?? 'script');
				link_co.set(l.href, l.getAttribute('crossorigin'));
			}
		} catch {
			// ok: no document: nothing of it to read
		}
		const type_of = (r: PerformanceResourceTiming) => resource_type(r, link_as);
		const preload_misses: Visit[] = [];
		let resources: Visit[] = [];
		const refetched: Visit[] = [];
		const totals = new Map<
			string,
			{ type: string; count: number; transfer: number; size: number }
		>();
		let all_n = 0;
		const uncompressed: { url: string; type: string; bytes: number }[] = [];
		const raw_seen = new Set<string>();
		try {
			const listed = seen.length
				? seen
				: (performance.getEntriesByType('resource') as PerformanceResourceTiming[]);
			const all = listed.filter((r) => !r.name.includes('/__profiler/') && !tool_made(r));
			all_n = all.length;
			for (const r of all) {
				const type = type_of(r);
				const t = totals.get(type) ?? { type, count: 0, transfer: 0, size: 0 };
				t.count++;
				t.transfer += r.transferSize || 0;
				t.size += r.decodedBodySize || 0;
				totals.set(type, t);
				if (
					r.decodedBodySize >= UNCOMPRESSED_MIN &&
					r.encodedBodySize >= r.decodedBodySize &&
					!raw_seen.has(r.name) &&
					(type === 'script' ||
						type === 'style' ||
						TEXT_EXT.includes(ext_of(r.name)) ||
						r.initiatorType === 'fetch' ||
						r.initiatorType === 'xmlhttprequest')
				) {
					raw_seen.add(r.name);
					uncompressed.push({ url: r.name.slice(0, 500), type, bytes: r.decodedBodySize });
				}
			}
			uncompressed.sort((a, b) => b.bytes - a.bytes);
			uncompressed.length = Math.min(uncompressed.length, MAX_UNCOMPRESSED);
			const by_url = new Map<string, PerformanceResourceTiming[]>();
			for (const r of all) (by_url.get(r.name) ?? by_url.set(r.name, []).get(r.name)!).push(r);
			for (const [url, list] of by_url) {
				if (list.length < 2 || preload_misses.length >= 20) continue;
				const pre = list.find((r) => r.initiatorType === 'link');
				const again_ = list.find(
					(r) =>
						r !== pre &&
						r.initiatorType !== 'link' &&
						r.encodedBodySize > 0 &&
						r.transferSize >= r.encodedBodySize
				);
				if (((pre as Resource | undefined)?.responseStatus ?? 0) >= 400) continue;
				if (pre && again_)
					preload_misses.push({
						url: url.slice(0, 500),
						type: type_of(pre),
						bytes: again_.transferSize,
						as: link_as.get(url) ?? '',
						crossorigin: link_co.get(url) ?? null
					});
			}
			const reload = nav.type === 'reload';
			const origin = location.origin;
			const entry_of = new Map<string, { entry: string; hole?: string }>();
			for (const el of document.querySelectorAll('ogygia-region[src][entry]')) {
				try {
					const host = el.parentElement?.closest('ogygia-region[endpoint]');
					const hole = host
						? (new URL(host.getAttribute('endpoint')!, location.href).searchParams.get('id') ?? '')
						: '';
					entry_of.set(new URL(el.getAttribute('src')!, document.baseURI).href, {
						entry: el.getAttribute('entry')!,
						...(hole ? { hole: hole.slice(0, 40) } : {})
					});
				} catch {
					// ok: not a URL, so not a file the page loaded
				}
			}
			const runtime_src =
				// oxlint-disable-next-line ogygia/markup-from-vocabulary -- inlined through toString(): it names nothing outside itself
				(document.querySelector('script[data-ogygia-runtime]') as HTMLScriptElement | null)?.src ??
				'';
			const counted = new Set<string>();
			for (const r of all) {
				if (
					refetched.length >= MAX_REFETCHED ||
					counted.has(r.name) ||
					!r.name.startsWith(origin) ||
					!r.name.includes('/immutable/')
				)
					continue;
				const body = r.encodedBodySize;
				if (!(r.transferSize > 0)) continue;
				const how =
					body === 0 || r.transferSize < body ? 'revalidated' : reload ? 'downloaded' : null;
				if (!how) continue;
				counted.add(r.name);
				const region = entry_of.get(r.name);
				refetched.push({
					url: r.name.slice(0, 500),
					how,
					bytes: body,
					ms: r2(r.duration),
					...(region
						? { entry: region.entry.slice(0, 300), ...(region.hole ? { hole: region.hole } : {}) }
						: {}),
					...(r.name === runtime_src ? { runtime: true } : {})
				});
			}
			const blocking = paint_blocker();
			const keep_list = all.filter(blocking).slice(0, MAX_DETAIL_RESOURCES);
			const lcp_res = paints.lcp_url ? all.find((r) => r.name === paints.lcp_url) : undefined;
			if (lcp_res && !keep_list.includes(lcp_res)) keep_list.push(lcp_res);
			const kept = new Set(keep_list);
			for (const pass of [false, true])
				for (const r of all) {
					if (keep_list.length >= MAX_DETAIL_RESOURCES) break;
					if (kept.has(r) || (type_of(r) === 'script') !== pass) continue;
					kept.add(r);
					keep_list.push(r);
				}
			keep_list.sort((a, b) => a.startTime - b.startTime);
			resources = keep_list.map((r) => ({
				url: r.name.slice(0, 500),
				type: type_of(r),
				start: r2(r.startTime),
				end: r2(r.responseEnd || r.startTime + r.duration),
				...(r.requestStart ? { req_start: r2(r.requestStart) } : {}),
				...(r.responseStart ? { res_start: r2(r.responseStart) } : {}),
				...(r.transferSize ? { transfer: r.transferSize } : {}),
				...(r.decodedBodySize ? { size: r.decodedBodySize } : {}),
				...(blocking(r) ? { blocking: true } : {})
			}));
		} catch {
			resources = [];
		}
		let fonts: { family: string; display: string; urls: string[] }[] = [];
		let oversized: Visit[] = [];
		let dom: DomShape | null = null;
		let wasted: { url: string; as: string; bytes: number }[] | null = null;
		let below: Visit[] = [];
		let unsized: string[] | null = null;
		try {
			fonts = font_faces_of(
				new Set(resources.filter((r) => r.type === 'font').map((r) => r.url as string))
			);
			oversized = oversized_images();
			below = images_eager_below(nav.loadEventEnd);
			unsized = images_unsized();
			dom = dom_shape();
			wasted = preloads_never_used(nav.loadEventEnd);
		} catch {
			// ok: no document: nothing of it to read
		}
		const { held, ...regions } = part?.visit() ?? { islands: [] };
		const dock_open_at = g[Symbol.for('ogygia.dock-open-at')];
		return {
			at: Math.round(performance.timeOrigin),
			origin: location.origin,
			...unsupported_types(),
			nav: {
				...(start_hidden
					? { start_hidden: true }
					: { req_start: r2(nav.requestStart), res_start: r2(nav.responseStart) }),
				...(nav.responseEnd > 0 ? { res_end: r2(nav.responseEnd) } : {}),
				...(nav.domInteractive ? { dom_interactive: r2(nav.domInteractive) } : {}),
				...(nav.domContentLoadedEventEnd ? { dcl: r2(nav.domContentLoadedEventEnd) } : {}),
				...(nav.loadEventEnd ? { load: r2(nav.loadEventEnd) } : {}),
				...(nav.transferSize ? { transfer: nav.transferSize } : {}),
				...(nav.decodedBodySize ? { size: nav.decodedBodySize } : {}),
				...(nav.decodedBodySize >= UNCOMPRESSED_MIN && nav.encodedBodySize >= nav.decodedBodySize
					? { raw: true }
					: {}),
				...(nav.nextHopProtocol ? { protocol: nav.nextHopProtocol } : {}),
				...nav_phases(nav),
				...(nav.serverTiming?.length
					? {
							server_timing: nav.serverTiming.slice(0, 8).map((s) => ({
								name: s.name.slice(0, 40),
								ms: r2(s.duration),
								...(s.description ? { desc: s.description.slice(0, 80) } : {})
							}))
						}
					: {})
			},
			paints: {
				...paints,
				...(lcp_el && !lcp_el.isConnected && lcp_region?.isConnected
					? { lcp_replaced: true as const }
					: {}),
				...(held ? { held } : {})
			},
			resources,
			...(all_n > resources.length
				? { resource_totals: [...totals.values()], resources_all: all_n }
				: {}),
			...(preload_misses.length ? { preload_misses } : {}),
			...(uncompressed.length ? { uncompressed } : {}),
			...(fonts.length ? { font_faces: fonts } : {}),
			...(oversized.length ? { images_oversized: oversized } : {}),
			...(dom ? { dom } : {}),
			...(wasted?.length ? { preloads_unused: wasted } : {}),
			...(below.length ? { images_eager_below: below } : {}),
			...(unsized ? { images_unsized: unsized } : {}),
			...(forced.length ? { forced_layout: forced.slice() } : {}),
			...(scroll_jank.length ? { scroll_jank: scroll_jank.slice() } : {}),
			...(refetched.length ? { refetched } : {}),
			longtasks: longtasks.slice(),
			...(longtasks_from_frames ? { longtasks_from: 'frames' } : {}),
			firsts: firsts.slice(),
			shifts: shifts.slice(),
			...(interaction ? { interaction: interaction_with_scripts(interaction) } : {}),
			...(scripts.size
				? {
						scripts: [...scripts]
							.map(([url, s]) => ({ url, ms: r2(s.ms), count: s.count }))
							.sort((a, b) => b.ms - a.ms)
							.slice(0, 50)
					}
				: {}),
			...regions,
			...(visit_marks.length ? { marks: visit_marks.slice() } : {}),
			...(Object.keys(vitals).length ? { vitals: { ...vitals } } : {}),
			viewport: [innerWidth, innerHeight],
			ua: navigator.userAgent.slice(0, 200),
			...(typeof dock_open_at === 'number' ? { dock_open_at: r2(dock_open_at) } : {})
		};
	}

	function open_db(): Promise<IDBDatabase | null> {
		return new Promise((resolve) => {
			try {
				const req = indexedDB.open('ogygia-profiler', 1);
				req.onupgradeneeded = () => {
					const db = req.result;
					if (!db.objectStoreNames.contains('reports'))
						db.createObjectStore('reports', { keyPath: 'id' });
					if (!db.objectStoreNames.contains('visits'))
						db.createObjectStore('visits', { keyPath: 'key' });
				};
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => resolve(null);
				req.onblocked = () => resolve(null);
			} catch {
				resolve(null);
			}
		});
	}
	type Stored = {
		key: string;
		page: string;
		at: number;
		visit: Visit;
		snapshots: { fp: string }[];
	};
	async function store_visit(rec: Stored): Promise<void> {
		const db = await open_db();
		if (!db) return;
		try {
			const tx = db.transaction('visits', 'readwrite');
			const store = tx.objectStore('visits');
			const prior = store.get(rec.key);
			prior.onsuccess = () => {
				const old = prior.result as Stored | undefined;
				if (old) {
					const union = <T>(
						xs: T[] | undefined,
						ys: T[] | undefined,
						key: (x: T) => string
					): T[] => {
						const m = new Map<string, T>();
						for (const x of xs ?? []) m.set(key(x), x);
						for (const y of ys ?? []) m.set(key(y), y);
						return [...m.values()];
					};
					const ov = old.visit;
					const nv = rec.visit;
					const arr = (o: unknown) => (Array.isArray(o) ? (o as Visit[]) : []);
					rec = {
						...rec,
						visit: {
							...ov,
							...nv,
							nav: { ...(ov.nav as object), ...(nv.nav as object) },
							paints: { ...(ov.paints as object), ...(nv.paints as object) },
							islands: union(arr(ov.islands), arr(nv.islands), (i) => `${i.fp}|${i.t0}`),
							firsts: union(arr(ov.firsts), arr(nv.firsts), (f) => String(f.fp)),
							shifts: union(arr(ov.shifts), arr(nv.shifts), (s) => `${s.t}|${s.value}`),
							longtasks: union(arr(ov.longtasks), arr(nv.longtasks), (l) => `${l.t}|${l.ms}`),
							marks: union(arr(ov.marks), arr(nv.marks), (m) => `${m.name}|${m.t0 ?? ''}|${m.ms}`),
							resources:
								arr(nv.resources).length >= arr(ov.resources).length ? nv.resources : ov.resources
						},
						snapshots: union(old.snapshots, rec.snapshots, (s) => s.fp)
					};
				}
				store.put(rec);
				const keys = store.getAllKeys();
				keys.onsuccess = () => {
					const all = (keys.result as string[]).sort();
					for (const k of all.slice(0, Math.max(0, all.length - 30))) store.delete(k);
				};
			};
		} catch {
			// ok: no IndexedDB here: the visit is not kept in this browser
		}
	}

	function flush_visit(final: boolean): void {
		if (visit_state === 'sent' || off) return;
		const visit = build_visit();
		if (!visit || !target) return;
		send(JSON.stringify({ page: landing, visit }), () => {
			const no_files = JSON.stringify({ page: landing, visit: { ...visit, resources: [] } });
			return no_files.length <= KEEPALIVE_MAX - queued
				? no_files
				: JSON.stringify({
						page: landing,
						visit: { ...visit, resources: [], regions: [], islands: [] }
					});
		});
		void store_visit({
			key: `${landing}|${visit.at}`,
			page: landing,
			at: visit.at as number,
			visit,
			snapshots: part?.snapshots(final) ?? []
		}); // ok: never rejects (a browser store it cannot open keeps nothing)
	}

	function make_profiler(): SelfProfiler | null {
		if (!g.Profiler) {
			cpu_off = 'unsupported';
			return null;
		}
		try {
			return new g.Profiler({ sampleInterval: 10, maxBufferSize: 30000 });
		} catch {
			cpu_off = 'no-policy';
			return null;
		}
	}
	function keep_trace(k: CpuKept): void {
		if (keep) cpu_kept = [k, ...cpu_kept.slice(0, 4)];
	}
	function post_trace(body: string, hiding: boolean): void {
		if (!target) return;
		const keepalive = hiding && body.length <= KEEPALIVE_MAX - queued;
		if (hiding && !keepalive) return;
		post(body, keepalive);
	}

	function start_cpu(): void {
		if (cpu || cpu_sent) return;
		cpu = make_profiler();
		if (!cpu) return;
		cpu_started_at = performance.now();
		const check = () => {
			const now = performance.now();
			if ((part?.waking(now) ?? false) && now - cpu_started_at < CPU_WINDOW_MAX_MS)
				// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: the load trace's check ends itself at the cap
				setTimeout(check, CPU_QUIET_MS);
			else void flush_cpu(false); // ok: never rejects (a sampler that cannot stop has no trace)
		};
		// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: the load trace's check ends itself at the cap
		setTimeout(check, CPU_WINDOW_MS);
	}
	async function flush_cpu(hiding: boolean): Promise<void> {
		if (!cpu || cpu_sent) return;
		const p = cpu;
		cpu = null;
		cpu_sent = true;
		let trace: unknown;
		try {
			trace = await p.stop();
		} catch {
			return;
		}
		if (off || !trace) return;
		keep_trace({ trace, from: cpu_started_at, to: performance.now(), label: 'page load' });
		if (!hiding) start_interaction_cpu();
		post_trace(JSON.stringify({ page: landing, cpu: trace }), hiding);
	}
	function start_interaction_cpu(): void {
		if (icpu || icpu_done || off) return;
		icpu = make_profiler();
		if (!icpu) return;
		// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: the interaction trace's cap, cleared as it stops
		icpu_timer = setTimeout(() => void stop_interaction_cpu(false), ICPU_MAX_MS); // ok: never rejects
	}
	function interaction_seen(i: Interaction): void {
		if (!icpu || icpu_caught || i.ms < ICPU_SLOW_MS) return;
		const handlers_at = i.t + i.delay;
		icpu_caught = {
			t: i.t,
			wait: [i.t, handlers_at],
			handler: [handlers_at, handlers_at + i.processing]
		};
		if (icpu_timer) clearTimeout(icpu_timer);
		// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: the interaction trace's end, cleared as it stops
		icpu_timer = setTimeout(() => void stop_interaction_cpu(false), 300); // ok: never rejects
	}
	async function stop_interaction_cpu(hiding: boolean): Promise<void> {
		if (!icpu) return;
		const p = icpu;
		icpu = null;
		icpu_done = true;
		if (icpu_timer) clearTimeout(icpu_timer);
		icpu_timer = null;
		let trace: unknown;
		try {
			trace = await p.stop();
		} catch {
			return;
		}
		let caught = icpu_caught;
		if (off || !trace || !caught) return;
		const i = interaction;
		if (i && i.t === caught.t) {
			const handlers_at = i.t + i.delay;
			caught = {
				t: i.t,
				wait: [i.t, handlers_at],
				handler: [handlers_at, handlers_at + i.processing]
			};
		}
		keep_trace({
			trace,
			from: caught.wait[0],
			to: caught.handler[1],
			label: 'interaction',
			spans: caught
		});
		post_trace(JSON.stringify({ page: landing, cpu: trace, interaction: caught }), hiding);
	}

	function flush(): void {
		const c0 = performance.now();
		scheduled = false;
		if (samples.length || marks.length) {
			send(
				JSON.stringify({
					page: location.pathname,
					...(samples.length ? { islands: samples.splice(0, 400) } : {}),
					...(marks.length ? { marks: marks.splice(0, 400) } : {})
				})
			);
		}
		if (!early_done) {
			early_done = true;
			flush_visit(false);
			send_after_preload_check();
		}
		charge('send', c0);
	}
	function schedule(): void {
		if (scheduled || off) return;
		scheduled = true;
		// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: one queued send that ends itself
		if (g.requestIdleCallback) g.requestIdleCallback(flush, { timeout: 2000 });
		// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: one queued send that ends itself
		else setTimeout(flush, 1500);
	}
	function send_after_preload_check(): void {
		try {
			if (
				!document.querySelector(
					'link[rel="preload"][as="image"]:not([imagesrcset]), link[rel="preload"][as="font"], link[rel="preload"][as="style"]'
				)
			)
				return;
			if (document.readyState === 'complete')
				// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: once per document, a one-shot whose re-send is the visit's own
				setTimeout(
					resend_soon,
					Math.max(0, 1700 - (performance.now() - (nav_entry()?.loadEventEnd ?? 0)))
				);
			// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: once per document, a one-shot whose re-send is the visit's own
			else addEventListener('load', () => setTimeout(resend_soon, 1700), { once: true });
		} catch {
			// ok: no document: nothing of it to read
		}
	}

	function hide(): void {
		if (off) return;
		leaving = true;
		try {
			flush();
			if (visit_state !== 'sent') {
				clearTimeout(resend);
				resend = undefined;
				if (Object.keys(vitals).length)
					send(JSON.stringify({ page: landing, at: Math.round(performance.timeOrigin), vitals }));
				flush_visit(true);
				visit_state = 'sent';
			}
		} finally {
			leaving = false;
		}
		void flush_cpu(true); // ok: never rejects (a sampler that cannot stop has no trace)
		void stop_interaction_cpu(true); // ok: never rejects (a sampler that cannot stop has no trace)
	}
	function show(): void {
		if (visit_state === 'sent') visit_state = 'reopened';
	}

	function beacon_mark(
		name: string,
		ms: number,
		attrs?: Record<string, string | number | boolean>,
		t0?: number
	): void {
		if (off || !name || visit_marks.length >= 400) return;
		const m = {
			name: String(name).slice(0, 120),
			ms: Math.max(0, r2(ms)),
			...(t0 !== undefined ? { t0: r2(t0) } : {})
		};
		if (target && marks.length < 400) marks.push({ ...m, ...(attrs ? { attrs } : {}) });
		visit_marks.push(m);
		schedule();
	}

	function stop(): void {
		off = true;
		clearTimeout(resend);
		for (const o of observers) {
			try {
				o.disconnect();
			} catch {
				// ok: already disconnected
			}
		}
		for (const p of [cpu, icpu]) {
			try {
				p?.stop().catch(() => {}); // ok: the beacon is ending; its trace is not wanted
			} catch {
				// ok: already stopped
			}
		}
		cpu = icpu = null;
		if (icpu_timer) clearTimeout(icpu_timer);
		if (g[KEY] === api) delete g[KEY];
	}

	const api: PageBeacon = {
		sends: !!target,
		beacon_mark,
		join(p) {
			part = p;
		},
		hydrated(sample) {
			if (sample && target) samples.push(sample);
			schedule();
		},
		changed(always) {
			if (always) resend_soon();
			else again();
		},
		shift(s) {
			if (room(shifts, 60, (x) => x.t)) shifts.push(s);
			again();
		},
		room,
		nav_at(t) {
			first_nav_t ??= t;
		},
		input_on(el, from, to) {
			for (let k = recent_inputs.length - 1; k >= 0; k--) {
				const x = recent_inputs[k];
				if (x.t < from) break;
				const t = x.el.deref();
				if (x.t <= to && t && el.contains(t)) return x.type;
			}
			return undefined;
		},
		bare,
		attr_changes,
		copy_of,
		page() {
			return {
				vitals: { ...vitals },
				visit: build_visit(),
				firsts: firsts.slice(),
				shifts: shifts.slice(),
				longtasks: longtasks.slice(),
				...(longtasks_from_frames ? { longtasks_from: 'frames' as const } : {}),
				marks: visit_marks.slice(),
				cpu: {
					state: cpu ? 'recording' : cpu_kept.length ? 'done' : 'off',
					off: cpu_off,
					traces: cpu_kept.slice()
				}
			};
		},
		async record_cpu(ms, label) {
			if (!keep) return false;
			const p = make_profiler();
			if (!p) return false;
			const from = performance.now();
			// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: the recording's length, inside the caller's await
			await new Promise((ok) => setTimeout(ok, Math.max(200, Math.min(30000, ms))));
			try {
				keep_trace({ trace: await p.stop(), from, to: performance.now(), label });
				return true;
			} catch {
				return false;
			}
		},
		keep_traces() {
			keep = true;
		},
		send(body, slim, hiding) {
			leaving = !!hiding;
			try {
				send(body, slim);
			} finally {
				leaving = false;
			}
		},
		stop,
		state() {
			return { target, queued: samples.length, marks: marks.length, scheduled };
		}
	};
	g[KEY] = api;

	observe();
	start_cpu();
	// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: the document's hide and show, idle after stop()
	document.addEventListener('visibilitychange', () =>
		document.visibilityState === 'hidden' ? hide() : show()
	);
	// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: the document's hide, idle after stop()
	addEventListener('pagehide', hide);
	// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: the document's back/forward restore, idle after stop()
	addEventListener('pageshow', (e) => e.persisted && show());
	const waiting = g[WAITING_KEY] as Parameters<typeof beacon_mark>[] | undefined;
	delete g[WAITING_KEY];
	if (waiting) for (const args of waiting) beacon_mark(...args);
	if (document.readyState === 'loading')
		// oxlint-disable-next-line ogygia/owned-effects -- inline script, no imports: once, the early visit's start
		document.addEventListener('DOMContentLoaded', schedule, { once: true });
	else schedule();
}

/** @internal tests: a fresh page beacon in place of the one there */
export function _restart_page_beacon(): PageBeacon {
	const g = globalThis as unknown as Record<symbol, PageBeacon | undefined>;
	g[Symbol.for('ogygia.beacon')]?.stop();
	standalone_beacon();
	return g[Symbol.for('ogygia.beacon')]!;
}
