// THE ROUTER'S HISTORY behaves as a plain site's (runtime/router.ts, the history model). The router
// keeps one record of the visitor's entries, each with its address and scroll, and reads the rest
// from it: the address bar, the page on screen, the scroll a Back or Forward puts back.
//
//   - #270 Forward after Back lands where the page was left, not at the top: a page left by a Back
//     or Forward keeps its scroll too, not only one left by a click.
//   - #282 Back or Forward between two app-managed fragments (a hash no element has) keeps the
//     scroll the browser restored. (The browser restores it after `popstate`, so the router's old
//     jump to the top there was undone at once: this guards the history model, it failed on no
//     code.)
//   - #277 The `hashchange` the router fires for an app-managed fragment has the address before the
//     click as its `oldURL`.
//
// Against the built palaestra (/router-history, /router-history/b, /router-history/fragments).
// Usage: pnpm exec playwright test router-history
import type { Page } from '@playwright/test';
import { test, check, expect, stamp_document, document_stamp } from '@ogygia/tooling/e2e';

async function open(page: Page, path: string) {
	await page.goto(path, { waitUntil: 'networkidle' });
	await page.waitForSelector('meta[name="ogygia-router"]', { state: 'attached' });
}

const scroll_y = (page: Page) => page.evaluate(() => Math.round(scrollY));

async function scroll_to(page: Page, y: number) {
	await page.evaluate((y) => window.scrollTo(0, y), y);
	await expect.poll(() => scroll_y(page)).toBe(y);
	// (past the frame the browser hears the scroll in)
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50))));
}

test.describe('the router’s history behaves as a plain site’s', () => {
	test('#270 Forward after Back lands where the page was left', async ({ page }) => {
		await open(page, '/router-history');
		const doc = await stamp_document(page);
		await page.locator('[data-to-b]').click();
		await expect(page.locator('[data-history-b]')).toBeVisible();
		await scroll_to(page, 2000);
		await page.goBack();
		await expect(page.locator('[data-history-a]')).toBeVisible();
		await page.goForward();
		await expect(page.locator('[data-history-b]')).toBeVisible();
		await expect.poll(() => scroll_y(page), { timeout: 3_000 }).toBe(2000);
		check('every step was the router’s (one document)', (await document_stamp(page)) === doc);
	});

	test('#270 Back after Back and Forward still lands where each page was left', async ({
		page
	}) => {
		await open(page, '/router-history');
		await page.locator('[data-to-b]').click();
		await expect(page.locator('[data-history-b]')).toBeVisible();
		await scroll_to(page, 1500);
		await page.goBack();
		await expect(page.locator('[data-history-a]')).toBeVisible();
		await page.goForward();
		await expect(page.locator('[data-history-b]')).toBeVisible();
		await expect.poll(() => scroll_y(page), { timeout: 3_000 }).toBe(1500);
		await scroll_to(page, 2500);
		await page.goBack();
		await expect(page.locator('[data-history-a]')).toBeVisible();
		await page.goForward();
		await expect(page.locator('[data-history-b]')).toBeVisible();
		await expect.poll(() => scroll_y(page), { timeout: 3_000 }).toBe(2500);
	});

	// #452: the scroll was put back at once, before a region above it had its height: it landed
	// short by that height (1200 → 1091 with a 109 px header in Chromium and Firefox).
	for (const step of ['Back', 'Forward'] as const) {
		test(`#452 ${step} lands exactly where the page was left when a region above it is sized late`, async ({
			page
		}) => {
			const late_live = () =>
				page.locator('ogygia-region[data-hydrated]:has([data-late-top])').waitFor();
			if (step === 'Back') {
				// left by a click: Back returns to it
				await open(page, '/router-history/late');
				await late_live();
				await scroll_to(page, 1200);
				await page.evaluate(() =>
					(document.querySelector('[data-late-to-a]') as HTMLElement).click()
				);
				await expect(page.locator('[data-history-a]')).toBeVisible();
				await page.goBack();
			} else {
				// left by a Back: Forward returns to it
				await open(page, '/router-history');
				await page.locator('[data-to-late]').click();
				await late_live();
				await scroll_to(page, 1200);
				await page.goBack();
				await expect(page.locator('[data-history-a]')).toBeVisible();
				await page.goForward();
			}
			await expect(page.locator('[data-history-late]')).toBeVisible();
			await late_live();
			// (past the frames its height lands in)
			await page.evaluate(
				() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 300)))
			);
			expect(await scroll_y(page)).toBe(1200);
		});
	}

	test('#452 Back lands exactly where the page was left when the page is too short to reach it at the swap', async ({
		page
	}) => {
		const tall_live = () =>
			page.locator('ogygia-region[data-hydrated]:has([data-late-tall])').waitFor();
		await open(page, '/router-history/late-tall');
		await tall_live();
		await scroll_to(page, 1200);
		await page.evaluate(() =>
			(document.querySelector('[data-late-tall-to-a]') as HTMLElement).click()
		);
		await expect(page.locator('[data-history-a]')).toBeVisible();
		// (the put-back is clamped to the short page: that clamp must not end the hold)
		await page.goBack();
		await expect(page.locator('[data-history-late-tall]')).toBeVisible();
		await tall_live();
		await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 300))));
		expect(await scroll_y(page)).toBe(1200);
	});

	test('#282 Back between two app-managed fragments keeps the scroll', async ({ page }) => {
		await open(page, '/router-history/fragments');
		await scroll_to(page, 600);
		await page.evaluate(() => (document.querySelector('[data-row-1]') as HTMLElement).click());
		await expect.poll(() => new URL(page.url()).hash).toBe('#row-1');
		await scroll_to(page, 1200);
		// (from script: a pointer would scroll the link into view first)
		await page.evaluate(() => (document.querySelector('[data-row-2]') as HTMLElement).click());
		await expect.poll(() => new URL(page.url()).hash).toBe('#row-2');
		check('the click kept the scroll', (await scroll_y(page)) === 1200, `${await scroll_y(page)}`);
		await page.goBack();
		await expect.poll(() => new URL(page.url()).hash).toBe('#row-1');
		// (past the frames a jump would take)
		await page.waitForTimeout(300);
		const y = await scroll_y(page);
		check('Back kept the page where it was, not at the top', y === 1200, `scrollY ${y}`);
	});

	test('#277 the router’s hashchange has the address before the click as its oldURL', async ({
		page
	}) => {
		await open(page, '/router-history/fragments');
		await page.evaluate(() => {
			(window as { __changes?: Array<[string, string]> }).__changes = [];
			addEventListener('hashchange', (e) =>
				(window as unknown as { __changes: Array<[string, string]> }).__changes.push([
					e.oldURL,
					e.newURL
				])
			);
		});
		const before = page.url();
		await page.locator('[data-row-1]').click();
		await expect.poll(() => new URL(page.url()).hash).toBe('#row-1');
		const changes = await page.evaluate(
			() => (window as unknown as { __changes: Array<[string, string]> }).__changes
		);
		check('one hashchange', changes.length === 1, JSON.stringify(changes));
		check(
			'its oldURL is the address before the click',
			changes[0]?.[0] === before,
			changes[0]?.[0]
		);
		check('its newURL is the fragment', changes[0]?.[1] === page.url(), changes[0]?.[1]);
	});
});
