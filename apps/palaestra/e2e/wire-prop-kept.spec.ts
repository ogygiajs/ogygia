// An island whose props carry a transportable class instance has the same fingerprint on every
// server render, so a navigation that keeps it on screen keeps it mounted, with its state (#804).
// Against the built palaestra: /lazy-retry-class (two StampCounter islands sharing one RetryStamp).
//
// Run: pnpm exec playwright test wire-prop-kept
import { expect, test, type Page } from '@playwright/test';
import { check } from '@ogygia/tooling/e2e';

const NEAR = '[data-stamp-counter="near"]';
const region_of = (page: Page) => page.locator(`ogygia-region:has(${NEAR})`).first();

test.describe('a wire-class prop keeps its island across navigations', () => {
	test('two server renders of the page give the island the same data-og-fp', async ({
		context,
		baseURL
	}) => {
		const fp = async () => {
			const html = await (await context.request.get(`${baseURL}/lazy-retry-class`)).text();
			return [...html.matchAll(/<ogygia-region[^>]*data-og-fp="([0-9a-f]+)"/g)].map((m) => m[1]);
		};
		const first = await fp();
		const second = await fp();
		check('the page has fingerprinted islands', first.length > 0, JSON.stringify(first));
		expect(second).toEqual(first);
	});

	test('the server-delta render skips the island the client says it holds', async ({
		context,
		baseURL
	}) => {
		const full = await (await context.request.get(`${baseURL}/lazy-retry-class`)).text();
		const known = [...full.matchAll(/<ogygia-region[^>]*data-og-fp="([0-9a-f]+)"/g)]
			.map((m) => m[1])
			.join(',');
		const delta = await (
			await context.request.get(`${baseURL}/lazy-retry-class`, {
				headers: { 'x-ogygia-spa': '1', 'x-ogygia-known': known }
			})
		).text();
		check('the delta render skips a known island', delta.includes('data-og-skipped'));
	});

	test('a navigation that lands on the same page keeps the island mounted with its state', async ({
		page
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(String(e)));
		await page.goto('/lazy-retry-class');
		const button = page.locator(`${NEAR} button`);
		await expect(region_of(page)).toHaveAttribute('data-hydrated', /.*/);
		await button.click();
		await expect(button).toHaveText('count is 1');
		const before = await region_of(page).getAttribute('data-og-fp');
		// mark the live element: a kept island is the same node after the navigation
		await region_of(page).evaluate((el) => ((el as unknown as { __kept: boolean }).__kept = true));

		const nav = page.waitForResponse(
			(r) =>
				new URL(r.url()).pathname === '/lazy-retry-class' &&
				r.request().headers()['x-ogygia-spa'] !== undefined
		);
		await page.evaluate(() => {
			const a = document.createElement('a');
			a.href = '/lazy-retry-class';
			a.setAttribute('data-again', '');
			a.textContent = 'again';
			document.body.appendChild(a);
		});
		await page.locator('a[data-again]').click();
		await nav;
		await page.waitForTimeout(400);

		const after = await region_of(page).getAttribute('data-og-fp');
		check(
			'the fingerprint is the same after the navigation',
			after === before,
			`${before} vs ${after}`
		);
		check(
			'the island is the same live node',
			await region_of(page).evaluate(
				(el) => (el as unknown as { __kept?: boolean }).__kept === true
			)
		);
		await expect(button).toHaveText('count is 1');
		check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
	});
});
