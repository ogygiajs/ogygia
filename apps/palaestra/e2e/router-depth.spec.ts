// A NAVIGATION BETWEEN PAGES AT DIFFERENT URL DEPTHS ASKS FOR THE NEXT PAGE'S STYLESHEETS AT THEIR
// OWN ADDRESS (#449). Kit links a page's sheets page-relative (`../../../_app/immutable/assets/…`).
// The router loads the next page's sheets before its commit (#267), while the address bar still
// shows the page being left (#325): resolved against THAT address, `/router-depth/a/b/c` → `/router-
// depth/e` asked for `/router-depth/_app/immutable/assets/…`, which a real app answers with a whole
// HTML page per sheet. Every URL of the next page belongs to the next page's address.
//
// Against the built palaestra (/router-depth/a/b/c, /router-depth/e).
// Usage: pnpm exec playwright test router-depth
import type { Page } from '@playwright/test';
import { test, expect, stamp_document, document_stamp } from '@ogygia/tooling/e2e';

/** Every stylesheet the page asks for from here on, by path. */
function sheets_asked(page: Page): string[] {
	const asked: string[] = [];
	page.on('request', (r) => {
		if (r.resourceType() === 'stylesheet') asked.push(new URL(r.url()).pathname);
	});
	return asked;
}

test.describe('a navigation between URL depths', () => {
	for (const [from, to, link, landed, color] of [
		[
			'/router-depth/a/b/c',
			'/router-depth/e',
			'[data-to-shallow]',
			'[data-depth-shallow]',
			'rgb(120, 30, 40)'
		],
		[
			'/router-depth/e',
			'/router-depth/a/b/c',
			'[data-to-deep]',
			'[data-depth-deep]',
			'rgb(10, 20, 30)'
		]
	] as const) {
		test(`${from} → ${to} asks for the next page's sheets at the app's asset address`, async ({
			page
		}) => {
			await page.goto(from, { waitUntil: 'networkidle' });
			await page.waitForSelector('meta[name="ogygia-router"]', { state: 'attached' });
			const doc = await stamp_document(page);
			const asked = sheets_asked(page);
			await page.locator(link).click();
			await expect(page.locator(landed)).toBeVisible();
			await expect(page).toHaveURL(new RegExp(`${to}$`));
			expect(await document_stamp(page), 'the router swapped the page (no document load)').toBe(
				doc
			);
			await expect(page.locator(landed)).toHaveCSS('color', color);
			expect(asked.length, 'the next page had a sheet of its own to load').toBeGreaterThan(0);
			expect(
				asked.filter((p) => !p.startsWith('/_app/')),
				'no sheet asked for at the page being left'
			).toEqual([]);
		});
	}
});
