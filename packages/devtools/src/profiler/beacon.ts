/**
 * THE REGIONS' HALF OF THE PAGE BEACON. The page beacon (beacon-standalone.ts, an inline script the
 * profiler and the devtools put in a measured document) owns the page: vitals, long tasks, CPU, marks
 * and the visit. This half hears the runtime through its hooks and adds what only the runtime knows:
 * each region's wake, its markup before and after hydration, failures, holes, navigations, warnings,
 * entry fallbacks and the critical wait. It joins the page beacon at boot; without one on the page
 * (a visitor), every call is a no-op.
 */
import { OG_FP, OG_HEALED, OG_RECOVERED, type AttrChange } from '@ogygia/core/internal/instruments';
import type {
	CriticalOutcome,
	CriticalSettledEvent,
	EntryFallbackEvent,
	HoleRefusal,
	NavigatedEvent,
	WarningEvent
} from '@ogygia/core/plugin/client';
import type { CpuKept, PageBeacon, PagePart, PageShift, RegionPart } from './beacon-standalone.ts';

export type { CpuKept };

/** A hole whose answer never came, as the visit reports it. */
export interface HoleFailed {
	id: string;
	reason: HoleRefusal | 'error';
	final_path?: string;
	message?: string;
	attempts: number;
	t: number;
}

/** A batch request that carried fewer holes than it was sent for, as the visit reports it. */
export interface HoleBatchMiss {
	sent: number;
	delivered: number;
	status: number;
	refused?: 'redirected' | 'document';
	final_url?: string;
	ids: string[];
}

export interface HoleAnswered {
	id: string;
	n: number;
	start: number;
	t: number;
	below_fold: boolean;
	left?: number;
	first?: number;
	end?: number;
	queue?: number;
	render?: number;
	batch?: number;
	p?: string;
}

interface VisitIslandRec {
	fp: string;
	entry?: string;
	t0: number;
	loaded: number;
	turn?: number;
	done: number;
	fx?: number;
	recovered?: boolean;
	changed?: boolean;
	attrs?: AttrChange[];
	input?: string;
	healed?: boolean;
	ssr_bytes?: number;
	markers?: [number, number];
}

/** An island's markup as the server sent it, after it hydrated, and at the visit's end. A big
 *  island keeps only the window around where the two first differ, without comments (`from`). */
export interface Snapshot {
	fp: string;
	ssr: string;
	hydrated: string;
	final?: string;
	from?: number;
}

const PAGE_KEY = Symbol.for('ogygia.beacon');
const REGIONS_KEY = Symbol.for('ogygia.beacon.regions');
const OWN_COST_KEY = Symbol.for('ogygia.own-cost');
const SNAPSHOT_CAP = 24_000;
const MAX_SNAPSHOTS = 40;
const CPU_QUIET_MS = 1500;
const r2 = (n: number) => Math.round(n * 100) / 100;

let visit_islands: VisitIslandRec[] = [];
let snapshots: Snapshot[] = [];
let snapshot_firsts = 0;
let navs_seen = false;
let visit_navs: NavOut[] = [];
let visit_warnings: { code: string; message: string; file?: string; fp?: string; t: number }[] = [];
let visit_holes_failed: HoleFailed[] = [];
let visit_holes_answered: HoleAnswered[] = [];
let holes_answered_els = new WeakSet<Element>();
let visit_hole_batches: HoleBatchMiss[] = [];
let visit_entry_fallbacks: EntryFallbackEvent[] = [];
let critical_held: { outcome: CriticalOutcome; resources: number; waited_ms: number } | null = null;
const failed_fps = new Map<string, string>();
const failed_spans = new Map<string, [number, number]>();
const failed_turns = new Map<string, number>();
let island_boxes: WeakMap<Element, { top: number; height: number }> | null = null;

type NavOut = Omit<NavigatedEvent, 'href' | 'reconciled'> & {
	server?: number;
	download?: number;
	bytes?: number;
	prefetched?: true;
};

/** The hooks this half answers, as a second copy on the page hands them to the first. */
interface RegionsApi {
	beacon_hydrated: typeof beacon_hydrated;
	beacon_failed: typeof beacon_failed;
	beacon_warning: typeof beacon_warning;
	beacon_hole_failed: typeof beacon_hole_failed;
	beacon_hole_answered: typeof beacon_hole_answered;
	beacon_hole_batch_missed: typeof beacon_hole_batch_missed;
	beacon_entry_fallback: typeof beacon_entry_fallback;
	beacon_nav: typeof beacon_nav;
	beacon_critical: typeof beacon_critical;
	beacon_page: typeof beacon_page;
}
type PageGlobals = { [PAGE_KEY]?: PageBeacon; [REGIONS_KEY]?: RegionsApi };
let self_api: RegionsApi | undefined;

/** the page beacon, when the document carries one */
function page(): PageBeacon | undefined {
	return (globalThis as PageGlobals)[PAGE_KEY];
}
/** the page's owning copy of this half when it is not this one, else null */
function owner(): RegionsApi | null {
	self_api ??= {
		beacon_hydrated,
		beacon_failed,
		beacon_warning,
		beacon_hole_failed,
		beacon_hole_answered,
		beacon_hole_batch_missed,
		beacon_entry_fallback,
		beacon_nav,
		beacon_critical,
		beacon_page
	};
	const o = ((globalThis as PageGlobals)[REGIONS_KEY] ??= self_api);
	return o === self_api ? null : o;
}

export function beacon_warning(w: WarningEvent): void {
	const o = owner();
	if (o) return o.beacon_warning(w);
	const p = page();
	if (!p || !p.room(visit_warnings, 50, (x) => x.t)) return;
	visit_warnings.push(w);
	p.changed();
}

export function beacon_hole_failed(h: HoleFailed): void {
	const o = owner();
	if (o) return o.beacon_hole_failed(h);
	const p = page();
	if (!p || visit_holes_failed.length >= 30 || visit_holes_failed.some((x) => x.id === h.id))
		return;
	visit_holes_failed.push(h);
	p.changed();
}

export function beacon_hole_batch_missed(
	m: Omit<HoleBatchMiss, 'ids'> & { endpoints: readonly string[] }
): void {
	const o = owner();
	if (o) return o.beacon_hole_batch_missed(m);
	const p = page();
	if (!p || visit_hole_batches.length >= 10) return;
	const ids: string[] = [];
	for (const e of m.endpoints.slice(0, 32)) {
		try {
			ids.push(new URL(e, location.href).searchParams.get('id') ?? '');
		} catch {
			ids.push('');
		}
	}
	visit_hole_batches.push({
		sent: m.sent,
		delivered: m.delivered,
		status: m.status,
		...(m.refused ? { refused: m.refused } : {}),
		...(m.final_url ? { final_url: m.final_url.slice(0, 300) } : {}),
		ids
	});
	p.changed();
}

/** The browser's timing of the request that answered a hole: the latest one for its URL done by
 *  `by`. Null when the resource buffer has none. */
export function hole_request_times(
	endpoint: string,
	by: number
): { left: number; first: number; end: number; queue?: number; render?: number } | null {
	try {
		const url = new URL(endpoint, location.href).href;
		let hit: PerformanceResourceTiming | undefined;
		for (const e of performance.getEntriesByName(url, 'resource') as PerformanceResourceTiming[])
			if (e.responseStart > 0 && e.responseEnd <= by + 1) hit = e;
		if (!hit) return null;
		let queue: number | undefined;
		let render: number | undefined;
		for (const s of hit.serverTiming ?? []) {
			if (s.name === 'og-queue') queue = Math.round(s.duration);
			else if (s.name === 'og-render') render = Math.round(s.duration);
		}
		return {
			left: Math.round(hit.requestStart || hit.startTime),
			first: Math.round(hit.responseStart),
			end: Math.round(hit.responseEnd),
			...(queue !== undefined ? { queue } : {}),
			...(render !== undefined ? { render } : {})
		};
	} catch {
		// ok: no Resource Timing in this browser: no timing for it
	}
	return null;
}

/** The load scheduler's critical wait settled: how long it held ogygia's downloads, for the visit. */
export function beacon_critical(e: CriticalSettledEvent): void {
	const o = owner();
	if (o) return o.beacon_critical(e);
	critical_held = { outcome: e.outcome, resources: e.resources, waited_ms: e.waitedMs };
}

export function beacon_entry_fallback(f: EntryFallbackEvent): void {
	const o = owner();
	if (o) return o.beacon_entry_fallback(f);
	const p = page();
	if (
		!p ||
		visit_entry_fallbacks.length >= 20 ||
		visit_entry_fallbacks.some((x) => x.entry === f.entry)
	)
		return;
	visit_entry_fallbacks.push({
		entry: f.entry.slice(0, 300),
		src: f.src.slice(0, 300),
		recovered: f.recovered
	});
	p.changed();
}

/** A hole's first answer landed: the profiler weighs how long its fallback held the first screen. */
export function beacon_hole_answered(
	el: Element,
	start: number,
	batch?: { left: number; at: number; size: number }
): void {
	const o = owner();
	if (o) return o.beacon_hole_answered(el, start, batch);
	const p = page();
	if (!p || visit_holes_answered.length >= 30) return;
	let id = '';
	try {
		id = new URL(el.getAttribute('endpoint') ?? '', location.href).searchParams.get('id') ?? '';
	} catch {
		id = '';
	}
	if (!id || holes_answered_els.has(el)) return;
	holes_answered_els.add(el);
	const rect = el.getBoundingClientRect();
	const times = batch
		? {
				left: Math.round(batch.left),
				first: Math.round(batch.at),
				end: Math.round(batch.at),
				batch: batch.size
			}
		: hole_request_times(el.getAttribute('endpoint') ?? '', performance.now());
	visit_holes_answered.push({
		id,
		n: visit_holes_answered.length,
		start: Math.round(start),
		t: Math.round(performance.now()),
		below_fold: rect.top + scrollY > innerHeight,
		p: p.copy_of(el.getAttribute('endpoint') ?? ''),
		...times
	});
	p.changed();
}

export function beacon_nav(n: NavigatedEvent): void {
	const o = owner();
	if (o) return o.beacon_nav(n);
	const p = page();
	if (!p || visit_navs.length >= 20) return;
	let split: Pick<NavOut, 'server' | 'download' | 'bytes' | 'prefetched'> = {};
	try {
		const entries = n.href
			? (performance.getEntriesByName(n.href) as PerformanceResourceTiming[])
			: [];
		let e: PerformanceResourceTiming | undefined;
		for (const x of entries)
			if (
				x.initiatorType === 'fetch' &&
				x.responseEnd <= n.fetched + 1 &&
				(!e || x.startTime > e.startTime)
			)
				e = x;
		if (e && e.responseStart > 0) {
			const asked = e.requestStart > 0 ? e.requestStart : e.startTime;
			split = {
				server: r2(Math.max(0, e.responseStart - asked)),
				download: r2(Math.max(0, e.responseEnd - e.responseStart)),
				...(e.transferSize || e.encodedBodySize
					? { bytes: e.transferSize || e.encodedBodySize }
					: {}),
				...(e.startTime < n.t - 1 ? { prefetched: true as const } : {})
			};
		}
	} catch {
		split = {};
	}
	if (!navs_seen) {
		navs_seen = true;
		snapshot_firsts = snapshots.length;
		p.nav_at(n.t);
	}
	visit_navs.push({
		from: n.from.slice(0, 300),
		to: n.to.slice(0, 300),
		type: (n.type || 'link').slice(0, 20),
		t: r2(n.t),
		fetched: r2(n.fetched),
		styled: r2(n.styled),
		swapped: r2(n.swapped),
		...split
	});
	p.changed(true);
}

export function beacon_failed(el: Element, message?: string, since?: number, turn?: number): void {
	const o = owner();
	if (o) return o.beacon_failed(el, message, since, turn);
	if (!page()) return;
	const fp = el.getAttribute(OG_FP);
	if (!fp) return;
	failed_fps.set(fp, (message ?? '').slice(0, 300));
	if (typeof since === 'number') failed_spans.set(fp, [r2(since), r2(performance.now())]);
	if (typeof turn === 'number') failed_turns.set(fp, r2(turn));
}

/** an element's box: its own, or (a region draws no box of its own) its children's together */
function box_of(el: Element): { top: number; bottom: number; left: number; width: number } | null {
	const r = el.getBoundingClientRect();
	if (r.width || r.height) return { top: r.top, bottom: r.bottom, left: r.left, width: r.width };
	let top = Infinity;
	let bottom = -Infinity;
	let left = Infinity;
	let right = -Infinity;
	for (const c of el.children) {
		const b = c.getBoundingClientRect();
		if (!b.width && !b.height) continue;
		top = Math.min(top, b.top);
		bottom = Math.max(bottom, b.bottom);
		left = Math.min(left, b.left);
		right = Math.max(right, b.right);
	}
	return top === Infinity ? null : { top, bottom, left, width: right - left };
}

function note_island_boxes(): void {
	if (island_boxes || typeof innerHeight === 'undefined') return;
	island_boxes = new WeakMap();
	for (const el of document.querySelectorAll(`ogygia-region[${OG_FP}]:not([data-hydrated])`)) {
		const b = box_of(el);
		if (b) island_boxes.set(el, { top: b.top + scrollY, height: b.bottom - b.top });
	}
}

function estimate_wake_shift(p: PageBeacon, el: Element, fp: string, t: number): void {
	const before = island_boxes?.get(el);
	if (!before) return;
	island_boxes!.delete(el);
	let last = before;
	const look = (at: number) => {
		const moved = box_shift(p, el, fp, last, at);
		if (moved) last = moved;
	};
	look(t);
	if (typeof requestAnimationFrame !== 'undefined')
		// oxlint-disable-next-line ogygia/owned-effects -- two frames on, one more look at a woken island's box for the document's visit: it only reads, and ends itself
		requestAnimationFrame(() => requestAnimationFrame(() => look(performance.now())));
	// oxlint-disable-next-line ogygia/owned-effects -- a last look at a woken island's box for the document's visit: it only reads, and ends itself
	setTimeout(() => look(performance.now()), 500);
}

function box_shift(
	p: PageBeacon,
	el: Element,
	fp: string,
	before: { top: number; height: number },
	t: number
): { top: number; height: number } | null {
	const after = box_of(el);
	if (!after) return null;
	const dh = after.bottom - after.top - before.height;
	if (Math.abs(dh) < 1) return null;
	const now = { top: after.top + scrollY, height: after.bottom - after.top };
	const vw = innerWidth;
	const vh = innerHeight;
	if (before.top - scrollY + before.height >= vh) return now;
	const moved = Math.min(Math.abs(dh), vh);
	const seen = Math.max(0, Math.min(vh, after.bottom) - Math.max(0, after.top));
	const value =
		Math.round(
			((seen * Math.min(after.width, vw)) / (vh * vw)) * (moved / Math.max(vw, vh)) * 10000
		) / 10000;
	if (value < 0.0001) return now;
	const s: PageShift = {
		t: r2(t),
		value,
		fp,
		from: [
			Math.round(after.left),
			Math.round(before.top - scrollY),
			Math.round(after.width),
			Math.round(before.height)
		],
		to: [
			Math.round(after.left),
			Math.round(after.top),
			Math.round(after.width),
			Math.round(after.bottom - after.top)
		]
	};
	const tag = describe_region(el);
	if (tag) s.tag = tag;
	p.shift(s);
	return now;
}

/** A region told briefly, as the page beacon tells a shift's element: `div#hero "Sale"`. */
function describe_region(el: Element): string {
	const tag = el.tagName.toLowerCase();
	const id = el.id ? `#${el.id.slice(0, 30)}` : '';
	const name = el.getAttribute('name');
	const label = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 30);
	return `${tag}${id}${name ? `[name=${name.slice(0, 30)}]` : ''}${label ? ` "${label}"` : ''}`;
}

/** Every region on the page as the visit ends: where it sits, how it wakes, whether it woke, and a
 *  failure's error. */
function visit_regions(): Record<string, unknown>[] {
	const out: Record<string, unknown>[] = [];
	try {
		const sy = typeof scrollY === 'number' ? scrollY : 0;
		for (const el of document.querySelectorAll(`ogygia-region[${OG_FP}]`)) {
			if (out.length >= 400) break;
			const fp = el.getAttribute(OG_FP)!;
			let box = el.getBoundingClientRect();
			if (!box.height && !box.width)
				for (const c of el.children) {
					const b = c.getBoundingClientRect();
					if (b.height || b.width) {
						box = b;
						break;
					}
				}
			const failed = failed_fps.get(fp);
			out.push({
				fp,
				...(el.getAttribute('entry') ? { entry: el.getAttribute('entry')! } : {}),
				...(el.getAttribute('wake') ? { wake: el.getAttribute('wake')! } : {}),
				...(el.getAttribute('render') === 'defer' ? { defer: true } : {}),
				...(el.hasAttribute('data-hydrated') ? { hydrated: true } : {}),
				...(failed !== undefined
					? {
							failed,
							...(failed_spans.has(fp) ? { failed_span: failed_spans.get(fp) } : {}),
							...(failed_turns.has(fp) ? { failed_turn: failed_turns.get(fp) } : {})
						}
					: {}),
				top: Math.round(box.top + sy),
				height: Math.round(box.height),
				...(!box.height && !box.width
					? { hidden: true, ...(is_headless(el) ? { headless: true } : {}) }
					: {})
			});
		}
	} catch {
		// ok: a document this cannot read: the regions are left out of the visit
	}
	return out;
}

/** The restorer's log (runtime/restore.ts `__og_restore_log`): its late and mismatched hosts. */
function restore_log(): { restores?: unknown[] } {
	const log = (globalThis as { __og_restore_log?: unknown[] }).__og_restore_log;
	return log?.length ? { restores: log.slice(0, 20) } : {};
}

const part: RegionPart = {
	visit() {
		return {
			...(visit_navs.length ? { navs: visit_navs.slice() } : {}),
			...(island_boxes ? { shifts_from: 'boxes' } : {}),
			islands: visit_islands.slice(),
			regions: visit_regions(),
			...(visit_warnings.length ? { warnings: visit_warnings.slice() } : {}),
			...(visit_holes_failed.length ? { holes_failed: visit_holes_failed.slice() } : {}),
			...(visit_holes_answered.length ? { holes_answered: visit_holes_answered.slice() } : {}),
			...(visit_hole_batches.length ? { hole_batches: visit_hole_batches.slice() } : {}),
			...restore_log(),
			...(visit_entry_fallbacks.length ? { entry_fallbacks: visit_entry_fallbacks.slice() } : {}),
			...(critical_held ? { held: critical_held } : {})
		};
	},
	snapshots(final) {
		const p = page();
		if (final && p)
			for (const s of snapshots) {
				const el = document.querySelector(`ogygia-region[${OG_FP}="${s.fp}"]`);
				if (!el) continue;
				const html =
					s.from === undefined
						? el.innerHTML
						: p.bare(el.innerHTML).slice(s.from, s.from + SNAPSHOT_CAP);
				if (html !== s.hydrated) s.final = html.slice(0, SNAPSHOT_CAP);
			}
		return snapshots;
	},
	waking(now) {
		const last = visit_islands.length ? visit_islands[visit_islands.length - 1].done : 0;
		if (now - last < CPU_QUIET_MS) return true;
		try {
			for (const el of document.querySelectorAll(
				`ogygia-region[${OG_FP}]:not([data-hydrated]):not([wake]):not([render="defer"]), ogygia-region[${OG_FP}][wake="load"]:not([data-hydrated])`
			))
				if (!failed_fps.has(el.getAttribute(OG_FP) ?? '')) return true;
		} catch {
			// ok: no document to read: nothing is waking
		}
		return false;
	}
};

function snapshot_of(fp: string, ssr: string, now: string, a: string, b: string): Snapshot {
	if (ssr.length <= SNAPSHOT_CAP && now.length <= SNAPSHOT_CAP) return { fp, ssr, hydrated: now };
	const n = Math.min(a.length, b.length);
	let i = 0;
	while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
	let from = Math.max(0, i - SNAPSHOT_CAP / 4);
	const lt = a.indexOf('<', from);
	if (lt !== -1 && lt <= i) from = lt;
	return {
		fp,
		ssr: a.slice(from, from + SNAPSHOT_CAP),
		hydrated: b.slice(from, from + SNAPSHOT_CAP),
		from
	};
}

function snapshot_room(): boolean {
	if (snapshots.length < MAX_SNAPSHOTS) return true;
	if (!navs_seen || snapshots.length <= snapshot_firsts) return false;
	snapshots.splice(snapshot_firsts, 1);
	return true;
}

/** Record one island's hydration: `t0` its wake, `t_loaded` its modules in hand, `t_done`
 *  `data-hydrated`; `ssr_html` the markup the server sent. */
export function beacon_hydrated(
	el: Element,
	t0: number,
	t_loaded: number,
	t_done: number,
	ssr_html?: string | null,
	t_turn?: number
): void {
	const o = owner();
	if (o) return o.beacon_hydrated(el, t0, t_loaded, t_done, ssr_html, t_turn);
	const p = page();
	if (!p) return;
	const c0 = performance.now();
	island_record(p, el, t0, t_loaded, t_done, ssr_html, t_turn);
	const spent = ((globalThis as Record<symbol, Record<string, number>>)[OWN_COST_KEY] ??= {});
	spent.islands = (spent.islands ?? 0) + (performance.now() - c0);
}

function island_record(
	p: PageBeacon,
	el: Element,
	t0: number,
	t_loaded: number,
	t_done: number,
	ssr_html?: string | null,
	t_turn?: number
): void {
	const fp = el.getAttribute(OG_FP);
	if (!fp) return;
	const recovered = el.hasAttribute(OG_RECOVERED);
	const reason = (el.getAttribute(OG_RECOVERED) || '').slice(0, 300) || undefined;
	const sent: Record<string, unknown> | null = p.sends
		? {
				fp,
				entry: el.getAttribute('entry') ?? '',
				ms: Math.max(0, r2(t_done - t0)),
				load: Math.max(0, r2(t_loaded - t0)),
				...(recovered ? { recovered: true } : {}),
				...(reason ? { reason } : {})
			}
		: null;
	let changed: boolean | undefined;
	let attrs: AttrChange[] | null = null;
	const room = p.room(visit_islands, 400, (i) => i.t0);
	if (typeof ssr_html === 'string' && room) {
		const now = el.innerHTML;
		if (now !== ssr_html) {
			const a = p.bare(ssr_html);
			const b = p.bare(now);
			changed = a !== b;
			if (changed) {
				attrs = p.attr_changes(a, b);
				if (snapshot_room()) snapshots.push(snapshot_of(fp, ssr_html, now, a, b));
			}
		} else changed = false;
	}
	const input = p.input_on(el, t0, t_done);
	if (island_boxes) estimate_wake_shift(p, el, fp, t_done);
	let markers: [number, number] | undefined;
	if (recovered && typeof ssr_html === 'string') {
		const open = count_of(ssr_html, '<!--[');
		const close = count_of(ssr_html, '<!--]');
		if (open !== close) markers = [open, close];
	}
	const rec: VisitIslandRec | null = room
		? {
				fp,
				...(el.getAttribute('entry') ? { entry: el.getAttribute('entry')! } : {}),
				t0: r2(t0),
				loaded: r2(t_loaded),
				...(t_turn !== undefined && t_turn >= t_loaded ? { turn: r2(t_turn) } : {}),
				done: r2(t_done),
				...(recovered ? { recovered: true } : {}),
				...(changed ? { changed: true } : {}),
				...(attrs ? { attrs } : {}),
				...(input ? { input } : {}),
				...(el.hasAttribute(OG_HEALED) ? { healed: true } : {}),
				...(typeof ssr_html === 'string' ? { ssr_bytes: ssr_html.length } : {}),
				...(markers ? { markers } : {})
			}
		: null;
	if (rec) visit_islands.push(rec);
	if (rec || sent)
		queueMicrotask(() => {
			const fx = performance.now();
			if (fx - t_done < 1) return;
			if (rec) rec.fx = r2(fx);
			if (sent) sent.ms = Math.max(0, r2(fx - t0));
		});
	p.changed();
	p.hydrated(sent);
}

/** A HEADLESS island: no text of its own, and every element child marked `hidden`. */
export function is_headless(el: Element): boolean {
	for (const n of el.childNodes) {
		if (n.nodeType === 3 && (n.textContent ?? '').trim()) return false;
		if (n.nodeType === 1 && !(n as Element).hasAttribute('hidden')) return false;
	}
	return true;
}

function count_of(html: string, needle: string): number {
	let n = 0;
	for (let at = html.indexOf(needle); at !== -1; at = html.indexOf(needle, at + needle.length)) n++;
	return n;
}

/** What the browser saw of this document so far, for the devtools Page tab: the page beacon's
 *  parts, with the islands' wakes and markup. Null without a page beacon. */
export interface BeaconPage extends PagePart {
	islands: VisitIslandRec[];
	shifts_from?: 'boxes';
	snapshots: Snapshot[];
}
export function beacon_page(): BeaconPage | null {
	const o = owner();
	if (o) return o.beacon_page();
	const p = page();
	if (!p) return null;
	return {
		...p.page(),
		islands: visit_islands.slice(),
		...(island_boxes ? { shifts_from: 'boxes' as const } : {}),
		snapshots: snapshots.slice()
	};
}

/** Devtools: sample the main thread for `ms` from now and keep the trace in the page. */
export function beacon_record_cpu(ms: number, label: string): Promise<boolean> {
	return page()?.record_cpu(ms, label) ?? Promise.resolve(false);
}

/** Join the page beacon as the page boots, before any region wakes: a second copy on the page
 *  hands its calls to the first. `dock`: the devtools keep the CPU traces in the page. */
export function install_beacon(dock: boolean): void {
	const p = page();
	if (!p || owner() !== null) return;
	if (dock) p.keep_traces();
	p.join(part);
	let shifts_seen = false;
	try {
		shifts_seen = PerformanceObserver.supportedEntryTypes.includes('layout-shift');
	} catch {
		// ok: no PerformanceObserver: no layout shifts either
	}
	if (!shifts_seen) note_island_boxes();
}

/** @internal tests */
export function _reset_beacon(): void {
	const g = globalThis as PageGlobals;
	if (!self_api || g[REGIONS_KEY] === self_api) delete g[REGIONS_KEY];
	visit_islands = [];
	snapshots = [];
	snapshot_firsts = 0;
	navs_seen = false;
	visit_navs = [];
	visit_warnings = [];
	visit_holes_failed = [];
	visit_holes_answered = [];
	holes_answered_els = new WeakSet();
	visit_hole_batches = [];
	visit_entry_fallbacks = [];
	critical_held = null;
	failed_fps.clear();
	failed_spans.clear();
	failed_turns.clear();
	island_boxes = null;
}

/** @internal tests */
export function _beacon_state(): {
	target: string | null;
	queued: number;
	marks: number;
	scheduled: boolean;
	snapshots: number;
} {
	const s = page()?.state() ?? { target: null, queued: 0, marks: 0, scheduled: false };
	return { ...s, snapshots: snapshots.length };
}
