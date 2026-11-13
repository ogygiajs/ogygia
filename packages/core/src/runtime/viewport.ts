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
 * ONE RULE (`decide`) for an element with no box of its own. A region whose content is out of flow
 * (a `position: fixed` button) or that is `display: contents` has no area, and where such a box sits
 * says nothing (`display: contents` reports 0,0). So what it renders decides: its first children
 * (bounded: the first few levels, the first few children of each), and it is on screen when one of
 * them is. With no area and nothing of its own on screen, a line of its own still counts (an empty
 * hole at the fold). The observers read the rule off their reports (each such element's children are
 * watched for it); a read before any report measures. The load scheduler measured with this rule while
 * the observers watched the region's own box, so a fixed button on screen downloaded as `visible` and
 * never woke.
 */
import { scope, seen, tasks, type Scope } from '@ogygia/machine';

/** Hears an element's on-screen state: once known, then on every change. */
type Heard = (on: boolean) => void;
/** An element as last seen: crossing the root (with its margin), and its size. */
type Seen = { crosses: boolean; w: number; h: number };

/** How many levels down an element with no area of its own is decided by what it renders. */
const DEPTH = 3;
/** How many children of each level stand in for it. */
const WIDTH = 16;
/** No children followed. */
// static: the empty list, shared and never written
const NONE: readonly Element[] = [];

/** The children that stand in for an element with no area of its own. */
function stand_ins(el: Element): Element[] {
	const out: Element[] = [];
	for (let c = el.firstElementChild; c && out.length < WIDTH; c = c.nextElementSibling) out.push(c);
	return out;
}

/** On screen, by the rule, from what `read` says of each element (`undefined`: not seen yet). */
function decide(
	el: Element,
	depth: number,
	read: (el: Element) => Seen | undefined
): boolean | undefined {
	const s = read(el);
	if (!s) return undefined;
	if (s.w > 0 && s.h > 0) return s.crosses;
	if (depth > 0) {
		let pending = false;
		for (const c of stand_ins(el)) {
			const on = decide(c, depth - 1, read);
			if (on) return true;
			if (on === undefined) pending = true;
		}
		if (pending) return undefined;
	}
	// nothing it renders is on screen: a line of its own still counts (an empty hole at the fold)
	return s.crosses && (s.w > 0 || s.h > 0);
}

/** One margin's observer and what it knows. */
class Tracker {
	readonly io: IntersectionObserver;
	/** Each observed target's last report. */
	readonly seen = new WeakMap<Element, Seen>();
	/** Each observed target: the watched elements whose decision it is part of (none: unobserved). */
	readonly part_of = new WeakMap<Element, Set<Element>>();
	/** A target with no area: the children it follows for each watched element, as picked. */
	readonly followed = new WeakMap<Element, Map<Element, readonly Element[]>>();
	/** The watched elements: who hears each, and its state as last decided. */
	readonly heard = new Map<Element, Set<Heard>>();
	readonly decided = new WeakMap<Element, boolean>();
	readonly read = (el: Element): Seen | undefined => this.seen.get(el);
	readonly owner: Scope;
	/** Hears the children of a target with no area change (its content swapped): an observer
	 *  reports a target only when its own intersection changes, never what replaced it. Made when a
	 *  target with no area is first followed. */
	#swaps: MutationObserver | null = null;
	/** What `#swaps` observes: each target with no area followed into, and the watched elements
	 *  that follow into it. A target leaves with its last one, and the observer with it (#1255). */
	readonly #swap_targets = new Map<Element, Set<Element>>();

	constructor(root_margin: string, owner: Scope) {
		this.owner = owner;
		// (only browsers observe: where there is none, the first `observe` throws, as the raw
		// constructor did, and the caller is told rather than left unwoken)
		this.io = owner.watch(
			seen.observer((entries) => this.#report(entries), { rootMargin: root_margin })!
		);
	}

	#swapped(records: MutationRecord[]): void {
		const touched = new Set<Element>();
		for (const r of records) {
			const part = this.part_of.get(r.target as Element);
			if (!part) continue;
			for (const watched of part) touched.add(watched);
		}
		// (each settles by following its children again: what it rendered before is let go there)
		for (const el of touched) this.#settle(el);
	}

	watch(el: Element, given: Heard): () => void {
		let set = this.heard.get(el);
		if (!set) {
			this.heard.set(el, (set = new Set()));
			this.#observe(el, el);
		}
		// (each watch its own entry: one function watching twice is two watches, each stopped alone)
		const heard: Heard = (on) => given(on);
		set.add(heard);
		// a later watcher gets the state known (the browser reports a target it watches only on a
		// change), or the first report with the others
		const known = this.decided.get(el);
		if (known !== undefined)
			tasks.micro(() => {
				if (this.heard.get(el)?.has(heard)) heard(known);
			});
		// (observed already, as what another watched element renders: its report is in, none comes)
		else if (this.seen.has(el)) tasks.micro(() => this.#settle(el));
		return () => {
			const now = this.heard.get(el);
			if (!now?.delete(heard) || now.size) return;
			this.heard.delete(el);
			this.decided.delete(el);
			this.#follow(el, el, DEPTH, false);
		};
	}

	/** Observe `target` as part of `watched`'s decision. */
	#observe(target: Element, watched: Element): void {
		let part = this.part_of.get(target);
		if (!part) this.part_of.set(target, (part = new Set()));
		if (!part.size) this.io.observe(target);
		part.add(watched);
	}

	#unobserve(target: Element, watched: Element): void {
		const part = this.part_of.get(target);
		if (!part?.delete(watched) || part.size) return;
		this.part_of.delete(target);
		this.seen.delete(target);
		this.io.unobserve(target);
	}

	/**
	 * Keep what `watched`'s decision reads observed (`keep`), or let all of it go: `target`, and,
	 * while it reported no area, the children standing in for it, a level at a time (picked again as
	 * they change: the content it renders was swapped). What it lets go is what it RECORDED following
	 * (`followed`), never the children re-read now: a child pushed out of the first few, or taken
	 * out, is let go all the same.
	 */
	#follow(target: Element, watched: Element, depth: number, keep: boolean): void {
		const s = this.seen.get(target);
		const deeper = keep && depth > 0 && s !== undefined && !(s.w > 0 && s.h > 0);
		if (deeper) this.#hear_swaps(target, watched);
		else this.#stop_swaps(target, watched);
		let by = this.followed.get(target);
		const had = by?.get(watched) ?? NONE;
		const now = deeper ? stand_ins(target) : NONE;
		for (const c of now) this.#observe(c, watched);
		for (const c of had) if (!now.includes(c)) this.#follow(c, watched, 0, false);
		for (const c of now) this.#follow(c, watched, depth - 1, true);
		if (now.length) {
			if (!by) this.followed.set(target, (by = new Map()));
			by.set(watched, now);
		} else if (by?.delete(watched) && by.size === 0) this.followed.delete(target);
		if (!keep) this.#unobserve(target, watched);
	}

	/** Hear `target`'s children change, for `watched`'s decision. */
	#hear_swaps(target: Element, watched: Element): void {
		let by = this.#swap_targets.get(target);
		if (!by) {
			this.#swap_targets.set(target, (by = new Set()));
			(this.#swaps ??= this.owner.watch(
				new MutationObserver((records) => this.#swapped(records))
			)).observe(target, { childList: true });
		}
		by.add(watched);
	}

	/** `watched` no longer follows into `target`: with its last follower gone, the observer lets it
	 *  go. (An observer has no unobserve: it disconnects and observes again the targets left, and
	 *  hands on the records of theirs it had not delivered yet.) */
	#stop_swaps(target: Element, watched: Element): void {
		const by = this.#swap_targets.get(target);
		if (!by?.delete(watched) || by.size) return;
		this.#swap_targets.delete(target);
		const swaps = this.#swaps!;
		const pending = swaps.takeRecords();
		swaps.disconnect();
		for (const t of this.#swap_targets.keys()) swaps.observe(t, { childList: true });
		// (later, as the observer would have: this runs inside a #follow)
		if (pending.length) tasks.micro(() => this.#swapped(pending));
	}

	#report(entries: IntersectionObserverEntry[]): void {
		const touched = new Set<Element>();
		for (const e of entries) {
			const t = e.target;
			const part = this.part_of.get(t);
			if (!part) continue;
			for (const watched of part) touched.add(watched);
			// what a watched element rendered left the page (its content was swapped): let it go
			if (!t.isConnected && !this.heard.has(t)) {
				for (const watched of Array.from(part)) this.#follow(t, watched, 0, false);
				continue;
			}
			const r = e.boundingClientRect;
			this.seen.set(t, { crosses: e.isIntersecting, w: r.width, h: r.height });
		}
		for (const el of touched) this.#settle(el);
	}

	/** Decide a watched element again, and tell its watchers when that changed it. */
	#settle(el: Element): void {
		const set = this.heard.get(el);
		if (!set) return;
		this.#follow(el, el, DEPTH, true);
		const on = decide(el, DEPTH, this.read);
		if (on === undefined || on === this.decided.get(el)) return;
		this.decided.set(el, on);
		// (a copy: a watcher may stop while it hears)
		for (const heard of Array.from(set)) heard(on);
	}
}

/** The document's trackers, one per distinct root margin (the few the app names), and the scope
 *  that owns their observers: made at the first watch, ended only by a test's reset. */
class Trackers {
	readonly by_margin = new Map<string, Tracker>();
	readonly owner: Scope = scope();
}
let T: Trackers | null = null;

/**
 * Watch whether `el` is on screen (the root grown by `root_margin`): `heard` gets its state once it
 * is known, then every change, until the returned stop is called. A watcher that joins late gets the
 * state known at once.
 */
export function watch_viewport(el: Element, root_margin: string, heard: Heard): () => void {
	const all = (T ??= new Trackers());
	let t = all.by_margin.get(root_margin);
	if (!t) all.by_margin.set(root_margin, (t = new Tracker(root_margin, all.owner)));
	return t.watch(el, heard);
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

/** Is `el` on screen now? What the tracker last decided when something watches it, else measured
 *  by the same rule. */
export function on_screen(el: Element): boolean {
	if (typeof innerHeight === 'undefined' || !el.isConnected) return false;
	return T?.by_margin.get('0px')?.decided.get(el) ?? decide(el, DEPTH, measure) === true;
}

/** An element as its box is now, against the viewport. */
function measure(el: Element): Seen {
	const r = el.getBoundingClientRect();
	return {
		crosses: r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth,
		w: r.width,
		h: r.height
	};
}

/** Test seam: how many observers exist (one per distinct root margin). */
export function tracker_count(): number {
	return T?.by_margin.size ?? 0;
}

/** Test seam: a fresh document (every observer disconnected, every watch forgotten). */
export function reset_viewport(): void {
	T?.owner.close();
	T = null;
}
