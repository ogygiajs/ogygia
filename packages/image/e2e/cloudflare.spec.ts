// The fixture app built with adapter-cloudflare and `cloudflare({ links: false })`, run by
// `wrangler dev` (workerd, local) with its Images binding in local mode (`IMAGE_E2E_MODE=cloudflare`):
// every page prerendered but /late, which the Worker renders on request and whose files the
// Worker's endpoint makes with the binding.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { test, expect } from '@ogygia/tooling/e2e';
import { server_log_since, server_log_size } from '@ogygia/tooling/e2e/server-log.ts';
import { photo_card_misses } from './card-pixels.ts';

const APP = fileURLToPath(new URL('./app/', import.meta.url));
const PRERENDERED = ['/', '/blog/first-post', '/blog/second-post', '/blog/third-post', '/island'];
const BUILT_RE = /\/_app\/immutable\/og\/[\w-]+\.(?:avif|webp)/g;
const SIGNED_RE = /\/__ogygia__\/i\/[^\s",)]+/g;
const KEPT = 'public, immutable, max-age=31536000';

function b64(url: string): string {
	return Buffer.from(url).toString('base64url');
}

async function named(
	request: import('@playwright/test').APIRequestContext,
	pages: readonly string[],
	re: RegExp
): Promise<string[]> {
	const seen = new Set<string>();
	for (const p of pages) {
		const res = await request.get(p);
		expect(res.status(), p).toBe(200);
		for (const url of (await res.text()).match(re) ?? []) seen.add(url);
	}
	return [...seen];
}

test("every file a prerendered page names is the build's, served by the asset layer to be kept forever", async ({
	request
}) => {
	const urls = await named(request, PRERENDERED, BUILT_RE);
	expect(urls.length).toBeGreaterThan(40);
	expect(await named(request, PRERENDERED, SIGNED_RE)).toEqual([]);
	for (const url of urls) {
		const res = await request.get(url);
		expect(res.status(), url).toBe(200);
		expect(res.headers()['content-type'], url).toBe(`image/${/\.(\w+)$/.exec(url)![1]}`);
		expect(res.headers()['cache-control'], url).toBe(KEPT);
	}
});

test("an original under _app/immutable/assets is kept forever too, by Kit's _headers rule", async ({
	request
}) => {
	const headers = fs.readFileSync(`${APP}.svelte-kit/cloudflare/_headers`, 'utf8');
	const rule = headers.slice(headers.indexOf('/_app/immutable/*')).split('\n').slice(0, 3);
	expect(rule.map((line) => line.trim())).toEqual([
		'/_app/immutable/*',
		'! Cache-Control',
		`Cache-Control: ${KEPT}`
	]);
	const original = fs
		.readdirSync(`${APP}.svelte-kit/cloudflare/_app/immutable/assets`)
		.find((f) => f.endsWith('.jpg'))!;
	const res = await request.get(`/_app/immutable/assets/${original}`);
	expect(res.status()).toBe(200);
	expect(res.headers()['cache-control']).toBe(KEPT);
});

test("a built file that is not there is the asset layer's 404, and Kit's _headers rule marks it immutable", async ({
	request
}) => {
	const res = await request.get('/_app/immutable/og/AAAAAAAAAAAAAAAA-48x48.avif');
	expect(res.status()).toBe(404);
	expect(res.headers()['cache-control']).toBe(KEPT);
});

test('every file a live page names is made by the Images binding, cut to its box, and kept forever', async ({
	request
}) => {
	const urls = await named(request, ['/late'], SIGNED_RE);
	const late = urls.filter((u) => u.includes('/one.'));
	expect(late.map((u) => /-(\d+x\d+)-ptop\/.*\.(\w+)$/.exec(u)!.slice(1).join(' ')).sort()).toEqual(
		['160x80 avif', '160x80 webp', '80x40 avif', '80x40 webp']
	);
	expect(urls.length).toBeGreaterThan(late.length);
	for (const url of urls) {
		const res = await request.get(url);
		expect(res.status(), url).toBe(200);
		const format = /\.(\w+)$/.exec(url)![1]!;
		expect(res.headers()['content-type'], url).toBe(`image/${format}`);
		expect(res.headers()['cache-control'], url).toBe('public, max-age=31536000, immutable');
		const meta = await sharp(await res.body()).metadata();
		const [w, h] = /-(\d+)x(\d+)[-/]/.exec(url)!.slice(1).map(Number);
		expect([meta.format === 'heif' ? 'avif' : meta.format, meta.width, meta.height], url).toEqual([
			format,
			w,
			h
		]);
		const again = await request.get(url);
		expect(again.status(), url).toBe(200);
		expect(Buffer.compare(await again.body(), await res.body()), url).toBe(0);
	}
});

test("a live page's moving image offers a still the binding makes (anim=false), which a visitor asking for less motion gets", async ({
	page,
	request
}) => {
	const stills = (await named(request, ['/late/motion'], SIGNED_RE)).filter((u) =>
		/-\d+x\d+-s\//.test(u)
	);
	expect(stills.length).toBeGreaterThan(0);
	for (const url of stills) {
		const res = await request.get(url);
		expect(res.status(), url).toBe(200);
		expect(res.headers()['content-type'], url).toMatch(/^image\/(avif|webp)$/);
	}
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.goto('/late/motion');
	const img = page.locator('#motion');
	await expect
		.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
		.toBe(true);
	expect(stills).toContain(
		await img.evaluate((el: HTMLImageElement) => new URL(el.currentSrc).pathname)
	);
});

test("a live page's remoteImage() is fetched by the Worker and made by the binding, kept for remote.maxAge, never forever; an unlisted host is 404; a prerendered one is the build's", async ({
	request
}) => {
	const urls = await named(request, ['/late/cms'], SIGNED_RE);
	const listed = urls.filter((u) =>
		u.includes(`/.remote/${b64('http://127.0.0.1:4176/photos/field.jpg')}.`)
	);
	expect(listed.length).toBeGreaterThan(0);
	for (const url of listed) {
		const res = await request.get(url);
		expect(res.status(), url).toBe(200);
		expect(res.headers()['cache-control'], url).toMatch(
			/^public, max-age=\d+, stale-while-revalidate=86400$/
		);
		const meta = await sharp(await res.body()).metadata();
		expect(meta.width, url).toBe(Number(/-(\d+)x\d+\//.exec(url)![1]));
	}
	const unlisted = urls.find((u) =>
		u.includes(`/.remote/${b64('http://127.0.0.1:4177/photos/field.jpg')}.`)
	)!;
	const refused = await request.get(unlisted);
	expect(refused.status()).toBe(404);
	expect(refused.headers()['cache-control']).toBe('no-store');
	const built = await named(request, ['/cms'], BUILT_RE);
	expect(built.length).toBeGreaterThan(0);
	expect(await named(request, ['/cms'], SIGNED_RE)).toEqual([]);
	for (const url of built) expect((await request.get(url)).status(), url).toBe(200);
});

test("a prerendered card that names images is drawn by the build with them: an asset of the build as an <img>, a small remote WebP as a style's url()", async ({
	request
}) => {
	const built = (await named(request, ['/card/photo'], /\/_app\/immutable\/og\/c[\w-]+\.png/g))[0]!;
	const res = await request.get(built);
	expect(res.status()).toBe(200);
	expect(await photo_card_misses(await res.body())).toEqual([]);
});

test("a live page's share card is the build's file of it when a prerendered page made the same card, else 404 kept nowhere: the Worker draws no card", async ({
	request
}) => {
	const og = async (query: string): Promise<string> => {
		const res = await request.get(`/late/card?${query}`);
		expect(res.status()).toBe(200);
		const at = /property="og:image" content="([^"]+)"/.exec(await res.text())![1]!;
		return new URL(at.replaceAll('&amp;', '&')).pathname;
	};
	const prerendered = (await named(request, ['/card'], /\/_app\/immutable\/og\/c[\w-]+\.png/g))[0]!;
	const same = await og(
		new URLSearchParams({ title: 'Ships & <harbors>', section: 'Blog' }).toString()
	);
	expect(same).toMatch(/^\/__ogygia__\/i\/[^/]+\/c[\w-]{32}-1200x630\/\.card\//);
	expect(same).toContain(`/${/og\/(c[\w-]{32})-/.exec(prerendered)![1]}-1200x630/`);
	const res = await request.get(same);
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toBe('image/png');
	expect(res.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
	const meta = await sharp(await res.body()).metadata();
	expect([meta.width, meta.height]).toEqual([1200, 630]);
	const missing = await request.get(await og('title=Nobody+prerendered+this'));
	expect(missing.status()).toBe(404);
	expect(missing.headers()['cache-control']).toBe('no-store');
});

test("a live page's card that shows a remote image is 404 kept nowhere, though a prerendered page made the same card: the build named that one by the bytes it got, never by its recipe", async ({
	request
}) => {
	const res = await request.get('/late/card/photo');
	expect(res.status()).toBe(200);
	const at = /property="og:image" content="([^"]+)"/.exec(await res.text())![1]!;
	const live = new URL(at.replaceAll('&amp;', '&')).pathname;
	expect(live).toMatch(/^\/__ogygia__\/i\/[^/]+\/c[\w-]{32}-1200x630\/\.card\//);
	const built = (await named(request, ['/card/photo'], /\/_app\/immutable\/og\/c[\w-]+\.png/g))[0]!;
	expect(built, 'the build renamed it').not.toContain(/\/(c[\w-]{32})-1200x630\//.exec(live)![1]);
	const from = server_log_size();
	const card = await request.get(live);
	expect(card.status()).toBe(404);
	expect(card.headers()['cache-control']).toBe('no-store');
	await expect
		.poll(() => server_log_since(from))
		.toMatch(/shows a remote image, so the build named it by the bytes it got[\s\S]*image_no_encoder/);
});

test('the endpoint refuses a forged signature and a POST, kept nowhere', async ({ request }) => {
	const url = (await named(request, ['/late'], SIGNED_RE))[0]!;
	const sig = /\/i\/([^/]+)\//.exec(url)![1]!;
	const forged = url.replace(
		sig,
		sig.replace(/^./, (c) => (c === '0' ? '1' : '0'))
	);
	const denied = await request.get(forged);
	expect(denied.status()).toBe(403);
	expect(denied.headers()['cache-control']).toBe('no-store');
	const posted = await request.post(url);
	expect(posted.status()).toBe(405);
	expect(posted.headers()['cache-control']).toBe('no-store');
});

test('the Worker wrangler would deploy holds the binding maker and none of sharp', () => {
	const out = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-worker-'));
	try {
		execFileSync(
			process.execPath,
			['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--outdir', out],
			{ cwd: APP, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, stdio: 'pipe' }
		);
		const worker = fs.readFileSync(path.join(out, '_worker.js'), 'utf8');
		expect(worker).toContain('binding_maker');
		expect(worker).toContain('ogygia-image.invalid');
		expect(worker).not.toMatch(
			/from ["']sharp["']|require\(["']sharp["']\)|import\(["']sharp["']\)/
		);
		for (const engine of [
			'encode_recipe',
			'limitInputPixels',
			'runtime_store',
			'mozjpeg',
			'connect_lookup',
			'card_png',
			'harfbuzz'
		])
			expect(worker, engine).not.toContain(engine);
		expect(worker).not.toMatch(/(?:from |import\()["'](?:satori|@resvg\/resvg-js)["']/);
		expect(worker).toContain('web_get');
	} finally {
		fs.rmSync(out, { recursive: true, force: true });
	}
});
