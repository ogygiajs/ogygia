// A LIVE QUERY BELONGS TO EVERY ISLAND THAT READS IT, FROM ANY OF ITS COMPONENTS (#853). Holder (kept
// across navigations) reads the live clock only from a child it mounts after a click; Leaver, which
// leaves on the navigation, made the clock's entry. The navigation must not stop the clock Holder's
// child still shows.
//
// Against the built palaestra (/live-shared ↔ /live-shared/b).
// Usage: pnpm exec playwright test live-query-late-reader
import type { Page } from '@playwright/test';
import { test, check } from '@ogygia/tooling/e2e';

const TICK = /\d{4}-\d\d-\d\dT/;

async function late_tick(page: Page): Promise<string> {
	return ((await page.locator('[data-late-clock]').textContent()) ?? '').trim();
}

/** Wait until the late reader shows a tick other than `from` (false when none came in `ms`). */
async function ticks_past(page: Page, from: string, ms = 4000): Promise<boolean> {
	return page
		.waitForFunction(
			([f, re]) => {
				const t = document.querySelector('[data-late-clock]')?.textContent?.trim() ?? '';
				return t !== f && new RegExp(re).test(t);
			},
			[from, TICK.source] as const,
			{ timeout: ms }
		)
		.then(
			() => true,
			() => false
		);
}

test('a kept island reading a live query only from a later child keeps it after a navigation', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto('/live-shared', { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('[data-holder]');
	await page.waitForFunction(
		(re) => new RegExp(re).test(document.querySelector('[data-leaver]')?.textContent ?? ''),
		TICK.source,
		{ timeout: 8000 }
	);
	await page.waitForSelector('ogygia-region[data-hydrated] [data-show-clock]');
	await page.locator('[data-show-clock]').click();
	await page.waitForSelector('[data-late-clock]');
	check('the late reader ticks on page A', await ticks_past(page, await late_tick(page)));

	await page.locator('[data-holder]').evaluate((el) => el.setAttribute('data-was-here', ''));
	await page.locator('[data-to-b]').click();
	await page.waitForURL('**/live-shared/b', { timeout: 8000 });
	await page.waitForTimeout(600);
	check('Holder was kept (same element)', (await page.locator('[data-was-here]').count()) === 1);
	check('Leaver left', (await page.locator('[data-leaver]').count()) === 0);

	const after = await late_tick(page);
	check('the late reader keeps ticking after the navigation', await ticks_past(page, after), after);
	check('no read threw', errors.length === 0, errors.join(' | '));
});
