// The wait for Kit's page thread is its waiters'. An island of ours on a Kit-hydrated document waits
// for Kit's client entry to publish its page (kit-page-thread.svelte.ts). On a global that refuses an
// accessor on the symbol (a sealed sandbox) the wait watches it on a 50 ms timer. An island that
// leaves the page while it waits no longer waits, and once no island waits nothing may keep watching.
import { afterEach, expect, inject, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';

const KIT_PAGE_KEY = Symbol.for('ogygia.kit-page');
const ISLAND = 'ogygia-region[wake="idle"]';
const inject_html = (key: 'lake_page_reader_ssr_b64') =>
	decodeURIComponent(escape(atob(inject(key))));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
	document.body.innerHTML = '';
});

test('a sealed global: the wait stops watching for Kit once the island that waited has left the page', async () => {
	// the symbol cannot be redefined (no accessor latch): every read of it is the timer's watch
	let reads = 0;
	let value: unknown;
	Object.defineProperty(globalThis, KIT_PAGE_KEY, {
		configurable: false,
		get: () => {
			reads++;
			return value;
		},
		set: (v) => (value = v)
	});
	document.body.innerHTML =
		'<script>__sveltekit_lab = {};</script>' +
		'<div data-mount>' +
		inject_html('lake_page_reader_ssr_b64') +
		'</div>';
	const island = document.querySelector(ISLAND) as HTMLElement;
	expect(island, 'the fixture is the lake + idle island shape').not.toBeNull();
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
