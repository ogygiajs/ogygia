// THE LARGE CMS PAGE (the TBT blame study's fixtures, internal/checks/tbt-*.ts), pinned.
//
// /bench-cms/kit: a csr=true page whose chrome is two lakes, and a few hundred `<x-widget>`s that
// render into their own light DOM before Kit hydrates. That edit makes Svelte's hydration mismatch,
// so Kit clears its root and mounts the page fresh (every widget disconnects); with `?xw=static` the
// widgets leave their light DOM alone and Kit hydrates in place. Either way the lakes are ogygia's:
// they hold their server HTML and their islands wake.
//
// /bench-cms/holes: a deferred hole of about 250 KB below the fold swaps in when it scrolls into
// view, and the islands inside its answer wake.
//
//   pnpm --filter palaestra e2e bench-cms
import { test, check, sleep } from '@ogygia/tooling/e2e';
import type { Page } from '@playwright/test';

type Xw = { connect: number; disconnect: number; construct: number };
const xw = (page: Page) => page.evaluate(() => (window as unknown as { __xw: Xw }).__xw);

async function open_kit(page: Page, query = '') {
	await page.goto(`/bench-cms/kit/${query}`, { waitUntil: 'networkidle' });
	await sleep(300);
}

async function header_lake_holds_its_own(page: Page) {
	const header = page.locator('ogygia-region[wake="none"]').first();
	check(
		'the header lake holds the header',
		(await header.locator('[data-kit-lake="header"]').count()) === 1
	);
	await header
		.locator('ogygia-region[wake="load"][data-hydrated]')
		.first()
		.waitFor({ timeout: 10_000 });
	check('the header lake’s load island woke', true);
}

test.describe('the large CMS page as a csr=true page', () => {
	test('a web component that edits its light DOM before Kit hydrates makes Kit remount the page', async ({
		page
	}) => {
		await open_kit(page);
		const counts = await xw(page);
		check(
			'every widget was taken off the page once (Kit cleared its root and mounted fresh)',
			counts.disconnect > 0,
			JSON.stringify(counts)
		);
		check(
			'two lakes on the page',
			(await page.locator('ogygia-region[wake="none"]').count()) === 2
		);
		await header_lake_holds_its_own(page);
	});

	test('with the widgets leaving their light DOM alone, Kit hydrates in place', async ({
		page
	}) => {
		await open_kit(page, '?xw=static');
		const counts = await xw(page);
		check('no widget was taken off the page', counts.disconnect === 0, JSON.stringify(counts));
		const footer = page.locator('ogygia-region[wake="none"]').nth(1);
		check(
			'the footer lake holds the footer',
			(await footer.locator('[data-kit-lake="footer"]').count()) === 1
		);
		await header_lake_holds_its_own(page);
	});
});

test.describe('the large CMS page with big holes', () => {
	test('a 250 KB hole swaps in when it scrolls into view, and the islands in its answer wake', async ({
		page
	}) => {
		await page.goto('/bench-cms/holes/?csp=0', { waitUntil: 'networkidle' });
		await page.waitForSelector('[data-big-hole="top"]', { timeout: 10_000 });
		check(
			'the below-the-fold hole waits for the visitor',
			(await page.locator('[data-big-hole="a"]').count()) === 0
		);
		await page.locator('ogygia-region[render="defer"]').nth(1).scrollIntoViewIfNeeded();
		await page.waitForSelector('[data-big-hole="a"]', { timeout: 10_000 });
		const bytes = await page.evaluate(
			() => document.querySelector('[data-big-hole="a"]')!.outerHTML.length
		);
		check('the hole’s answer is about 250 KB of HTML', bytes > 200_000, String(bytes));
		await page.waitForFunction(
			() =>
				document.querySelectorAll('[data-big-hole="a"] ogygia-region[wake="load"][data-hydrated]')
					.length === 5,
			undefined,
			{ timeout: 10_000 }
		);
		check('the five islands in the hole’s answer woke', true);
		const button = page.locator('[data-big-hole="a"] [data-counter] button').first();
		await button.click();
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-big-hole="a"] [data-counter] button')
					?.textContent?.includes('count is 1'),
			undefined,
			{ timeout: 5000 }
		);
		check('an island in the hole answers a click', true);
	});
});
