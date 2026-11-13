/**
 * The docs shell's mobile bar is one element for the whole visit (docs app, phone width, #634): a
 * client navigation hands the kept bar the next page's tree instead of hydrating a new one, with no
 * page error. Kept, its sheet would stay open over the new page: a link picked in the sheet closes it.
 *
 *   pnpm turbo run e2e --filter=docs
 *
 * Self-booting: the docs app's `vite dev` comes up in `beforeAll` and is torn down after.
 */
import { test, expect, REPO as root } from '@ogygia/tooling/e2e';
import { port, spawn_server, type SpawnedServer } from '@ogygia/tooling/e2e/servers.ts';

const PORT = port(5175);
const base = `http://127.0.0.1:${PORT}`;
const BAR = '.og-bottombar';
const MENU = `${BAR} button.og-cbar-menu`;

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
		url: `${base}/docs/start/overview`,
		timeout_ms: 180_000
	});
});
test.afterAll(() => srv?.kill());

test.use({ viewport: { width: 390, height: 844 } });

/** a promise on the page for the next client navigation's end */
const next_nav = (page: import('@playwright/test').Page) =>
	page.evaluate(() => {
		const w = window as unknown as { __e2e_nav?: Promise<void> };
		w.__e2e_nav = new Promise((done) =>
			document.addEventListener('og:page-load', () => done(), { once: true })
		);
	});
const nav_done = (page: import('@playwright/test').Page) =>
	page.evaluate(() => (window as unknown as { __e2e_nav?: Promise<void> }).__e2e_nav);

test('a link picked in the mobile sheet closes it; the bar stays, with the new page marked', async ({
	page
}) => {
	test.setTimeout(3 * 60_000);
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto(`${base}/docs/start/overview`);
	await expect(page.locator(`ogygia-region[data-hydrated] ${MENU}`)).toHaveCount(1, {
		timeout: 60_000
	});
	await page.locator(BAR).evaluate((el) => {
		(el as unknown as { __e2e_kept: boolean }).__e2e_kept = true;
	});

	// (by keyboard: the dev server's devtools dock sits over the bottom bar)
	await next_nav(page);
	await page.locator(MENU).press('Enter');
	await page.locator('.og-sheet a[href="/docs/regions/regions"]').first().press('Enter');
	await nav_done(page);
	await expect(page).toHaveURL(/\/docs\/regions\/regions$/);

	await expect(page.locator('.og-sheet')).toHaveCount(0);
	await expect(page.locator(MENU)).toHaveAttribute('aria-expanded', 'false');
	expect(
		await page
			.locator(BAR)
			.evaluate((el) => (el as unknown as { __e2e_kept?: boolean }).__e2e_kept === true)
	).toBe(true);
	await page.locator(MENU).press('Enter');
	await expect(
		page.locator('.og-sheet a[href="/docs/regions/regions"][aria-current="page"]').first()
	).toBeVisible();
	expect(errors).toEqual([]);
});
