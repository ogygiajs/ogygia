// A LIVE QUERY BELONGS TO THE ISLAND THAT READS IT (#817). A client navigation that keeps an island
// on the page (the simplest: the link to the page already shown) must leave that island's live query
// running: its value keeps changing and no read throws. Leaving the page and coming back still opens
// a fresh stream for the new copy of the island.
//
// Against the built palaestra (/data's live clock, the nav's "Data" and "Home" links).
// Usage: pnpm exec playwright test live-query-kept
import type { Page } from '@playwright/test';
import { test, check } from '@ogygia/tooling/e2e';

/** The clock's latest tick as the island shows it. */
async function tick(page: Page): Promise<string> {
	return ((await page.locator('[data-live-current]').textContent()) ?? '').trim();
}

/** Wait until the clock shows a tick other than `from` (false when none came in `ms`). */
async function ticks_past(page: Page, from: string, ms = 4000): Promise<boolean> {
	return page
		.waitForFunction(
			(f) => {
				const t = document.querySelector('[data-live-current]')?.textContent?.trim() ?? '';
				return t !== f && /\d{4}-\d\d-\d\dT/.test(t);
			},
			from,
			{ timeout: ms }
		)
		.then(
			() => true,
			() => false
		);
}

test.describe('a live query in a kept island', () => {
	test('a navigation that keeps the island leaves its live query running', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		// (no networkidle: the live stream keeps a connection open)
		await page.goto('/data', { waitUntil: 'domcontentloaded' });
		await page.waitForSelector('meta[name="ogygia-router"]', { state: 'attached' });
		check('the clock ticks before the navigation', await ticks_past(page, await tick(page)));

		// mark the island's element: a kept island is the same element after the navigation
		await page.evaluate(() =>
			document
				.querySelector('[data-live-current]')
				?.closest('ogygia-region')
				?.setAttribute('data-was-here', '')
		);
		await page.evaluate(() => (document.querySelector('a[href="/data"]') as HTMLElement).click());
		await page.waitForTimeout(600);
		check(
			'the navigation kept the island (same element)',
			(await page.locator('ogygia-region[data-was-here] [data-live-current]').count()) === 1
		);

		const after = await tick(page);
		check('the clock keeps ticking after the navigation', await ticks_past(page, after), after);
		check('no read threw', errors.length === 0, errors.join(' | '));
	});

	test('leaving the page and coming back opens a fresh stream for the new island', async ({
		page
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.goto('/data', { waitUntil: 'domcontentloaded' });
		await page.waitForSelector('meta[name="ogygia-router"]', { state: 'attached' });
		check('the clock ticks on the first visit', await ticks_past(page, await tick(page)));

		await page.evaluate(() => (document.querySelector('a[href="/"]') as HTMLElement).click());
		await page.waitForURL((u) => u.pathname === '/', { timeout: 8000 });
		await page.waitForTimeout(300);
		await page.evaluate(() => (document.querySelector('a[href="/data"]') as HTMLElement).click());
		await page.waitForURL('**/data', { timeout: 8000 });
		await page.waitForSelector('[data-live-current]');

		check('the clock ticks on the second visit', await ticks_past(page, await tick(page), 6000));
		check('no read threw', errors.length === 0, errors.join(' | '));
	});
});
