// What a visitor does on a load-woken island before its code is live is not lost: the runtime holds
// the clicks and replays them once the island is live, and puts typed text and focus back, as it
// does for an interaction-woken one. When the code never comes, the clicks are let go.
// Usage: pnpm --filter palaestra e2e load-early-click
import type { Page } from '@playwright/test';
import { test, expect } from '@ogygia/tooling/e2e';
import { console_text } from '@ogygia/tooling/e2e/browsers.ts';

const REGION_RE = /<ogygia-region\b[^>]*>/g;
const ENTRY_RE = /\sentry="([^"]+)"/;
const SRC_RE = /\ssrc="([^"]+)"/;
const HOLD_MS = 1500;

/** Every island's file names: its built location and its stable name (the fallback a lost one takes). */
async function island_files(base: string): Promise<string[]> {
	const html = await (await fetch(base + '/load-early-click')).text();
	const names: string[] = [];
	for (const [tag] of html.matchAll(REGION_RE))
		for (const re of [SRC_RE, ENTRY_RE]) {
			const name = tag.match(re)?.[1];
			if (name) names.push(name.split('/').pop()!);
		}
	return names;
}

/** Hold the islands' code for `HOLD_MS`, then let it through; or (`abort`) drop it then. */
async function hold_islands(page: Page, files: string[], abort = false): Promise<void> {
	await page.route(
		(url) => files.some((f) => url.pathname.endsWith('/' + f)),
		async (r) => {
			await new Promise((done) => setTimeout(done, HOLD_MS));
			await (abort ? r.abort() : r.continue());
		}
	);
}

const live = (page: Page) => page.locator('ogygia-region[data-hydrated]');

test.describe('a load island before its code is live', () => {
	let files: string[] = [];
	// oxlint-disable-next-line no-empty-pattern -- Playwright reads the pattern to inject fixtures; this hook needs none
	test.beforeAll(async ({}, testInfo) => {
		files = await island_files(String(testInfo.project.use.baseURL));
		expect(files.length).toBeGreaterThan(0);
	});

	test('two clicks before its code is live both count once it is live', async ({ page }) => {
		await hold_islands(page, files);
		await page.goto('/load-early-click', { waitUntil: 'domcontentloaded' });

		const button = page.locator('[data-counter] button');
		await expect(button).toHaveText('count is 0');
		await expect(live(page)).toHaveCount(0);
		await button.click();
		await button.click();
		await expect(live(page)).toHaveCount(0);

		await expect(live(page)).toHaveCount(2, { timeout: 15_000 });
		await expect(button).toHaveText('count is 2');
		await button.click();
		await expect(button).toHaveText('count is 3');
	});

	test('text typed before its code is live stays, bound, and focus stays in the field', async ({
		page
	}) => {
		await hold_islands(page, files);
		await page.goto('/load-early-click', { waitUntil: 'domcontentloaded' });

		const input = page.locator('[data-i-input]');
		await expect(live(page)).toHaveCount(0);
		await input.click();
		await input.pressSequentially('hello', { delay: 15 });
		await expect(live(page)).toHaveCount(0);

		await expect(live(page)).toHaveCount(2, { timeout: 15_000 });
		await expect(input).toHaveValue('hello');
		await expect(page.locator('[data-i-typed]')).toHaveText('hello');
		await expect(input).toBeFocused();
	});

	test('when its code never comes, the clicks are let go and the failure is said', async ({
		page
	}) => {
		const errors: Promise<string>[] = [];
		page.on('console', (m) => {
			if (m.type() === 'error') errors.push(console_text(m));
		});
		await hold_islands(page, files, true);
		await page.addInitScript(() => {
			const held: boolean[] = [];
			(window as unknown as { __held: boolean[] }).__held = held;
			document.addEventListener('click', (e) => {
				// (a visitor's clicks only: the failure path replays the held one onto the server markup)
				if (e.isTrusted && (e.target as Element | null)?.closest?.('[data-counter]'))
					held.push(e.defaultPrevented);
			});
		});
		await page.goto('/load-early-click', { waitUntil: 'domcontentloaded' });

		const button = page.locator('[data-counter] button');
		await button.click();
		await expect
			.poll(async () => (await Promise.all(errors)).some((t) => t.includes('island_load_failed')), {
				timeout: 30_000
			})
			.toBe(true);
		await button.click();
		const held = await page.evaluate(() => (window as unknown as { __held: boolean[] }).__held);
		expect(held).toEqual([true, false]);
		await expect(live(page)).toHaveCount(0);
	});
});
