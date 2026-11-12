// THE SIMULATOR'S REAL-BROWSER TIER: a run the simulator found interesting (a search's plan, a
// shrunk failure: internal/notes/dst.md), played again in a real browser on the palaestra's build.
// Time is the page's fake clock (`context.clock`), moved on as the simulated run's was; what the
// network did to the run's own requests (a dropped download, a body cut midway) is done again to
// the same request (`context.route`, by method, path and its count on that tab); the visitor's
// actions are the plan's. At rest: no page error, no coded error ogygia said, no machine left in
// a state of work under way, and ogygia's rules (the `page` fixture). What the simulator found is
// attached, to compare.
//
//   SIM_PLANS=<plan.json>[,<plan.json>...] npx playwright test e2e/sim-replay --project chromium
//
// Skipped without SIM_PLANS. A plan for another app than the palaestra is skipped too.
import type { BrowserContext, Page, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { check, moves, test } from '@ogygia/tooling/e2e';

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

interface BrowserPlan {
	readonly app: string;
	readonly seed: number;
	readonly plan: { readonly actions: readonly Action[] };
	readonly wire?: readonly WireFault[];
	/** What the simulator found on the run. */
	readonly found?: readonly string[];
}

const PLANS = (process.env.SIM_PLANS ?? '').split(',').filter(Boolean);

/** Moves the fake clock on by `ms`, a slice at a time, with real time between for the network. */
async function pass(context: BrowserContext, ms: number): Promise<void> {
	for (let left = ms; left > 0; left -= 100) {
		await context.clock.runFor(Math.min(100, left));
		await new Promise((r) => setTimeout(r, 10));
	}
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

if (PLANS.length === 0) test('sim replay', () => test.skip(true, 'no SIM_PLANS given'));

for (const file of PLANS) {
	const p = JSON.parse(readFileSync(file, 'utf8')) as BrowserPlan;
	test(`sim seed ${p.seed}, ${p.plan.actions.length} actions (${file.split('/').pop()})`, async ({
		page,
		context
	}, info) => {
		test.skip(!p.app.endsWith('palaestra'), `a plan of ${p.app}`);
		info.annotations.push({
			type: 'simulator found',
			description: (p.found ?? []).join('\n') || 'nothing'
		});
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
			if (fault?.kind === 'cut') {
				const res = await route.fetch();
				const body = await res.body();
				return route.fulfill({ response: res, body: body.subarray(0, body.length >> 1) });
			}
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
					await tab.goto(a.path);
					break;
				case 'back':
					await tab.goBack().catch(() => null); // ok: no page before it, as in the sim
					break;
				case 'forward':
					await tab.goForward().catch(() => null); // ok: no page after it, as in the sim
					break;
				case 'reload':
					await tab.reload();
					break;
				case 'open': {
					const t = await context.newPage();
					tabs.push(t);
					watch(t);
					await t.goto(a.path);
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
		await pass(context, 5000);
		check('no page error, no coded error', errors.length === 0, errors.join('\n'));
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
	});
}
