// A SERVER ISLAND INSIDE A HELD REGION THAT WAKES SHOWS (#901). A remote returns
// `await region(Card)` (Card imported `with { wake: 'load' }`), and Card places a server island
// (`Greeting with { render: 'deferred' }`). The region's HTML is baked on the server, painted, then
// Card hydrates over it. The server island stayed an empty element: never fetched, nothing said.
//
// Usage: pnpm --filter palaestra e2e held-hole
import { test, check } from '@ogygia/tooling/e2e';

test('a server island inside a woken held region shows its server render', async ({ page }) => {
	const warns: string[] = [];
	page.on('console', (m) => {
		const t = m.text();
		if (/hydration_mismatch|discarded its ENTIRE/.test(t)) warns.push(t.slice(0, 160));
	});
	await page.goto('/held-hole', { waitUntil: 'load' });
	const card = page.locator('[data-held-card]');
	await card.locator('[data-held-card-btn]').waitFor();
	await page.waitForFunction(
		() => !!document.querySelector('[data-held-host] ogygia-region[data-hydrated]'),
		null,
		{ timeout: 10_000 }
	);
	await page.waitForFunction(
		() =>
			/Held, stranger!/.test(
				document.querySelector('[data-held-card] [data-server-greeting]')?.textContent ?? ''
			),
		null,
		{ timeout: 10_000 }
	);
	check('the server island shows', true);
	check('no hydration mismatch or discard warning', warns.length === 0, warns.join(' | '));

	await card.locator('[data-held-card-btn]').click();
	await page.waitForFunction(
		() => document.querySelector('[data-held-card-btn]')?.textContent === 'card: 1',
		null,
		{ timeout: 5000 }
	);
	check('the woken card counts the press', true);
});
