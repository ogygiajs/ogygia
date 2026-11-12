// AN EARLY CLICK ON A SCHEDULED ISLAND (#260; runtime/interaction.ts, core.ts `#catch_early_input`).
// A `visible` island in view at load is server markup until its own schedule wakes it. The runtime's
// capture holds a click that lands on it before then, and replays it ONCE, on the live island, AT
// WAKE; nothing is left queued, so the next click acts once too.
//
// What went wrong: the capture's replay half is a lazy chunk, asked for only when a visitor reaches an
// island. A visitor whose browser already holds the page's code (a second page view) but never
// touched an island before: the island went live at once, the replay half was still on its way over
// a slow network, and the early click did nothing at wake. It came in late, beside the visitor's next
// click, which then looked like one click that acted twice.
//
// Real conditions: Chromium's own CPU throttling and network emulation (CDP: 6x CPU, Slow 4G), a
// browser that has the page's code from a visit before (not the replay half: nobody touched the
// island), and many runs, each in a fresh browser context: a race can pass by chance in one.
// Usage: pnpm exec playwright test wake-early-click
import type { Browser, Page } from '@playwright/test';
import { test, check } from '@ogygia/tooling/e2e';
import { needs_cdp } from '@ogygia/tooling/e2e/browsers.ts';

const RUNS = 10;

type Seen = { trusted: boolean; live: boolean; held: boolean };

/** Every click on the switch that reaches `document`: trusted or a replay, whether the island was
 *  live, and whether the runtime's capture held it (canceled it, to replay it at wake). */
function watch_clicks(): void {
	const seen: Seen[] = [];
	(window as unknown as { __clicks: Seen[] }).__clicks = seen;
	document.addEventListener('click', (e) => {
		const t = e.target as Element | null;
		if (!t?.closest?.('[data-wake-switch]')) return;
		seen.push({
			trusted: e.isTrusted,
			live: !!t.closest('ogygia-region[data-hydrated]'),
			held: e.defaultPrevented
		});
	});
}

/** A slow phone: 6x CPU slowdown, DevTools' Slow 4G. */
async function slow_phone(page: Page): Promise<void> {
	needs_cdp(page);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
	await cdp.send('Network.enable');
	await cdp.send('Network.emulateNetworkConditions', {
		offline: false,
		latency: 562.5,
		downloadThroughput: (1.6 * 1024 * 1024 * 0.9) / 8,
		uploadThroughput: (750 * 1024 * 0.9) / 8
	});
}

const clicks = (page: Page) =>
	page.evaluate(() => (window as unknown as { __clicks: Seen[] }).__clicks.slice());
const flips = async (page: Page) =>
	Number(await page.locator('[data-wake-switch]').getAttribute('data-flips'));
const live = (page: Page) =>
	page.locator('ogygia-region[data-hydrated]').waitFor({ timeout: 30_000 });

/** A browser that visited the page before (its code is cached) without touching the island, now on
 *  a slow phone. Returns the page and where the switch sits. */
async function returning_visitor(browser: Browser, base: string) {
	const context = await browser.newContext({ baseURL: base });
	const page = await context.newPage();
	await page.addInitScript(watch_clicks);
	await page.goto('/wake-switch', { waitUntil: 'networkidle' });
	await live(page);
	const box = (await page.locator('[data-wake-switch]').boundingBox())!;
	await slow_phone(page);
	return { context, page, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('an early click on a visible island acts once, at wake (#260)', () => {
	test.setTimeout(RUNS * 30_000);

	test(`an early click acts at wake, and the next click acts once (${RUNS} runs, 6x CPU, Slow 4G)`, async ({
		browser
	}, testInfo) => {
		const base = String(testInfo.project.use.baseURL);
		const runs: string[] = [];
		let held = 0;
		for (let i = 0; i < RUNS; i++) {
			const { context, page, x, y } = await returning_visitor(browser, base);
			await page.goto('/wake-switch', { waitUntil: 'commit' });
			// the visitor clicks once the page's runtime is up, while the island is still server markup
			await page.waitForFunction(() => !!customElements.get('ogygia-region'), null, {
				polling: 1
			});
			await page.mouse.click(x, y);
			const first = (await clicks(page))[0];
			const was_held = !!first?.held && !first.live;
			if (was_held) held++;
			await live(page);
			// at wake: the replay is a frame after the island is live
			await page.waitForTimeout(300);
			const at_wake = await flips(page);
			// the visitor's next click, on the live switch
			await page.mouse.click(x, y);
			await page.waitForTimeout(2000);
			const after = await flips(page);
			const seen = await clicks(page);
			runs.push(
				`run ${i}: early click ${was_held ? 'held' : 'not held'}; ` +
					`flips at wake ${at_wake}, after the next click ${after}; clicks at document ` +
					seen.map((c) => (c.trusted ? 'T' : 'r') + (c.live ? 'L' : '-')).join(' ')
			);
			await context.close();
		}
		const report = runs.join('\n');
		check(
			'the early click landed before the island was live and was held, in most runs',
			held >= RUNS * 0.8,
			`${held}/${RUNS}\n${report}`
		);
		const of_held = runs.filter((r) => r.includes('early click held'));
		check(
			'every held early click acted once, at wake',
			of_held.every((r) => r.includes('flips at wake 1,')),
			report
		);
		check(
			'every next click acted once',
			of_held.every((r) => r.includes('after the next click 2;')),
			report
		);
		// at `document`: the held click (T-), its replay on the live island (rL), the next click (TL)
		check(
			'every replay came before the next click, and nothing came after it',
			of_held.every((r) => r.endsWith('clicks at document T- rL TL')),
			report
		);
	});

	// The control: no early click — the switch wakes on its own, and one click acts once.
	test(`no early click: one click acts once (${RUNS} runs)`, async ({ browser }, testInfo) => {
		const base = String(testInfo.project.use.baseURL);
		const runs: number[] = [];
		for (let i = 0; i < RUNS; i++) {
			const { context, page, x, y } = await returning_visitor(browser, base);
			await page.goto('/wake-switch', { waitUntil: 'commit' });
			await live(page);
			await page.mouse.click(x, y);
			await page.waitForTimeout(2000);
			runs.push(await flips(page));
			await context.close();
		}
		check(
			'every run flipped once',
			runs.every((n) => n === 1),
			runs.join(',')
		);
	});
});
