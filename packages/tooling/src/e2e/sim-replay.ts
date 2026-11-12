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
	| { kind: 'away'; tab: number; nth: number; ms: number }
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

/** What a page's performance observers reported (Chromium only): a layout shift that came right
 *  after a region's content changed, or a script that ran over 50 ms. */
export type PerfEntry =
	| {
			kind: 'shift';
			tab: number;
			url: string;
			value: number;
			regions: string[];
	  }
	| {
			kind: 'task';
			tab: number;
			url: string;
			duration: number;
			source: string;
			fn: string;
	  };

/** CLS at or over this, from regions filling in, in one document, fails the run (web.dev's "poor"
 *  starts above 0.25, "good" ends at 0.1). */
export const REGION_SHIFT_LIMIT = 0.1;
/** A task at or over this, in a file of ogygia's, fails the run (the long-task line). */
export const LONG_TASK_MS = 50;

/**
 * Judges what the observers reported. `owned`: is the file at a URL ogygia's code (its runtime, or a
 * chunk that holds its coded messages)? Each region-caused shift and each long task is noted; a
 * document whose region-caused shifts add up to {@link REGION_SHIFT_LIMIT}, and a long task in
 * ogygia's code, fail.
 */
export function judge_perf(
	entries: readonly PerfEntry[],
	owned: (url: string) => boolean
): { noted: string[]; failing: string[] } {
	const noted: string[] = [];
	const failing: string[] = [];
	const by_doc = new Map<string, number>();
	for (const e of entries) {
		if (e.kind === 'shift') {
			const doc = `tab ${e.tab} ${e.url}`;
			by_doc.set(doc, (by_doc.get(doc) ?? 0) + e.value);
			noted.push(`${doc}: a shift of ${e.value.toFixed(4)} after ${e.regions.join(', ')}`);
		} else {
			const line = `tab ${e.tab} ${e.url}: a ${Math.round(e.duration)} ms task in ${e.source}${e.fn ? ` (${e.fn})` : ''}`;
			noted.push(line);
			if (e.duration >= LONG_TASK_MS && owned(e.source)) failing.push(`ogygia's code: ${line}`);
		}
	}
	for (const [doc, sum] of by_doc)
		if (sum >= REGION_SHIFT_LIMIT)
			failing.push(`${doc}: regions filling in shifted the layout by ${sum.toFixed(4)}`);
	return { noted, failing };
}

/**
 * Runs in every document before its own scripts (Chromium): a MutationObserver notes when a
 * region's content changes once the page is parsed, a `layout-shift` observer sends each shift no
 * input caused that came within 100 ms of such a change (with the regions), and a
 * `long-animation-frame` observer sends each script that ran over 50 ms. Time is a new
 * `PerformanceMark`'s, the browser's own clock, as the entries' are: the page's `performance.now`
 * and an event's `timeStamp` follow the fake clock.
 */
export function perf_watch(): void {
	type Sent = Record<string, unknown>;
	const w = window as unknown as {
		__sim_perf?: (e: Sent) => void;
		__sim_input?: () => void;
	};
	const send = (e: Sent) => void w.__sim_perf?.({ ...e, url: location.href });
	const now = () => new PerformanceMark('sim').startTime;
	let parsed = false;
	// oxlint-disable-next-line ogygia/owned-effects -- runs in the replayed page (an init script, no imports): the document's record for its whole life
	document.addEventListener('DOMContentLoaded', () => (parsed = true));
	let input = -Infinity;
	w.__sim_input = () => (input = now());
	const fills: Array<{ t: number; region: string }> = [];
	const KEEP = ['entry', 'wake', 'render', 'when', 'endpoint'];
	const describe = (el: Element) =>
		`<ogygia-region${[...el.attributes]
			.filter((a) => KEEP.includes(a.name))
			.map((a) => ` ${a.name}="${a.value.slice(0, 48)}"`)
			.join('')}>`;
	// oxlint-disable-next-line ogygia/owned-effects -- runs in the replayed page (an init script, no imports): the document's record for its whole life
	new MutationObserver((records) => {
		if (!parsed) return;
		const t = now();
		for (const r of records) {
			const at = r.target instanceof Element ? r.target : r.target.parentElement;
			const region = at?.closest('ogygia-region');
			if (region) fills.push({ t, region: describe(region) });
		}
		if (fills.length > 200) fills.splice(0, fills.length - 200);
	}).observe(document, { childList: true, subtree: true, characterData: true });
	try {
		// oxlint-disable-next-line ogygia/owned-effects -- runs in the replayed page (an init script, no imports): the document's record for its whole life
		new PerformanceObserver((list) => {
			for (const e of list.getEntries() as unknown as Array<{
				startTime: number;
				value: number;
				hadRecentInput: boolean;
			}>) {
				// (one the visitor's action caused, as CLS leaves out a shift within 500 ms of input)
				if (e.hadRecentInput || e.startTime - input < 500) continue;
				const by = fills.filter((f) => f.t <= e.startTime && e.startTime - f.t < 100);
				if (by.length === 0) continue;
				send({
					kind: 'shift',
					value: e.value,
					regions: [...new Set(by.map((f) => f.region))].slice(0, 3)
				});
			}
		}).observe({ type: 'layout-shift', buffered: true });
	} catch {
		// ok: an engine with no layout-shift entries (the run notes none)
	}
	try {
		// oxlint-disable-next-line ogygia/owned-effects -- runs in the replayed page (an init script, no imports): the document's record for its whole life
		new PerformanceObserver((list) => {
			for (const e of list.getEntries() as unknown as Array<{
				scripts?: Array<{
					duration: number;
					sourceURL: string;
					sourceFunctionName: string;
				}>;
			}>)
				for (const s of e.scripts ?? [])
					if (s.duration > 50 && s.sourceURL)
						send({
							kind: 'task',
							duration: s.duration,
							source: s.sourceURL,
							fn: s.sourceFunctionName
						});
		}).observe({ type: 'long-animation-frame', buffered: true });
	} catch {
		// ok: an engine with no long-animation-frame entries
	}
}

/** The plans SIM_PLANS names, read. */
function plans(): Array<{ file: string; plan: BrowserPlan }> {
	return (process.env.SIM_PLANS ?? '')
		.split(',')
		.filter(Boolean)
		.map((file) => ({
			file,
			plan: JSON.parse(readFileSync(file, 'utf8')) as BrowserPlan
		}));
}

/** The generated app on disk at `app`: its seed and whether it drew a peer, or null for an app
 *  nobody generated. */
function generated(app: string): { seed: number; peer: boolean } | null {
	const at = join(app, 'src', 'lib', 'gen', 'plan.json');
	if (!existsSync(at)) return null;
	const p = JSON.parse(readFileSync(at, 'utf8')) as {
		seed: number;
		peer?: unknown;
	};
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
	// LAYOUT SHIFT AND LONG TASKS: Chromium's observers, in every document (the others report none)
	const perf: PerfEntry[] = [];
	const chromium = context.browser()?.browserType().name() === 'chromium';
	if (chromium) {
		await context.exposeBinding('__sim_perf', ({ page: from }, e: Omit<PerfEntry, 'tab'>) => {
			perf.push({ ...e, tab: tabs.indexOf(from) } as PerfEntry);
		});
		await context.addInitScript(perf_watch);
	}
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
		// (what the visitor does next is input: a shift it causes is the visitor's, not a region's)
		if (chromium)
			await tab
				.evaluate(() => (window as unknown as { __sim_input?: () => void }).__sim_input?.())
				.catch(() => {}); // ok: a tab on the browser's error page has no observers
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
				info.annotations.push({
					type: 'not played',
					description: `action ${i + 1}: a deploy`
				});
				break;
			case 'away':
				// (no link: nothing done, as in the simulator)
				if (!(await nth_of(tab, LINKS, a.nth))) break;
				await pass(context, a.ms);
				await navigated(tab.goBack());
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
	if (chromium) {
		// (a file is ogygia's when it is its runtime or holds its coded messages)
		const owned = new Map<string, boolean>();
		for (const e of perf)
			if (e.kind === 'task' && !owned.has(e.source)) {
				const text = await context.request
					.get(e.source)
					.then((r) => r.text())
					.catch(() => '');
				owned.set(e.source, /\/og-runtime-/.test(e.source) || text.includes('ogygiajs.dev/e/'));
			}
		const { noted, failing } = judge_perf(perf, (u) => owned.get(u) === true);
		if (noted.length > 0)
			info.annotations.push({
				type: 'layout shift and long tasks',
				description: noted.join('\n')
			});
		check(
			'no layout shift from regions filling in, no long task in ogygia',
			failing.length === 0,
			failing.join('\n')
		);
	}
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
