// A DEFERRED REGION THAT WAKES ADOPTS ITS ANSWER. A held region with a schedule (`TapBadge`,
// `wake: 'load'`) returned UN-awaited from a remote crosses as a deferred region: the runtime fetches
// its HTML (`render()`'s shape — the component in one anchor pair), swaps it in, then hydrates it.
// The hydrate must ADOPT those nodes. A host component around the island (one marker layer more)
// once met that shape one layer short: Svelte discarded the answer and re-rendered it client-side,
// and the detector flagged it (`data-og-recovered`, "discarded its ENTIRE server-rendered DOM").
//
// Usage: pnpm exec playwright test deferred-wake-adopt
import { test, check } from '@ogygia/tooling/e2e';

test('a woken deferred region adopts its fetched HTML, and it is interactive', async ({ page }) => {
	const warns: string[] = [];
	page.on('console', (m) => {
		const t = m.text();
		if (/hydration_mismatch|discarded its ENTIRE/.test(t)) warns.push(t.slice(0, 160));
	});
	await page.goto('/shapes', { waitUntil: 'load' });
	const section = page.locator('section[data-shape="array"]');
	await section.locator('button').first().click();

	const tap = section.locator('ogygia-region[render="defer"][wake]');
	await tap.locator('button').waitFor();
	await page.waitForFunction(
		() =>
			!!document.querySelector(
				'section[data-shape="array"] ogygia-region[render="defer"][wake][data-hydrated]'
			),
		null,
		{ timeout: 10_000 }
	);
	check(
		'the woken deferred region is not flagged recovered',
		(await tap.getAttribute('data-og-recovered')) === null
	);
	check('no hydration mismatch or discard warning', warns.length === 0, warns.join(' | '));

	await tap.locator('button').click();
	await page.waitForFunction(
		() =>
			document
				.querySelector('section[data-shape="array"] ogygia-region[render="defer"][wake] button')
				?.textContent?.includes('4'),
		null,
		{ timeout: 5000 }
	);
	check('the adopted button counts the tap', true);
});
