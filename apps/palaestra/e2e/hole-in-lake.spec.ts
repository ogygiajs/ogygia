// A server island inside a server island inside an island (#948). The island waits for a press; the
// server island in it renders inline, as a lake; the server island inside that one is a hole with no
// fallback, whose answer is slow. Its answer lands, and stays.
// Usage: pnpm exec playwright test hole-in-lake
import { test, check, expect } from '@ogygia/tooling/e2e';

test('a server island inside a server island inside an island shows, and stays', async ({
	page
}) => {
	const problems: string[] = [];
	page.on('pageerror', (e) => problems.push(e.message));
	page.on('console', (m) => {
		if (m.type() === 'error') problems.push(m.text().slice(0, 200));
	});
	await page.goto('/hole-in-lake');

	await expect(page.locator('[data-hil-middle]'), 'the middle server island shows').toHaveCount(1);
	await expect(page.locator('[data-hil-inner]'), 'the inner answer lands').toHaveText(
		'inner hole',
		{ timeout: 10_000 }
	);
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(500);
	await expect(page.locator('[data-hil-inner]'), 'the inner answer stays').toHaveText('inner hole');
	check('no page error', problems.length === 0, problems.join(' | '));
});
