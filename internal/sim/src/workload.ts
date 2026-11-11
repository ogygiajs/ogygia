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
	| { kind: 'deploy' };

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

/** The seed's next action for a world with `tabs` tabs (`deploys`: a deploy may be drawn; the
 *  operator's, not a visitor's, and as rare as one in a session should be). */
export function next_action(
	rng: Rng,
	tabs: number,
	paths: readonly string[],
	deploys = false
): Action {
	const tab = rng.int(Math.max(1, tabs));
	return rng.weighted<Action>([
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
		[{ kind: 'deploy' }, deploys ? 0.6 : 0]
	]);
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
		case 'click': {
			if (tab === undefined) return;
			const found = links(tab, origin);
			if (found.length === 0) return;
			const link = found[a.nth % found.length];
			// (the trace names the link, so a shrunk repro can click it by its address)
			world.loop.note(`${tab.name} clicks ${link.getAttribute('href')}`);
			link.click();
			await world.quiesce();
			return;
		}
		case 'press': {
			if (tab === undefined) return;
			const found = buttons(tab);
			if (found.length === 0) return;
			const button = found[a.nth % found.length];
			const region = button.closest('ogygia-region');
			// (the trace names the button by its region and text, so a shrunk repro can find it)
			world.loop.note(
				`${tab.name} presses "${(button.textContent ?? '').trim().slice(0, 40)}" in ${region?.getAttribute('entry') ?? '?'}`
			);
			button.click();
			await world.quiesce();
			return;
		}
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
