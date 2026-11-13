import { scope, seen, tasks, type Scope } from '@ogygia/machine';

type Heard = (on: boolean) => void;
type Seen = { crosses: boolean; w: number; h: number };

const DEPTH = 3;
const WIDTH = 16;
const NONE: readonly Element[] = [];

function stand_ins(el: Element): Element[] {
	const out: Element[] = [];
	for (let c = el.firstElementChild; c && out.length < WIDTH; c = c.nextElementSibling) out.push(c);
	return out;
}

// @why an element that is `display: contents` reports a 0,0 box, and an out-of-flow child's box is not its parent's (test: test/browser/viewport-agree.test.ts › a visible hole that is display: contents fetches when what it renders is on screen)
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
	return s.crosses && (s.w > 0 || s.h > 0);
}

class Tracker {
	readonly io: IntersectionObserver;
	readonly seen = new WeakMap<Element, Seen>();
	readonly part_of = new WeakMap<Element, Set<Element>>();
	readonly followed = new WeakMap<Element, Map<Element, readonly Element[]>>();
	readonly heard = new Map<Element, Set<Heard>>();
	readonly decided = new WeakMap<Element, boolean>();
	readonly read = (el: Element): Seen | undefined => this.seen.get(el);
	readonly owner: Scope;
	#swaps: MutationObserver | null = null;
	readonly #swap_targets = new Map<Element, Set<Element>>();

	constructor(root_margin: string, owner: Scope) {
		this.owner = owner;
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
		for (const el of touched) this.#settle(el);
	}

	watch(el: Element, given: Heard): () => void {
		let set = this.heard.get(el);
		if (!set) {
			this.heard.set(el, (set = new Set()));
			this.#observe(el, el);
		}
		const heard: Heard = (on) => given(on);
		set.add(heard);
		const known = this.decided.get(el);
		if (known !== undefined)
			tasks.micro(() => {
				if (this.heard.get(el)?.has(heard)) heard(known);
			});
		else if (this.seen.has(el)) tasks.micro(() => this.#settle(el));
		return () => {
			const now = this.heard.get(el);
			if (!now?.delete(heard) || now.size) return;
			this.heard.delete(el);
			this.decided.delete(el);
			this.#follow(el, el, DEPTH, false);
		};
	}

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

	// @why a MutationObserver has no unobserve: it disconnects and observes the targets left again (test: test/browser/viewport-shared.test.ts › a box-less region the tracker lets go is no longer observed for swaps (#1255))
	#stop_swaps(target: Element, watched: Element): void {
		const by = this.#swap_targets.get(target);
		if (!by?.delete(watched) || by.size) return;
		this.#swap_targets.delete(target);
		const swaps = this.#swaps!;
		const pending = swaps.takeRecords();
		swaps.disconnect();
		for (const t of this.#swap_targets.keys()) swaps.observe(t, { childList: true });
		if (pending.length) tasks.micro(() => this.#swapped(pending));
	}

	#report(entries: IntersectionObserverEntry[]): void {
		const touched = new Set<Element>();
		for (const e of entries) {
			const t = e.target;
			const part = this.part_of.get(t);
			if (!part) continue;
			for (const watched of part) touched.add(watched);
			if (!t.isConnected && !this.heard.has(t)) {
				for (const watched of Array.from(part)) this.#follow(t, watched, 0, false);
				continue;
			}
			const r = e.boundingClientRect;
			this.seen.set(t, { crosses: e.isIntersecting, w: r.width, h: r.height });
		}
		for (const el of touched) this.#settle(el);
	}

	#settle(el: Element): void {
		const set = this.heard.get(el);
		if (!set) return;
		this.#follow(el, el, DEPTH, true);
		const on = decide(el, DEPTH, this.read);
		if (on === undefined || on === this.decided.get(el)) return;
		this.decided.set(el, on);
		for (const heard of Array.from(set)) heard(on);
	}
}

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
