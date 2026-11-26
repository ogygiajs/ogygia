// The fixture app built with adapter-vercel and `vercel({ sizes })` alone
// (`IMAGE_E2E_MODE=vercel-alone`): no endpoint makes files, so the function holds no sharp; a live
// resize is Vercel's link, and a live crop, which Vercel cannot make, fails its render with
// `image_encoder_cannot`. Prerendered pages still name the files the build made with sharp.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@ogygia/tooling/e2e';
import { server_log_since, server_log_size } from '@ogygia/tooling/e2e/server-log.ts';
import { linked, VERCEL_IMAGES, WHOLE_LINKS } from './vercel-links.ts';

const OUTPUT = fileURLToPath(new URL('./app/.vercel/output/', import.meta.url));
const FUNC = path.join(OUTPUT, 'functions/![-]/catchall.func');
const BUILT_RE = /\/_app\/immutable\/og\/[\w-]+\.(?:avif|webp)/g;
const SIGNED_RE = /\/__ogygia__\/i\/[^\s",)]+/g;

test('the function holds no sharp: vercel() alone has no endpoint maker', () => {
	expect(fs.existsSync(path.join(FUNC, 'packages/image/e2e/app/node_modules/sharp'))).toBe(false);
	const config = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'config.json'), 'utf8')) as {
		images: unknown;
	};
	expect(config.images).toEqual(VERCEL_IMAGES);
});

test("a live page's resize is named by Vercel's link, nothing signed", async ({ request }) => {
	expect(await linked(request, '/late/whole')).toEqual(WHOLE_LINKS);
	const html = await (await request.get('/late/whole')).text();
	expect(html.match(SIGNED_RE) ?? []).toEqual([]);
});

test('a live page that crops fails its render, image_encoder_cannot naming vercel() and the crop', async ({
	request
}) => {
	const from = server_log_size();
	const res = await request.get('/late');
	expect(res.status()).toBe(500);
	await expect
		.poll(() => server_log_since(from))
		.toMatch(/vercel\(\) cannot make on a page rendered on request: crop/);
	expect(server_log_since(from)).toContain('image_encoder_cannot');
});

test('vercel() alone cannot make a still, so no page offers one, and a live moving image fails its render', async ({
	request
}) => {
	const html = await (await request.get('/twins')).text();
	expect(html).toContain('id="motion"');
	expect(html).not.toContain('prefers-reduced-motion');
	const from = server_log_size();
	expect((await request.get('/late/motion')).status()).toBe(500);
	await expect
		.poll(() => server_log_since(from))
		.toMatch(/vercel\(\) cannot make on a page rendered on request: source gif/);
});

test('a live card is drawn with no sharp, and one that names an image is refused, image_card_source saying to list sharp()', async ({
	request
}) => {
	const card = async (query: string): Promise<import('@playwright/test').APIResponse> => {
		const html = await (await request.get(`/late/card?${query}`)).text();
		const url = (html.match(SIGNED_RE) ?? []).find((u) => u.includes('/.card/'))!;
		return request.get(url);
	};
	const plain = await card('title=Alone');
	expect([plain.status(), plain.headers()['content-type']]).toEqual([200, 'image/png']);
	const from = server_log_size();
	const photo = await card('title=Alone&photo');
	expect(photo.status()).toBe(500);
	await expect
		.poll(() => server_log_since(from))
		.toMatch(/this server fits no image to a card: sharp makes no file here \(list sharp\(\)/);
	expect(server_log_since(from)).toContain('image_card_source');
});

test('prerendered pages name the files the build made, served from the output', async ({
	request
}) => {
	const html = await (await request.get('/')).text();
	const built = [...new Set(html.match(BUILT_RE) ?? [])];
	expect(built.length).toBeGreaterThan(5);
	for (const url of built) expect((await request.get(url)).status(), url).toBe(200);
});
