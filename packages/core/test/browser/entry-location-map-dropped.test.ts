// THE CURRENT BUILD'S MAP, DROPPED AT THE NETWORK (runtime/entry-locations.ts `recover_location`). A
// read of `<appDir>/ogygia.json` that gets no answer at all (the connection dropped, not a 5xx) is a
// map that could not be read: it is not kept, and the recovery asks again, after the rollover's wait,
// until it is read. The island wakes on the current build's file.
//
// Its own file: the maps read are module state shared by a file's tests.
import { afterEach, expect, test, vi } from 'vitest';
import { import_entry } from '../../src/runtime/entry-locations.ts';

const IDENTITY = '/test/browser/fixtures/ogygia/og-region.000000000aa2.js';

afterEach(() => vi.unstubAllGlobals());

test('a map read dropped at the network twice: the recovery waits, asks again, and wakes', async () => {
	const real = fetch;
	/** When each read of the map went out. */
	const reads: number[] = [];
	vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
		if (String(input).endsWith('/ogygia.json')) {
			reads.push(performance.now());
			if (reads.length <= 2) return Promise.reject(new TypeError('Failed to fetch'));
		}
		return real(input, init);
	});
	// (the first read is the load's own; the identity is a name, so its load fails; the recovery's
	// first read is dropped too, and the next waits the rollover's first backoff, 1 s)
	const m = await import_entry<{ default: string }>(IDENTITY);
	expect(m.default).toBe('current');
	expect(reads).toHaveLength(3);
	expect(reads[2] - reads[1]).toBeGreaterThanOrEqual(900);
});
