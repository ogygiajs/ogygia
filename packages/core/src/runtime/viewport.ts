/**
 * ONE NOTION OF "ON SCREEN" (#444), for every feature that asks it: `wake: 'visible'` (islands,
 * holes, lakes), the hydration scheduler's viewport snapshot, the load scheduler's class (an island's
 * code, a hole's HTML: `visible` or `ahead`) and the router's `viewport` prefetch.
 *
 * ONE IntersectionObserver per root margin, owned by the tracker's scope (the document's: a test's
 * reset closes it). An observer per island (150 on a measured page) is 150 observers the browser
 * walks on every scroll; one per margin walks the same targets in one pass. Any number of watchers per
 * element: the scheduler's snapshot and a `visible` wake both watch an island at `0px`, and one
 * leaving does not silence the other.
 *
 * ONE RULE for an element with no box of its own. A region whose content is out of flow (a
 * `position: fixed` button) or that is `display: contents` has no area, and where such a box sits
 * says nothing (`display: contents` reports 0,0). So when an element reports no area, what it renders
 * decides: its first children are watched for it (bounded: the first few levels, the first few
 * children of each), and it is on screen when one of them is. An element with no area and nothing of
 * its own on screen still counts when it crosses with a line of its own (an empty hole at the fold).
 * The load scheduler used this rule (by measuring) while the observers watched the region's own box,
 * so a fixed button on screen downloaded as `visible` and never woke.
 */
import { scope, type Scope } from '@ogygia/machine';

/** Hears an element's on-screen state: once known, then on every change. */
type Heard = (on: boolean) => void;
/** What a watched target last reported: crossing the root (with its margin), and its size. */
type Seen = { crosses: boolean; w: number; h: number };

/** How many levels down an element with no area of its own is decided by what it renders. */
const DEPTH = 3;
/** How many children of each level stand in for it. */
const WIDTH = 16;

/** One margin's observer and what it knows. */
class Tracker {
	readonly io: IntersectionObserver;
	/** Each observed target's last report. */
	readonly seen = new WeakMap<Element, Seen>();
	/** How many reasons each target is observed for (a watched element, a stand-in for one). */
	readonly observed = new WeakMap<Element, number>();
	/** The watched elements: who hears each, and its state as last decided. */
	readonly heard = new Map<Element, Set<Heard>>();
	readonly decided = new WeakMap<Element, boolean>();
	/** A target with no area: the children standing in for it, and the watched elements whose
	 *  decision they are part of. */
	readonly stand_ins = new WeakMap<Element, Element[]>();
	readonly part_of = new WeakMap<Element, Set<Element>>();

	constructor(root_margin: string, owner: Scope) {
		// oxlint-disable-next-line ogygia/owned-effects -- the margin's one observer, owned by the tracker's scope (`owner.watch` disconnects it)
		this.io = owner.watch(
			new IntersectionObserver((entries) => this.#report(entries), { rootMargin: root_margin })
		);
	}

	watch(el: Element, heard: Heard): () => void {
		let set = this.heard.get(el);
		if (!set) {
			this.heard.set(el, (set = new Set()));
			this.#observe(el, el);
		}
		set.add(heard);
		// a later watcher gets the state known (the browser reports a target it watches only on a
		// change), or the first report with the others
		const known = this.decided.get(el);
		if (known !== undefined)
			queueMicrotask(() => {
				if (this.heard.get(el)?.has(heard)) heard(known);
			});
		return () => {
			const now = this.heard.get(el);
			if (!now?.delete(heard) || now.size) return;
			this.heard.delete(el);
			this.decided.delete(el);
			this.#unobserve(el, el);
		};
	}

	/** `el`'s state as last decided, if it is watched and decided. */
	known(el: Element): boolean | undefined {
		return this.decided.get(el);
	}

	/** Observe `target` as part of `watched`'s decision. */
	#observe(target: Element, watched: Element): void {
		let part = this.part_of.get(target);
		if (!part) this.part_of.set(target, (part = new Set()));
		if (part.has(watched)) return;
		part.add(watched);
		const n = this.observed.get(target) ?? 0;
		this.observed.set(target, n + 1);
		if (n === 0) this.io.observe(target);
	}

	/** `target` is no longer part of `watched`'s decision (nor are the children standing in for it). */
	#unobserve(target: Element, watched: Element): void {
		const part = this.part_of.get(target);
		if (!part?.delete(watched)) return;
		for (const c of this.stand_ins.get(target) ?? []) this.#unobserve(c, watched);
		if (!part.size) this.part_of.delete(target);
		const n = (this.observed.get(target) ?? 1) - 1;
		if (n > 0) {
			this.observed.set(target, n);
			return;
		}
		this.observed.delete(target);
		this.seen.delete(target);
		this.stand_ins.delete(target);
		this.io.unobserve(target);
	}

	#report(entries: IntersectionObserverEntry[]): void {
		const touched = new Set<Element>();
		for (const e of entries) {
			const t = e.target;
			const r = e.boundingClientRect;
			this.seen.set(t, { crosses: e.isIntersecting, w: r.width, h: r.height });
			for (const watched of this.part_of.get(t) ?? []) touched.add(watched);
		}
		for (const el of touched) {
			if (!this.heard.has(el)) continue;
			this.#pick_stand_ins(el, el, DEPTH);
			const on = this.#decide(el, DEPTH);
			if (on === undefined || on === this.decided.get(el)) continue;
			this.decided.set(el, on);
			// (a copy: a watcher may stop while it hears)
			for (const heard of Array.from(this.heard.get(el)!)) heard(on);
		}
	}

	/** Under `watched`, a target that reported no area has its first children watched for it (and
	 *  picked again when one of them left the page: the content it renders was swapped). */
	#pick_stand_ins(target: Element, watched: Element, depth: number): void {
		const s = this.seen.get(target);
		if (!s || (s.w > 0 && s.h > 0) || depth === 0) return;
		const had = this.stand_ins.get(target);
		if (had?.every((c) => c.isConnected && c.parentElement === target)) {
			for (const c of had) {
				this.#observe(c, watched); // (picked for another watched element first: this one's too)
				this.#pick_stand_ins(c, watched, depth - 1);
			}
			return;
		}
		for (const c of had ?? []) this.#unobserve(c, watched);
		const picked: Element[] = [];
		for (let c = target.firstElementChild; c && picked.length < WIDTH; c = c.nextElementSibling)
			picked.push(c);
		this.stand_ins.set(target, picked);
		for (const c of picked) this.#observe(c, watched);
	}

	/** On screen (`undefined`: a target it depends on has not reported yet). */
	#decide(target: Element, depth: number): boolean | undefined {
		const s = this.seen.get(target);
		if (!s) return undefined;
		if (s.w > 0 && s.h > 0) return s.crosses;
		if (depth > 0) {
			let pending = false;
			for (const c of this.stand_ins.get(target) ?? []) {
				const on = this.#decide(c, depth - 1);
				if (on === true) return true;
				if (on === undefined) pending = true;
			}
			if (pending) return undefined;
		}
		// nothing it renders is on screen: a line of its own still counts (an empty hole at the fold)
		return s.crosses && (s.w > 0 || s.h > 0);
	}
}

/** The trackers, by root margin, and the scope that owns their observers. */
let trackers = new Map<string, Tracker>();
let owner: Scope | null = null;

function tracker(root_margin: string): Tracker {
	let t = trackers.get(root_margin);
	if (!t) trackers.set(root_margin, (t = new Tracker(root_margin, (owner ??= scope()))));
	return t;
}

/**
 * Watch whether `el` is on screen (the root grown by `root_margin`): `heard` gets its state once it
 * is known, then every change, until the returned stop is called. A watcher that joins late gets the
 * state known at once.
 */
export function watch_viewport(el: Element, root_margin: string, heard: Heard): () => void {
	return tracker(root_margin).watch(el, heard);
}

/** Watch until the FIRST time `el` is on screen, then fire once and stop. */
export function once_on_screen(el: Element, root_margin: string, fire: () => void): () => void {
	const stop = watch_viewport(el, root_margin, (on) => {
		if (!on) return;
		stop();
		fire();
	});
	return stop;
}

/**
 * Is `el` on screen now? What the tracker last decided when something watches it, else measured
 * by the same rule (its box, or, with no area of its own, what it renders).
 */
export function on_screen(el: Element): boolean {
	if (typeof innerHeight === 'undefined' || !el.isConnected) return false;
	return trackers.get('0px')?.known(el) ?? measured(el, DEPTH);
}

function measured(el: Element, depth: number): boolean {
	const r = el.getBoundingClientRect();
	const crosses = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
	if (r.width > 0 && r.height > 0) return crosses;
	if (depth > 0) {
		let seen = 0;
		for (let c = el.firstElementChild; c && seen < WIDTH; c = c.nextElementSibling, seen++)
			if (measured(c, depth - 1)) return true;
	}
	// nothing it renders is on screen: a line of its own still counts (an empty hole at the fold)
	return crosses && (r.width > 0 || r.height > 0);
}

/** Test seam: how many observers exist (one per distinct root margin). */
export function tracker_count(): number {
	return trackers.size;
}

/** Test seam: a fresh document (every observer disconnected, every watch forgotten). */
export function reset_viewport(): void {
	owner?.close();
	owner = null;
	trackers = new Map();
}
