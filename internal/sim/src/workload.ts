/**
 * THE WORKLOAD: what visitors do, drawn from the seed. It drives a real app from what its pages
 * offer: links it finds on the page (clicked, so the app's own router sees the click), back,
 * forward, reload, a new tab, going offline and back, and time passing. Each action is plain data,
 * so a failing run's actions can be printed, shrunk and replayed.
 */
import type { Tab, Visitor } from './browser.ts';
import type { Rng } from './rng.ts';
import type { World } from './world.ts';

export type Action =
	| { kind: 'click'; tab: number; nth: number }
	| { kind: 'press'; tab: number; nth: number }
	| { kind: 'goto'; tab: number; path: string }
	| { kind: 'back' | 'forward' | 'reload'; tab: number }
	| { kind: 'open'; path: string }
	| { kind: 'offline' | 'online'; tab: number }
	| { kind: 'wait'; ms: number }
	| { kind: 'deploy' }
	/** Follow link `nth`, stay `ms` on the next page, then go back: a page left a while and come back
	 *  to (10 to 50 s: under the 60 s its hole answers linger for a quick return). */
	| { kind: 'away'; tab: number; nth: number; ms: number }
	/** Click link `nth`, then link `then` `after` ms later, before the first navigation lands: a
	 *  navigation called off midway (claimed again while loading or settling, its stage discarded). */
	| { kind: 'hurry'; tab: number; nth: number; next: number; after: number }
	/** Point at link or region `nth` (of both, in document order) without clicking: the router warms
	 *  a hovered link's page, an island's code is warmed on intent. */
	| { kind: 'hover'; tab: number; nth: number }
	/** Go to `path` and press button `nth` `after` ms in, while the page still loads: an input before
	 *  the first paint, or during the wait for the page's critical resources. */
	| { kind: 'eager'; tab: number; path: string; nth: number; after: number }
	| {
			kind: 'outage';
			tab: number;
			/** What the visitor does as it starts: follow a link, press a button, or nothing (a live
			 *  stream or a hole's fetch already on its way). */
			during: 'click' | 'press' | 'wait';
			nth: number;
			/** ms after that before the connection drops, and how long it stays down. */
			after: number;
			lasts: number;
	  };

export function describe(a: Action): string {
	switch (a.kind) {
		case 'click':
			return `tab ${a.tab}: click link #${a.nth}`;
		case 'press':
			return `tab ${a.tab}: press button #${a.nth}`;
		case 'goto':
			return `tab ${a.tab}: go to ${a.path}`;
		case 'open':
			return `new tab at ${a.path}`;
		case 'wait':
			return `wait ${a.ms} ms`;
		case 'deploy':
			return 'deploy the next build';
		case 'away':
			return `tab ${a.tab}: follow link #${a.nth}, come back ${a.ms} ms later`;
		case 'hurry':
			return `tab ${a.tab}: click link #${a.nth}, then link #${a.next} ${a.after} ms later`;
		case 'hover':
			return `tab ${a.tab}: point at link or region #${a.nth}`;
		case 'eager':
			return `tab ${a.tab}: go to ${a.path}, press button #${a.nth} ${a.after} ms in`;
		case 'outage':
			return `tab ${a.tab}: ${a.during === 'wait' ? 'an outage' : `${a.during} #${a.nth}, then an outage`} ${a.after} ms in, for ${a.lasts} ms`;
		default:
			return `tab ${a.tab}: ${a.kind}`;
	}
}

/** Same-origin links on a tab's page, in document order. */
export function links(tab: Tab, origin: string): HTMLAnchorElement[] {
	const doc = tab.page.mainFrame.document as unknown as Document;
	return [...doc.querySelectorAll('a[href]')].filter((a) => {
		const href = (a as HTMLAnchorElement).href;
		return (
			href.startsWith(origin) &&
			!(a as HTMLAnchorElement).hasAttribute('download') &&
			!(a as HTMLAnchorElement).target
		);
	}) as HTMLAnchorElement[];
}

/** The buttons in a tab's regions, in document order: what a visitor presses in an island, woken
 *  or not yet (a press before its code came is replayed once it wakes). */
export function buttons(tab: Tab): HTMLButtonElement[] {
	const doc = tab.page.mainFrame.document as unknown as Document;
	// (not a form's: a submit is a navigation of its own)
	return [...doc.querySelectorAll('ogygia-region button')].filter(
		(b) => !(b as HTMLButtonElement).disabled && (b as HTMLButtonElement).form === null
	) as HTMLButtonElement[];
}

/** A workload's mix: each kind of action's weight, times this (a swarm over what visitors do: a
 *  run that never presses, one that mostly goes back and forth). Unnamed kinds keep theirs. */
export type Mix = Readonly<Partial<Record<Action['kind'], number>>>;

/** The kinds a mix weighs. */
export const ACTION_KINDS: readonly Action['kind'][] = [
	'click',
	'press',
	'goto',
	'back',
	'forward',
	'reload',
	'open',
	'offline',
	'online',
	'wait',
	'deploy',
	'outage',
	'away',
	'hurry',
	'hover',
	'eager'
];

/** The seed's next action for a world with `tabs` tabs (`deploys`: a deploy may be drawn; the
 *  operator's, not a visitor's, and as rare as one in a session should be), weighed by `mix`. */
export function next_action(
	rng: Rng,
	tabs: number,
	paths: readonly string[],
	deploys = false,
	mix?: Mix
): Action {
	const tab = rng.int(Math.max(1, tabs));
	return rng.weighted<Action>(
		choices(rng, tab, tabs, paths, deploys).map(([a, w]) => [a, w * (mix?.[a.kind] ?? 1)])
	);
}

/** Every action the next could be, with its weight (each drawn in full: the draws stay the same
 *  whatever the weights). */
function choices(
	rng: Rng,
	tab: number,
	tabs: number,
	paths: readonly string[],
	deploys: boolean
): Array<[Action, number]> {
	return [
		[{ kind: 'click', tab, nth: rng.int(1000) }, 8],
		[{ kind: 'press', tab, nth: rng.int(1000) }, 4],
		[{ kind: 'goto', tab, path: rng.pick(paths) }, 2],
		[{ kind: 'back', tab }, 2],
		[{ kind: 'forward', tab }, 1],
		[{ kind: 'reload', tab }, 1],
		[{ kind: 'open', path: rng.pick(paths) }, tabs < 3 ? 1 : 0],
		[{ kind: 'offline', tab }, 0.5],
		[{ kind: 'online', tab }, 1],
		[{ kind: 'wait', ms: rng.pick([16, 100, 1000, 5000]) }, 2],
		// (weight 0 when there is nothing to deploy: the draw is then the same as without it)
		[{ kind: 'deploy' }, deploys ? 0.6 : 0],
		// the connection dropping for a while, as on a train: mid-navigation, mid-press, mid-stream
		[
			{
				kind: 'outage',
				tab,
				during: rng.pick(['click', 'press', 'wait'] as const),
				nth: rng.int(1000),
				after: rng.pick([0, 5, 20, 100, 500]),
				lasts: rng.pick([1000, 5000, 30_000, 120_000])
			},
			1
		],
		[
			{
				kind: 'away',
				tab,
				nth: rng.int(1000),
				ms: rng.pick([10_000, 20_000, 35_000, 50_000])
			},
			1
		],
		[
			{
				kind: 'hurry',
				tab,
				nth: rng.int(1000),
				next: rng.int(1000),
				after: rng.pick([0, 5, 20, 60, 150, 300])
			},
			1
		],
		[{ kind: 'hover', tab, nth: rng.int(1000) }, 2],
		[
			{
				kind: 'eager',
				tab,
				path: rng.pick(paths),
				nth: rng.int(1000),
				after: rng.pick([0, 5, 20, 60, 150, 300])
			},
			1
		]
	];
}

/** A visitor's click on `el`: the pointer goes down and up on it, then the click, as a browser
 *  sends them (`element.click()` alone sends only the click, and the page never hears an input). */
export function user_click(el: Element): void {
	const view = el.ownerDocument.defaultView as Window & typeof globalThis;
	const at = { bubbles: true, cancelable: true, composed: true, button: 0 };
	el.dispatchEvent(new view.PointerEvent('pointerdown', { ...at, buttons: 1, isPrimary: true }));
	el.dispatchEvent(new view.MouseEvent('mousedown', { ...at, buttons: 1 }));
	el.dispatchEvent(new view.PointerEvent('pointerup', { ...at, isPrimary: true }));
	el.dispatchEvent(new view.MouseEvent('mouseup', at));
	(el as HTMLElement).click();
}

/** Clicks link `nth` (of the tab's links, wrapping); false when it has none. */
function click(world: World, tab: Tab, nth: number, origin: string): boolean {
	const found = links(tab, origin);
	if (found.length === 0) return false;
	const link = found[nth % found.length];
	// (the trace names the link, so a shrunk repro can click it by its address)
	world.loop.note(`${tab.name} clicks ${link.getAttribute('href')}`);
	user_click(link);
	return true;
}

/** Presses button `nth` in the tab's regions (wrapping); false when it has none. */
function press(world: World, tab: Tab, nth: number): boolean {
	const found = buttons(tab);
	if (found.length === 0) return false;
	const button = found[nth % found.length];
	const region = button.closest('ogygia-region');
	// (the trace names the button by its region and text, so a shrunk repro can find it)
	world.loop.note(
		`${tab.name} presses "${(button.textContent ?? '').trim().slice(0, 40)}" in ${region?.getAttribute('entry') ?? '?'}`
	);
	user_click(button);
	return true;
}

/** Does `a` in `world`, as `visitor`; runs the world to rest after it. */
export async function act(
	world: World,
	visitor: Visitor,
	a: Action,
	origin: string
): Promise<void> {
	const tab = 'tab' in a ? visitor.tabs[a.tab % Math.max(1, visitor.tabs.length)] : undefined;
	switch (a.kind) {
		case 'click':
			if (tab !== undefined && click(world, tab, a.nth, origin)) await world.quiesce();
			return;
		case 'press':
			if (tab !== undefined && press(world, tab, a.nth)) await world.quiesce();
			return;
		case 'outage': {
			if (tab === undefined) return;
			if (a.during === 'click') click(world, tab, a.nth, origin);
			else if (a.during === 'press') press(world, tab, a.nth);
			await world.loop.run(a.after);
			world.loop.note(`${tab.name} goes offline`);
			world.network.offline(tab.name, true);
			await world.loop.run(a.lasts);
			world.loop.note(`${tab.name} is back online`);
			world.network.offline(tab.name, false);
			await world.quiesce();
			return;
		}
		case 'away':
			if (tab === undefined || !click(world, tab, a.nth, origin)) return;
			await world.quiesce();
			await world.loop.run(a.ms);
			await world.go(tab, 'back');
			return;
		case 'hover': {
			if (tab === undefined) return;
			const doc = tab.page.mainFrame.document as unknown as Document;
			const found = [...links(tab, origin), ...doc.querySelectorAll('ogygia-region')];
			if (found.length === 0) return;
			const target = found[a.nth % found.length];
			world.loop.note(
				`${tab.name} points at ${target.getAttribute('href') ?? target.getAttribute('entry') ?? target.tagName}`
			);
			const view = tab.page.mainFrame.window as unknown as Window & typeof globalThis;
			for (const type of ['pointerover', 'mouseover'])
				target.dispatchEvent(
					new (type === 'pointerover' ? view.PointerEvent : view.MouseEvent)(type, {
						bubbles: true,
						composed: true
					})
				);
			await world.quiesce();
			return;
		}
		case 'hurry':
			if (tab === undefined || !click(world, tab, a.nth, origin)) return;
			await world.loop.run(a.after);
			click(world, tab, a.next, origin);
			await world.quiesce();
			return;
		case 'eager':
			if (tab === undefined) return;
			await world.start(tab, 'goto', a.path, a.after);
			press(world, tab, a.nth);
			await world.quiesce();
			return;
		case 'goto':
			if (tab) await world.go(tab, 'goto', a.path);
			return;
		case 'back':
		case 'forward':
		case 'reload':
			if (tab) await world.go(tab, a.kind);
			return;
		case 'open': {
			const t = world.tab(visitor);
			await world.go(t, 'goto', a.path);
			return;
		}
		case 'offline':
		case 'online':
			if (tab) world.network.offline(tab.name, a.kind === 'offline');
			await world.quiesce(1000);
			return;
		case 'wait':
			await world.loop.run(a.ms);
			return;
		case 'deploy':
			if (await world.deploy_next()) await world.quiesce(1000);
			return;
	}
}
