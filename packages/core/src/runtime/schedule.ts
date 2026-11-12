/**
 * THE HYDRATION SCHEDULER — one island per task, viewport first.
 *
 * `customElements.define` upgrades every region on the page in one task; with 21 `wake:'load'`
 * islands the old runtime then hydrated them back-to-back in microtasks — props parse + module
 * continuation + Svelte hydrate, 21 times, in ONE long task, in document order, with the header
 * nobody can see yet racing the hero everybody can. Here every island that is ready to hydrate
 * asks for a TURN; turns are handed out one per task (`scheduler.yield()`, else a `MessageChannel`
 * hop — never a timer), so the browser paints, scrolls and handles input between islands, and the
 * next turn goes to a region that is on screen NOW (the one viewport tracker's snapshot, taken at
 * connect: ./viewport.ts) before any that is not, document order within each group.
 *
 * What a turn covers is the island's whole synchronous hydrate step (props parse, Svelte hydrate,
 * lake restore). Module imports are NOT serialized — every island's `import()` starts at its wake,
 * in parallel; a turn is requested when the module has arrived. Arrivals are staggered (one task
 * each, in network order), so "viewport first" also means: a ready island BELOW the fold holds its
 * turn while a viewport island is still waiting for its module — bounded, so a chunk that never
 * comes cannot stall the rest of the page.
 *
 * The viewport snapshot is asynchronous (the observer reports after layout). A drain waits for
 * the snapshot of every queued region, bounded (a hidden document never lays out; a stalled
 * observer must not stall hydration), so the boot's first island is the right one, not merely the
 * first one.
 */
import { watch_viewport } from './viewport.ts';
import { clock, flights, machine, tasks, timers, type Scope, type Stale } from '@ogygia/machine';

type Turn = {
	el: Element;
	order: number;
	/** request order: breaks a tie between two turns of one region */
	seq: number;
	queued_at: number;
	resolve: () => void;
	/** in the viewport heap (true) or the other one; a heap entry that disagrees is stale */
	vis: boolean;
	done: boolean;
};

/** How long the drain waits for the observer's snapshot of a queued region before ignoring it. */
const SNAPSHOT_WAIT_MS = 48;
/** How long a ready below-the-fold island holds for a viewport island still loading its module. */
const HOLD_FOR_VIEWPORT_MS = 1000;

// THE PENDING TURNS, kept so a turn costs the same however many are pending (a page's `load` wakes
// are all pending at once): two heaps by connect order, the turns of regions in the viewport and
// the rest (a region's report moves its turns across; the entry left behind is skipped), each
// region's turns, and the turns still waiting for their snapshot, in request order.
class PendingTurns {
	count = 0;
	next_seq = 0;
	readonly heap_vis: Turn[] = [];
	readonly heap_rest: Turn[] = [];
	readonly turns_of = new Map<Element, Turn[]>();
	readonly unsnapped: Turn[] = [];
	unsnapped_head = 0;
}
/** The document's pending turns (its one scheduler's: a turn leaves at its pick or its region's leaving). */
const P = new PendingTurns();
/**
 * The drain, as a machine:
 *
 *   idle ─ queued ─ idle            a drain waits for its task (`yield_task`), then runs
 *       ╲ waiting{at} ╱             a drain waits for a time: the snapshot, or a viewport island
 *
 * `waiting` owns its timer (its visit's scope), so leaving it drops the timer: a drain queued
 * meanwhile runs sooner and works out the waits again, and a sooner wait replaces a later one
 * (#236). One state in place of the `draining` flag beside a `wait_timer` and its `wait_at`.
 */
const drainer = machine<{ idle: {}; queued: {}; waiting: { at: number } }>()({
	name: 'hydrate-drain',
	initial: 'idle',
	steps: {
		idle: ['queued', 'waiting'],
		queued: ['idle'],
		waiting: ['queued', 'waiting']
	}
}).create();
/** Connect-order stamp per region — document order at upgrade, insertion order after a morph. */
const order_of = new WeakMap<Element, number>();
let next_order = 0;
/** The snapshot: intersecting now? Absent = the observer has not reported yet. */
const in_viewport = new WeakMap<Element, boolean>();
/** Each region's viewport snapshot while it runs (closing it stops the snapshot). */
const snapshot_of = new WeakMap<Element, () => void>();
/** Regions whose hydrate has STARTED (module in flight) and not yet taken its turn (held weakly: a
 *  region gone is let go), and those of them the snapshot says intersect the viewport (what a hold
 *  waits for: each leaves at its turn, its settle or its region's leaving). */
class LoadingRegions {
	readonly all = new WeakSet<Element>();
	readonly on_screen = new Set<Element>();
}
const L = new LoadingRegions();

/** Keep the on-screen loading regions in step after `el`'s loading state or snapshot changed. */
function sync_loading(el: Element): void {
	if (L.all.has(el) && in_viewport.get(el) === true) L.on_screen.add(el);
	else L.on_screen.delete(el);
}

function stop_loading(el: Element): boolean {
	L.on_screen.delete(el);
	return L.all.delete(el);
}

/** Connect order, then request order: the pick order within one heap. */
const before = (a: Turn, b: Turn): boolean =>
	a.order < b.order || (a.order === b.order && a.seq < b.seq);

function heap_push(h: Turn[], t: Turn): void {
	let i = h.push(t) - 1;
	while (i > 0) {
		const p = (i - 1) >> 1;
		if (!before(h[i], h[p])) break;
		[h[i], h[p]] = [h[p], h[i]];
		i = p;
	}
}

function heap_pop(h: Turn[]): void {
	const last = h.pop()!;
	if (!h.length) return;
	h[0] = last;
	for (let i = 0; ;) {
		const l = 2 * i + 1;
		const r = l + 1;
		let m = i;
		if (l < h.length && before(h[l], h[m])) m = l;
		if (r < h.length && before(h[r], h[m])) m = r;
		if (m === i) return;
		[h[i], h[m]] = [h[m], h[i]];
		i = m;
	}
}

/** The heap's first live turn (stale entries on top are dropped on the way). */
function heap_top(h: Turn[], vis: boolean): Turn | undefined {
	while (h.length && (h[0].done || h[0].vis !== vis)) heap_pop(h);
	return h[0];
}

/** File each pending turn of `el` in the heap its snapshot now says. */
function refile(el: Element): void {
	const vis = in_viewport.get(el) === true;
	for (const t of P.turns_of.get(el) ?? []) {
		if (t.vis === vis) continue;
		t.vis = vis;
		heap_push(vis ? P.heap_vis : P.heap_rest, t);
	}
}

/** The turn leaves the queue (taken, or its region went away). */
function retire(t: Turn): void {
	t.done = true;
	P.count--;
	const list = P.turns_of.get(t.el)!;
	list.splice(list.indexOf(t), 1);
	if (!list.length) P.turns_of.delete(t.el);
}

/**
 * Yield to the event loop: resolves in a NEW task, so whatever ran before is a finished task and
 * the browser may render and handle input in between. `scheduler.yield()` where it exists (it
 * keeps the continuation at the current task's priority); else a message hop — a `MessageChannel`
 * post lands as a task without the 4 ms clamp `setTimeout` carries.
 */
class TaskHops {
	readonly channel = new MessageChannel();
	/** The hops posted and not yet landed, in order (each lands in its own task). */
	readonly waiting: Array<() => void> = [];
	constructor() {
		this.channel.port1.onmessage = () => this.waiting.shift()?.();
	}
	hop(resolve: () => void): void {
		this.waiting.push(resolve);
		this.channel.port2.postMessage(null);
	}
}
/** The message-channel hop, made at the first yield that needs it (the document's). */
let hops: TaskHops | null = null;
export function yield_task(): Promise<void> {
	const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
	if (s && typeof s.yield === 'function') return s.yield();
	return new Promise<void>((resolve) => (hops ??= new TaskHops()).hop(resolve));
}

/**
 * Run `fn` at background priority, off the current task: `scheduler.postTask` at 'background' where
 * it exists, else a macrotask. This orders MAIN-THREAD work only — it lets a pending render or input
 * task go first. It does not hold back the network: while the page's resources download the main
 * thread is idle, so a background task runs at once and an `import()` it starts competes with them.
 * Holding island code back until the page has painted is `after_document_painted`'s job.
 */
export function background_start(fn: () => void): void {
	// ONE background task drains every start queued meanwhile (a task per island: each hydrate turn
	// outranked the next island's start, so its import began late); it yields past a time budget
	B.starts.push(fn);
	if (!B.armed) {
		B.armed = true;
		post_background(drain_background);
	}
}

/** The starts queued for the background drain (each leaves as it runs), and whether a drain is out. */
class BackgroundStarts {
	readonly starts: (() => void)[] = [];
	armed = false;
}
const B = new BackgroundStarts();
/** a drain yields to the page after this long, and continues in a new background task */
const BACKGROUND_BUDGET_MS = 30;

function drain_background(): void {
	const until = now() + BACKGROUND_BUDGET_MS;
	let i = 0;
	try {
		while (i < B.starts.length) {
			B.starts[i++]();
			if (now() >= until) break;
		}
	} finally {
		B.starts.splice(0, i);
		if (B.starts.length) post_background(drain_background);
		else B.armed = false;
	}
}

function post_background(fn: () => void): void {
	const s = (
		globalThis as {
			scheduler?: { postTask?: (cb: () => void, o?: { priority?: string }) => unknown };
		}
	).scheduler;
	if (s && typeof s.postTask === 'function') {
		try {
			s.postTask(fn, { priority: 'background' });
			return;
		} catch {
			// ok: an invalid-priority throw (an older postTask); the fallback below runs it
		}
	}
	// oxlint-disable-next-line ogygia/owned-effects -- the process's one background drain (`B.armed`), one task: it ends itself, and a start queued in it belongs to whoever queued it
	timers.after(fn, 0);
}

/** The gate below, once for the document (a test's reset drops it). */
const document_painted = flights({ name: 'document painted', run: () => until_painted() });

/**
 * Resolves once the document is parsed AND painted: after `DOMContentLoaded`, then one rendered
 * frame. This is the moment SvelteKit starts hydrating (its start runs from a deferred module
 * script, so never before DOMContentLoaded), and an island's wake starts no earlier: the runtime
 * boots from a module script that runs BEFORE DOMContentLoaded — the app's other deferred scripts
 * may still be executing and the first paint (and its LCP image) not yet happened — and an island
 * `import()` started there takes bandwidth from both.
 *
 * `readyState` cannot tell "DOMContentLoaded fired" from "about to fire" (it reads `interactive` for
 * both), so the navigation timing entry decides; `load` backs up the listener where there is none.
 * A hidden document paints no frame (`requestAnimationFrame` never fires there) — nothing to protect,
 * so it waits one task instead. Once resolved it stays resolved: a late region (SPA swap, a hole's
 * answer) passes straight through.
 */
export function after_document_painted(): Promise<void | Stale> {
	return document_painted.get();
}
function until_painted(): Promise<void> {
	return new Promise<void>((resolve) => {
		if (typeof document === 'undefined') return resolve();
		// (the document's own gate, once per document: these end themselves, whoever waits on them)
		const painted = () => {
			if (document.visibilityState === 'hidden' || typeof requestAnimationFrame !== 'function')
				// oxlint-disable-next-line ogygia/owned-effects -- the document's paint gate, one task, once per document
				timers.after(resolve, 0);
			// oxlint-disable-next-line ogygia/owned-effects -- the document's paint gate, one frame and one task, once per document
			else tasks.frame(() => timers.after(resolve, 0)); // the task after the frame
		};
		if (dom_content_loaded()) return painted();
		let done = false;
		const once = () => {
			if (done) return;
			done = true;
			document.removeEventListener('DOMContentLoaded', once);
			removeEventListener('load', once);
			painted();
		};
		// oxlint-disable-next-line ogygia/owned-effects -- the document's paint gate, once per document: the first of the two takes both off
		document.addEventListener('DOMContentLoaded', once);
		// oxlint-disable-next-line ogygia/owned-effects -- the document's paint gate, once per document: the first of the two takes both off
		addEventListener('load', once);
	});
}

function dom_content_loaded(): boolean {
	if (document.readyState === 'complete') return true;
	if (document.readyState === 'loading') return false;
	const nav = (typeof performance !== 'undefined' &&
		performance.getEntriesByType?.('navigation')[0]) as PerformanceNavigationTiming | undefined;
	return !!nav && nav.domContentLoadedEventEnd > 0;
}

/** Test seam: forget the resolved gate (a test that fakes a fresh document). */
export function reset_document_painted(): void {
	document_painted.drop(() => true);
}

/**
 * Register a region with the scheduler at connect: stamp its order, start its viewport snapshot.
 * Cheap on purpose (a stamp and an `observe`) — connect runs for every region in one task. The
 * snapshot is `owner`'s (the region's lifetime in the page): it stops at the region's turn, or when
 * the owner ends.
 */
export function register_region(el: Element, owner: Scope): void {
	if (!order_of.has(el)) order_of.set(el, next_order++);
	if (snapshot_of.has(el) || owner.closed) return;
	const stop = watch_viewport(el, '0px', (intersecting) => {
		in_viewport.set(el, intersecting);
		sync_loading(el);
		refile(el);
		if (P.count) schedule_drain();
	});
	snapshot_of.set(el, stop);
	// (the owner ending stops this snapshot only: a later one of the element is another owner's.
	// A defer, not a child scope: one closure per region on the hydrate path, #300)
	owner.defer(() => {
		if (snapshot_of.get(el) === stop) stop_snapshot(el);
	});
}

/**
 * Drop a region from the scheduler (disconnect): its snapshot stops and any pending turn is handed
 * out at once — the waiting hydrate step then sees `isConnected === false` and stands down (or, if
 * the element was re-attached meanwhile, runs — exactly what an un-scheduled wait would have done).
 */
export function unregister_region(el: Element): void {
	stop_snapshot(el);
	in_viewport.delete(el);
	stop_loading(el);
	const list = P.turns_of.get(el);
	// (the latest request first, as the turns always resolved here)
	if (list) {
		for (const turn of list.slice().reverse()) {
			retire(turn);
			turn.resolve();
		}
	}
	if (P.count) schedule_drain();
}

function stop_snapshot(el: Element): void {
	const stop = snapshot_of.get(el);
	if (stop === undefined) return;
	snapshot_of.delete(el);
	stop();
}

/** The island's module is in flight: a viewport island here holds ready islands below the fold. */
export function hydrate_started(el: Element): void {
	L.all.add(el);
	sync_loading(el);
}

/** The hydrate attempt is over (turn taken, or it never got there — no entry, a failed import). */
export function hydrate_settled(el: Element): void {
	if (!stop_loading(el)) return;
	if (P.count) schedule_drain();
}

/**
 * Wait for this region's turn. Resolves in a task of its own, after every region ahead of it in
 * priority has had its task. Call it when the island can hydrate right now (module loaded) — the
 * continuation after the `await` IS the turn: keep the whole synchronous hydrate step in it.
 */
export function hydrate_turn(el: Element): Promise<void> {
	return new Promise<void>((resolve) => {
		const turn: Turn = {
			el,
			order: order_of.get(el) ?? (order_of.set(el, next_order), next_order++),
			seq: P.next_seq++,
			queued_at: now(),
			resolve,
			vis: in_viewport.get(el) === true,
			done: false
		};
		P.count++;
		heap_push(turn.vis ? P.heap_vis : P.heap_rest, turn);
		const list = P.turns_of.get(el);
		if (list) list.push(turn);
		else P.turns_of.set(el, [turn]);
		if (!in_viewport.has(el)) P.unsnapped.push(turn);
		schedule_drain();
	});
}

const now = clock.mono;

function schedule_drain(): void {
	if (drainer.now.kind === 'queued') return;
	drainer.go('queued');
	yield_task().then(drain);
}

/** Re-drain after `ms`. One wait at a time, and it is the EARLIEST: a sooner wait replaces a later
 *  one (a short snapshot wait set during a long hold), a later one rides the sooner. */
function drain_after(ms: number): void {
	const at = now() + Math.max(1, ms);
	const s = drainer.now;
	if (s.kind === 'waiting' && s.at <= at) return;
	drainer.go('waiting', { at });
	drainer.scope.timeout(schedule_drain, Math.max(1, ms));
}

/**
 * The earliest-requested pending turn still waiting for its snapshot within its wait, or none.
 * Turns are requested in time order, so the ones ahead of it that reported, went, or ran out of
 * wait are behind for good (the clock only moves on) and leave the queue.
 */
function first_unsnapped(t: number): Turn | undefined {
	while (P.unsnapped_head < P.unsnapped.length) {
		const p = P.unsnapped[P.unsnapped_head];
		if (!p.done && !in_viewport.has(p.el) && SNAPSHOT_WAIT_MS - (t - p.queued_at) > 0) return p;
		P.unsnapped_head++;
	}
	P.unsnapped.length = P.unsnapped_head = 0;
	return undefined;
}

/** One turn per call: pick the best pending region, hand it its task; the next pick after a yield. */
function drain(): void {
	drainer.go('idle');
	if (!P.count) return;
	const t = now();
	const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
	// Viewport-first needs the snapshot: hold the FIRST picks until every queued region has
	// reported, or its wait is up (the observer re-drains as reports arrive). A hidden document has
	// no viewport to prefer — skip the wait there.
	if (!hidden) {
		const p = first_unsnapped(t);
		if (p) return drain_after(SNAPSHOT_WAIT_MS - (t - p.queued_at));
	}
	// the best: a region in the viewport before one that is not, connect order within each
	const turn = (heap_top(P.heap_vis, true) ?? heap_top(P.heap_rest, false))!;
	// The best ready island is below the fold while a viewport island is still waiting for its
	// module: hold — that island's turn request (or its settling) re-drains. Bounded, so a chunk
	// that never arrives cannot stall the page.
	if (!hidden && !turn.vis && L.on_screen.size) {
		const left = HOLD_FOR_VIEWPORT_MS - (t - turn.queued_at);
		if (left > 0) return drain_after(left);
	}
	heap_pop(turn.vis ? P.heap_vis : P.heap_rest);
	retire(turn);
	stop_loading(turn.el);
	stop_snapshot(turn.el);
	turn.resolve(); // the island's hydrate step runs as this task's microtask continuation
	if (P.count) schedule_drain(); // the next island in the next task
}

/** Test seam: is a hydration turn queued or being drained right now? */
export function schedule_idle(): boolean {
	return P.count === 0 && drainer.now.kind !== 'queued';
}
