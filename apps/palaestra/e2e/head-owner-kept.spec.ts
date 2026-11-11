// A HEAD TAG A REGION WRITES STAYS WHILE ITS REGION STAYS (#806). A refresh in place (or a navigation
// that keeps a hydrated region) sends the region in `x-ogygia-known`, and the server skips rendering
// it, and with it the head tags its inner islands write: the `ogygia-kit-island` stamp and their
// region stylesheets. The head after the refresh must still be the head a fresh load has.
//
// Against the built palaestra (/portable-snippet: a nested island inside a forwarded snippet).
// Usage: pnpm exec playwright test head-owner-kept
import type { Page } from '@playwright/test';
import { test, check } from '@ogygia/tooling/e2e';

/** The head tags regions write: kit-island stamps and region stylesheets, as sorted text. */
async function region_head(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		[...document.head.querySelectorAll('meta[name="ogygia-kit-island"], [data-ogygia-region-css]')]
			.map(
				(n) =>
					`${n.tagName}:${n.getAttribute('content') ?? n.getAttribute('href') ?? n.getAttribute('data-ogygia-region-css')}`
			)
			.sort()
	);
}

test.describe('head tags a kept region wrote', () => {
	test('a page refreshed in place keeps the head a fresh load has', async ({ page }) => {
		await page.goto('/portable-snippet', { waitUntil: 'networkidle' });
		await page.waitForSelector('meta[name="ogygia-router"]', { state: 'attached' });
		await page.locator('ogygia-region[data-hydrated]').first().waitFor();
		const fresh = await region_head(page);
		check(
			'a fresh load has the kit-island stamp',
			fresh.some((t) => t.startsWith('META:')),
			fresh.join(' | ')
		);

		// (a fragment jump, then the same link again: the router refreshes the page in place)
		await page.evaluate(() => (document.querySelector('a[href="#gh"]') as HTMLElement).click());
		await page.waitForTimeout(300);
		await page.evaluate(() => (document.querySelector('a[href="#gh"]') as HTMLElement).click());
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(300);

		const after = await region_head(page);
		check(
			'the head after the refresh has the same region tags',
			JSON.stringify(after) === JSON.stringify(fresh),
			`fresh: ${fresh.join(' | ')} — after: ${after.join(' | ')}`
		);
	});
});
