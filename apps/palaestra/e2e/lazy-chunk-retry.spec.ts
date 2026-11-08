// LAZY CHUNKS THAT FAIL (#201, #237, #238). The runtime loads its lazy pieces (the hydrate core,
// devalue, the interaction replay, a transportable class's module, the router's navigation) on the
// first use that needs each. On a flaky mobile network that first download can fail. It must never
// break every later use in the tab: a dropped download is tried again, and a use after a failed one
// loads it afresh.
//
// Each test drops the first N downloads of one chunk at the network (the browser sees a failed
// fetch, as on a dropped connection), found by what only that chunk carries in a production build.
// Against the built palaestra (/lazy-retry, /lazy-retry-class, /router-links).
//
// What the browser does, measured here: a module whose download failed stays failed in its module
// map for the life of the page; a second import() of the same URL fails without a request. The
// runtime asks for a failed lazy chunk again under a fresh URL (runtime/import-again.ts). A failed
// chunk SHARED with others (imported statically) cannot be asked for again at all.
// Usage: pnpm exec playwright test lazy-chunk-retry
import { expect, test, type Page } from '@playwright/test';
import { check, replayed_once } from '@ogygia/tooling/e2e';

/** What only each chunk carries in a production build. */
const CHUNKS = {
	/** the foreign-mutation detector's message code, kept in production */
	'hydrate core': 'hydration_discarded',
	/** devalue's own parse error */
	devalue: 'Invalid circular reference',
	/** the replay restores a field's selection */
	'interaction replay': 'setSelectionRange',
	/** the router's navigation (runtime/router-nav.ts): the server-delta header it sends */
	navigation: 'x-ogygia-known',
	/** a transportable class's lazy load (runtime/wire-classes.ts): the small chunk that re-exports
	 *  it, the one its loader imports (the class itself sits in a chunk the page's own node shares) */
	'class module': /export\{\w+ as RetryStamp\}from/
} as const;

type Chunk = keyof typeof CHUNKS;

/** Drops the first `times` downloads of `chunk`. Returns how many were dropped and served. */
async function drop(page: Page, chunk: Chunk, times: number) {
	const seen = { dropped: 0, served: 0 };
	const mark = CHUNKS[chunk];
	await page.route(
		(url) => url.pathname.endsWith('.js'),
		async (route) => {
			const response = await route.fetch();
			const body = await response.text();
			if (typeof mark === 'string' ? body.includes(mark) : mark.test(body)) {
				if (seen.dropped < times) {
					seen.dropped++;
					return route.abort('failed');
				}
				seen.served++;
			}
			return route.fulfill({ response, body });
		}
	);
	return seen;
}

/** The page's uncaught errors (an unhandled rejection is one). */
function errors(page: Page): string[] {
	const out: string[] = [];
	page.on('pageerror', (e) => out.push(String(e)));
	return out;
}

const region_of = (page: Page, label: string) =>
	page.locator(`ogygia-region:has([data-dated-counter="${label}"])`);

async function hydrated(page: Page, label: string, timeout = 4000): Promise<boolean> {
	return region_of(page, label)
		.and(page.locator('[data-hydrated]'))
		.waitFor({ timeout })
		.then(
			() => true,
			() => false
		);
}

async function counts(page: Page, label: string): Promise<boolean> {
	const button = page.locator(`[data-dated-counter="${label}"] button`);
	await button.click();
	return (await button.innerText()).includes('count is 1');
}

test.describe('lazy chunks that fail once are loaded again (#201)', () => {
	test('the hydrate core dropped once: the first wake still hydrates', async ({ page }) => {
		const thrown = errors(page);
		const seen = await drop(page, 'hydrate core', 1);
		await page.goto('/lazy-retry');
		check('the near island hydrated', await hydrated(page, 'near'));
		check('it counts', await counts(page, 'near'));
		check(
			'the hydrate core was dropped once, then loaded',
			seen.dropped === 1 && seen.served >= 1,
			JSON.stringify(seen)
		);
		check('no uncaught error', thrown.length === 0, thrown.join('\n'));
	});

	test('the hydrate core dropped until a wake fails: the next wake loads it afresh', async ({
		page
	}) => {
		const thrown = errors(page);
		const logged: string[] = [];
		page.on('console', (m) => m.type() === 'error' && logged.push(m.text()));
		const seen = await drop(page, 'hydrate core', 2);
		await page.goto('/lazy-retry');
		// the near island's wake gives up after its retry: its HTML stays, dead but real
		await expect.poll(() => logged.some((t) => t.includes('island_load_failed'))).toBe(true);
		check('the near island did not hydrate', !(await hydrated(page, 'near', 500)));
		// a later wake, in the same tab
		await page.locator('[data-dated-counter="far"]').scrollIntoViewIfNeeded();
		check('the far island hydrated', await hydrated(page, 'far'));
		check('it counts', await counts(page, 'far'));
		check(
			'dropped twice, then served',
			seen.dropped === 2 && seen.served >= 1,
			JSON.stringify(seen)
		);
		check('no uncaught error', thrown.length === 0, thrown.join('\n'));
	});

	// devalue is not a chunk of its own in a Kit app: it shares one with Kit's client, which other
	// chunks import statically. A SHARED chunk that failed stays failed for the life of the page in
	// Chromium and Firefox (no URL trick reaches a static import), so its islands cannot wake until a
	// reload. What the runtime owes then: say so for each wake, leave nothing uncaught, hang nothing.
	test('devalue’s shared chunk dropped: each wake that needs it says so, nothing uncaught', async ({
		page
	}) => {
		const thrown = errors(page);
		const logged: string[] = [];
		page.on('console', (m) => m.type() === 'error' && logged.push(m.text()));
		const seen = await drop(page, 'devalue', 1);
		await page.goto('/lazy-retry');
		await expect.poll(() => seen.dropped).toBe(1);
		await expect
			.poll(() => logged.filter((t) => t.includes('island_load_failed')).length)
			.toBeGreaterThan(0);
		await page.locator('[data-dated-counter="far"]').scrollIntoViewIfNeeded();
		// the far wake settles too (reported, not left pending): a second report
		await expect
			.poll(() => logged.filter((t) => t.includes('island_load_failed')).length)
			.toBeGreaterThan(1);
		check('no uncaught error', thrown.length === 0, thrown.join('\n'));
	});

	test('the hydrate core dropped until a wake fails: a click wake after it lands its click', async ({
		page
	}) => {
		const thrown = errors(page);
		const seen = await drop(page, 'hydrate core', 2);
		await page.goto('/lazy-retry');
		await expect.poll(() => seen.dropped).toBe(2);
		await page.locator('[data-i-btn]').click();
		check('the click replayed once the island woke', await replayed_once(page));
		check(
			'dropped twice, then served',
			seen.dropped === 2 && seen.served >= 1,
			JSON.stringify(seen)
		);
		check('no uncaught error', thrown.length === 0, thrown.join('\n'));
	});

	test('the interaction replay dropped twice: the click still lands, nothing uncaught', async ({
		page
	}) => {
		const thrown = errors(page);
		const seen = await drop(page, 'interaction replay', 2);
		await page.goto('/lazy-retry');
		await page.waitForTimeout(300);
		await page.locator('[data-i-btn]').click();
		check('the click replayed', await replayed_once(page));
		check(
			'dropped twice, then served',
			seen.dropped === 2 && seen.served >= 1,
			JSON.stringify(seen)
		);
		check('no uncaught error', thrown.length === 0, thrown.join('\n'));
	});
});

// A TRANSPORTABLE CLASS'S MODULE (#237): an island whose props carry an instance loads the class's
// module before it decodes them (runtime/wire-classes.ts). A failed load must not be kept: the
// decode of the wake it failed for says which class is missing, and the next wake loads it afresh.
test.describe('a class module that fails once is loaded again (#237)', () => {
	const stamp_region = (page: Page, label: string) =>
		page.locator(`ogygia-region:has([data-stamp-counter="${label}"])`);
	const stamp_hydrated = (page: Page, label: string, timeout = 4000) =>
		stamp_region(page, label)
			.and(page.locator('[data-hydrated]'))
			.waitFor({ timeout })
			.then(
				() => true,
				() => false
			);
	const stamp_counts = async (page: Page, label: string) => {
		const button = page.locator(`[data-stamp-counter="${label}"] button`);
		await button.click();
		return (await button.innerText()).includes('count is 1');
	};

	test('dropped once: the first wake still decodes its class', async ({ page }) => {
		const thrown = errors(page);
		const seen = await drop(page, 'class module', 1);
		await page.goto('/lazy-retry-class');
		check('the near island hydrated', await stamp_hydrated(page, 'near'));
		check('it counts', await stamp_counts(page, 'near'));
		check(
			'the class module was dropped once, then loaded',
			seen.dropped === 1 && seen.served >= 1,
			JSON.stringify(seen)
		);
		check('no uncaught error', thrown.length === 0, thrown.join('\n'));
	});

	test('dropped until a wake fails: that wake names the class, the next wake loads it afresh', async ({
		page
	}) => {
		const thrown = errors(page);
		const logged: string[] = [];
		page.on('console', (m) => m.type() === 'error' && logged.push(m.text()));
		const seen = await drop(page, 'class module', 2);
		await page.goto('/lazy-retry-class');
		// the near island's decode had no class: it says which, and its HTML stays
		await expect
			.poll(() => logged.some((t) => t.includes('transportable_class_missing')))
			.toBe(true);
		check('the near island did not hydrate', !(await stamp_hydrated(page, 'near', 500)));
		// a later wake, in the same tab
		await page.locator('[data-stamp-counter="far"]').scrollIntoViewIfNeeded();
		check('the far island hydrated', await stamp_hydrated(page, 'far'));
		check('it counts', await stamp_counts(page, 'far'));
		check(
			'dropped twice, then served',
			seen.dropped === 2 && seen.served >= 1,
			JSON.stringify(seen)
		);
		check('no uncaught error', thrown.length === 0, thrown.join('\n'));
	});
});

// THE ROUTER'S NAVIGATION (#238): its heavy half loads on the first prefetch, click or refresh
// (runtime/router.ts). A failed load must not be kept: a click it failed for falls back to a full
// load, as always, but every later click, `invalidateAll` and `preloadData` loads it afresh.
test.describe('the navigation chunk that fails once is loaded again (#238)', () => {
	type Handle = { invalidateAll(): Promise<void> };
	const invalidate_all = (page: Page) =>
		page.evaluate(() =>
			(globalThis as unknown as Record<symbol, Handle>)[Symbol.for('ogygia.nav')]
				.invalidateAll()
				.then(
					() => 'ok',
					(e: unknown) => 'failed: ' + String(e)
				)
		);

	const open = async (page: Page) => {
		await page.goto('/router-links', { waitUntil: 'networkidle' });
		await page.waitForFunction(() => Symbol.for('ogygia.nav') in globalThis);
	};

	test('dropped until a refresh fails: the next invalidateAll loads it and refreshes', async ({
		page
	}) => {
		const thrown = errors(page);
		const seen = await drop(page, 'navigation', 2);
		await open(page);
		const first = await invalidate_all(page);
		check('the first refresh failed (its chunk dropped)', first !== 'ok', first);
		const second = await invalidate_all(page);
		check('the next refresh loaded the chunk and refreshed', second === 'ok', second);
		check(
			'dropped twice, then served',
			seen.dropped === 2 && seen.served >= 1,
			JSON.stringify(seen)
		);
		check('no uncaught error', thrown.length === 0, thrown.join('\n'));
	});

	test('dropped until a refresh fails: the next click is still a router navigation', async ({
		page
	}) => {
		const thrown = errors(page);
		const seen = await drop(page, 'navigation', 2);
		await open(page);
		await invalidate_all(page);
		await page.evaluate(() => ((window as unknown as { __same_doc: boolean }).__same_doc = true));
		await page.locator('[data-plain]').click();
		await page.waitForSelector('#about-heading', { timeout: 10_000 });
		const same_doc = await page.evaluate(
			() => (window as unknown as { __same_doc?: boolean }).__same_doc === true
		);
		check('the click swapped the page in place (no full load)', same_doc);
		check(
			'dropped twice, then served',
			seen.dropped === 2 && seen.served >= 1,
			JSON.stringify(seen)
		);
		check('no uncaught error', thrown.length === 0, thrown.join('\n'));
	});
});
