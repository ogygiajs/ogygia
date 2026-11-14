// Mixed-mode (islands on a csr=true page) + opt-in router (MPA handoff) checks.
//
//   pnpm exec playwright test mixed
import { test, check, sleep, stamp_document, document_stamp } from '@ogygia/tooling/e2e';

test.describe('csr=true coexistence + opt-in router', () => {
	test('Mixed mode: island on the csr=true /kit page', async ({ page }) => {
		const errs: string[] = [];
		page.on('pageerror', (e) => errs.push(e.message));
		await page.goto('/kit', { waitUntil: 'networkidle' });
		await sleep(500);
		check(
			'mixed: exactly one counter in DOM (no duplicate)',
			(await page.locator('[data-counter]').count()) === 1
		);
		// csr=true → ogygia steps aside: the island compiled to a plain component, so there is NO
		// <ogygia-region> at all (zero ogygia on the page). Kit hydrates the plain component itself.
		check(
			'mixed: NO ogygia-region on the csr=true page (zero ogygia)',
			(await page.locator('ogygia-region').count()) === 0
		);
		const btn = page.locator('[data-counter] button');
		await btn.click();
		await btn.click();
		check(
			'mixed: island interactive via Kit hydration',
			(await btn.textContent())!.includes('count is 44')
		);
		// real $app/state in a normal (non-island) component
		check(
			'mixed: normal component uses REAL $app/state',
			(await page.locator('[data-kit-status] strong').textContent())!.includes('/kit')
		);
		const ks = page.locator('[data-kit-status] button');
		await ks.click();
		check('mixed: normal component interactive', (await ks.textContent())!.includes('count 1'));
		check('mixed: no page errors', errs.length === 0, errs.slice(0, 2).join('; '));
	});

	test('Global router: SPA everywhere; /plain opts out of view transitions per-page', async ({
		page
	}) => {
		await page.goto('/', { waitUntil: 'networkidle' });
		const m1 = await stamp_document(page);
		// SPA nav keeps the document stamp (no full document reload)
		await page.click('nav a[href="/about"]');
		await page.waitForSelector('[data-clock-island]', { timeout: 3000 });
		check('router: SPA nav keeps the stamp', (await document_stamp(page)) === m1);

		// nav to /plain -> still SPA (router is global); the page only opts out of view transitions
		let loaded: boolean = false;
		page.on('load', () => (loaded = true));
		await page.click('nav a[href="/plain"]');
		await page.waitForSelector('[data-static-shell]', { timeout: 4000 });
		await sleep(200);
		check('router: nav to /plain stayed SPA (no document reload)', !loaded);
		check('router: at /plain', page.url().endsWith('/plain'));
		const m2 = await document_stamp(page);
		check('router: SPA nav to /plain kept the document stamp', m2 === m1);
		// island on /plain still hydrates
		await page.waitForSelector('ogygia-region[data-hydrated]', { timeout: 3000 });
		const pbtn = page.locator('[data-counter] button');
		await pbtn.click();
		check(
			'router: island on /plain still hydrates & works',
			(await pbtn.textContent())!.includes('count is 6')
		);
	});

	// BACK FROM A csr=true PAGE (#259). A link from a router page to a csr=true page is handed to the
	// browser (the router does not render Kit's pages). The router had already written the history
	// entry for it, and a browser navigation to the address it is on reloads that entry: the Kit
	// document took over the entry, with the router's state, and the router page's entry before it
	// became an entry of the Kit document too. Back was then a same-document step inside the Kit
	// page: the address changed, the Kit page stayed, nothing loaded.
	test('back from a csr=true page the router handed off shows the router page', async ({
		page
	}) => {
		await page.goto('/router-links', { waitUntil: 'networkidle' });
		const before = await page.evaluate(() => history.length);
		await page.locator('[data-kit-link]').click();
		await page.waitForSelector('[data-kit-status]', { timeout: 10_000 });
		await page.waitForLoadState('networkidle');
		const kit_doc = await stamp_document(page);
		check(
			'one history entry for the click',
			(await page.evaluate(() => history.length)) === before + 1
		);
		check(
			'the Kit document starts with an entry of its own (no router state)',
			!(await page.evaluate(() => (history.state as { ogygia?: string } | null)?.ogygia))
		);
		await page.goBack();
		const shown = await page.waitForSelector('[data-router-links]', { timeout: 10_000 }).then(
			() => true,
			() => false
		);
		check('back shows the router page', shown, page.url());
		check('at the router page’s address', new URL(page.url()).pathname === '/router-links');
		check('the Kit document is gone', (await document_stamp(page)) !== kit_doc);
		check('the Kit page is not on screen', (await page.locator('[data-kit-status]').count()) === 0);
	});
});
