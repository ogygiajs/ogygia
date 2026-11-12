// THE ROUTER LANDS WHERE A NAVIGATION WOULD (runtime/router-nav.ts `nav_headers`, the hand-offs,
// runtime/router.ts `nav_target`).
//
//   1. Every router page fetch (nav, prefetch, history) sends the browser's DOCUMENT `Accept`.
//      `fetch` alone sends `*/*`, and servers answer that differently: a field app 302'd `*/*` home
//      while serving `text/html` its page — the router followed the redirect, rewrote the address
//      bar to the home page and never navigated.
//   2. A page the router will not render (another application behind the same origin) is handed to
//      the browser as a navigation to the address the visitor CLICKED, never to where the router's
//      own fetch was redirected.
//   3. A web-component link that re-dispatches the visitor's click on its inner `<a>` starts ONE
//      navigation, not two (the second used to abort the first and fetch again).
//   4. A beforeNavigate cancel does not leave that swallow armed: the next click navigates.
//   5. The same with the anchor in the component's SHADOW ROOT (#263), where the re-dispatched click
//      may never reach `document`: a click event that is not composed stays in the shadow tree, and
//      a click on an anchor the swap took out of the page reaches no document at all. The browser
//      followed the link itself: a full load, after a router click it had already prevented.
//   6. A link the browser never replaces the page for (a file download, a 204) works every time
//      (#266). The router's fetch gets no page and hands the link to the browser, which keeps the
//      page on screen: no swap ever ended that navigation, and every later click on the link joined
//      it and was swallowed.
// The foreign server and the web components are faked by the test (page.route / an init script).
// Usage: pnpm exec playwright test router-document-fetch
import type { Page, Request } from '@playwright/test';
import { test, check, expect, stamp_document, document_stamp } from '@ogygia/tooling/e2e';
import { needs_attachment_downloads } from '@ogygia/tooling/e2e/browsers.ts';

/** What Chromium sends for a top-level document navigation. */
const DOCUMENT_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const FOREIGN = '**/router-links/foreign/**';
const FOREIGN_PATH = '/router-links/foreign/docs/';
const FOREIGN_HTML =
	'<!doctype html><html><head><title>foreign</title></head><body><h1 data-foreign-page>foreign app</h1></body></html>';

/** Requests the router made for a page (its fetches carry `x-ogygia-spa`). */
function spa_requests(page: Page): Request[] {
	const out: Request[] = [];
	page.on('request', (r) => {
		if (r.headers()['x-ogygia-spa']) out.push(r);
	});
	return out;
}

/** The re-dispatching web-component link: on the visitor's (trusted) click it clicks its inner
 *  `<a>` again a few ms later — what design-system button links do. */
const RELINK = () => {
	customElements.define(
		'x-relink',
		class extends HTMLElement {
			connectedCallback() {
				this.addEventListener('click', (e) => {
					if (!e.isTrusted) return;
					setTimeout(() => this.querySelector('a')?.click(), 5);
				});
			}
		}
	);
};

/** How the shadow-root link re-dispatches the visitor's click on its inner `<a>`. */
type Redispatch = 'event' | 'click';

/** A link component whose `<a>` is in its shadow root. On the visitor's (trusted) click it clicks
 *  its inner anchor again: `event` — a new click event a few ms later, not composed (it stays in the
 *  shadow tree); `click` — the anchor's `.click()`, after an animation (by then the router's swap
 *  has taken the component out of the page). */
const SHADOW_RELINK = (how: Redispatch) => {
	customElements.define(
		'x-shadow-relink',
		class extends HTMLElement {
			connectedCallback() {
				if (this.shadowRoot) return;
				const root = this.attachShadow({ mode: 'open' });
				const a = document.createElement('a');
				a.href = this.getAttribute('href') ?? '';
				a.textContent = 'about (shadow-root link)';
				root.append(a);
				a.addEventListener('click', (e) => {
					if (!e.isTrusted) return;
					if (how === 'event')
						setTimeout(
							() => a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
							5
						);
					else setTimeout(() => a.click(), 400);
				});
			}
		}
	);
};

async function open(page: Page) {
	await page.goto('/router-links', { waitUntil: 'networkidle' });
	await page.waitForFunction(
		() =>
			!!customElements.get('ogygia-region') ||
			!!document.querySelector('meta[name="ogygia-router"]')
	);
}

test.describe('the router fetches a page the way the browser fetches a document', () => {
	test('nav, prefetch and history fetches all send the document Accept', async ({ page }) => {
		const reqs = spa_requests(page);
		await open(page);
		await page.locator('[data-plain]').hover(); // prefetch
		await page.waitForTimeout(400);
		await page.locator('[data-plain]').click(); // nav (from the prefetch cache, or a fetch)
		await page.waitForSelector('#about-heading');
		await page.goBack(); // history
		await page.waitForSelector('[data-router-links]');
		await page.waitForTimeout(300);
		const purposes = reqs.map((r) => r.headers()['x-ogygia-purpose'] ?? 'nav');
		check(
			'a prefetch and a history fetch were made',
			purposes.includes('prefetch') && purposes.includes('history'),
			purposes.join(',')
		);
		const wrong = reqs.filter((r) => r.headers()['accept'] !== DOCUMENT_ACCEPT);
		check(
			'every router page fetch sends the document Accept',
			reqs.length > 0 && wrong.length === 0,
			wrong.map((r) => `${r.url()} accept=${r.headers()['accept']}`).join('\n')
		);
	});

	test('a server that redirects */* but serves text/html: the click lands on the page a navigation gets', async ({
		page
	}) => {
		const seen: Array<{ accept: string; spa: boolean }> = [];
		await page.route(FOREIGN, (route) => {
			const h = route.request().headers();
			seen.push({ accept: h['accept'] ?? '', spa: !!h['x-ogygia-spa'] });
			if (!(h['accept'] ?? '').includes('text/html'))
				return route.fulfill({ status: 302, headers: { location: '/' } });
			return route.fulfill({ status: 200, contentType: 'text/html', body: FOREIGN_HTML });
		});
		await open(page);
		await page.locator('[data-foreign]').click();
		await page.waitForSelector('[data-foreign-page]', { timeout: 10_000 });
		check(
			'the address is the clicked one, not the redirect target',
			new URL(page.url()).pathname === FOREIGN_PATH,
			page.url()
		);
		check(
			'the foreign document was loaded by the browser (a real navigation)',
			seen.some((s) => !s.spa),
			JSON.stringify(seen)
		);
		check(
			'no request was answered with the */* redirect',
			seen.every((s) => s.accept.includes('text/html')),
			JSON.stringify(seen)
		);
	});

	test('a page the router will not render is handed off to the CLICKED address, not the fetch’s redirect', async ({
		page
	}) => {
		// Only the router's fetch is redirected (a server keying on its own header): the browser's
		// own request for the clicked address must be what the visitor ends up on.
		// The redirect target is a real non-ogygia document (routes/router-links/elsewhere/+server.ts):
		// the router's fetch lands on it and hands off. The redirect is the server's own
		// (routes/router-links/to-elsewhere): Playwright's WebKit cannot fulfill a route with a 3xx.
		await page.route(FOREIGN, (route) =>
			route.request().headers()['x-ogygia-spa']
				? route.continue({ url: new URL('/router-links/to-elsewhere', route.request().url()).href })
				: route.fulfill({ status: 200, contentType: 'text/html', body: FOREIGN_HTML })
		);
		await open(page);
		const before = await page.evaluate(() => history.length);
		await page.locator('[data-foreign]').click();
		await page.waitForSelector('[data-foreign-page]', { timeout: 10_000 });
		check(
			'landed on the clicked address',
			new URL(page.url()).pathname === FOREIGN_PATH,
			page.url()
		);
		check(
			'one history entry for one click',
			(await page.evaluate(() => history.length)) === before + 1
		);
	});

	test('a web-component link that re-dispatches its click: one fetch, one history entry', async ({
		page
	}) => {
		await page.addInitScript(RELINK);
		const reqs = spa_requests(page);
		await open(page);
		const before = await page.evaluate(() => history.length);
		const n0 = reqs.length;
		await page.locator('[data-relink]').click();
		await page.waitForSelector('#about-heading');
		await page.waitForTimeout(300);
		const navs = reqs
			.slice(n0)
			.filter((r) => new URL(r.url()).pathname === '/about' && !r.headers()['x-ogygia-purpose']);
		check('exactly one navigation fetch', navs.length === 1, String(navs.length));
		check('exactly one history entry', (await page.evaluate(() => history.length)) === before + 1);
	});

	for (const [how, what] of [
		['event', 'a click event that stays in its shadow tree, a few ms later'],
		['click', 'its anchor’s .click(), after the swap took it out of the page']
	] as const) {
		test(`a shadow-root link that re-dispatches its click (${what}): one router navigation, no full load`, async ({
			page
		}) => {
			await page.addInitScript(SHADOW_RELINK, how);
			const reqs = spa_requests(page);
			const documents: string[] = [];
			page.on('request', (r) => {
				if (r.resourceType() === 'document') documents.push(new URL(r.url()).pathname);
			});
			await open(page);
			const stamp = await stamp_document(page);
			const before = await page.evaluate(() => history.length);
			const n0 = reqs.length;
			await page.locator('[data-shadow-relink] >> a').click();
			await page.waitForSelector('#about-heading', { timeout: 10_000 });
			// past the component's re-dispatch (5 ms, or 400 ms) and what it would start
			await page.waitForTimeout(1200);
			check(
				'no full load: the document is the one the click started on',
				(await document_stamp(page)) === stamp
			);
			check('no document request for the page', !documents.includes('/about'), documents.join(','));
			const navs = reqs
				.slice(n0)
				.filter((r) => new URL(r.url()).pathname === '/about' && !r.headers()['x-ogygia-purpose']);
			check('exactly one navigation fetch', navs.length === 1, String(navs.length));
			check('at the page', new URL(page.url()).pathname === '/about', page.url());
			check(
				'exactly one history entry',
				(await page.evaluate(() => history.length)) === before + 1
			);
		});
	}

	test('a beforeNavigate cancel does not leave the link swallowed', async ({ page }) => {
		await open(page);
		await page.evaluate(() => {
			const nav = (
				globalThis as unknown as Record<
					symbol,
					{ beforeNavigate(fn: (n: { cancel(): void }) => void): () => void }
				>
			)[Symbol.for('ogygia.nav')];
			let once = true;
			nav.beforeNavigate((n) => {
				if (once) {
					once = false;
					n.cancel();
				}
			});
		});
		await page.locator('[data-plain]').click();
		await page.waitForTimeout(400);
		check('the cancelled click stayed', new URL(page.url()).pathname === '/router-links');
		await page.locator('[data-plain]').click();
		await page.waitForSelector('#about-heading', { timeout: 10_000 });
		check(
			'the next click on the same link navigates',
			new URL(page.url()).pathname === '/about',
			page.url()
		);
	});
});

// (#297) and none of them adds a history entry: the router writes an entry when a page goes in,
// never before its fetch, so Back goes to the page before. A download sent as HTML is one too: its
// `Content-Disposition: attachment` makes it a file, whatever its type, never a page to swap in.
test.describe('a link the browser never replaces the page for works every time (#266, #297)', () => {
	for (const [link, path, what, file] of [
		['[data-download]', '/router-links/export.csv', 'a file download', 'export.csv'],
		['[data-no-content]', '/router-links/no-content', 'a 204', null],
		['[data-download-html]', '/router-links/export.html', 'a download sent as HTML', 'report.html']
	] as const) {
		test(`${what}, clicked twice: the browser gets it each time and the page stays`, async ({
			page
		}) => {
			// the browser's own requests for the link (the router's fetch carries `x-ogygia-spa`)
			const asked: string[] = [];
			page.on('request', (r) => {
				if (new URL(r.url()).pathname === path && !r.headers()['x-ogygia-spa'])
					asked.push(r.resourceType());
			});
			const downloads: string[] = [];
			page.on('download', (d) => downloads.push(d.suggestedFilename()));
			// a page before this one, for Back to go to
			await page.goto('/router-history', { waitUntil: 'networkidle' });
			if (file) await needs_attachment_downloads(page);
			await open(page);
			const stamp = await stamp_document(page);
			const entries = await page.evaluate(() => history.length);
			for (const n of [1, 2]) {
				await page.locator(link).click();
				await expect
					.poll(() => asked.length, {
						message: `click ${n}: the browser asked for ${path}`,
						timeout: 5_000
					})
					.toBe(n);
				if (file)
					await expect
						.poll(() => downloads.length, {
							message: `click ${n}: the file downloaded`,
							timeout: 5_000
						})
						.toBe(n);
				// past the browser's answer: nothing else comes of the click
				await page.waitForTimeout(300);
			}
			check(
				'each was a document navigation',
				asked.every((t) => t === 'document'),
				asked.join()
			);
			if (file)
				check(
					'both downloads are the file',
					downloads.every((f) => f === file)
				);
			check(
				'the page stayed: the document is the one the clicks started on',
				(await document_stamp(page)) === stamp
			);
			check('at the page', new URL(page.url()).pathname === '/router-links', page.url());
			await expect(page.locator('[data-router-links]')).toBeVisible();
			const now = await page.evaluate(() => history.length);
			check('no history entry for either click', now === entries, `${entries} → ${now}`);
			await page.goBack();
			await expect(page.locator('[data-history-a]')).toBeVisible({ timeout: 10_000 });
			check(
				'Back goes to the page before',
				new URL(page.url()).pathname === '/router-history',
				page.url()
			);
		});
	}
});
