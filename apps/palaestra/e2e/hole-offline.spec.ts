// A HOLE THAT FAILED FOR THE NETWORK WAITS FOR THE NETWORK (#891). The connection drops as the
// deferred region's first request goes out, and comes back a few seconds later (past every retry).
// The region loads once the browser is back online, instead of keeping its fallback for the life of
// the page.
//
// Against the built palaestra (/server's deferred greeting). Chromium: Playwright's offline mode
// fires the browser's own `offline` / `online` events there.
// Usage: pnpm exec playwright test hole-offline --project=chromium
import { test, check } from '@ogygia/tooling/e2e';

test('a deferred region whose fetch failed offline loads once the network is back', async ({
	page,
	context,
	browserName
}) => {
	test.skip(browserName !== 'chromium', "the offline switch must land before the hole's request");
	let dropped = false;
	await page.route(
		(url) => url.pathname === '/__ogygia__',
		async (route) => {
			if (!dropped) {
				dropped = true;
				await context.setOffline(true);
				return route.abort('internetdisconnected');
			}
			return route.fallback();
		}
	);
	await page.goto('/server', { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(() => navigator.onLine === false, null, { timeout: 8000 });
	// past every timed retry it would have made
	await page.waitForTimeout(4000);
	check('the request was cut', dropped);
	await context.setOffline(false);
	const loaded = await page
		.waitForFunction(() => /Hello, stranger/.test(document.body.textContent ?? ''), null, {
			timeout: 8000
		})
		.then(
			() => true,
			() => false
		);
	check('the region loaded once the network was back', loaded);
});
