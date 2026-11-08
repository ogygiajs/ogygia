// P2: overlapping SPA navigations must not leave URL ≠ DOM (last-nav-wins).
// Usage: pnpm exec playwright test router-race
import { test, check, expect } from '@ogygia/tooling/e2e';

const FORMS_HEADING_RE = /classic form actions/i;

test.describe('overlapping SPA navigations / stale-swap guards', () => {
	test('last navigation wins: URL settles on /data and the DOM matches it', async ({ page }) => {
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await page.waitForSelector('meta[name="ogygia-router"]', { state: 'attached' });

		// /forms is heavier; /data is light — classic last-fetch-wins repro from the audit.
		await page.evaluate(() => {
			(document.querySelector('a[href="/forms"]') as HTMLAnchorElement | null)?.click();
		});
		await page.waitForTimeout(40);
		await page.evaluate(() => {
			(document.querySelector('a[href="/data"]') as HTMLAnchorElement | null)?.click();
		});

		await page.waitForURL('**/data', { timeout: 8000 }).catch(() => {});
		await page.waitForTimeout(800);

		const path = await page.evaluate(() => location.pathname);
		const h1 = (
			(await page
				.locator('h1')
				.first()
				.textContent()
				.catch(() => '')) || ''
		).trim();

		check('URL settled on last navigation (/data)', path === '/data', path);
		check(
			'DOM matches URL (not forms Guestbook heading)',
			path === '/data' && !FORMS_HEADING_RE.test(h1),
			`path=${path} h1=${h1}`
		);
	});

	// REGRESSION (CI, a slow runner): back pressed while the next page was still loading. The load
	// still in flight must never land: Back goes back from the page on screen (the router writes an
	// entry only when a page goes in, as a browser commits one only when its document arrives), and
	// the page it brings is the one that shows.
	test('back while the next page loads: the load never lands, Back goes back from the page on screen', async ({
		page
	}) => {
		await page.goto('/', { waitUntil: 'load' });
		await page.waitForSelector('meta[name="ogygia-router"]', { state: 'attached' });
		const home_h1 = (await page.locator('h1').first().textContent())?.trim();
		await page.locator('a[href="/about"]').first().click();
		await page.waitForURL('**/about');
		await page.waitForSelector('#about-heading');
		let release!: () => void;
		const held = new Promise<void>((r) => (release = r));
		await page.route('**/data', async (route) => {
			await held;
			await route.continue();
		});
		await page.locator('a[href="/data"]').first().click();
		await page.waitForTimeout(200);
		check(
			'the address is the page on screen while /data loads',
			new URL(page.url()).pathname === '/about',
			page.url()
		);
		await page.goBack();
		await page.waitForURL((u) => u.pathname === '/');
		await expect
			.poll(async () => (await page.locator('h1').first().textContent())?.trim())
			.toBe(home_h1);
		release();
		await page.waitForTimeout(800);
		const path = await page.evaluate(() => location.pathname);
		const h1 = (await page.locator('h1').first().textContent())?.trim();
		check('URL back on /', path === '/', path);
		check('DOM is / (the held /data never swapped in)', h1 === home_h1, `h1=${h1}`);
	});
});
