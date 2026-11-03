/**
 * The sidebar's section switcher keeps opening across client-side navigations (docs app).
 *
 *   pnpm turbo run e2e --filter=docs
 *
 * REGRESSION: after the second client navigation inside one section, the switcher's trigger still
 * flipped to open, but no menu appeared. The navigation kept the switcher's island (same props on
 * both pages) and removed every `<body>` child the next page's HTML did not have, among them the
 * anchor the menu's portal had mounted beside, so the menu was inserted next to a detached node.
 * The fix is ogygia's (runtime/reconcile.ts: a navigation leaves the page's own body children).
 *
 * Self-booting: the docs app's `vite dev` comes up in `beforeAll` and is torn down after.
 */
import type { Page } from '@playwright/test';
import { test, expect, REPO as root } from '@ogygia/tooling/e2e';
import { port, spawn_server, type SpawnedServer } from '@ogygia/tooling/e2e/servers.ts';

const PORT = port(5174);
const base = `http://127.0.0.1:${PORT}`;
const TRIGGER = '.og-cside ogygia-region[data-hydrated] button[data-dropdown-menu-trigger]';

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
		url: base + '/docs/start/overview',
		timeout_ms: 180_000
	});
});
test.afterAll(() => srv?.kill());

/** Open the switcher, check its menu shows, close it again. */
async function opens(page: Page) {
	await page.locator(TRIGGER).click();
	await expect(page.getByRole('menu', { name: 'Docs sections' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('menu')).toHaveCount(0);
}

/** A client-side navigation by a sidebar link, settled once the switcher is awake again. */
async function sidebar_nav(page: Page, text: string, path: string) {
	await page.locator('.og-cside .og-nav-link', { hasText: text }).first().click();
	await page.waitForURL('**' + path);
	await expect(page.locator(TRIGGER)).toHaveCount(1);
}

test('the section switcher opens after every client-side navigation, inside a section too', async ({
	page
}) => {
	test.setTimeout(3 * 60_000);
	await page.goto(base + '/docs/start/overview');
	await expect(page.locator(TRIGGER)).toHaveCount(1, { timeout: 60_000 });
	await opens(page);

	// to another section through the switcher
	await page.locator(TRIGGER).click();
	await page.getByRole('menuitem', { name: /^Core/ }).click();
	await page.waitForURL('**/docs/core/overview');
	await expect(page.locator(TRIGGER)).toHaveCount(1);
	await opens(page);

	// inside the section: the switcher's island is kept, the same node across the navigation
	await page.locator(TRIGGER).evaluate((b) => b.setAttribute('data-e2e-before-nav', ''));
	await sidebar_nav(page, 'Writing a plugin', '/docs/core/plugins');
	await expect(page.locator(`${TRIGGER}[data-e2e-before-nav]`)).toHaveCount(1);
	await opens(page);

	// and once more
	await sidebar_nav(page, '@ogygia/core/plugin/client', '/docs/core/api/plugin-client');
	await opens(page);
});

test('loaded on a section page, the switcher still opens after a navigation inside the section', async ({
	page
}) => {
	test.setTimeout(3 * 60_000);
	await page.goto(base + '/docs/core/overview');
	await expect(page.locator(TRIGGER)).toHaveCount(1, { timeout: 60_000 });
	await sidebar_nav(page, 'Writing a plugin', '/docs/core/plugins');
	await opens(page);
	await sidebar_nav(page, 'Overview', '/docs/core/overview');
	await opens(page);
});
