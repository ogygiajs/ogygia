/**
 * WHAT A VISITOR DOES BEFORE AN ISLAND IS LIVE IS NOT LOST. `wake: 'interaction'` — the island sleeps
 * until someone uses it; and every scheduled island (`load` / `idle` / `visible` / media) is armed the
 * same way until it is live, since its server markup has no handlers either: a press on it wakes it at
 * once (a gesture), and the click is replayed when it is live.
 *
 * WAKE (capture-phase): `pointerdown` | `keydown` | `focusin` | `click`. The first of these starts
 * hydration. WARM (not a wake): the pointer moving over the region prefetches the island module, so
 * by the time the press lands the chunk is usually cached and the wake is one microtask.
 *
 * DELEGATED: the listeners live on the DOCUMENT, once — five per armed island used to be five
 * hundred on a page of interaction islands. An event resolves to the nearest ARMED region above its
 * target (`closest`, walking up past nested regions that are not armed) and that region's state
 * handles it exactly as its own capture listener did.
 *
 * HYDRATION REPLACES NODES. Svelte's hydrate pass may recreate the region's DOM, so nothing
 * captured before the wake can be replayed/restored by node reference — the original elements are
 * disconnected afterwards. Everything below is therefore re-resolved POSITIONALLY: an element is
 * recorded as its child-index path from the region ("address"), and after hydration the element
 * now sitting at that address receives the replay/restore. The hydrated markup mirrors the SSR
 * markup (same component, same props), so addresses stay valid; a tag-name check guards drift.
 *
 * WHAT SURVIVES THE WAKE:
 * - **Clicks are queued + replayed.** While waking, `click` events are `preventDefault()`ed and
 *   recorded (address + coordinates); after hydration each re-dispatches at its address. Cancel-
 *   then-replay means a checkbox / link / summary activates exactly ONCE — on the replay, where
 *   the island's handlers exist. Enter/Space activation arrives as a derived click → same path.
 * - **Typing lands natively and is restored.** Characters are in the DOM before hydration starts;
 *   hydration resets `.value` from SSR state, so field values (+ checkedness + selection) are
 *   snapshotted at wake and re-applied at the field's address, with `input`/`change` events so
 *   `bind:` syncs. Keydowns are never synthetically replayed (untrusted keys produce no text).
 * - **Focus is restored** at the focused element's address.
 *
 * Replayed events are NOT trusted user gestures (`event.isTrusted === false`): `window.open`,
 * clipboard, fullscreen from the first interaction will be blocked by the browser, and a component
 * that ignores untrusted clicks ignores the replay. Components can detect the situation via
 * `hydratedBy() === 'interaction'`. A click that opens a link elsewhere (a modifier or the middle
 * button) is never canceled: the browser does it on the server markup, and an untrusted replay could not.
 *
 * The capture (this module) is what must run synchronously inside the first event. The RESTORE +
 * REPLAY half (./interaction-replay.ts) is only needed once an island has woken, so it is off the
 * boot path: asked for as background work once an island arms (`replay_ahead`), and at once when a
 * pointer reaches an armed island or input lands.
 */

import { flights, STALE, type Scope, type Stale } from '@ogygia/machine';
import { LoadSlot } from './load-scheduler.ts';
import { import_again } from './import-again.ts';
import { slots } from './slots.ts';
import { warm_island_module } from './region-endpoint-url.ts';
import { island_entry_of } from './entry-locations.ts';
import { OgygiaError } from '../messages/core.ts';
import { download } from '../policies.ts';

/** Feature entry: fill the `interaction` slot — wake a cold island on first use, warm on hover. */
export function install(): void {
	slots.interaction = (el, fire, owner) => {
		const warm = () => {
			const entry = island_entry_of(el);
			if (entry) warm_island_module(entry, undefined, 'user'); // a hover: the visitor is reaching for it
		};
		return arm_interaction(el, warm, fire, owner);
	};
}

const WAKE_EVENTS = ['pointerdown', 'keydown', 'focusin', 'click'] as const;
// any region: an `interaction` one, and a scheduled one (`load` / `idle` / `visible` / media) not live
// yet — the `armed` map says which are armed
const ARMED_SELECTOR = 'ogygia-region';

/** Form controls whose typed value must survive hydration. */
const VALUE_SELECTOR = 'input, textarea, select';

/** Child-index path from `region` down to `el` — survives node replacement by position. */
export function element_address(region: Element, el: Element): number[] | null {
	const addr: number[] = [];
	let node: Element = el;
	while (node !== region) {
		const parent = node.parentElement;
		if (!parent) return null;
		addr.unshift(Array.prototype.indexOf.call(parent.children, node));
		node = parent;
	}
	return addr;
}

/** The element now sitting at `addr` under `region` (post-hydration), or null. */
export function resolve_address(region: Element, addr: number[]): Element | null {
	let node: Element = region;
	for (const i of addr) {
		const next = node.children[i];
		if (!next) return null;
		node = next;
	}
	return node;
}

export type FieldSnapshot = {
	/** The PRE-hydration node. Values are read from it AT RESTORE TIME: the wake fires on the very
	 * first keydown — BEFORE that key's character has landed — and more keystrokes land in this
	 * node while the island loads. A detached node keeps its `.value`, so at restore it holds
	 * everything the user typed up to the moment hydration swapped it out. */
	el: HTMLInputElement;
	addr: number[];
	tag: string;
};

function snapshot_fields(region: Element): FieldSnapshot[] {
	const out: FieldSnapshot[] = [];
	for (const el of region.querySelectorAll(VALUE_SELECTOR)) {
		const addr = element_address(region, el);
		if (!addr) continue;
		out.push({ el: el as HTMLInputElement, addr, tag: el.tagName });
	}
	return out;
}

/**
 * Wake the island for a visitor. `replayed` is what replays their input once it is live (the replay
 * half, loading): the island's wake waits for it before it goes live, so the input lands AT wake. An
 * island that went live first left the replay to come in later, over a slow network, beside the
 * visitor's next click (#260). Resolves when the island is live; rejects when it failed to wake.
 */
export type WakeFn = (replayed: Promise<unknown>) => Promise<void> | void;

export type QueuedClick = {
	addr: number[];
	/** The deepest node of the click's composed path when it lies INSIDE a web component's shadow
	 *  tree (a design-system button's inner <button>): a host-level replay never reaches the shadow-internal
	 *  handler that actually toggles the component, so the replay lands here instead. */
	deep: EventTarget | null;
	tag: string;
	init: MouseEventInit;
};

/**
 * One arming of a region — what its own capture listeners used to close over. Each arming is its
 * own: a region put back after it left arms a new one, and only the arming that holds the region's
 * entry may delete it. `state`: `armed` (waiting for a visitor), `woken` (its wake is out, its clicks
 * queue), `over` (disarmed while woken because the region left: its wake's end replays nothing).
 */
type Armed = {
	region: Element;
	warm: () => void;
	fire: WakeFn;
	/** the region's lifetime in the page: the replay's frame is its */
	owner: Scope;
	state: 'armed' | 'woken' | 'over';
	warmed: boolean;
	queued: QueuedClick[];
};

/**
 * Ends an arming: its entry goes, if it is still the region's (a newer arming's stays). `over`: the
 * region left the page while it was woken — the visit that queued its clicks is over, and they go
 * with it (the region that comes back is server markup of a new visit, with a capture of its own).
 */
function disarm(a: Armed, over: boolean): void {
	if (armed.get(a.region) === a) armed.delete(a.region);
	if (over && a.state === 'woken') a.state = 'over';
}

const armed = new Map<Element, Armed>();
let installed = false;

/** THE REPLAY HALF, loaded once, when the first region arms. A download that fails is tried again
 *  at once and never kept: the next wake (or the failure path below) loads it afresh. */
type Replay = typeof import('./interaction-replay.ts');
const load_replay = flights({
	name: 'interaction replay',
	run: import_again(() => import('./interaction-replay.ts')),
	retry: download
});
/** (Never STALE: nothing drops the replay half.) */
function replay(): Promise<Replay | Stale> {
	// Link what the replay chunk uses from this module right where the chunk is loaded, so whoever
	// loads it (the feature's arm, or a direct `arm_interaction`) has linked it (./slots.ts `BootLink`).
	slots.interaction_link ??= { resolve_address };
	return load_replay.get();
}

/** The nearest ARMED region above an event's target (past nested regions that are not armed), never
 *  past a live one: a click inside an awake island is that island's, whatever sleeps around it. */
function armed_region_of(target: EventTarget | null): Armed | null {
	let el = target instanceof Element ? target.closest(ARMED_SELECTOR) : null;
	while (el) {
		const a = armed.get(el);
		if (a) return a;
		if (el.hasAttribute('data-hydrated')) return null;
		el = el.parentElement?.closest(ARMED_SELECTOR) ?? null;
	}
	return null;
}

/** A click that opens a link elsewhere (a new tab or window): the browser does it on the server markup,
 *  and a replayed — untrusted — click could not. */
function opens_elsewhere(e: MouseEvent, target: Element): boolean {
	return (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) && !!target.closest('a[href]');
}

function on_wake_event(e: Event): void {
	if (armed.size === 0) return;
	const a = armed_region_of(e.target);
	if (a) wake(a, e);
}

/** `pointerover` bubbles (unlike `pointerenter`) — the pointer crossing INTO an armed region, from
 *  any descendant, warms its module once. */
function on_warm_event(e: Event): void {
	if (armed.size === 0) return;
	const a = armed_region_of(e.target);
	if (!a || a.warmed) return;
	a.warmed = true;
	a.warm();
	// the pointer is reaching for an island: the replay half, ahead of its press (a warm: a download
	// that fails is asked for again by the press, which says its failure)
	replay().catch(() => {}); // ok: a warm ahead; the press loads it again and says a failure
}

function install_listeners(): void {
	if (installed) return;
	installed = true;
	for (const type of WAKE_EVENTS)
		// oxlint-disable-next-line ogygia/owned-effects -- the wake delegation, installed once (`installed`) for every armed region: it lives as long as the document
		document.addEventListener(type, on_wake_event, { capture: true });
	// oxlint-disable-next-line ogygia/owned-effects -- the warm delegation, installed once beside the wake's: it lives as long as the document
	document.addEventListener('pointerover', on_warm_event, { capture: true, passive: true });
}

function wake(a: Armed, e: Event): void {
	const { region, queued } = a;
	// While waking (and before), clicks are canceled + queued: their activation happens once,
	// on the replay, when the island's handlers exist. Everything else passes through natively.
	if (
		e.type === 'click' &&
		e.target instanceof Element &&
		!opens_elsewhere(e as MouseEvent, e.target)
	) {
		const addr = element_address(region, e.target);
		if (addr) {
			const me = e as MouseEvent;
			e.preventDefault();
			// `e.target` is already retargeted to the shadow HOST; keep the real deepest node too.
			const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
			const deep = path.length && path[0] !== e.target ? path[0] : null;
			queued.push({
				addr,
				deep,
				tag: e.target.tagName,
				init: {
					bubbles: true,
					cancelable: true,
					composed: true,
					clientX: me.clientX,
					clientY: me.clientY,
					button: me.button,
					ctrlKey: me.ctrlKey,
					metaKey: me.metaKey,
					shiftKey: me.shiftKey,
					altKey: me.altKey,
					detail: me.detail
				}
			});
		}
	}
	if (a.state !== 'armed') return;
	a.state = 'woken';
	// what woke it, for `hydratedBy()` (hydration-info.ts): a visitor did — its first click is a replay,
	// whatever schedule the island had
	region.setAttribute('data-og-woke', 'interaction');

	// Typed-so-far values + focus, captured as ADDRESSES (hydration may replace the nodes).
	const fields = snapshot_fields(region);
	const active = document.activeElement;
	const active_addr =
		active instanceof Element && region.contains(active) ? element_address(region, active) : null;

	const replayed = replay();
	Promise.all([replayed, Promise.resolve(a.fire(replayed))]).then(
		([r]) => {
			if (a.state === 'over') return;
			disarm(a, false);
			if (r !== STALE) r.after_wake(region, fields, active_addr, queued, a.owner);
		},
		(err) => {
			if (a.state === 'over') return;
			// Hydration FAILED (chunk 404, network drop). Disarm so the region stops canceling
			// clicks — native behavior (links, form posts, checkboxes) must keep working on the
			// dead-but-real HTML. Replay the swallowed clicks so the failed one still acts.
			disarm(a, false);
			// (the replay half itself may be what failed: asked for again; if it fails again the
			// clicks are lost, and said so, never left as an unhandled rejection)
			replay().then(
				(r) => r !== STALE && r.replay_clicks(region, queued, a.owner),
				(again: unknown) => console.error(new OgygiaError('interaction_hydrate_failed'), again)
			);
			console.error(new OgygiaError('interaction_hydrate_failed'), err);
		}
	);
}

/**
 * Arm a cold `wake="interaction"` region.
 *
 * @param region the `<ogygia-region>` element
 * @param warm   prefetch the island module (no hydrate) — wired to the pointer entering the region
 * @param fire   begin hydration ({@link WakeFn}); resolves when the island is live
 * @param owner  the region's lifetime in the page: the frame its clicks replay in is its
 * @returns disarm(over?) — end this arming (the island is live or failed, or the region left
 *          before any interaction); `over`: the region left while it was woken, so its queued clicks
 *          are dropped instead of replayed
 */
export function arm_interaction(
	region: Element,
	warm: () => void,
	fire: WakeFn,
	owner: Scope
): (over?: boolean) => void {
	const a: Armed = { region, warm, fire, owner, state: 'armed', warmed: false, queued: [] };
	armed.set(region, a);
	install_listeners();
	replay_ahead();
	return (over = false) => disarm(a, over);
}

/** The replay half's warm is queued (one at a time: the first island armed while none is). */
let replay_queued = false;

/**
 * THE REPLAY HALF, ASKED FOR AHEAD OF THE VISITOR (#451). A click before wake waits for it (the
 * island goes live with it, #260); asked for only at that click, on a slow phone it queued behind the
 * page's other downloads and the wake waited it out. It is background work, timed by the load
 * scheduler (load-scheduler.ts: after the page's critical resources, in the background window), so
 * it never delays the hero. When its turn comes with no island left armed (they all woke on their
 * own, nobody touched one), it is not needed and nothing is fetched.
 */
function replay_ahead(): void {
	if (replay_queued) return;
	replay_queued = true;
	void new LoadSlot({ kind: 'code', cls: 'ahead', label: 'interaction replay' }).ready.then(
		(release) => {
			replay_queued = false;
			if (armed.size === 0) return release();
			replay().then(release, release);
		}
	); // ok: a slot's turn never fails; a failed download is asked for again by the press, which says it
}
