// THE CURRENT BUILD'S MAP, READ AGAIN AFTER A FAILURE (runtime/entry-locations.ts `current_location`).
// A page that outlived its build recovers through `<appDir>/ogygia.json`, and it is asked exactly when
// a deploy is rolling over: a 404 or a 5xx from an edge that does not have the new file yet. A failed
// read must not be kept for the page's life — the next island asks again and wakes.
//
// Its own file: the maps read are module state shared by a file's tests.
import { afterEach, expect, test, vi } from 'vitest';
import { import_entry } from '../../src/runtime/entry-locations.ts';

const IDENTITY = '/test/browser/fixtures/ogygia/og-region.000000000aa2.js';

afterEach(() => vi.unstubAllGlobals());

test('one failed read of the current map: the load asks again, and wakes', async () => {
	const real = fetch;
	let failed = 0;
	vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
		if (String(input).endsWith('/ogygia.json') && failed === 0) {
			failed++;
			return Promise.resolve(new Response('', { status: 503 }));
		}
		return real(input, init);
	});
	// (no location anywhere, and the map unreachable: the identity is a name, so the first load
	// fails; the recovery reads the map again)
	const m = await import_entry<{ default: string }>(IDENTITY);
	expect(m.default).toBe('current');
	expect(failed).toBe(1);
});
