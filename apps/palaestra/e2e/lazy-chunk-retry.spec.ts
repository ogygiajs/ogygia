// LAZY CHUNKS THAT FAIL (#201, #237, #238, #261, #262). The runtime loads its lazy pieces (the hydrate core,
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
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { check, replayed_once } from '@ogygia/tooling/e2e';
import { console_text } from '@ogygia/tooling/e2e/browsers.ts';

/** Keeps an error message's own text in every engine (Firefox's console text of an Error is its
 *  class, without the message code the tests look for). */
function log_error(m: ConsoleMessage, logged: string[]): void {
	if (m.type() !== 'error') return;
	const read = console_text(m).then((t) => void logged.push(t));
	let pending = reading.get(logged);
	if (!pending) reading.set(logged, (pending = []));
	pending.push(read);
}

/** The console reads still out for each list (`console_text` awaits the page for each argument). */
const reading = new WeakMap<string[], Promise<void>[]>();

/** Every error the page logged so far is in `logged`: a check that reads it once (not a poll) waits
 *  for the reads still out first. */
async function all_logged(logged: string[]): Promise<string[]> {
	await Promise.all(reading.get(logged) ?? []);
	return logged;
}

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
	'class module': /export\{\w+ as RetryStamp\}from/,
	/** Svelte's client runtime: a static import of the hydrate core and of every island's code */
	svelte: 'svelte.dev/e/'
} as const;

type Chunk = keyof typeof CHUNKS;

/** Drops the first `times` downloads of `chunk` (or of the file whose path ends with `file`).
 *  Returns how many were dropped and served. */
async function drop(page: Page, chunk: Chunk | { file: string }, times: number) {
	const seen = { dropped: 0, served: 0 };
	const mark = typeof chunk === 'string' ? CHUNKS[chunk] : null;
	const is_it = (path: string, body: string) =>
		typeof chunk !== 'string'
			? path.endsWith(chunk.file)
			: typeof mark === 'string'
				? body.includes(mark)
				: mark!.test(body);
	await page.route(
		(url) => url.pathname.endsWith('.js'),
		async (route) => {
			const response = await route.fetch();
			const body = await response.text();
			if (is_it(new URL(route.request().url()).pathname, body)) {
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
		page.on('console', (m) => log_error(m, logged));
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
		page.on('console', (m) => log_error(m, logged));
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
		page.on('console', (m) => log_error(m, logged));
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
// load, as always, but every later click, `invalidateAll` and `preloadData` loads it afresh. A
// prefetch it failed for warms nothing, quietly.
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

	// A hover prefetch is a guess: when the navigation code cannot load, it warms nothing and says
	// nothing (it once left an uncaught rejection), and the click after it still navigates.
	test('dropped while a hover prefetches: nothing uncaught, and the click navigates', async ({
		page
	}) => {
		const thrown = errors(page);
		const seen = await drop(page, 'navigation', 2);
		await open(page);
		await page.locator('[data-plain]').hover();
		await expect.poll(() => seen.dropped).toBe(2);
		// (an unhandled rejection reaches the page's error event a moment after it settles)
		await page.waitForTimeout(300);
		check('the failed prefetch left no uncaught error', thrown.length === 0, thrown.join('\n'));
		await page.evaluate(() => ((window as unknown as { __same_doc: boolean }).__same_doc = true));
		await page.locator('[data-plain]').click();
		await page.waitForSelector('#about-heading', { timeout: 10_000 });
		const same_doc = await page.evaluate(
			() => (window as unknown as { __same_doc?: boolean }).__same_doc === true
		);
		check('the click swapped the page in place (no full load)', same_doc);
		check('then served', seen.served >= 1, JSON.stringify(seen));
	});
});

/** The file an island's region loads (its `src`), read off the page's server HTML. */
async function island_file(page: Page, path: string, wake: string): Promise<string> {
	const html = await (await page.request.get(path)).text();
	const src = new RegExp(`<ogygia-region [^>]*wake="${wake}"[^>]*\\ssrc="([^"]+)"`).exec(html)?.[1];
	if (!src) throw new Error(`no ${wake} region with a src on ${path}`);
	return src.slice(src.lastIndexOf('/'));
}

/** Every request for a `.js` file the page makes: its file name and its retry mark. */
function js_requests(page: Page): string[] {
	const out: string[] = [];
	page.on('request', (r) => {
		const u = new URL(r.url());
		if (u.pathname.endsWith('.js'))
			out.push(u.pathname.slice(u.pathname.lastIndexOf('/') + 1) + u.search);
	});
	return out;
}

// AN ISLAND'S OWN FILE (#261): the lazy runtime chunks above are asked for again under a fresh URL,
// and an island's own entry file must be too. It went through a plain import(): one dropped
// download, and the island never woke for the rest of the tab (the browser keeps the failed URL).
test.describe('an island’s own file that fails once is loaded again (#261)', () => {
	test('dropped once: the island wakes on the retry, and so does the next island of that file', async ({
		page
	}) => {
		const thrown = errors(page);
		const logged: string[] = [];
		page.on('console', (m) => log_error(m, logged));
		const file = await island_file(page, '/lazy-retry', 'visible');
		const seen = await drop(page, { file }, 1);
		await page.goto('/lazy-retry');
		check('the near island hydrated', await hydrated(page, 'near', 8000));
		check('it counts', await counts(page, 'near'));
		await page.locator('[data-dated-counter="far"]').scrollIntoViewIfNeeded();
		check('the far island (same file) hydrated', await hydrated(page, 'far', 8000));
		check(
			'the island’s file was dropped once, then loaded',
			seen.dropped === 1 && seen.served >= 1,
			JSON.stringify(seen)
		);
		await all_logged(logged);
		check(
			'no island_load_failed',
			!logged.some((t) => t.includes('island_load_failed')),
			logged.join('\n')
		);
		check('no uncaught error', thrown.length === 0, thrown.join('\n'));
	});
});

// A FAILED DEPENDENCY (#262). When a static import of a lazy chunk fails, the browser's error names
// the chunk, not the dependency, and the dependency stays failed in the module map: the chunk under
// a fresh URL fails again the same way, however often it is asked for (the runtime asked `og-retry=1`,
// `2`, … on every later wake, each failing). After one retry that fails although the chunk itself
// came, asking again cannot help: the runtime says once that the page needs a reload, and asks no more.
// And a failed file in the RUNTIME's own static graph (it never runs, so no island wakes) is said too.
/** Svelte's shared chunk dropped once: each chunk that imports it is asked for again once, then the
 *  page says once that it needs a reload (#262). */
async function dropped_shared_chunk(page: Page): Promise<void> {
	const thrown = errors(page);
	const logged: string[] = [];
	page.on('console', (m) => log_error(m, logged));
	const asked = js_requests(page);
	const seen = await drop(page, 'svelte', 1);
	await page.goto('/lazy-retry');
	await expect.poll(() => logged.some((t) => t.includes('island_load_failed'))).toBe(true);
	const retried_at_first_wake = asked.filter((r) => r.includes('og-retry=')).length;
	// later wakes, in the same tab: the far island, then a click on the interaction island
	await page.locator('[data-dated-counter="far"]').scrollIntoViewIfNeeded();
	await page.waitForTimeout(1000);
	await page.locator('[data-i-btn]').click();
	await page.waitForTimeout(1000);
	const retries = asked.filter((r) => r.includes('og-retry='));
	check('Svelte’s chunk was dropped', seen.dropped === 1, JSON.stringify(seen));
	check('the first wake retried its chunks once', retried_at_first_wake > 0, retries.join(', '));
	check(
		'never a second retry of a chunk (og-retry=2)',
		!retries.some((r) => r.includes('og-retry=2')),
		retries.join(', ')
	);
	check(
		'each chunk asked for again once at most',
		new Set(retries.map((r) => r.split('?')[0])).size === retries.length,
		retries.join(', ')
	);
	const reload = (await all_logged(logged)).filter((t) => t.includes('chunk_reload_needed'));
	check('one message says the page needs a reload', reload.length === 1, logged.join('\n'));
	check('no uncaught error', thrown.length === 0, thrown.join('\n'));
}

test.describe('a lazy chunk whose dependency fails says a reload is needed (#262)', () => {
	test('Svelte’s shared chunk dropped: one retry each, then one reload message, nothing more asked', async ({
		page
	}) => {
		await dropped_shared_chunk(page);
	});

	// #450: the page's resource timing buffer holds 250 entries by default, and a large page fills it
	// by the end of its load: nothing later is recorded there. Whether a retry's own file came must
	// not depend on that shared buffer (here: full after the document's own entry).
	test('the same, on a page whose resource timing buffer is full', async ({ page }) => {
		await page.addInitScript(() => performance.setResourceTimingBufferSize(1));
		await dropped_shared_chunk(page);
	});

	test('a file of the runtime’s own static graph dropped: the page says so', async ({ page }) => {
		const logged: string[] = [];
		page.on('console', (m) => log_error(m, logged));
		const html = await (await page.request.get('/lazy-retry')).text();
		const dep = /<link rel="modulepreload" href="([^"]+)" data-ogygia-runtime-dep>/.exec(html)?.[1];
		check('the runtime has a static dependency to drop', !!dep, html.slice(0, 300));
		const seen = await drop(page, { file: dep!.slice(dep!.lastIndexOf('/')) }, 1);
		await page.goto('/lazy-retry');
		await expect
			.poll(() => logged.some((t) => t.includes('runtime_load_failed')), { timeout: 5000 })
			.toBe(true);
		check('the dependency was dropped', seen.dropped === 1, JSON.stringify(seen));
		check('no island woke', (await page.locator('ogygia-region[data-hydrated]').count()) === 0);
	});
});
