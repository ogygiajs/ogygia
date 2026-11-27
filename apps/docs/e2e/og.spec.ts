/**
 * The docs app's share images (docs app): a page's og:image is its share card
 * (`import.meta.og.image.card`, src/lib/og/share.ts), a PNG named at the origin that served the page,
 * so a preview deploy never points crawlers at production.
 *
 *   pnpm turbo run e2e --filter=docs
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
		url: `${base}/docs/start/overview`,
		timeout_ms: 180_000
	});
});
test.afterAll(() => srv?.kill());

test('og:image is the page share card, a PNG at the origin that served the page', async ({
	page
}) => {
	await page.goto(`${base}/docs/start/overview`);
	const image = await page.locator('meta[property="og:image"]').getAttribute('content');
	expect(image).not.toBeNull();
	const url = new URL(image!);
	expect(url.origin).toBe(base);
	expect(url.pathname).toMatch(/^\/__ogygia__\/i\/[^/]+\/c[\w-]{32}-1200x630\/\.card\/.+\.png$/);
});

test('a share card answers with a 1200 x 630 PNG, its title text decoded', async ({
	page,
	request
}) => {
	test.setTimeout(2 * 60_000);
	await page.goto(`${base}/docs/reference/constraints`);
	const image = await page.locator('meta[property="og:image"]').getAttribute('content');
	const res = await request.get(image!);
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toBe('image/png');
	const body = await res.body();
	expect([...body.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	expect([body.readUInt32BE(16), body.readUInt32BE(20)]).toEqual([1200, 630]);
	const tail = new URL(image!).pathname
		.split('/.card/')[1]!
		.split('/')[1]!
		.replace(/\.png$/, '');
	expect(JSON.parse(Buffer.from(tail, 'base64url').toString('utf8'))).toMatchObject({
		title: 'Constraints & patterns'
	});
});
