/**
 * The Releases pages (docs app): every package's releases from its CHANGELOG.md, read at build.
 *
 *   pnpm turbo run e2e --filter=docs
 *
 * `/releases` groups each version's packages in one card; its filters are links the server reads,
 * so they work with JavaScript off. `/releases/<package>` is one package's history.
 *
 * Self-booting: the docs app's `vite dev` comes up in `beforeAll` and is torn down after.
 */
import { test, expect, REPO as root } from '@ogygia/tooling/e2e';
import { port, spawn_server, type SpawnedServer } from '@ogygia/tooling/e2e/servers.ts';

const PORT = port(5174);
const base = `http://127.0.0.1:${PORT}`;

let srv: SpawnedServer | undefined;

test.beforeAll(async () => {
	test.setTimeout(5 * 60_000);
	srv = await spawn_server({
		cmd: 'pnpm',
		args: [
			'--filter',
			'docs',
			'exec',
			'vite',
			'dev',
			'--port',
			String(PORT),
			'--strictPort',
			'--host',
			'127.0.0.1'
		],
		cwd: root,
		url: base + '/releases',
		timeout_ms: 180_000
	});
});
test.afterAll(() => srv?.kill());

const card = (page: import('@playwright/test').Page, version: string) =>
	page.locator(`[data-release-version="${version}"]`);

test('the releases page lists 0.13.0 with the packages released in it', async ({ page }) => {
	await page.goto(base + '/releases');
	const v = card(page, '0.13.0');
	await expect(v).toBeVisible();
	for (const name of ['ogygia', '@ogygia/core', '@ogygia/machine'])
		await expect(v.locator('[data-release-package]', { hasText: name }).first()).toBeVisible();
	// its lines keep their PR links
	await expect(
		v.locator('a[href^="https://github.com/ogygiajs/ogygia/pull/"]').first()
	).toBeVisible();
});

test.describe('with JavaScript off', () => {
	test.use({ javaScriptEnabled: false });

	test('a type filter is a link the server reads: Patch lists patch releases only', async ({
		page
	}) => {
		await page.goto(base + '/releases');
		await page.getByRole('link', { name: 'Patch', exact: true }).click();
		await expect(page).toHaveURL(/type=patch/);
		await expect(card(page, '0.12.3')).toBeVisible();
		await expect(card(page, '0.13.0')).toHaveCount(0);
		// every card is open: nothing to expand without JavaScript
		const closed = await page.locator('details[data-release-version]:not([open])').count();
		expect(closed).toBe(0);
	});
});

test('one package has its own page, with only its own releases', async ({ page }) => {
	await page.goto(base + '/releases/machine');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('@ogygia/machine');
	await expect(card(page, '0.13.0')).toBeVisible();
	await expect(page.locator('[data-release-package]', { hasText: '@ogygia/core' })).toHaveCount(0);
});
