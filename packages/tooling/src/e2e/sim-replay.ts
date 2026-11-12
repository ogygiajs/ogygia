// THE SIMULATOR'S REAL-BROWSER TIER: a run the simulator found interesting (a search's plan, a
// shrunk failure: internal/notes/dst.md), played again in a real browser on the app's build.
// Time is the page's fake clock (`context.clock`), moved on as the simulated run's was; what the
// network did to the run's own requests (a dropped download, a body cut midway) is done again to
// the same request (`context.route`, by method, path and its count on that tab); the visitor's
// actions are the plan's. At rest: no page error, no coded error ogygia said, no machine left in
// a state of work under way, and ogygia's rules (the `page` fixture). What the simulator found is
// attached, to compare.
//
// An app's spec is one call, `sim_replay(<the app's directory>)`, and its plans come from
// SIM_PLANS (a comma list of plan files). A plan of another app is skipped, and so is a generated
// app's plan when the app on disk was written from another seed (`gen` in the plan, `seed` in the
// app's `src/lib/gen/plan.json`) or drew a peer (a peer is a second server, not played yet).
import type { BrowserContext, Page, Route, TestInfo } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { check, moves, sleep, test } from './index.ts';

type Action =
	| { kind: 'click' | 'press'; tab: number; nth: number }
	| { kind: 'goto'; tab: number; path: string }
	| { kind: 'back' | 'forward' | 'reload' | 'offline' | 'online'; tab: number }
	| { kind: 'open'; path: string }
	| { kind: 'wait'; ms: number }
	| { kind: 'deploy' }
	| {
			kind: 'outage';
			tab: number;
			during: 'click' | 'press' | 'wait';
			nth: number;
			after: number;
			lasts: number;
	  };

/** What the network did to one of the run's requests: the `nth` of `method path` its tab made. */
interface WireFault {
	readonly tab: number;
	readonly method: string;
	readonly path: string;
	readonly nth: number;
	readonly kind: 'drop' | 'cut';
}

/** A plan file, as the simulator writes it (internal/sim/src/cli.ts `plan_json`). */
export interface BrowserPlan {
	readonly app: string;
	readonly seed: number;
	/** A generated app's seed, the app the run was on; absent for a hand-written app. */
	readonly gen?: number;
	readonly plan: { readonly actions: readonly Action[] };
	readonly wire?: readonly WireFault[];
	/** What the simulator found on the run. */
	readonly found?: readonly string[];
}

/** The plans SIM_PLANS names, read. */
function plans(): Array<{ file: string; plan: BrowserPlan }> {
	return (process.env.SIM_PLANS ?? '')
		.split(',')
		.filter(Boolean)
		.map((file) => ({ file, plan: JSON.parse(readFileSync(file, 'utf8')) as BrowserPlan }));
}

/** The generated app on disk at `app`: its seed and whether it drew a peer, or null for an app
 *  nobody generated. */
function generated(app: string): { seed: number; peer: boolean } | null {
	const at = join(app, 'src', 'lib', 'gen', 'plan.json');
	if (!existsSync(at)) return null;
	const p = JSON.parse(readFileSync(at, 'utf8')) as { seed: number; peer?: unknown };
	return { seed: p.seed, peer: p.peer != null };
}

/** Why `p` cannot be played on the app at `app`, or null when it can. */
export function unplayable(p: BrowserPlan, app: string): string | null {
	// (by the app's folder name: a plan made in another checkout is still this app's)
	if (basename(p.app) !== basename(app)) return `a plan of ${p.app}`;
	const gen = generated(app);
	if (gen === null) return null;
	if (p.gen !== gen.seed)
		return `a plan of generated app ${p.gen ?? '(unknown)'}, and the app on disk is ${gen.seed}`;
	if (gen.peer) return 'the generated app has a peer (a second server, not played yet)';
	return null;
}

/** Moves the fake clock on by `ms`, a slice at a time, with real time between for the network. */
async function pass(context: BrowserContext, ms: number): Promise<void> {
	for (let left = ms; left > 0; left -= 100) {
		await context.clock.runFor(Math.min(100, left));
		await sleep(10);
	}
}

/** A navigation the visitor made. One the network failed (offline: here every tab's, where the
 *  simulator's is one tab's) shows the browser's error page, as in the simulator, and does not end
 *  the run; anything else (a load that never ends) still does. */
async function navigated(nav: Promise<unknown>): Promise<void> {
	await nav.catch((e: Error) => {
		if (!/net::ERR_|NS_ERROR_|Could not connect|WebKit encountered/.test(e.message)) throw e;
	});
}

const LINKS = 'links' as const;
const BUTTONS = 'buttons' as const;

/** Clicks the `nth` (wrapping) of the page's same-origin links a visitor can follow, or of the
 *  buttons in its regions that are not a form's, in document order (internal/sim/src/workload.ts);
 *  false when there is none. */
async function nth_of(page: Page, list: 'links' | 'buttons', nth: number): Promise<boolean> {
	return page.evaluate(
		([list, nth]) => {
			const found: HTMLElement[] =
				list === 'links'
					? [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(
							(a) => a.href.startsWith(location.origin) && !a.hasAttribute('download') && !a.target
						)
					: [...document.querySelectorAll<HTMLButtonElement>('ogygia-region button')].filter(
							(b) => !b.disabled && b.form === null
						);
			if (found.length === 0) return false;
			found[nth % found.length].click();
			return true;
		},
		[list, nth] as const
	);
}

/** One test per plan SIM_PLANS names, each played on the app at `app` (its directory). */
export function sim_replay(app: string): void {
	const list = plans();
	if (list.length === 0) test('sim replay', () => test.skip(true, 'no SIM_PLANS given'));
	for (const { file, plan: p } of list) {
		test(`sim seed ${p.seed}, ${p.plan.actions.length} actions (${file.split('/').pop()})`, async ({
			page,
			context
		}, info) => {
			const why = unplayable(p, app);
			test.skip(why !== null, why ?? '');
			info.annotations.push({
				type: 'simulator found',
				description: (p.found ?? []).join('\n') || 'nothing'
			});
			await play(p, page, context, info);
		});
	}
}

async function play(
	p: BrowserPlan,
	page: Page,
	context: BrowserContext,
	info: TestInfo
): Promise<void> {
	const errors: string[] = [];
	const tabs: Page[] = [page];
	// each tab's requests, counted by method and path, so a fault meets the request it met
	const counts = new Map<string, number>();
	const watch = (tab: Page) => {
		tab.on('pageerror', (e) => errors.push(`tab ${tabs.indexOf(tab)}: ${e.message}`));
		tab.on('console', (m) => {
			if (m.type() === 'error' && m.text().includes('ogygiajs.dev/e/'))
				errors.push(`tab ${tabs.indexOf(tab)}: ${m.text()}`);
		});
	};
	watch(page);
	// (the requests on the wire, every tab's)
	let flying = 0;
	context.on('request', () => flying++);
	context.on('requestfinished', () => flying--);
	context.on('requestfailed', () => flying--);
	await context.route('**/*', async (route: Route) => {
		const req = route.request();
		const tab = tabs.indexOf(req.frame().page());
		const u = new URL(req.url());
		const key = `${tab} ${req.method()} ${u.pathname}${u.search}`;
		const nth = counts.get(key) ?? 0;
		counts.set(key, nth + 1);
		const fault = p.wire?.find(
			(f) =>
				f.tab === tab &&
				f.method === req.method() &&
				f.path === `${u.pathname}${u.search}` &&
				f.nth === nth
		);
		if (fault?.kind === 'drop') return route.abort('failed');
		// (a body cut midway fails its read, as the simulator's does: the connection resets)
		if (fault?.kind === 'cut') return route.abort('connectionreset');
		return route.continue();
	});
	await context.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
	await page.goto('/');
	await pass(context, 2000);
	for (const [i, a] of p.plan.actions.entries()) {
		const tab = 'tab' in a ? tabs[a.tab % tabs.length] : page;
		switch (a.kind) {
			case 'click':
				await nth_of(tab, LINKS, a.nth);
				break;
			case 'press':
				await nth_of(tab, BUTTONS, a.nth);
				break;
			case 'goto':
				await navigated(tab.goto(a.path));
				break;
			case 'back':
				await navigated(tab.goBack());
				break;
			case 'forward':
				await navigated(tab.goForward());
				break;
			case 'reload':
				await navigated(tab.reload());
				break;
			case 'open': {
				const t = await context.newPage();
				tabs.push(t);
				watch(t);
				await navigated(t.goto(a.path));
				break;
			}
			case 'offline':
			case 'online':
				await context.setOffline(a.kind === 'offline');
				break;
			case 'wait':
				await pass(context, a.ms);
				break;
			case 'deploy':
				info.annotations.push({ type: 'not played', description: `action ${i + 1}: a deploy` });
				break;
			case 'outage':
				if (a.during !== 'wait') await nth_of(tab, a.during === 'click' ? LINKS : BUTTONS, a.nth);
				await pass(context, a.after);
				await context.setOffline(true);
				await pass(context, a.lasts);
				await context.setOffline(false);
				break;
		}
		await pass(context, 1000);
	}
	await context.setOffline(false);
	// AT REST, as the simulator's: nothing on the wire (a server's slow render takes real time,
	// which the page's clock does not move), then the clock run on (20 s real at most)
	const until = Date.now() + 20_000;
	do await pass(context, 1000);
	while (flying > 0 && Date.now() < until);
	await pass(context, 5000);
	// (as in the simulator, a tab the network failed may say why: a fault on one of its requests,
	// or the connection down, which here is every tab's)
	const offline = p.plan.actions.some((a) => a.kind === 'offline' || a.kind === 'outage');
	const faulted = (tab: number) => offline || (p.wire ?? []).some((f) => f.tab === tab);
	const judged = errors.filter((e) => !faulted(Number(/^tab (\d+)/.exec(e)?.[1])));
	if (judged.length < errors.length)
		info.annotations.push({
			type: 'said on a faulted tab',
			description: errors.filter((e) => !judged.includes(e)).join('\n')
		});
	check('no page error, no coded error', judged.length === 0, judged.join('\n'));
	for (const [i, t] of tabs.entries()) {
		const last = new Map<string, string>();
		for (const line of ((await moves(t)) ?? '').split('\n')) {
			const m = /^(\S+) \S+ -> (\S+)$/.exec(line);
			if (m) last.set(m[1], m[2]);
		}
		const held = [...last].filter(([, s]) => s.endsWith('ing'));
		check(
			`tab ${i}: every wait settled`,
			held.length === 0,
			held.map((h) => h.join(' ')).join(', ')
		);
	}
}
