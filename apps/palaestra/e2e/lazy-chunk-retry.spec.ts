// LAZY CHUNKS THAT FAIL (#201). The runtime loads its lazy pieces (the hydrate core, devalue, the
// interaction replay) on the first island that needs each. On a flaky mobile network that first
// download can fail. It must never break every later wake in the tab: a dropped download is tried
// again, and a wake after a failed one loads it afresh.
//
// Each test drops the first N downloads of one chunk at the network (the browser sees a failed
// fetch, as on a dropped connection), found by a string only that chunk carries in a production
// build. Against the built palaestra (/lazy-retry).
// Usage: pnpm exec playwright test lazy-chunk-retry
import { expect, test, type Page } from '@playwright/test';
import { check, replayed_once } from '@ogygia/tooling/e2e';

/** Strings only each chunk carries in a production build. */
const CHUNKS = {
	/** the foreign-mutation detector's message code, kept in production */
	'hydrate core': 'hydration_discarded',
	/** devalue's own parse error */
	devalue: 'Invalid circular reference',
	/** the replay restores a field's selection */
	'interaction replay': 'setSelectionRange'
} as const;

type Chunk = keyof typeof CHUNKS;

/** Drops the first `times` downloads of `chunk`. Returns how many were dropped and served. */
async function drop(page: Page, chunk: Chunk, times: number) {
	const seen = { dropped: 0, served: 0 };
	await page.route(
		(url) => url.pathname.endsWith('.js'),
		async (route) => {
			const response = await route.fetch();
			const body = await response.text();
			if (body.includes(CHUNKS[chunk])) {
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

	test('devalue dropped until a wake fails: the next wake loads it afresh, its Date intact', async ({
		page
	}) => {
		const thrown = errors(page);
		const seen = await drop(page, 'devalue', 2);
		await page.goto('/lazy-retry');
		await expect.poll(() => seen.dropped).toBe(2);
		check('the near island did not hydrate', !(await hydrated(page, 'near', 500)));
		await page.locator('[data-dated-counter="far"]').scrollIntoViewIfNeeded();
		check('the far island hydrated', await hydrated(page, 'far'));
		check(
			'its Date prop crossed as a Date',
			(await page.locator('[data-dated-counter="far"]').getAttribute('data-since-ok')) === 'true'
		);
		check('it counts', await counts(page, 'far'));
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
