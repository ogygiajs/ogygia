// A KEY NAMES ONE REGION (#840). /props-tail shows two identical Tally islands (same props, same
// fingerprint). Navigating to /props-tail/b (no twins) left one twin behind on page B. Back on
// /props-tail, the client listed that fingerprint as live, so the server skipped both twins and sent
// empty `<ogygia-region data-og-skipped>` placeholders; the second had no live twin to pair with and
// stayed in the page with the placeholder's marks (`data-og-skipped`, and the compiler's
// `data-og-opaque`, which tells the morph and the ownership map not to walk the region). A fresh load
// of the same page has neither.
//
// Against the built palaestra (/props-tail ↔ /props-tail/b, csr=false, the ogygia router).
// Usage: pnpm exec playwright test skip-marks-kept
import { test, check } from '@ogygia/tooling/e2e';

test.describe('twin regions across client navigations', () => {
	test('none is left behind, and none carries skip marks a fresh load lacks', async ({ page }) => {
		const marked = () =>
			page.evaluate(() =>
				[
					...document.querySelectorAll(
						'ogygia-region[data-og-skipped], ogygia-region[data-og-opaque]'
					)
				].map((r) => r.getAttribute('entry') + ' ' + r.getAttributeNames().join(','))
			);
		const twins = () => page.locator('[data-tally="twin"]').count();
		await page.goto('/props-tail');
		await page.waitForSelector('ogygia-region[data-hydrated]');
		check('a fresh load: two twins', (await twins()) === 2, String(await twins()));
		check('a fresh load has no skip marks', (await marked()).length === 0, String(await marked()));

		await page.locator('[data-to-b]').click();
		await page.waitForFunction(() => location.pathname.endsWith('/props-tail/b'));
		await page.waitForSelector('[data-tally="b-only"]');
		await page.waitForTimeout(300);
		check('page B: no twin of page A left', (await twins()) === 0, String(await twins()));
		check('page B: no skip marks', (await marked()).length === 0, (await marked()).join('\n'));

		await page.locator('[data-to-a]').click();
		await page.waitForFunction(() => /\/props-tail\/?$/.test(location.pathname));
		await page.waitForTimeout(300);
		check('back on A: two twins', (await twins()) === 2, String(await twins()));
		check('back on A: no skip marks', (await marked()).length === 0, (await marked()).join('\n'));
	});
});
