// A held region inside a held region's island (#945). The page's island reads a query whose region is
// an island; inside it, another island renders a plain component that holds a second query's region,
// awaited in the render. The inner region comes in with the outer one's HTML, and must show.
// Usage: pnpm exec playwright test held-in-held
import { test, check, expect } from '@ogygia/tooling/e2e';

test('a held region inside a held region shows', async ({ page }) => {
	const problems: string[] = [];
	page.on('pageerror', (e) => problems.push(e.message));
	page.on('console', (m) => {
		if (m.type() === 'error') problems.push(m.text().slice(0, 200));
	});
	await page.goto('/held-in-held');

	await expect(page.locator('[data-hih-middle]'), 'the outer region shows').toHaveCount(1, {
		timeout: 10_000
	});
	await expect(page.locator('[data-hih-inner]'), 'the inner region shows').toHaveText(
		'inner region',
		{ timeout: 10_000 }
	);
	check('no page error', problems.length === 0, problems.join(' | '));
});
