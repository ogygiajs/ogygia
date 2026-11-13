// On a csr=true page a region import means one thing wherever it is written: a deferred hole and a
// lake in the page file itself behave as the same imports in a shared component the page renders.
// The hole sends its fallback and fills from the server; the lake stays a frozen region Kit never
// hydrates. A wake island in the page file is Kit's: a plain component it hydrates.
//
//   pnpm exec playwright test csr-true-regions
import { test, check, sleep } from '@ogygia/tooling/e2e';

const PLACES = ['page', 'shared'] as const;

test.describe('csr=true page: a region written in the page file or in a shared component', () => {
	test('SSR: the hole sends its fallback and the lake is a frozen region, in both places', async ({
		baseURL
	}) => {
		const html = await (await fetch(`${baseURL}/csr-true-regions`)).text();
		for (const at of PLACES) {
			check(
				`${at}: the hole is a deferred region holding its fallback`,
				new RegExp(
					`<ogygia-region entry="[^"]*" render="defer"[^>]*>(?:<!--[^>]*-->)*<p data-ctr-fallback="${at}"`
				).test(html)
			);
			check(
				`${at}: the hole's server render is not in the page`,
				!html.includes(`<strong>${at === 'page' ? 'Page' : 'Shared'}, `)
			);
			check(
				`${at}: the lake is a frozen region`,
				new RegExp(
					`<ogygia-region entry="[^"]+" wake="none"[^>]*>(?:<!--[^>]*-->)*<div data-ctr-lake="${at}"`
				).test(html)
			);
		}
		check(
			'the page file’s wake island is a plain component (no region around it)',
			/<div data-ctr-island=""><div class="island[^"]*" data-counter/.test(html)
		);
	});

	test('browser: Kit hydrates the page; each hole fills and each lake stays frozen', async ({
		page
	}) => {
		const errs: string[] = [];
		page.on('pageerror', (e) => errs.push(e.message));
		await page.goto('/csr-true-regions', { waitUntil: 'networkidle' });
		await page.click('[data-ctr-kit]');
		check('Kit hydrated the page', (await page.textContent('[data-ctr-kit]')) === 'kit:1');
		await sleep(300);
		for (const at of PLACES) {
			const hole = page.locator(`[data-ctr-hole="${at}"]`);
			check(
				`${at}: the hole filled from the server`,
				(await hole.locator('[data-server-greeting]').count()) === 1
			);
			check(
				`${at}: the hole's fallback is gone`,
				(await page.locator(`[data-ctr-fallback="${at}"]`).count()) === 0
			);
			const lake_btn = page.locator(`[data-ctr-lake-btn="${at}"]`);
			await lake_btn.click();
			check(
				`${at}: the lake stayed frozen (its button was never hydrated)`,
				(await lake_btn.textContent()) === 'lake:0'
			);
			check(
				`${at}: the lake is still its region`,
				(await page.locator(`ogygia-region[wake="none"] [data-ctr-lake="${at}"]`).count()) === 1
			);
		}
		const counter = page.locator('[data-ctr-island] button');
		await counter.click();
		check(
			'the page file’s wake island works as Kit’s component',
			(await counter.textContent()) === 'count is 4'
		);
		check('no page error', errs.length === 0, errs.join('; '));
	});
});
