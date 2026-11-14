import {
	flights,
	machine,
	noop,
	registry,
	STALE,
	type Machine,
	type Scope,
	type Stale
} from '@ogygia/machine';
import { LoadSlot } from './load-scheduler.ts';
import { import_again } from './import-again.ts';
import { slots } from './slots.ts';
import { warm_island_module } from './region-endpoint-url.ts';
import { island_entry_of } from './entry-locations.ts';
import { OgygiaError } from '../messages/core.ts';
import { download } from '../policies.ts';
import { OG_WOKE } from '../wire-markup.ts';

/** Feature entry: fill the `interaction` slot — wake a cold island on first use, warm on hover. */
export function install(): void {
	slots.interaction = (el, fire, owner) => {
		const warm = () => {
			const entry = island_entry_of(el);
			if (entry) warm_island_module(entry, undefined, 'user');
		};
		return arm_interaction(el, warm, fire, owner);
	};
}

const WAKE_EVENTS = ['pointerdown', 'keydown', 'focusin', 'click'] as const;
const ARMED_SELECTOR = 'ogygia-region';

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

const arming_steps = {
	armed: ['woken'],
	woken: ['over'],
	over: []
} as const;

const arming_definition = machine<{ armed: {}; woken: {}; over: {} }>()({
	name: 'interaction-arming',
	initial: 'armed',
	steps: arming_steps
});

type Arming = Machine<{ armed: {}; woken: {}; over: {} }, typeof arming_steps>;

type Armed = {
	region: Element;
	warm: () => void;
	fire: WakeFn;
	owner: Scope;
	arming: Arming;
	warmed: boolean;
	queued: QueuedClick[];
	forget: () => void;
};

function disarm(a: Armed, over: boolean): void {
	a.forget();
	if (over) a.arming.move('woken', 'over');
}

const armed = registry.keyed<Element, Armed>();
let installed = false;

type Replay = typeof import('./interaction-replay.ts');
const load_replay = flights({
	name: 'interaction replay',
	run: import_again(() => import('./interaction-replay.ts')),
	retry: download
});
function replay(): Promise<Replay | Stale> {
	slots.interaction_link ??= { resolve_address };
	return load_replay.get();
}

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

// @why a synthetic (untrusted) click cannot open a new tab or window (test: test/browser/interaction-delegated.test.ts › a click that opens a link elsewhere is never canceled (an untrusted replay could not open it))
function opens_elsewhere(e: MouseEvent, target: Element): boolean {
	return (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) && !!target.closest('a[href]');
}

function on_wake_event(e: Event): void {
	if (armed.size === 0) return;
	const a = armed_region_of(e.target);
	if (a) wake(a, e);
}

function on_warm_event(e: Event): void {
	if (armed.size === 0) return;
	const a = armed_region_of(e.target);
	if (!a || a.warmed) return;
	a.warmed = true;
	a.warm();
	// oxlint-disable-next-line ogygia/no-silent-failures -- a warm ahead; the press loads it again and says a failure
	replay().catch(() => {});
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
	if (
		e.type === 'click' &&
		e.target instanceof Element &&
		!opens_elsewhere(e as MouseEvent, e.target)
	) {
		const addr = element_address(region, e.target);
		if (addr) {
			const me = e as MouseEvent;
			e.preventDefault();
			e.stopPropagation();
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
	if (!a.arming.move('armed', 'woken')) return;
	region.setAttribute(OG_WOKE, 'interaction');

	const fields = snapshot_fields(region);
	const active = document.activeElement;
	const active_addr =
		active instanceof Element && region.contains(active) ? element_address(region, active) : null;

	const replayed = replay();
	Promise.all([replayed, Promise.resolve(a.fire(replayed))]).then(
		([r]) => {
			if (a.arming.now.kind === 'over') return;
			disarm(a, false);
			if (r !== STALE) r.after_wake(region, fields, active_addr, queued, a.owner);
		},
		(err) => {
			if (a.arming.now.kind === 'over') return;
			disarm(a, false);
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
	const a: Armed = {
		region,
		warm,
		fire,
		owner,
		arming: arming_definition.create(),
		warmed: false,
		queued: [],
		forget: noop
	};
	a.forget = armed.set(region, a, owner);
	install_listeners();
	replay_ahead();
	return (over = false) => disarm(a, over);
}

let replay_queued = false;

function replay_ahead(): void {
	if (replay_queued) return;
	replay_queued = true;
	// oxlint-disable-next-line ogygia/no-silent-failures -- a slot's turn never fails; a failed download is asked for again by the press, which says it
	void new LoadSlot({ kind: 'code', cls: 'ahead', label: 'interaction replay' }).ready.then(
		(release) => {
			replay_queued = false;
			if (armed.size === 0) return release();
			replay().then(release, release);
		}
	);
}
