/**
 * The search palette's download (the heavy half of `Search`, loaded on first intent), on the docs
 * app's dev server.
 *
 *   pnpm turbo run e2e --filter=docs
 *
 * - #272: a failed download of the palette must not leave the search button dead. The browser keeps
 *   a failed module URL failed, so the next intent asks for it again under a fresh URL; a click
 *   whose load fails follows the trigger's real `/search` link.
 * - #279: Ctrl/Cmd+K pressed twice while the palette is still loading is "open, then close": the
 *   palette must stay closed when it arrives.
 *
 * Self-booting: the docs app's `vite dev` comes up in `beforeAll` and is torn down after.
 */
import type { Page } from '@playwright/test';
import { test, expect, REPO as root } from '@ogygia/tooling/e2e';
import { port, spawn_server, type SpawnedServer } from '@ogygia/tooling/e2e/servers.ts';

const PORT = port(5174);
const base = `http://127.0.0.1:${PORT}`;
const TRIGGER = 'ogygia-region[data-hydrated] a.og-search-trigger';
const PALETTE = /SearchPalette\.svelte/;

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

async function ready(page: Page) {
	await page.goto(`${base}/docs/start/overview`);
	await expect(page.locator(TRIGGER)).toHaveCount(1, { timeout: 60_000 });
}

test('a failed palette download is asked for again, and a click while it fails follows /search', async ({
	page
}) => {
	test.setTimeout(3 * 60_000);
	await ready(page);
	// the palette's file fails at the network, every time, for now
	let failing = true;
	await page.route(PALETTE, (route) => (failing ? route.abort('failed') : route.continue()));

	// a hover warms it: the download fails
	await page.locator(TRIGGER).hover();
	await page.waitForTimeout(500);
	// a click while it still fails: the trigger's real link is followed
	await Promise.all([page.waitForURL(/\/docs\/search/), page.locator(TRIGGER).click()]);

	// the network back: from the docs page again, a hover loads it, and a click opens it
	await page.goBack();
	await expect(page.locator(TRIGGER)).toHaveCount(1, { timeout: 60_000 });
	failing = false;
	await page.locator(TRIGGER).hover();
	await page.locator(TRIGGER).click();
	await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
	await expect(page).toHaveURL(/\/docs\/start\/overview$/);
});

test('Ctrl/Cmd+K twice while the palette loads leaves it closed', async ({ page }) => {
	test.setTimeout(3 * 60_000);
	await ready(page);
	// hold the palette's download until both presses are in
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	await page.route(PALETTE, async (route) => {
		await held;
		await route.continue();
	});
	await page.keyboard.press('ControlOrMeta+k');
	await page.keyboard.press('ControlOrMeta+k');
	const arrived = page.waitForResponse(PALETTE);
	release();
	// the palette arrives, and stays closed
	await arrived;
	await page.waitForTimeout(1000);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	// a third press opens it
	await page.keyboard.press('ControlOrMeta+k');
	await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
});
