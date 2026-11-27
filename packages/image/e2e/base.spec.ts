// The fixture app under `paths.base` (`/base`), every page prerendered and served as plain files
// there (`IMAGE_E2E_MODE=base`): every file a page names sits under the base, in the app folder, and
// is a file the build wrote, whether an <img> named it, a CSS background did, or a preset was warmed.
import { fileURLToPath } from 'node:url';
import { test, expect } from '@ogygia/tooling/e2e';
import { E2E_OUT_DIR } from '@ogygia/tooling/e2e/build.ts';
import { marked_files } from './marks.ts';

const PAGES = [
	'/base/',
	'/base/blog/first-post',
	'/base/blog/third-post',
	'/base/island',
	'/base/twins',
	'/base/card'
];
const FILE_RE = /\/[^\s",()]*(?:__ogygia__\/i|_app\/immutable\/og)\/[^\s",)]+/g;
const BUILT_RE = /^\/base\/_app\/immutable\/og\/[\w-]+\.(?:avif|webp|png)$/;

test('every image file each page names sits under the base, and loads as an image', async ({
	request
}) => {
	const seen = new Set<string>();
	for (const p of PAGES) {
		const res = await request.get(p);
		expect(res.status(), p).toBe(200);
		for (const url of (await res.text()).match(FILE_RE) ?? [])
			seen.add(url.replace(/^\/\/example\.com\//, '/'));
	}
	expect(seen.size).toBeGreaterThan(40);
	for (const url of seen) {
		expect(url, url).toMatch(BUILT_RE);
		const res = await request.get(url);
		expect(res.status(), url).toBe(200);
		expect(res.headers()['content-type'], url).toMatch(/^image\/(avif|webp|png)$/);
	}
});

test('the page loads every image, its CSS background and its warmed preset under the base', async ({
	page
}) => {
	await page.goto('/base/');
	const backdrop = await page
		.locator('#backdrop')
		.evaluate((el: HTMLElement) => el.style.backgroundImage);
	expect(backdrop).toMatch(/^url\("?\/base\/_app\/immutable\/og\/[\w-]+-120x60\.webp"?\)$/);
	expect(await page.locator('#warmed').getAttribute('src')).toMatch(
		/^\/base\/_app\/immutable\/og\//
	);
	const imgs = page.locator('img');
	for (let i = 0; i < (await imgs.count()); i++) {
		const img = imgs.nth(i);
		await img.scrollIntoViewIfNeeded();
		await expect
			.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
			.toBe(true);
	}
});

test('with no image({ theme }), a dark file is a <source media> row the system theme picks', async ({
	page
}) => {
	const chart = page.locator('img[alt="A chart"]');
	await expect(page.locator('picture[data-og-theme]')).toHaveCount(0);
	const picked = async (): Promise<string> => {
		await chart.scrollIntoViewIfNeeded();
		await expect
			.poll(() => chart.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
			.toBe(true);
		return chart.evaluate((el: HTMLImageElement) => new URL(el.currentSrc).pathname);
	};
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		await page.goto('/base/twins');
		const row = page.locator(
			'picture:has(img[alt="A chart"]) source[media="(prefers-color-scheme: dark)"]'
		);
		const dark = (await row.first().getAttribute('srcset'))!
			.split(', ')
			.map((c) => c.split(' ')[0]!);
		expect(dark.includes(await picked()), scheme).toBe(scheme === 'dark');
	}
});

test("no file of the build keeps the build's mark, its SPA fallback page included", async ({
	request
}) => {
	const html = await (await request.get('/base/404.html')).text();
	expect(html).toContain('kit.start');
	expect(html).not.toMatch(/ogygia\.invalid/);
	const app = fileURLToPath(new URL('./app/', import.meta.url));
	const found = marked_files(app, ['build/static', `${E2E_OUT_DIR}/output`]);
	expect(found.read).toBeGreaterThan(50);
	expect(found.marked).toEqual([]);
});
