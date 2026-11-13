// The wait for Kit's page thread is its waiters'. An island of ours on a Kit-hydrated document waits
// for Kit's client entry to publish its page (kit-page-thread.svelte.ts). On a global that refuses an
// accessor on the symbol (a sealed sandbox) the wait watches it on a 50 ms timer. An island that
// leaves the page while it waits no longer waits, and once no island waits nothing may keep watching.
// One that still waits hydrates once Kit publishes.
import { afterEach, expect, inject, test } from 'vitest';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';
import { publish_kit_page } from './_kit-thread.svelte.ts';

const KIT_PAGE_KEY = Symbol.for('ogygia.kit-page');
const ISLAND = 'ogygia-region[wake="idle"]';
const inject_html = (key: 'lake_page_reader_ssr_b64') => from_b64(inject(key));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// the symbol cannot be redefined (no accessor latch), for the whole file: every read of it is the
// timer's watch, and Kit's entry publishes through the plain assignment
let reads = 0;
let value: unknown;
Object.defineProperty(globalThis, KIT_PAGE_KEY, {
	configurable: false,
	get: () => {
		reads++;
		return value;
	},
	set: (v) => {
		value = v;
	}
});

/** Kit's document with our lake + idle island in it, not booted by Kit yet. */
function kit_document(): HTMLElement {
	document.body.innerHTML = `<script>__sveltekit_lab = {};\x3C/script><div data-mount>${inject_html('lake_page_reader_ssr_b64')}</div>`;
	const island = document.querySelector(ISLAND) as HTMLElement;
	expect(island, 'the fixture is the lake + idle island shape').not.toBeNull();
	return island;
}

afterEach(() => {
	document.body.innerHTML = '';
});

test('a sealed global: the wait stops watching for Kit once the island that waited has left the page', async () => {
	const island = kit_document();
	bootDev();

	// it woke and waits for Kit, watching the symbol
	await expect.poll(() => reads, { timeout: 10_000 }).toBeGreaterThan(3);
	expect(island.hasAttribute('data-hydrated')).toBe(false);

	// the island leaves the page: nobody waits for Kit any more
	document.querySelector('[data-mount]')!.remove();
	await pause(150);
	const after = reads;
	await pause(400);
	expect(reads, 'no watch outlives the island that waited').toBe(after);
});

test('a sealed global: an island that waits hydrates once Kit publishes its page', async () => {
	const island = kit_document();
	const before = reads;
	await expect.poll(() => reads - before, { timeout: 10_000 }).toBeGreaterThan(3);
	expect(island.hasAttribute('data-hydrated'), 'held until Kit publishes').toBe(false);

	publish_kit_page({ searchBarMarkup: '<i data-testid="search">search</i>' });

	await expect.poll(() => island.hasAttribute('data-hydrated'), { timeout: 5_000 }).toBe(true);
	expect(island.hasAttribute('data-og-recovered'), 'same branch as the server').toBe(false);
	expect(island.querySelector('[data-testid="branch"]')?.textContent).toBe('search');
});
