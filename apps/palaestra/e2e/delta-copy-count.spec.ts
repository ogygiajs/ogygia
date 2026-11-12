// THE SERVER REUSES ONLY THE COPIES THE BROWSER HOLDS (#846). On a client navigation the browser
// tells the server which regions it already shows live, and the server skips rendering those. A page
// with one copy of an island navigating to a page with two copies (same props) got both skipped:
// the second arrived as an empty placeholder with no live copy to stand for, rendered in the browser
// instead of from server HTML, and kept the placeholder's `data-og-skipped` / `data-og-opaque`.
//
// Against the built palaestra (/delta-copies/<n> shows n identical copies of one island).
// Usage: pnpm exec playwright test delta-copy-count
import { test, check } from '@ogygia/tooling/e2e';

test.describe('a client navigation from one copy of an island to two', () => {
	test('the second copy arrives rendered by the server, with no skip marks', async ({ page }) => {
		const answers: Promise<string>[] = [];
		page.on('response', (r) => {
			if (r.request().headers()['x-ogygia-spa'] && r.url().endsWith('/delta-copies/2'))
				answers.push(r.text());
		});
		const twins = () => page.locator('[data-tally="twin"]').count();
		await page.goto('/delta-copies/1');
		await page.waitForSelector('ogygia-region[data-hydrated]');
		check('one copy', (await twins()) === 1, String(await twins()));

		await page.locator('[data-to-2]').click();
		await page.waitForFunction(() => location.pathname.endsWith('/delta-copies/2'));
		await page.waitForTimeout(300);

		const html = (await Promise.all(answers)).join('');
		const rendered = (html.match(/data-tally="twin"/g) ?? []).length;
		const skipped = (html.match(/data-og-skipped/g) ?? []).length;
		check('the server skipped one copy (the live one)', skipped === 1, `skipped ${skipped}`);
		check('the server rendered the other copy', rendered === 1, `rendered ${rendered}`);

		check('two copies', (await twins()) === 2, String(await twins()));
		const marked = await page.evaluate(() =>
			[
				...document.querySelectorAll(
					'ogygia-region[data-og-skipped], ogygia-region[data-og-opaque]'
				)
			].map((r) => r.getAttribute('entry'))
		);
		check('no skip marks on the page', marked.length === 0, marked.join(','));
	});
});
