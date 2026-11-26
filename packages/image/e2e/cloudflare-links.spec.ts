// The fixture app built with adapter-cloudflare and `cloudflare()` (links on), run by `wrangler dev`
// (`IMAGE_E2E_MODE=cloudflare-links`): a live page names each file as an Image Transformations link,
// which only Cloudflare's CDN serves, so here their shape is checked; prerendered pages still name
// the files the build made.
import { test, expect } from '@ogygia/tooling/e2e';

const PRERENDERED = ['/', '/blog/first-post', '/blog/second-post', '/blog/third-post', '/island'];
const BUILT_RE = /\/_app\/immutable\/og\/[\w-]+\.(?:avif|webp)/g;
const SIGNED_RE = /\/__ogygia__\/i\/[^\s",)]+/g;
const LINK_RE = /\/cdn-cgi\/image\/[^\s")]+\.(?:png|jpg)/g;

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

test('a live page names every file as a /cdn-cgi/image link to its original, and nothing signed', async ({
	request
}) => {
	expect(await named(request, ['/late'], SIGNED_RE)).toEqual([]);
	const links = (await named(request, ['/late'], LINK_RE)).filter((l) => l.includes('/one.'));
	expect(links.map((l) => l.replace(/one\.[\w-]+\.png$/, 'one.<hash>.png')).sort()).toEqual([
		'/cdn-cgi/image/width=160,height=80,fit=cover,gravity=top,quality=60,format=avif/_app/immutable/assets/one.<hash>.png',
		'/cdn-cgi/image/width=160,height=80,fit=cover,gravity=top,quality=80,format=webp/_app/immutable/assets/one.<hash>.png',
		'/cdn-cgi/image/width=80,height=40,fit=cover,gravity=top,quality=60,format=avif/_app/immutable/assets/one.<hash>.png',
		'/cdn-cgi/image/width=80,height=40,fit=cover,gravity=top,quality=80,format=webp/_app/immutable/assets/one.<hash>.png'
	]);
	const original = /\/_app\/immutable\/assets\/one\.[\w-]+\.png$/.exec(links[0]!)![0];
	expect((await request.get(original)).status()).toBe(200);
});

test("a live page's moving image offers a still as a link with anim=false, at reduced motion", async ({
	request
}) => {
	const html = await (await request.get('/late/motion')).text();
	const rows = [
		...html.matchAll(/<source media="\(prefers-reduced-motion: reduce\)"[^>]*srcset="([^"]+)"/g)
	];
	expect(rows.length).toBe(2);
	for (const [, srcset] of rows)
		for (const c of srcset!.split(', '))
			expect(c).toMatch(
				/^\/cdn-cgi\/image\/[^ ]*,anim=false\/_app\/immutable\/assets\/[\w-]+\.[\w-]+\.gif \d+w$/
			);
	expect(html).toMatch(/<img[^>]* srcset="\/cdn-cgi\/image\/(?:(?!anim=false)[^ ])+ \d+w/);
});

test("a live page's remoteImage() is a /cdn-cgi/image link to its whole URL (the zone must allow that origin); one on an unlisted host gets no link, only the endpoint's URL, which refuses it", async ({
	request
}) => {
	const html = await (await request.get('/late/cms')).text();
	const signed = [...new Set(html.match(SIGNED_RE) ?? [])];
	const unlisted = Buffer.from('http://127.0.0.1:4177/photos/field.jpg').toString('base64url');
	expect(signed.length).toBeGreaterThan(0);
	for (const url of signed) expect(url).toContain(`/.remote/${unlisted}.`);
	expect(html).not.toContain(
		'/cdn-cgi/image/width=300,height=200,fit=crop,quality=80,format=webp/http://127.0.0.1:4177'
	);
	expect((await request.get(signed[0]!)).status()).toBe(404);
	const links = [
		...new Set(
			html.match(
				/\/cdn-cgi\/image\/[^\s",]+(?:,[^\s",]+)*\/http:\/\/127\.0\.0\.1:4176\/photos\/field\.jpg/g
			) ?? []
		)
	];
	expect(links.sort()).toEqual([
		'/cdn-cgi/image/width=300,height=200,fit=crop,quality=60,format=avif/http://127.0.0.1:4176/photos/field.jpg',
		'/cdn-cgi/image/width=300,height=200,fit=crop,quality=80,format=webp/http://127.0.0.1:4176/photos/field.jpg',
		'/cdn-cgi/image/width=480,height=320,fit=crop,quality=60,format=avif/http://127.0.0.1:4176/photos/field.jpg',
		'/cdn-cgi/image/width=480,height=320,fit=crop,quality=80,format=webp/http://127.0.0.1:4176/photos/field.jpg',
		'/cdn-cgi/image/width=600,height=400,fit=crop,quality=60,format=avif/http://127.0.0.1:4176/photos/field.jpg',
		'/cdn-cgi/image/width=600,height=400,fit=crop,quality=80,format=webp/http://127.0.0.1:4176/photos/field.jpg'
	]);
});

test("a live page's share card is the endpoint's signed URL, never a link: no CDN can fetch a card's original", async ({
	request
}) => {
	const html = await (await request.get('/late/card?title=Linked')).text();
	const og = /property="og:image" content="([^"]+)"/.exec(html)![1]!;
	expect(new URL(og).pathname).toMatch(/^\/__ogygia__\/i\/[^/]+\/c[\w-]{32}-1200x630\/\.card\//);
	expect((html.match(LINK_RE) ?? []).filter((l) => l.includes('.card'))).toEqual([]);
});

test('prerendered pages still name the files the build made, and no link', async ({ request }) => {
	expect((await named(request, PRERENDERED, BUILT_RE)).length).toBeGreaterThan(40);
	expect(await named(request, PRERENDERED, LINK_RE)).toEqual([]);
	expect(await named(request, PRERENDERED, SIGNED_RE)).toEqual([]);
});

test('a browser reads each link whole from a srcset, its commas included', async ({ page }) => {
	await page.goto('/late');
	const img = page.locator('img[alt$="one.png"]');
	await expect
		.poll(() => img.evaluate((el: HTMLImageElement) => el.currentSrc))
		.toContain('/cdn-cgi/');
	const picked = await img.evaluate((el: HTMLImageElement) => el.currentSrc);
	expect(new URL(picked).pathname).toMatch(
		/^\/cdn-cgi\/image\/width=(?:80|160),height=(?:40|80),fit=cover,gravity=top,quality=60,format=avif\/_app\/immutable\/assets\/one\.[\w-]+\.png$/
	);
});
