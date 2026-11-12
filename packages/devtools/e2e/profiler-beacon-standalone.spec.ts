// THE STANDALONE BEACON'S VISIT (#209): a Kit-hydrated page with no island (/score-lab-kit) reports
// through the profiler's inline beacon, not the runtime's. Hiding the page sends the visit once and
// nothing after it while the page stays hidden; a back/forward cache restore or coming back to the
// tab opens the visit again, and the next hide sends it again.
import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn_server, port, type SpawnedServer } from '@ogygia/tooling/e2e/servers.ts';

const PORT = port(3104);
const ORIGIN = `http://localhost:${PORT}`;
// (16 bytes or more: a production profiler refuses a shorter secret, #760)
const KEY = 'e2e-beacon-profiler-key';
// (the devtools lab, built by this suite's globalSetup)
const app = fileURLToPath(new URL('./app', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'og-beacon-'));
let server: SpawnedServer | undefined;

test.use({ extraHTTPHeaders: { 'x-profiler-key': KEY } });

test.beforeAll(async () => {
	server = await spawn_server({
		cmd: 'node',
		args: ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'],
		cwd: app,
		env: { ORIGIN, OGYGIA_PROFILER_SECRET: KEY, OGYGIA_PROFILES_DB: join(dir, 'profiles.db') },
		url: `${ORIGIN}/robots.txt`
	});
});
test.afterAll(async () => {
	await server?.kill();
	rmSync(dir, { recursive: true, force: true });
});

/** every body the page posts to the beacon, by sendBeacon or fetch, in order */
async function record_posts(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const posts: string[] = [];
		(window as unknown as { __posts: string[] }).__posts = posts;
		const beacon = navigator.sendBeacon.bind(navigator);
		navigator.sendBeacon = (url, body) => {
			if (String(url).endsWith('/beacon')) posts.push(String(body));
			return beacon(url, body);
		};
		const fetch_ = window.fetch.bind(window);
		window.fetch = (input, init) => {
			if (String(input).endsWith('/beacon') && init?.method === 'POST')
				posts.push(String(init.body));
			return fetch_(input, init);
		};
	});
}

const visits = (page: Page) =>
	page.evaluate(
		() =>
			(window as unknown as { __posts: string[] }).__posts.filter((b) => b.includes('"visit"'))
				.length
	);

const visibility = (page: Page, state: 'hidden' | 'visible') =>
	page.evaluate((state) => {
		Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
	}, state);

async function open(page: Page): Promise<void> {
	await record_posts(page);
	await page.goto(`${ORIGIN}/score-lab-kit`, { waitUntil: 'load' });
	// the standalone beacon is the one reporting (no runtime on this page)
	expect(
		await page.evaluate(() => ({
			standalone: !!(window as unknown as Record<symbol, unknown>)[Symbol.for('ogygia.beacon')],
			runtime: !!document.querySelector('script[data-ogygia-runtime]')
		}))
	).toEqual({ standalone: true, runtime: false });
}

test('a page hidden right after it loads sends its visit once, and no copy after it', async ({
	page
}) => {
	await open(page);
	// hidden before the early visit (1.5 s after load) went
	await visibility(page, 'hidden');
	const final = await visits(page);
	expect(final).toBeGreaterThan(0);
	await page.waitForTimeout(3000);
	expect(await visits(page)).toBe(final);
});

test('a page restored from the back/forward cache reports its visit again', async ({ page }) => {
	await open(page);
	await page.evaluate(() =>
		dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
	);
	const first = await visits(page);
	expect(first).toBeGreaterThan(0);
	await page.evaluate(() =>
		dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
	);
	await page.evaluate(() =>
		dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
	);
	expect(await visits(page)).toBeGreaterThan(first);
});

test('coming back to the tab opens the visit again: the next hide sends it', async ({ page }) => {
	await open(page);
	await visibility(page, 'hidden');
	const first = await visits(page);
	expect(first).toBeGreaterThan(0);
	await visibility(page, 'visible');
	await visibility(page, 'hidden');
	expect(await visits(page)).toBeGreaterThan(first);
});

test('a Kit page reports its vitals once and its visit, with no regions, from the one page beacon', async ({
	page
}) => {
	await open(page);
	await visibility(page, 'hidden');
	const bodies = await page.evaluate(() =>
		(window as unknown as { __posts: string[] }).__posts.map(
			(b) => JSON.parse(b) as { vitals?: object; visit?: { islands: unknown[] } }
		)
	);
	expect(bodies.filter((b) => b.vitals && !b.visit)).toHaveLength(1);
	const visits = bodies.filter((b) => b.visit);
	expect(visits.length).toBeGreaterThan(0);
	expect(visits.at(-1)!.visit!.islands).toEqual([]);
});
