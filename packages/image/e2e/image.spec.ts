// @ogygia/image against a real Kit app: macro images on `/`, a markdown blog on `/blog/[slug]`. The
// same specs run in four modes (playwright.config.ts): built with adapter-node and served (by Vite's
// preview, and by the adapter's own output), every page prerendered with adapter-static and served as plain files (no server at all), and the dev server.
// `pnpm --filter @ogygia/image e2e`.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import sharp from 'sharp';
import { test, expect } from '@ogygia/tooling/e2e';
import { E2E_OUT_DIR } from '@ogygia/tooling/e2e/build.ts';
import { server_log } from '@ogygia/tooling/e2e/server-log.ts';
import { photo_card_misses } from './card-pixels.ts';
import { marked_files } from './marks.ts';

const MODE = process.env.IMAGE_E2E_MODE ?? 'node';
const PAGES = [
	'/',
	'/blog/first-post',
	'/blog/second-post',
	'/blog/third-post',
	'/blog/fourth-post',
	'/twins',
	'/remote',
	'/cms',
	'/card',
	'/card/photo'
];
const IMAGE_URL_RE = /\/(?:__ogygia__\/i|_app\/immutable\/og)\/[^\s",)]+/g;
const SIGNED_URL_RE = /\/__ogygia__\/i\/[^\s",)]+/g;

/** An AVIF candidate of the source whose original is `name`, at `size`, as this mode names it: a
 *  signed URL by its original, a file the build made by its recipe alone. */
function avif_of(name: string, size = '\\d+x\\d+'): RegExp {
	return MODE === 'static'
		? new RegExp(`/_app/immutable/og/[\\w-]+-${size}\\.avif \\d+w`)
		: new RegExp(`-${size}/[^ ]*${name}[^ ]*\\.avif \\d+w`);
}

/** Scroll every lazy image into view, then wait until each has decoded pixels. */
async function every_image_loads(page: Page): Promise<void> {
	const imgs = page.locator('img');
	const n = await imgs.count();
	expect(n).toBeGreaterThan(0);
	for (let i = 0; i < n; i++) {
		const img = imgs.nth(i);
		await img.scrollIntoViewIfNeeded();
		await expect
			.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
				message: `image ${i} (${await img.getAttribute('alt')}) loads`
			})
			.toBe(true);
	}
}

async function attrs(img: Locator): Promise<Record<string, string | null>> {
	return img.evaluate((el: HTMLImageElement) => {
		const out: Record<string, string | null> = {};
		for (const name of ['src', 'srcset', 'sizes', 'width', 'height', 'loading', 'fetchpriority'])
			out[name] = el.getAttribute(name);
		out.background = el.style.backgroundImage || null;
		out.transition = el.style.viewTransitionName || null;
		out.picture = el.parentElement?.tagName === 'PICTURE' ? 'yes' : null;
		out.avif =
			el.parentElement?.querySelector('source[type="image/avif"]')?.getAttribute('srcset') ?? null;
		return out;
	});
}

/** The URLs of a srcset, in order. */
function urls(srcset: string | null): string[] {
	return (srcset ?? '')
		.split(', ')
		.map((c) => c.split(' ')[0]!)
		.filter(Boolean);
}

/** What the page says that it should not: errors, and Svelte's hydration warnings. */
function listen(page: Page): string[] {
	const said: string[] = [];
	page.on('pageerror', (e) => said.push(e.message));
	page.on('console', (m) => {
		if (m.type() === 'error' || /hydration_/.test(m.text())) said.push(m.text());
	});
	return said;
}

/** The `src`, `srcset` and AVIF `srcset` the server wrote for the `<img id>` in `html`. */
function server_attrs(html: string, id: string): Record<'src' | 'srcset' | 'avif', string> {
	const at = html.indexOf(`id="${id}"`);
	const picture = html.lastIndexOf('<picture', at);
	const tag = html.slice(html.lastIndexOf('<img', at), html.indexOf('>', at));
	const read = (text: string, name: string): string =>
		new RegExp(`\\s${name}="([^"]*)"`).exec(text)![1]!.replaceAll('&amp;', '&');
	return {
		src: read(tag, 'src'),
		srcset: read(tag, 'srcset'),
		avif: read(html.slice(picture, at), 'srcset')
	};
}

/** One file's bytes and decoded size. */
async function fetch_file(
	request: APIRequestContext,
	url: string
): Promise<{ type: string; bytes: Buffer; width: number; height: number; pages: number }> {
	const res = await request.get(url);
	expect(res.status(), url).toBe(200);
	const bytes = await res.body();
	const meta = await sharp(bytes, { animated: true }).metadata();
	return {
		type: res.headers()['content-type'] ?? '',
		bytes,
		width: meta.width,
		height: meta.pageHeight ?? meta.height,
		pages: meta.pages ?? 1
	};
}

test.describe('macro images (/)', () => {
	test('a photo renders a <picture> with an AVIF source, a srcset, sizes and its box', async ({
		page
	}) => {
		await page.goto('/');
		const a = await attrs(page.locator('#portrait'));
		expect(a.picture).toBe('yes');
		expect(a.avif).toMatch(/\.avif 400w, .+\.avif 800w$/);
		expect(a.srcset).toMatch(/\.webp 400w, .+\.webp 800w$/);
		expect(a.sizes).toBe('(min-width: 400px) 400px, 100vw');
		expect([a.width, a.height]).toEqual(['400', '500']);
		expect(a.loading).toBe('lazy');
	});

	test('an opaque lazy image paints a placeholder; a transparent one does not', async ({
		page
	}) => {
		await page.goto('/');
		expect((await attrs(page.locator('#portrait'))).background).toMatch(
			/^url\("?data:image\/webp;base64,/
		);
		expect((await attrs(page.locator('#badge'))).background).toBeNull();
		expect((await attrs(page.locator('#logo'))).background).toBeNull();
	});

	test('a placeholder costs the page at most 400 bytes of HTML', async ({ request }) => {
		const html = await (await request.get('/')).text();
		const found = html.match(/data:image\/[a-z]+;base64,[\w+/=]+/g) ?? [];
		expect(found.length).toBeGreaterThan(0);
		for (const url of found) expect(url.length).toBeLessThanOrEqual(400);
	});

	test('the cover preset is the priority hero: preloaded from the head and fetched first', async ({
		page
	}) => {
		await page.goto('/');
		const hero = await attrs(page.locator('#hero'));
		expect(hero.fetchpriority).toBe('high');
		expect(hero.loading).toBe('eager');
		expect(hero.sizes).toBe('100vw');
		const preload = page.locator('head link[rel="preload"][as="image"]');
		await expect(preload).toHaveCount(1);
		expect(await preload.getAttribute('imagesrcset')).toBe(hero.avif);
		expect(await preload.getAttribute('fetchpriority')).toBe('high');
	});

	test('a thumb preset and a cover preset of the same source are different crops', async ({
		page,
		request
	}) => {
		await page.goto('/');
		const thumb = await attrs(page.locator('#thumb'));
		const cover = await attrs(page.locator('#hero'));
		expect([thumb.width, thumb.height]).toEqual(['200', '200']);
		for (const url of [...urls(thumb.avif), ...urls(thumb.srcset)]) {
			const f = await fetch_file(request, url);
			expect(f.width, url).toBe(f.height);
		}
		for (const url of [...urls(cover.avif), ...urls(cover.srcset)]) {
			const f = await fetch_file(request, url);
			expect(Math.abs(f.width / f.height - 16 / 9), url).toBeLessThan(0.01);
		}
	});

	test('a fixed 48px avatar never downloads a file wider than 96px', async ({ page, request }) => {
		await page.goto('/');
		const avatar = page.locator('#avatar');
		const a = await attrs(avatar);
		expect([a.width, a.height]).toEqual(['48', '48']);
		expect(a.srcset).toMatch(/ 1x, .+ 2x$/);
		for (const url of [...urls(a.avif), ...urls(a.srcset), a.src!]) {
			const f = await fetch_file(request, url);
			expect(f.width, url).toBeLessThanOrEqual(96);
		}
		await expect
			.poll(() => avatar.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
			.toBe(true);
		expect(await avatar.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeLessThanOrEqual(
			96
		);
	});

	test('a glob gallery renders each file', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('img.gallery')).toHaveCount(3);
	});

	test('a 300px gallery image on a 1x screen downloads a file between 300 and 480 pixels wide', async ({
		page
	}) => {
		await page.goto('/');
		const first = page.locator('img.gallery').first();
		await first.scrollIntoViewIfNeeded();
		await expect
			.poll(() => first.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
			.toBe(true);
		const natural = await first.evaluate((el: HTMLImageElement) => el.naturalWidth);
		expect(natural).toBeGreaterThanOrEqual(300);
		expect(natural).toBeLessThanOrEqual(480);
	});

	test('a width and height crop keeps its box after the image loads, from a file cut to that box', async ({
		page
	}) => {
		await page.goto('/');
		const crop = page.locator('#crop');
		await crop.scrollIntoViewIfNeeded();
		await expect
			.poll(() => crop.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
			.toBe(true);
		const box = await crop.boundingBox();
		expect([Math.round(box!.width), Math.round(box!.height)]).toEqual([400, 400]);
		const natural = await crop.evaluate((el: HTMLImageElement) => [
			el.naturalWidth,
			el.naturalHeight
		]);
		expect(natural[0]).toBe(natural[1]);
		expect(natural[0]).toBeGreaterThanOrEqual(400);
	});

	test('an SVG passes through as its original file, with no <picture>', async ({ page }) => {
		await page.goto('/');
		const logo = await attrs(page.locator('#logo'));
		expect(logo.picture).toBeNull();
		expect(logo.src).toMatch(/\.svg(?:\?no-inline)?$/);
		expect(logo.srcset).toBeNull();
		expect([logo.width, logo.height]).toEqual(['120', '40']);
	});

	test('an animated GIF is served as an animated WebP, its only <source> rows the reduced-motion still', async ({
		page,
		request
	}) => {
		await page.goto('/');
		const spinner = await attrs(page.locator('#spinner'));
		expect(spinner.picture).toBe('yes');
		const medias = await page
			.locator('picture:has(#spinner) source')
			.evaluateAll((els) => els.map((el) => el.getAttribute('media')));
		expect(medias).toEqual([
			'(prefers-reduced-motion: reduce)',
			'(prefers-reduced-motion: reduce)'
		]);
		expect(spinner.src).toMatch(/\.webp$/);
		const f = await fetch_file(request, spinner.src!);
		expect(f.type).toBe('image/webp');
		expect(f.bytes.includes(Buffer.from('ANIM'))).toBe(true);
		expect(f.pages).toBe(3);
	});

	test('no image carries an inline event handler, so a strict CSP has nothing to block', async ({
		request
	}) => {
		for (const url of ['/', '/blog/first-post']) {
			const html = await (await request.get(url)).text();
			const tags = html.match(/<(?:img|picture|source)\b[^>]*>/g) ?? [];
			expect(tags.length).toBeGreaterThan(0);
			for (const tag of tags) expect(tag).not.toMatch(/\son[a-z]+=/i);
		}
	});

	test('the named attributes reach the <img>', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('img#portrait')).toHaveAttribute('title', 'Tall');
	});

	test('every image on the page really loads', async ({ page }) => {
		await page.goto('/');
		await every_image_loads(page);
	});
});

test.describe('a markdown page (/markdown)', () => {
	test('an image its <script> names with import.meta.og.image() renders through <Img> and loads', async ({
		page
	}) => {
		const said = listen(page);
		await page.goto('/markdown');
		const img = page.locator('img#svx-hero');
		const a = await attrs(img);
		expect(a.picture).toBe('yes');
		expect(a.avif).toMatch(avif_of('hero', '320x178'));
		expect(a.srcset).toMatch(/\.webp 320w, .+\.webp 640w$/);
		expect(a.width).toBe('320');
		await every_image_loads(page);
		expect(said).toEqual([]);
	});
});

test.describe('markdown images (/blog/[slug])', () => {
	test('the frontmatter cover renders through <Img> with the cover preset', async ({ page }) => {
		await page.goto('/blog/first-post');
		const cover = await attrs(page.locator('#cover'));
		expect(cover.picture).toBe('yes');
		expect(cover.avif).toMatch(avif_of('cover'));
		expect([cover.width, cover.height]).toEqual(['1120', '630']);
		expect(cover.fetchpriority).toBe('high');
		await expect(page.locator('head link[rel="preload"][as="image"]')).toHaveCount(1);
	});

	test('a co-located body image renders through <Img> with the prose preset', async ({ page }) => {
		await page.goto('/blog/first-post');
		const harbor = await attrs(page.getByAltText('A harbor in the evening'));
		expect(harbor.picture).toBe('yes');
		expect(harbor.avif).toMatch(avif_of('harbor', '720x480'));
		expect(harbor.sizes).toBe('(min-width: 720px) 720px, 100vw');
		expect([harbor.width, harbor.height]).toEqual(['720', '480']);
		expect(harbor.loading).toBe('lazy');
		expect(harbor.background).toMatch(/^url\("?data:image\/webp;base64,/);
	});

	test('a GIF in the body becomes an animated WebP', async ({ page, request }) => {
		await page.goto('/blog/first-post');
		const gif = await attrs(page.getByAltText('A moving dot'));
		expect(gif.src).toMatch(/\.webp$/);
		const f = await fetch_file(request, gif.src!);
		expect(f.type).toBe('image/webp');
		expect(f.bytes.includes(Buffer.from('ANIM'))).toBe(true);
	});

	test('a GIF in the body takes the markdown.animated preset, so the browser asks for its narrow files', async ({
		page,
		request
	}) => {
		await page.goto('/blog/first-post');
		const gif = await attrs(page.getByAltText('A moving dot'));
		expect(gif.sizes).toBe('33vw');
		expect([gif.width, gif.height]).toEqual(['40', '27']);
		expect(gif.srcset).toMatch(/^\S+ 40w, \S+ 80w$/);
		for (const url of urls(gif.srcset))
			expect((await fetch_file(request, url)).width).toBeLessThanOrEqual(80);
	});

	test("an image from another post's folder (../) resolves, title kept", async ({ page }) => {
		await page.goto('/blog/second-post');
		const img = page.getByAltText('The same harbor');
		expect(await img.getAttribute('title')).toBe('Borrowed');
		expect((await attrs(img)).avif).toMatch(avif_of('harbor', '720x480'));
		await expect(page.locator('#cover')).toHaveAttribute('height', '630');
	});

	test('images whose names hold a space or an accent resolve and load', async ({ page }) => {
		await page.goto('/blog/third-post');
		for (const alt of ['A spaced name', 'A name with an accent']) {
			const a = await attrs(page.getByAltText(alt));
			expect(a.picture).toBe('yes');
			expect(a.avif).toMatch(/\.avif 500w/);
		}
		await expect(page.locator('#cover')).toHaveAttribute('height', '630');
	});

	for (const slug of ['first-post', 'second-post', 'third-post'])
		test(`every image on /blog/${slug} really loads`, async ({ page }) => {
			await page.goto(`/blog/${slug}`);
			await every_image_loads(page);
		});
});

test.describe('the image endpoint', () => {
	test('every file URL every page names answers 200 with its type', async ({ request }) => {
		const seen = new Set<string>();
		for (const p of PAGES) {
			const html = await (await request.get(p)).text();
			for (const url of html.match(IMAGE_URL_RE) ?? []) seen.add(url);
		}
		expect(seen.size).toBeGreaterThan(40);
		for (const url of seen) {
			const res = await request.get(url);
			expect(res.status(), url).toBe(200);
			const ext = /\.(avif|webp|png)$/.exec(url)?.[1];
			expect(res.headers()['content-type'], url).toBe(`image/${ext}`);
		}
	});

	test('a file URL whose recipe was changed, or whose signature was, is refused', async ({
		request
	}) => {
		test.skip(MODE === 'static', 'a prerendered page names no signed URL');
		const html = await (await request.get('/')).text();
		const url = html.match(SIGNED_URL_RE)!.find((u) => /-48x48\//.test(u))!;
		const wider = url.replace('-48x48/', '-2000x2000/');
		const sig = /\/i\/([^/]+)\//.exec(url)![1]!;
		const resigned = url.replace(
			sig,
			sig.replace(/^./, (c) => (c === '0' ? '1' : '0'))
		);
		for (const bad of [wider, resigned, url.replace(`/${sig}/`, '/')]) {
			const res = await request.get(bad);
			expect(res.status(), bad).toBe(403);
			expect(res.headers()['x-ogygia-deny'], bad).toBe('sig');
			expect(res.headers()['cache-control'], bad).toBe('no-store');
		}
		const posted = await request.post(url);
		expect(posted.status()).toBe(405);
		expect(posted.headers()['cache-control']).toBe('no-store');
		expect((await request.get(url)).status()).toBe(200);
	});

	test('a file the build made is sent to be kept forever, and one it did not make is a 404 that is not', async ({
		page,
		request
	}) => {
		test.skip(
			MODE === 'static' || MODE === 'dev',
			'a static host and the dev server serve no build'
		);
		await page.goto('/');
		const built = (await attrs(page.locator('#warmed'))).src!;
		expect(built).toMatch(/^\/_app\/immutable\/og\//);
		const res = await request.get(built);
		expect(res.status()).toBe(200);
		expect(res.headers()['cache-control']).toBe('public,max-age=31536000,immutable');
		const missing = await request.get('/_app/immutable/og/AAAAAAAAAAAAAAAA-48x48.avif');
		expect(missing.status()).toBe(404);
		expect(missing.headers()['cache-control']).not.toMatch(/immutable/);
	});

	test('a file URL asked with a query string is sent to the bare URL, so a CDN keeps one copy', async ({
		request
	}) => {
		test.skip(MODE === 'static', 'a static host serves its files whatever the query');
		const html = await (await request.get('/')).text();
		const url = html.match(SIGNED_URL_RE)![0]!;
		const res = await request.get(`${url}?bust=1`, { maxRedirects: 0 });
		expect(res.status()).toBe(308);
		expect(res.headers()['location']).toBe(url);
		expect((await request.get(`${url}?bust=2`)).status()).toBe(200);
	});

	test('an image added while the dev server runs is served at once', async ({ request }) => {
		test.skip(MODE !== 'dev', 'the dev server only');
		const late = new URL('./app/src/lib/late/', import.meta.url);
		const added = new URL('two.png', late);
		fs.copyFileSync(new URL('one.png', late), added);
		try {
			await expect
				.poll(
					async () =>
						(
							(await (await request.get('/late')).text()).match(/<img(?![^>]*id="site-mark")/g) ??
							[]
						).length
				)
				.toBe(2);
			const html = await (await request.get('/late')).text();
			const two = (html.match(SIGNED_URL_RE) ?? []).filter((u) => u.includes('two.'));
			expect(two.length).toBeGreaterThan(0);
			for (const url of two) expect((await request.get(url)).status(), url).toBe(200);
		} finally {
			fs.rmSync(added, { force: true });
		}
	});

	test('a file is sent to be kept forever', async ({ request }) => {
		test.skip(MODE === 'static', 'a static host sends its own headers');
		const html = await (await request.get('/')).text();
		const res = await request.get(html.match(SIGNED_URL_RE)![0]!);
		expect(res.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
	});

	test('a CSS background from getImage() is made in every mode, though no crawler reads a style', async ({
		request
	}) => {
		const html = await (await request.get('/')).text();
		const style = /id="backdrop" style="([^"]+)"/.exec(html)![1]!;
		const url = /url\(([^)]+)\)/.exec(style)![1]!;
		expect(url).toMatch(
			MODE === 'static'
				? /^\/_app\/immutable\/og\/[\w-]+-120x60\.webp$/
				: /^\/__ogygia__\/i\/.+-120x60\/.+\.webp$/
		);
		const f = await fetch_file(request, url);
		expect([f.type, f.width, f.height]).toEqual(['image/webp', 120, 60]);
	});

	test("a warmed preset's files are static files the build made", async ({ page, request }) => {
		await page.goto('/');
		const a = await attrs(page.locator('#warmed'));
		const all = [...urls(a.avif), ...urls(a.srcset), a.src!];
		for (const url of all)
			expect(url).toMatch(
				MODE === 'dev' ? /^\/__ogygia__\/i\// : /^\/_app\/immutable\/og\/[\w-]+\.(avif|webp)$/
			);
		for (const url of all) {
			const f = await fetch_file(request, url);
			expect(f.width, url).toBe(f.height);
		}
	});
});

test.describe('remote images (/remote, /blog/fourth-post)', () => {
	const ID_RE = /\/(?:__ogygia__\/i\/[^/]+|_app\/immutable\/og)\/([\w-]+?)-\d+x\d+/;

	test('a listed URL in the macro is a source: its files load, made from the fetched bytes', async ({
		page,
		request
	}) => {
		await page.goto('/remote');
		const a = await attrs(page.locator('#remote'));
		expect(a.picture).toBe('yes');
		expect([a.width, a.height]).toEqual(['300', '200']);
		expect(a.background).toMatch(/^url\("?data:image\/webp;base64,/);
		await every_image_loads(page);
		const f = await fetch_file(request, urls(a.avif).at(-1)!);
		expect([f.type, f.width, f.height]).toEqual(['image/avif', 600, 400]);
	});

	test('a URL behind a redirect names the same source: the id is the bytes, not the URL', async ({
		page
	}) => {
		await page.goto('/remote');
		const direct = await attrs(page.locator('#remote'));
		const moved = await attrs(page.locator('#remote-moved'));
		expect(ID_RE.exec(moved.src!)![1]).toBe(ID_RE.exec(direct.src!)![1]);
	});

	test("a remote source's warmed preset names static files the build made", async ({
		page,
		request
	}) => {
		await page.goto('/remote');
		const a = await attrs(page.locator('#remote-thumb'));
		const all = [...urls(a.avif), ...urls(a.srcset), a.src!];
		for (const url of all) {
			expect(url).toMatch(
				MODE === 'dev' ? /^\/__ogygia__\/i\// : /^\/_app\/immutable\/og\/[\w-]+\.(avif|webp)$/
			);
			const f = await fetch_file(request, url);
			expect(f.width, url).toBe(f.height);
		}
	});

	test('a frontmatter URL and a body image on a listed host render through <Img>', async ({
		page
	}) => {
		await page.goto('/blog/fourth-post');
		const cover = await attrs(page.locator('#cover'));
		expect(cover.picture).toBe('yes');
		expect([cover.width, cover.height]).toEqual(['1600', '900']);
		const body = await attrs(page.getByAltText('A field on a listed host'));
		expect(body.picture).toBe('yes');
		expect(body.sizes).toBe('(min-width: 720px) 720px, 100vw');
		await every_image_loads(page);
	});
});

test.describe('remote images at request (/cms, /late/cms)', () => {
	const REMOTE_ID_RE = /\/r[\w-]{32}-\d+x\d+\/\.remote\/[\w-]+\.(?:avif|webp)$/;

	async function late_url(request: APIRequestContext, id: string): Promise<string> {
		const res = await request.get('/late/cms');
		expect(res.status()).toBe(200);
		return urls(server_attrs(await res.text(), id).avif)[0]!;
	}

	test("a CMS image from a server load renders in its box and loads; live, its files are the endpoint's, named by the URL and kept for remote.maxAge, never forever; prerendered, files the build made from the bytes", async ({
		page,
		request
	}) => {
		await page.goto('/cms');
		const a = await attrs(page.locator('#cms'));
		expect(a.picture).toBe('yes');
		expect([a.width, a.height]).toEqual(['400', '225']);
		expect(a.background).toBeNull();
		await every_image_loads(page);
		const all = [...urls(a.avif), ...urls(a.srcset)];
		for (const url of all) {
			if (MODE === 'static')
				expect(url).toMatch(/^\/_app\/immutable\/og\/[\w-]{16}-\d+x\d+\.(avif|webp)$/);
			else expect(url).toMatch(REMOTE_ID_RE);
			const res = await request.get(url);
			expect(res.status(), url).toBe(200);
			if (MODE === 'static') continue;
			expect(res.headers()['cache-control'], url).toMatch(
				/^public, max-age=\d+, stale-while-revalidate=86400$/
			);
		}
		const f = await fetch_file(request, urls(a.avif).at(-1)!);
		expect([f.type, f.width, f.height]).toEqual(['image/avif', 800, 450]);
	});

	test('a .remote/ tail changed to name another URL, though listed, is refused by the signature', async ({
		request
	}) => {
		test.skip(MODE === 'static', 'a prerendered page names no signed URL');
		const url = await late_url(request, 'listed');
		const other = Buffer.from('http://127.0.0.1:4176/photos/cover.jpg').toString('base64url');
		const forged = url.replace(/\.remote\/[\w-]+/, `.remote/${other}`);
		const res = await request.get(forged);
		expect(res.status()).toBe(403);
		expect(res.headers()['x-ogygia-deny']).toBe('sig');
		expect((await request.get(url)).status()).toBe(200);
	});

	test('an unlisted host the app signed is 404, a body past maxBytes 413, a host past remote.timeout 504, each kept nowhere', async ({
		request
	}) => {
		test.skip(MODE === 'static', 'every page prerendered: no request reaches an endpoint');
		for (const [id, status] of [
			['unlisted', 404],
			['huge', 413],
			['slow', 504]
		] as const) {
			const res = await request.get(await late_url(request, id));
			expect(res.status(), id).toBe(status);
			expect(res.headers()['cache-control'], id).toBe('no-store');
		}
	});
});

test.describe('share cards (/card, /late/card)', () => {
	const CARD_URL_RE = /\/c[\w-]{32}-1200x630\/\.card\/[\w-]{16}\/([\w-]+)\.png$/;

	async function og_image(page: Page, path: string): Promise<URL> {
		await page.goto(path);
		return new URL((await page.locator('meta[property="og:image"]').getAttribute('content'))!);
	}

	test("a card's own src is a 1200 x 630 PNG, absolute in og:image: prerendered, a file the build made under og/; live, a signed URL kept forever; its <Img> loads", async ({
		page,
		request
	}) => {
		const og = await og_image(page, '/card');
		if (MODE === 'static') {
			expect(og.origin).toBe('https://example.com');
			expect(og.pathname).toMatch(/^\/_app\/immutable\/og\/c[\w-]{32}-1200x630\.png$/);
			const app = fileURLToPath(new URL('./app/', import.meta.url));
			expect(fs.existsSync(path.join(app, 'build/static', og.pathname))).toBe(true);
		} else {
			expect(og.origin).toBe(new URL(page.url()).origin);
			expect(og.pathname).toMatch(CARD_URL_RE);
		}
		const res = await request.get(og.pathname);
		expect(res.status()).toBe(200);
		if (MODE !== 'static')
			expect(res.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
		const meta = await sharp(await res.body()).metadata();
		expect([res.headers()['content-type'], meta.format, meta.width, meta.height]).toEqual([
			'image/png',
			'png',
			1200,
			630
		]);
		await every_image_loads(page);
	});

	test("a card that names images draws them, read and fitted by the build or the server that draws it: an asset of the build as an <img>, a small remote WebP as a style's url()", async ({
		page,
		request
	}) => {
		const og = await og_image(page, '/card/photo');
		if (MODE === 'static') expect(og.pathname).toMatch(/^\/_app\/immutable\/og\/c[\w-]+\.png$/);
		else expect(og.pathname).toMatch(CARD_URL_RE);
		const res = await request.get(og.pathname);
		expect(res.status(), await res.text().catch(() => '')).toBe(200);
		expect(await photo_card_misses(await res.body())).toEqual([]);
	});

	test('a card rendered on request draws the props its load named, one source per props', async ({
		page,
		request
	}) => {
		test.skip(MODE === 'static', 'every page prerendered: no request reaches an endpoint');
		const a = await og_image(page, '/late/card?title=First');
		const b = await og_image(page, '/late/card?title=Second');
		expect(a.pathname).toMatch(CARD_URL_RE);
		expect(a.pathname.split('/')[4]).not.toBe(b.pathname.split('/')[4]);
		const props = CARD_URL_RE.exec(a.pathname)![1]!;
		expect(JSON.parse(Buffer.from(props, 'base64url').toString('utf8'))).toEqual({
			title: 'First'
		});
		for (const url of [a, b]) {
			const f = await fetch_file(request, url.pathname);
			expect([f.type, f.width, f.height]).toEqual(['image/png', 1200, 630]);
		}
	});

	test('a .card/ tail changed to other props is refused by the signature', async ({
		page,
		request
	}) => {
		test.skip(MODE === 'static', 'a prerendered page names no signed URL');
		const og = await og_image(page, '/late/card?title=Mine');
		const other = Buffer.from(JSON.stringify({ title: 'Forged' })).toString('base64url');
		const forged = og.pathname.replace(/(\.card\/[\w-]+\/)[\w-]+/, `$1${other}`);
		const res = await request.get(forged);
		expect(res.status()).toBe(403);
		expect(res.headers()['x-ogygia-deny']).toBe('sig');
		expect((await request.get(og.pathname)).status()).toBe(200);
	});

	test('in dev, a share image that is WebP or AVIF says image_share_format', async ({
		request
	}) => {
		test.skip(MODE !== 'dev', 'a dev rule');
		expect((await request.get('/late/card?format=webp')).status()).toBe(200);
		await expect
			.poll(() => fs.readFileSync(server_log()!, 'utf8'))
			.toMatch(/image_share_format\?path=%2Flate%2Fcard/);
	});
});

test.describe('absolute image URLs', () => {
	const ABSOLUTE_RE =
		MODE === 'static'
			? /^https:\/\/example\.com\/_app\/immutable\/og\/[\w-]+\.\w+$/
			: /^http:\/\/localhost:\d+\/__ogygia__\/i\/.+\.\w+$/;

	test("a post's og:image, made with new URL(src, page.url), names its file at the site's origin", async ({
		request
	}) => {
		const html = await (await request.get('/blog/first-post')).text();
		const share = /<meta property="og:image" content="([^"]+)"/.exec(html)![1]!;
		expect(share).toMatch(ABSOLUTE_RE);
		const f = await fetch_file(request, new URL(share).pathname);
		expect([f.type, f.width]).toEqual(['image/webp', 1200]);
	});

	test('the RSS feed names each cover and every image in each body by an absolute URL that loads', async ({
		request
	}) => {
		const xml = await (await request.get('/feed.xml')).text();
		expect(xml).not.toMatch(/ogygia\.invalid/);
		const named = [...xml.matchAll(/\b(?:url|src|srcset)="([^"]+)"/g)].flatMap((m) =>
			m[1]!.split(', ').map((c) => c.split(' ')[0]!)
		);
		expect(named.length).toBeGreaterThan(10);
		for (const [, url, type] of xml.matchAll(/<enclosure url="([^"]+)" type="([^"]+)"/g)) {
			const res = await request.get(new URL(url!).pathname);
			expect(res.headers()['content-type'], url).toBe(type);
		}
		for (const url of named) {
			expect(url).toMatch(ABSOLUTE_RE);
			const res = await request.get(new URL(url).pathname);
			expect(res.status(), url).toBe(200);
			expect(res.headers()['content-type'], url).toMatch(/^image\//);
		}
	});
});

test.describe('a build', () => {
	test.skip(MODE === 'dev', 'the dev server builds nothing');

	test("leaves the build's mark in no file of its output, Kit's or the adapter's", () => {
		const app = fileURLToPath(new URL('./app/', import.meta.url));
		const dirs = MODE === 'static' ? ['build/static'] : ['build'];
		const found = marked_files(app, [...dirs, `${E2E_OUT_DIR}/output`], (rel) =>
			MODE === 'static' ? false : rel.startsWith('build/static')
		);
		expect(found.read).toBeGreaterThan(50);
		expect(found.marked).toEqual([]);
	});

	test("of the docs' blog recipe keeps the collection on the server: no server-only warning, no post in a client bundle", () => {
		const said = fs.readFileSync(server_log()!, 'utf8');
		expect(said).toContain('built in');
		expect(said).not.toMatch(/content_collection_not_server_only|content leaked into the CLIENT/);
	});
});

test.describe('a prerendered build', () => {
	test.skip(MODE !== 'static', 'every page prerendered');

	test("its SPA fallback page, rendered after the build wrote its files, holds no mark, and the root layout's image loads in it", async ({
		page,
		request
	}) => {
		const html = await (await request.get('/404.html')).text();
		expect(html).toContain('kit.start');
		expect(html).not.toMatch(/ogygia\.invalid/);
		await page.goto('/404.html');
		const mark = page.locator('#site-mark');
		await expect
			.poll(() => mark.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
			.toBe(true);
	});

	test('names every file a page shows as a file under the app folder, never a signed URL', async ({
		request
	}) => {
		for (const p of PAGES) {
			const html = await (await request.get(p)).text();
			expect(html.match(SIGNED_URL_RE) ?? [], p).toEqual([]);
			const named = html.match(IMAGE_URL_RE) ?? [];
			expect(named.length, p).toBeGreaterThan(0);
			for (const url of named) expect(url, p).toMatch(/^\/_app\/immutable\/og\/[\w-]+\.\w+$/);
		}
	});

	test('names the same files in a second build with no OGYGIA_SECRET, and warns of no key', async ({
		browserName
	}) => {
		test.skip(browserName !== 'chromium', 'one browser builds again');
		test.setTimeout(240_000);
		const app = fileURLToPath(new URL('./app/', import.meta.url));
		const again = 'build/static-again';
		const env: NodeJS.ProcessEnv = {
			...process.env,
			IMAGE_E2E_STATIC: '1',
			IMAGE_E2E_PAGES: again,
			OGYGIA_RULES: '1'
		};
		delete env.OGYGIA_SECRET;
		try {
			const res = spawnSync('node', ['node_modules/vite/bin/vite.js', 'build'], {
				cwd: app,
				env,
				encoding: 'utf8'
			});
			const said = `${res.stdout}${res.stderr}`;
			expect(res.status, said).toBe(0);
			expect(said).not.toMatch(/build_key_prerender/);
			for (const p of PAGES) {
				const file = p === '/' ? 'index.html' : `${p.slice(1)}.html`;
				const named = (dir: string): string[] =>
					fs.readFileSync(path.join(app, dir, file), 'utf8').match(IMAGE_URL_RE) ?? [];
				const first = named('build/static');
				expect(first.length, file).toBeGreaterThan(0);
				expect(named(again), file).toEqual(first);
			}
		} finally {
			fs.rmSync(path.join(app, again), { recursive: true, force: true });
		}
	});
});

test.describe('with the runtime', () => {
	test("an <Img> inside a hydrated island keeps the server's files through hydration and every update after, with no warning", async ({
		page,
		request
	}) => {
		const said = listen(page);
		const html = await (await request.get('/')).text();
		const server = server_attrs(html, 'island-img');
		await page.goto('/');
		const img = page.locator('#island-img');
		const button = page.locator('#island-count');
		await expect(async () => {
			await button.click();
			await expect(button).not.toHaveText('0', { timeout: 200 });
		}).toPass();
		const clicks = Number(await button.textContent());
		await expect(img).toHaveClass(clicks % 2 ? /\bodd\b/ : /\beven\b/);
		const after = await attrs(img);
		expect([after.src, after.srcset, after.avif]).toEqual([server.src, server.srcset, server.avif]);
		await expect
			.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
			.toBe(true);
		expect(said).toEqual([]);
	});

	test('a priority <Img> inside an island keeps the head preload the server wrote', async ({
		page,
		request
	}) => {
		const said = listen(page);
		const html = await (await request.get('/island')).text();
		const preload = /<link rel="preload" as="image"[^>]*>/.exec(html)![0];
		const server_set = /imagesrcset="([^"]+)"/.exec(preload)![1]!.replaceAll('&amp;', '&');
		expect(server_set).toMatch(/\.avif 320w/);
		await page.goto('/island');
		const button = page.locator('#hero-count');
		await expect(async () => {
			await button.click();
			await expect(button).not.toHaveText('0', { timeout: 200 });
		}).toPass();
		const link = page.locator('head link[rel="preload"][as="image"]');
		await expect(link).toHaveCount(1);
		expect(await link.getAttribute('imagesrcset')).toBe(server_set);
		expect((await attrs(page.locator('#island-hero'))).avif).toBe(server_set);
		expect(said).toEqual([]);
	});

	test('a morph thumbnail and the post hero of the same source share one view-transition name, and the navigation runs clean', async ({
		page
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('console', (m) => {
			if (m.type() === 'error') errors.push(m.text());
		});
		await page.goto('/');
		const thumb = await attrs(page.locator('#post-thumb'));
		expect(thumb.transition).toMatch(/^og-img-[\w-]+$/);
		expect((await attrs(page.locator('#thumb'))).transition).toBeNull();
		await page.locator('#to-post').click();
		await expect(page.locator('#cover')).toBeVisible();
		expect((await attrs(page.locator('#cover'))).transition).toBe(thumb.transition);
		expect(errors).toEqual([]);
	});

	test("a client-side navigation swaps the head's preload for the new page's priority image", async ({
		page
	}) => {
		await page.goto('/');
		const preload = page.locator('head link[rel="preload"][as="image"]');
		await expect(preload).toHaveCount(1);
		const home = await preload.getAttribute('imagesrcset');
		await page.evaluate(() => ((window as { __same_page?: boolean }).__same_page = true));
		await page.locator('#to-post').click();
		await expect(page.locator('#cover')).toBeVisible();
		expect(await page.evaluate(() => (window as { __same_page?: boolean }).__same_page)).toBe(true);
		await expect(preload).toHaveCount(1);
		const post = await preload.getAttribute('imagesrcset');
		expect(post).not.toBe(home);
		expect(post).toBe((await attrs(page.locator('#cover'))).avif);
		const cover = page.locator('#cover');
		await expect
			.poll(() => cover.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
			.toBe(true);
	});
});

/** Every file URL a `<picture>`'s rows and `<img>` name. */
async function picture_urls(picture: Locator): Promise<string[]> {
	return picture.evaluate((el) => {
		const out: string[] = [];
		for (const node of el.querySelectorAll('source, img'))
			for (const attr of ['srcset', 'src']) {
				const v = node.getAttribute(attr);
				if (v)
					for (const c of v.split(', '))
						out.push(new URL(c.split(' ')[0]!, location.href).pathname);
			}
		return out;
	});
}

/** The `<img>` the visitor sees, once it has pixels: its file and its box. */
async function shown(page: Page, selector: string): Promise<{ src: string; w: number; h: number }> {
	const img = page.locator(selector).filter({ visible: true });
	await expect(img).toHaveCount(1);
	await img.scrollIntoViewIfNeeded();
	await expect
		.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
		.toBe(true);
	return img.evaluate((el: HTMLImageElement) => {
		const r = el.getBoundingClientRect();
		return { src: new URL(el.currentSrc).pathname, w: r.width, h: r.height };
	});
}

test.describe('twins (/twins)', () => {
	const LIGHT = 'picture[data-og-theme="light"]';
	const DARK = 'picture[data-og-theme="dark"]';

	test('the system theme picks the picture: light shows the light file, dark the dark one', async ({
		page
	}) => {
		for (const scheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			await page.goto('/twins');
			const own = await picture_urls(page.locator(scheme === 'dark' ? DARK : LIGHT));
			const seen = await shown(page, `${LIGHT} img, ${DARK} img`);
			expect(own, scheme).toContain(seen.src);
		}
	});

	test('a data-theme switch shows the other picture, only the shown picture downloads, and nothing shifts', async ({
		page,
		browserName
	}) => {
		const asked: string[] = [];
		page.on('request', (r) => asked.push(new URL(r.url()).pathname));
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto('/twins');
		const light = await picture_urls(page.locator(LIGHT));
		const dark = await picture_urls(page.locator(DARK));
		const before = await shown(page, `${LIGHT} img, ${DARK} img`);
		expect(light).toContain(before.src);
		expect(asked.filter((u) => dark.includes(u))).toEqual([]);

		await page.evaluate(() => {
			(window as { __shift?: number }).__shift = 0;
			new PerformanceObserver((list) => {
				for (const e of list.getEntries() as (PerformanceEntry & { value: number })[])
					(window as { __shift?: number }).__shift! += e.value;
			}).observe({ type: 'layout-shift' as never, buffered: false });
			document.documentElement.dataset.theme = 'dark';
		});
		const after = await shown(page, `${LIGHT} img, ${DARK} img`);
		expect(dark).toContain(after.src);
		expect([after.w, after.h]).toEqual([before.w, before.h]);
		if (browserName === 'chromium')
			expect(await page.evaluate(() => (window as { __shift?: number }).__shift)).toBe(0);

		await page.emulateMedia({ colorScheme: 'dark' });
		await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
		expect(light).toContain((await shown(page, `${LIGHT} img, ${DARK} img`)).src);
	});

	test('asking for less motion shows the first frame of a moving image, a still file', async ({
		page,
		request
	}) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/twins');
		const still = await shown(page, '#motion');
		expect(still.src).toMatch(/-\d+x\d+-s[./]/);
		const bytes = Buffer.from(await (await request.get(still.src)).body());
		expect((await sharp(bytes, { animated: true }).metadata()).pages ?? 1).toBe(1);

		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.goto('/twins');
		const moving = await shown(page, '#motion');
		expect(moving.src).not.toMatch(/-s[./]/);
		expect([moving.w, moving.h]).toEqual([still.w, still.h]);
	});

	test('art direction: a narrow screen shows each art twin in its own box; a wide one the source', async ({
		page
	}) => {
		const ratio = async (id: string): Promise<number> => {
			const s = await shown(page, `#${id}`);
			return s.w / s.h;
		};
		await page.setViewportSize({ width: 400, height: 900 });
		await page.goto('/twins');
		for (const id of ['art-preset', 'art-macro', 'art-prop'])
			expect(await ratio(id), id).toBeCloseTo(0.8, 1);
		await page.setViewportSize({ width: 1200, height: 900 });
		await page.goto('/twins');
		expect(await ratio('art-preset')).toBeCloseTo(16 / 9, 1);
		for (const id of ['art-macro', 'art-prop']) expect(await ratio(id), id).toBeCloseTo(1.8, 1);
	});
});
