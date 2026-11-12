/**
 * The docs shell's sidebar is one element for the whole visit (docs app): a client navigation
 * hands the kept sidebar the next page's tree instead of rendering a new one, so its active chip
 * can glide to the new row. A navigation to another section changes the tree, so it shows this.
 *
 *   pnpm turbo run e2e --filter=docs
 *
 * Self-booting: the docs app's `vite dev` comes up in `beforeAll` and is torn down after.
 */
import { test, expect, REPO as root } from '@ogygia/tooling/e2e';
import { port, spawn_server, type SpawnedServer } from '@ogygia/tooling/e2e/servers.ts';

const PORT = port(5174);
const base = `http://127.0.0.1:${PORT}`;
const SIDEBAR = '.og-cside .og-sidebar';
const SWITCHER = '.og-cside ogygia-region[data-hydrated] button[data-dropdown-menu-trigger]';

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

test('the sidebar is the same element after a navigation to another section, with the new tree', async ({
	page
}) => {
	test.setTimeout(3 * 60_000);
	await page.goto(base + '/docs/start/overview');
	await expect(page.locator(SWITCHER)).toHaveCount(1, { timeout: 60_000 });
	await expect(page.locator(SIDEBAR)).toHaveCount(1);
	await page.locator(SIDEBAR).evaluate((el) => el.setAttribute('data-e2e-before-nav', ''));

	await page.evaluate(() => {
		const w = window as unknown as { __e2e_nav?: Promise<void> };
		w.__e2e_nav = new Promise((done) =>
			document.addEventListener('og:page-load', () => done(), { once: true })
		);
	});
	await page.locator(SWITCHER).click();
	await page.getByRole('menuitem', { name: /^Core/ }).click();
	await page.evaluate(() => (window as unknown as { __e2e_nav?: Promise<void> }).__e2e_nav);
	await expect(page).toHaveURL(/\/docs\/core\/overview$/);

	await expect(page.locator(`${SIDEBAR} a[href="/docs/core/plugins"]`)).toHaveCount(1);
	await expect(page.locator(`${SIDEBAR}[data-e2e-before-nav]`)).toHaveCount(1);
});
