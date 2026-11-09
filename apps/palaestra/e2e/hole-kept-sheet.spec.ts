// A HOLE KEPT ACROSS A NAVIGATION KEEPS ITS SHEET (#275). /hole-kept/a and /hole-kept/b hold the same
// hole with the same props. Its answer brings its own stylesheet, which the runtime lifts into the
// head; the server head of neither page lists it (the server never knew which answer it would be).
// A navigation from a to b keeps the answered hole as it is, so its sheet must stay in the head the
// whole time: the head merge took it out as a sheet the next page does not list, and the kept hole
// showed unstyled.
//
//   pnpm --filter palaestra e2e hole-kept-sheet
import { test, expect, check } from '@ogygia/tooling/e2e';

test('a hole kept across a navigation keeps its stylesheet in the head the whole time', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto('/hole-kept/a');
	await page.waitForSelector('meta[name="ogygia-router"]', { state: 'attached' });
	const hole = page.locator('[data-kept-hole]');
	await expect(hole).toHaveCount(1);
	const spacing = () => hole.evaluate((el) => getComputedStyle(el).wordSpacing);
	await expect.poll(spacing).toBe('6px');
	// mark the answered node, and watch the head for a region sheet that leaves it
	await page.evaluate(() => {
		const w = window as unknown as { __sheets_out: string[] };
		(document.querySelector('[data-kept-hole]') as unknown as { __kept: boolean }).__kept = true;
		w.__sheets_out = [];
		new MutationObserver((records) => {
			for (const r of records)
				for (const n of r.removedNodes)
					if (n instanceof Element && n.hasAttribute('data-ogygia-region-css'))
						w.__sheets_out.push(n.getAttribute('href') ?? n.getAttribute('data-ogygia-region-css')!);
		}).observe(document.head, { childList: true });
	});
	const sheets_before = await page.evaluate(
		() => document.head.querySelectorAll('[data-ogygia-region-css]').length
	);
	check('the answer’s sheet is in the head', sheets_before > 0, String(sheets_before));

	await page.locator('[data-hole-kept-link]').click();
	await expect(page.locator('[data-hole-kept-page="b"]')).toHaveCount(1);
	check(
		'the navigation was the router’s (same document)',
		await page.evaluate(() => '__sheets_out' in window)
	);
	check(
		'the answered hole was kept, not answered again',
		await page.evaluate(
			() =>
				(document.querySelector('[data-kept-hole]') as unknown as { __kept?: boolean } | null)
					?.__kept === true
		)
	);
	const out = await page.evaluate(
		() => (window as unknown as { __sheets_out: string[] }).__sheets_out
	);
	check('no region sheet left the head', out.length === 0, out.join(', '));
	check('the kept hole is still styled', (await spacing()) === '6px', await spacing());
	check('no page errors', errors.length === 0, errors.join(' | '));
});
