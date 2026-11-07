// WORK IN FLIGHT BELONGS TO WHAT STARTED IT. Three router races, each held open at the network so
// the late answer lands exactly when it would on a slow connection:
//
// - #203 two links clicked while the router's own chunk still downloads (a touch device on slow 3G:
//   no hover warmed it): the LAST click wins.
// - #202 a soft refresh (invalidateAll, what a remote form runs on success) still in flight when the
//   visitor clicks a link: its late answer must not overwrite the new page's head or data.
// - #208 a prefetch still in flight when a remote mutation clears the page cache: its late answer
//   must not put the page as it was before the mutation back into the cache.
//
// Against the built palaestra (/soft-race, /soft-race/b, the home page's links).
// Usage: pnpm exec playwright test router-ownership
import { expect, type Page, type Route } from '@playwright/test';
import { test, check } from '@ogygia/tooling/e2e';

/** A string only the navigation chunk carries (the SPA fetch header). */
const ROUTER_NAV_MARKER = 'x-ogygia-spa';

/** A gate: `hold` parks a route until `open()`. */
function gate() {
	let open!: () => void;
	const opened = new Promise<void>((r) => (open = r));
	const held: Route[] = [];
	return {
		held,
		open,
		hold: async (route: Route, fulfil: () => Promise<void>) => {
			held.push(route);
			await opened;
			await fulfil();
		}
	};
}

async function heading(page: Page): Promise<string> {
	return ((await page.locator('h1').first().textContent()) ?? '').trim();
}

test.describe('work in flight belongs to what started it', () => {
	test('#203 two clicks while the router chunk downloads: the last one wins', async ({ page }) => {
		const chunk = gate();
		await page.route(
			(url) => url.pathname.endsWith('.js'),
			async (route) => {
				const response = await route.fetch();
				const body = await response.text();
				if (!body.includes(ROUTER_NAV_MARKER)) return route.fulfill({ response, body });
				await chunk.hold(route, () => route.fulfill({ response, body }));
			}
		);
		await page.goto('/', { waitUntil: 'domcontentloaded' });
		await page.waitForSelector('meta[name="ogygia-router"]', { state: 'attached' });
		// (clicked from script: a pointer would hover first, and hovering warms the chunk anyway)
		await page.evaluate(() => (document.querySelector('a[href="/forms"]') as HTMLElement).click());
		await page.waitForTimeout(40);
		await page.evaluate(() => (document.querySelector('a[href="/data"]') as HTMLElement).click());
		await expect.poll(() => chunk.held.length).toBeGreaterThan(0);
		chunk.open();
		await page.waitForURL('**/data', { timeout: 8000 }).catch(() => {});
		await page.waitForTimeout(600);
		const path = await page.evaluate(() => location.pathname);
		check('the address is the last link clicked (/data)', path === '/data', path);
		check(
			'the page on screen is /data, not /forms',
			path === '/data' && !/form/i.test(await heading(page)),
			await heading(page)
		);
	});

	test('#202 a soft refresh in flight when the visitor navigates: the new page keeps its head', async ({
		page
	}) => {
		await page.goto('/soft-race', { waitUntil: 'networkidle' });
		await page.locator('ogygia-region[data-hydrated]:has([data-soft-refresh])').waitFor();
		const soft = gate();
		await page.route('**/soft-race', async (route) => {
			const r = route.request();
			// the soft refresh: a script fetch of the page on screen (a navigation to it is not held)
			if (r.method() !== 'GET' || r.resourceType() !== 'fetch') return route.continue();
			await soft.hold(route, () => route.continue());
		});
		await page.locator('[data-soft-refresh]').click();
		await expect.poll(() => soft.held.length).toBe(1);
		// the visitor moves on while the refresh is still out
		await page.evaluate(() => (document.querySelector('[data-soft-b]') as HTMLElement).click());
		await page.waitForURL('**/soft-race/b');
		await expect.poll(() => heading(page)).toBe('Soft race B');
		soft.open();
		await page.waitForTimeout(700);
		const head = await page.evaluate(() => ({
			title: document.title,
			meta: [...document.querySelectorAll('meta[name="soft-race"]')].map((m) =>
				m.getAttribute('content')
			)
		}));
		check(
			'the address is still /soft-race/b',
			new URL(page.url()).pathname === '/soft-race/b',
			page.url()
		);
		check('the title is still B’s', head.title === 'soft race B', head.title);
		check(
			'the head is B’s alone (A’s refresh did not merge in)',
			head.meta.join() === 'b',
			head.meta.join()
		);
		check(
			'the page on screen is still B',
			(await heading(page)) === 'Soft race B',
			await heading(page)
		);
	});

	test('a click a beforeNavigate guard cancels never ends the navigation already in flight', async ({
		page
	}) => {
		await page.goto('/soft-race', { waitUntil: 'networkidle' });
		await page
			.locator('ogygia-region[data-hydrated]:has([data-guard-cancelled])')
			.waitFor({ state: 'attached' }); // (the guard renders nothing visible)
		const b = gate();
		await page.route('**/soft-race/b', async (route) => {
			if (route.request().resourceType() !== 'fetch') return route.continue();
			await b.hold(route, () => route.continue());
		});
		// the visitor clicks B; while B's page is still out, a link the guard blocks
		await page.evaluate(() => (document.querySelector('[data-soft-b]') as HTMLElement).click());
		await expect.poll(() => b.held.length).toBe(1);
		await page.evaluate(() =>
			(document.querySelector('[data-soft-blocked]') as HTMLElement).click()
		);
		await expect
			.poll(() => page.locator('[data-guard-cancelled]').getAttribute('data-guard-cancelled'))
			.toBe('1');
		b.open();
		await page.waitForURL('**/soft-race/b', { timeout: 5000 }).catch(() => {});
		await page.waitForTimeout(300);
		check(
			'the guard cancelled the blocked link',
			new URL(page.url()).pathname !== '/soft-race/blocked',
			page.url()
		);
		check(
			'B, already in flight, still arrived',
			new URL(page.url()).pathname === '/soft-race/b' && (await heading(page)) === 'Soft race B',
			`${page.url()} · ${await heading(page)}`
		);
	});

	test('#208 a prefetch in flight when a mutation clears the cache: the click gets the fresh page', async ({
		page
	}) => {
		await page.goto('/soft-race', { waitUntil: 'networkidle' });
		const prefetch = gate();
		await page.route('**/soft-race/b', async (route) => {
			const r = route.request();
			if (r.headers()['x-ogygia-purpose'] !== 'prefetch') return route.continue();
			// the page as it was before the mutation: marked, so a click served from it shows
			const response = await route.fetch();
			const body = (await response.text()).replace(
				'Soft race B',
				'Soft race B (before the mutation)'
			);
			await prefetch.hold(route, () => route.fulfill({ response, body }));
		});
		// a remote mutation that succeeds (what a Kit command or form POST is on the wire)
		await page.route('**/remote/race-mutation', (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: '{"type":"result"}' })
		);
		await page.locator('[data-soft-b]').hover();
		await expect.poll(() => prefetch.held.length).toBe(1);
		const mutated = await page.evaluate(
			async () => (await fetch('/remote/race-mutation', { method: 'POST', body: '{}' })).ok
		);
		check('the mutation succeeded (the router clears its page cache)', mutated);
		prefetch.open();
		await page.waitForTimeout(400);
		await page.evaluate(() => (document.querySelector('[data-soft-b]') as HTMLElement).click());
		await page.waitForURL('**/soft-race/b');
		await page.waitForTimeout(300);
		check(
			'the click shows the page fetched after the mutation, not the prefetch from before it',
			(await heading(page)) === 'Soft race B',
			await heading(page)
		);
	});
});
