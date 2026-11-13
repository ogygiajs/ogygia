/**
 * Shared Playwright fixtures and the suites' `check()` idiom: `@ogygia/tooling/e2e`, imported by
 * every package's e2e specs (packages/<name>/e2e, apps/palaestra/e2e). Siblings (by file name, `.ts`
 * and all): `/servers.ts` (spawn_server), `/re.ts` (shared regexes), `/packed.ts` (the packed
 * ogygia), `/config.ts` (each suite's playwright.config.ts), `/build.ts` (a fixture app's build).
 *
 * @packageDocumentation
 */
import { test as base, expect, type Page } from '@playwright/test';
import { ISLAND_GRAPH_SCRIPT_G_RE } from './re.ts';
import { said_rules, server_log_since, server_log_size } from './server-log.ts';

export { expect };
export { REPO } from './paths.ts';

/** A rule ogygia found broken on itself (core src/rules.ts): its code, and what it found. */
export type BrokenRule = { code: string; detail: string };

/** The rules broken on the page now, or null where the page has none to check (a build made
 *  without them, a page that is not ogygia's, a page already closed). */
export async function rules(page: Page): Promise<BrokenRule[] | null> {
	try {
		return await page.evaluate(
			() => (globalThis as { __ogygia_rules?: () => BrokenRule[] }).__ogygia_rules?.() ?? null
		);
	} catch {
		return null; // ok: closed, or navigating away: nothing to read
	}
}

/** The page's machine moves, one line each (`visit#3 loading -> answered`), or null where the page
 *  keeps none (a build made without rules, a page that is not ogygia's, a page already closed). */
export async function moves(page: Page): Promise<string | null> {
	try {
		return await page.evaluate(
			() => (globalThis as { __ogygia_moves?: () => string }).__ogygia_moves?.() ?? null
		);
	} catch {
		return null; // ok: closed, or navigating away: nothing to read
	}
}

/**
 * Playwright's `test`, and at the end of every test that used a page, ogygia's rules on itself: a
 * page that has them (the dev server, a build made with `OGYGIA_RULES=1` such as the palaestra's)
 * must end the test with none broken. A soft assertion: the test's own checks all still report.
 * A test that failed gets the page's machine moves attached (`machine moves`) and printed.
 *
 * The check rides on `page` itself, which Playwright makes only for a test that asks for it: a test
 * that reads the wire alone (`fetch`, `request`) opens no browser for the rules.
 */
export const test = base.extend<{ server_rules: void }>({
	/**
	 * Every test, page or not: the rules a server said broken while it ran (core server/rules.ts,
	 * on in dev and in `OGYGIA_RULES=1` builds), read from the suite's server log
	 * (./server-log.ts). A soft assertion, as the page's rules are. `OGYGIA_E2E_SERVER_RULES=report`
	 * attaches and prints them instead, failing nothing.
	 */
	server_rules: [
		// oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's needs from this pattern
		async ({}, use, info) => {
			const from = server_log_size();
			await use();
			const said = said_rules(server_log_since(from));
			if (said.length === 0) return;
			await info.attach('server rules', { body: said.join('\n'), contentType: 'text/plain' });
			if (process.env.OGYGIA_E2E_SERVER_RULES === 'report')
				console.warn(`server rules said in "${info.title}":\n  ${said.join('\n  ')}`);
			else expect.soft(said, 'ogygia server rules said during the test').toEqual([]);
		},
		{ auto: true }
	],
	page: async ({ page }, use, info) => {
		await use(page);
		const broken = await rules(page);
		if (broken !== null) expect.soft(broken, 'ogygia rules broken at the end').toEqual([]);
		if (info.status === info.expectedStatus && info.errors.length === 0) return;
		const log = await moves(page);
		if (!log) return;
		await info.attach('machine moves', { body: log, contentType: 'text/plain' });
		console.error(`machine moves in "${info.title}":\n${log}`);
	}
});

/** A named soft assertion. `extra` (a measured value, a snippet) rides in the failure message.
 *  Every check in a test runs, each failure is reported, and the test fails once at the end: the
 *  shape of the PASS/FAIL scripts the specs replaced, with Playwright's report and traces around it. */
export function check(name: string, cond: unknown, extra = ''): void {
	expect.soft(!!cond, extra ? `${name} — ${extra}` : name).toBe(true);
}

// oxlint-disable-next-line ogygia/owned-effects -- a pause the test's own process awaits: it ends itself, holds nothing past it, and must keep the process open (a scope's timer does not)
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The interaction lab's counter (`[data-i-count]`) reached 1 — the click that woke its island,
 *  replayed. The runtime replays a frame AFTER `data-hydrated` (the island's wiring settles first),
 *  so this waits for it instead of reading the counter the instant the island is marked. */
export async function replayed_once(page: Page): Promise<boolean> {
	return page
		.waitForFunction(() => document.querySelector('[data-i-count]')?.textContent === '1', null, {
			timeout: 2000
		})
		.then(
			() => true,
			() => false
		); // ok: not replayed within the wait is the answer the caller checks
}

/** Every island graph script in a page's HTML, merged: entry → the chunks its code needs
 *  (src/island-graph.ts wire shape `{h:[href…], e:{entry:[index…]}}`). */
export function island_graph(html: string): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const m of html.matchAll(ISLAND_GRAPH_SCRIPT_G_RE)) {
		const wire = JSON.parse(m[1]) as { h: string[]; e: Record<string, number[]> };
		for (const [entry, ids] of Object.entries(wire.e))
			if (!out.has(entry))
				out.set(
					entry,
					ids.map((i) => wire.h[i])
				);
	}
	return out;
}

type StampWindow = Window & { __og_e2e_stamp?: number };

/**
 * SPA-vs-reload proof. A per-DOCUMENT stamp the TEST sets on the live window: an SPA body swap
 * keeps the window (and the stamp), a real document load replaces it (stamp gone). Read it back
 * with {@link document_stamp} after the navigation under test.
 */
export async function stamp_document(page: Page): Promise<number> {
	return page.evaluate(() => ((window as StampWindow).__og_e2e_stamp ??= Math.random()));
}

/** The stamp {@link stamp_document} set on this document, or `undefined` after a real load. */
export async function document_stamp(page: Page): Promise<number | undefined> {
	return page.evaluate(() => (window as StampWindow).__og_e2e_stamp);
}
