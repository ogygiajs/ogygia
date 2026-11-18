// A QUERY MADE OUTSIDE ANY ISLAND GETS FRESH DATA, EVEN WHILE A DEPARTED ISLAND STILL HOLDS IT (#2041).
// The remote counter on /data presses "bump", whose command is held at the network, and the visitor
// leaves for /query-after-leave. There a click handler reads the same query. The departed island's
// handler then gets its answer and refreshes its own query, which must throw nothing.
//
// Against the built palaestra (/data → /query-after-leave).
// Usage: pnpm exec playwright test query-after-leave
import { expect, type Route } from '@playwright/test';
import { test, check, while_open } from '@ogygia/tooling/e2e';

test('a query read from a click handler after its island left gets fresh data', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	let open!: () => void;
	const opened = new Promise<void>((r) => (open = r));
	const held: Route[] = [];
	await page.route(
		(url) => url.pathname.includes('/remote/'),
		while_open(async (route, request) => {
			if (request.method() !== 'POST') return route.continue();
			held.push(route);
			await opened;
			await route.continue();
		})
	);

	await page.goto('/data', { waitUntil: 'domcontentloaded' });
	await page.waitForSelector('ogygia-region[data-hydrated] [data-bump]');
	await page.locator('[data-bump]').click();
	await expect.poll(() => held.length).toBe(1);

	await page.evaluate(() => {
		const a = document.createElement('a');
		a.href = '/query-after-leave';
		a.setAttribute('data-to-after-leave', '');
		document.body.append(a);
		a.click();
	});
	await page.waitForURL('**/query-after-leave', { timeout: 8000 });
	await page.waitForSelector('ogygia-region[data-hydrated] [data-read-count]');
	check('the counter island left', (await page.locator('[data-remote-counter]').count()) === 0);

	await page.locator('[data-read-count]').click();
	await expect(page.locator('[data-read]')).not.toHaveText('');
	const read = ((await page.locator('[data-read]').textContent()) ?? '').trim();
	check('the click read the count from the server', /^\d+$/.test(read), read);

	open();
	await page.waitForTimeout(600);
	await page.locator('[data-read-count]').click();
	await page.waitForTimeout(300);
	const again = ((await page.locator('[data-read]').textContent()) ?? '').trim();
	check(
		'a second read after the departed handler refreshed still has data',
		/^\d+$/.test(again),
		again
	);
	check('nothing threw', errors.length === 0, errors.join(' | '));
});
