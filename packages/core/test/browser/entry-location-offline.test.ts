// AN ISLAND FILE THAT FAILED WHILE THE BROWSER IS OFFLINE (runtime/entry-locations.ts `load_entry`).
// No deploy lookup can answer offline, and the island's wake waits for `online` only when it hears
// the failure while still offline. Found by the simulator (seed 270754214, /static-lake): the
// lookup's backoff outlasted the outage, the failure landed online, and the island ended failed.
//
// Its own file: the maps read are module state shared by a file's tests.
import { afterEach, expect, test, vi } from 'vitest';
import { import_entry, note_entry_location } from '../../src/runtime/entry-locations.ts';

afterEach(() => {
	vi.unstubAllGlobals();
	delete (navigator as { onLine?: boolean }).onLine;
});

test('fails at once while offline, asking no map, so the wake hears it offline', async () => {
	const identity = '/test/browser/fixtures/ogygia/og-region.000000000ab0.js';
	note_entry_location(
		identity,
		'/test/browser/fixtures/immutable/og-region.000000000ab0.Oo00Ff11.js'
	);
	Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
	const real = fetch;
	let reads = 0;
	vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
		if (String(input).endsWith('/ogygia.json')) {
			reads++;
			return Promise.reject(new TypeError('Failed to fetch'));
		}
		return real(input, init);
	});
	const started = performance.now();
	await expect(import_entry(identity)).rejects.toBeTruthy();
	expect(navigator.onLine).toBe(false);
	expect(reads).toBe(0);
	expect(performance.now() - started).toBeLessThan(900);
}, 20_000);
