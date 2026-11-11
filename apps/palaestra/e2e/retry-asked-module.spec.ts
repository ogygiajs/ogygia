// A RETRY HANDS BACK THE MODULE THAT WAS ASKED FOR (#831). The Outer island's module awaits the
// module of the island nested in it as it loads. When that nested file fails to download once, the
// failed import's error names the NESTED file. The retry must ask again for the module that was
// asked for (Outer's own), never hand the nested module back in its place: the Outer island was
// replaced by the nested Counter.
//
// Against the built palaestra (/nested). WebKit's failed import names no URL, so there it never
// retried the named file: Chromium and Firefox are the engines this case is about.
// Usage: pnpm exec playwright test retry-asked-module
import { test, check } from '@ogygia/tooling/e2e';

/** The nested island's file, as the Outer module imports it. */
const NESTED_IMPORT_RE = /import\(`\.\/(og-region\.[^`]+\.js)`\)/;

test.describe('a retried import', () => {
	test('an island stays itself when the file of an island nested in it fails to download once', async ({
		page,
		baseURL
	}) => {
		// the Outer region's module, read from a page served as usual
		const html = await (await fetch(baseURL + '/nested')).text();
		const src = /<ogygia-region[^>]*\ssrc="([^"]+)"/.exec(html)?.[1] ?? '';
		const code = await (await fetch(new URL(src, baseURL + '/nested').href)).text();
		const nested = NESTED_IMPORT_RE.exec(code)?.[1] ?? '';
		check('the Outer module imports its nested island as it loads', nested !== '', src);

		// the nested file's first download is cut (the page's preload of it and the import may both
		// ask: every request before the first retry fails)
		let cut = 0;
		await page.route(
			(url) => url.pathname.endsWith('/' + nested) && !url.searchParams.has('og-retry'),
			async (route) => {
				cut++;
				await route.abort('connectionreset');
			}
		);
		await page.goto('/nested', { waitUntil: 'domcontentloaded' });
		await page.waitForTimeout(2500);

		check('the nested file was cut', cut > 0, String(cut));
		const outer_btn = page.locator('[data-outer-btn]');
		check(
			'the Outer island is still the Outer island',
			(await outer_btn.count()) === 1 &&
				((await outer_btn.textContent()) ?? '').trim().startsWith('outer A'),
			(await page.locator('ogygia-region').first().innerHTML()).slice(0, 200)
		);
		check(
			'the island was not re-rendered as another component',
			(await page.locator('[data-og-recovered]').count()) === 0
		);
	});
});
