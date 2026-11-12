// AN EARLY CLICK DOES NOT WAIT FOR THE REPLAY HALF'S DOWNLOAD (#451). Since #260 an island clicked
// before it is live goes live only once the capture's replay half (runtime/interaction-replay.ts, a
// lazy chunk of about 1.3 KB) is in, so the click acts at wake. That chunk was asked for only at the
// click: on a slow phone it queued behind the page's other downloads, and the wake waited for it
// (21.8 s from click to wake, in 8 of 8 runs). It is asked for once an island is armed, as
// background work (after the page's critical resources), so it is in before the visitor reaches.
//
// A held download stands in for the slow network: the switch's own code and the replay half each
// take HOLD_MS from their request. The visitor clicks while the switch's code is still on its way.
// Against the built palaestra (/wake-switch).
// Usage: pnpm exec playwright test replay-ahead
import type { Page } from '@playwright/test';
import { test, expect } from '@ogygia/tooling/e2e';

const HOLD_MS = 4000;
/** What only each held file carries in a production build. */
const REPLAY = 'setSelectionRange';
const SWITCH = 'data-wake-switch';

/** Holds the switch's code and the replay half HOLD_MS each; returns when each was asked for. */
async function hold(page: Page, t0: () => number): Promise<{ replay: number | null }> {
	const asked: { replay: number | null } = { replay: null };
	await page.route(
		(url) => url.pathname.endsWith('.js'),
		async (route) => {
			const response = await route.fetch();
			const body = await response.text();
			const is_replay = body.includes(REPLAY);
			if (is_replay && asked.replay === null) asked.replay = t0();
			if (is_replay || body.includes(SWITCH)) await new Promise((r) => setTimeout(r, HOLD_MS));
			return route.fulfill({ response, body });
		}
	);
	return asked;
}

test('an early click wakes the island without waiting for the replay half to download', async ({
	page
}) => {
	const start = Date.now();
	const t0 = () => Date.now() - start;
	const asked = await hold(page, t0);
	// (not `load`: WebKit holds the load event for a module preload still on its way, here the
	// switch's own held code, and by then the island is live)
	await page.goto('/wake-switch', { waitUntil: 'domcontentloaded' });
	await page.waitForTimeout(1000);
	const sw = page.locator('[data-wake-switch]');
	await expect(page.locator('ogygia-region[data-hydrated]')).toHaveCount(0); // its code is held
	const clicked = t0();
	await sw.click();
	await page.locator('ogygia-region[data-hydrated]').waitFor({ timeout: 20_000 });
	const woke = t0();
	expect(asked.replay, 'the replay half was asked for').not.toBeNull();
	expect(
		asked.replay!,
		'the replay half was asked for before the visitor reached the island'
	).toBeLessThan(clicked);
	expect(woke - clicked, 'the wake did not wait out a download the click started').toBeLessThan(
		HOLD_MS
	);
	// and the early click acted, once, at wake
	await expect.poll(async () => Number(await sw.getAttribute('data-flips'))).toBe(1);
});
