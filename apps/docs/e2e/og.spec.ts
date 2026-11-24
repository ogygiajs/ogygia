/**
 * The docs app's share images (docs app): a page's og:image names the origin that served it, so a
 * preview deploy never points crawlers at production, and /og/<key>.png answers with a PNG card.
 *
 *   pnpm turbo run e2e --filter=docs
 *
 * Self-booting: the docs app's `vite dev` comes up in `beforeAll` and is torn down after.
 */
import { test, expect, REPO as root } from '@ogygia/tooling/e2e';
import { port, spawn_server, type SpawnedServer } from '@ogygia/tooling/e2e/servers.ts';
import { card_path } from '../src/lib/og/card.ts';

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
		url: `${base}/docs/start/overview`,
		timeout_ms: 180_000
	});
});
test.afterAll(() => srv?.kill());

test('og:image points at the origin that served the page', async ({ page }) => {
	await page.goto(`${base}/docs/start/overview`);
	const image = await page.locator('meta[property="og:image"]').getAttribute('content');
	expect(image).not.toBeNull();
	expect(new URL(image!).origin).toBe(base);
	expect(new URL(image!).pathname).toBe(card_path({ title: 'Overview', category: 'Start' }));
});

test('the og endpoint answers with a PNG card', async ({ request }) => {
	test.setTimeout(2 * 60_000);
	const res = await request.get(
		`${base}${card_path({ title: 'SPA router & PPR', category: 'App' })}`
	);
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toBe('image/png');
	const body = await res.body();
	expect([...body.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});
