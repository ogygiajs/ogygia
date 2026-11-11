// A FILE THAT FAILED ANOTHER WAY (runtime/entry-locations.ts `recover_location`). The current map names
// the very file that just failed, and the host does not say that file is gone: the network cut it, or
// the module is broken. Asking the map again changes nothing, so the failure stands at once (the
// wake logs it and disarms) — the rollover's patience is only for a map an edge has not updated yet.
//
// Its own file: the maps read are module state shared by a file's tests.
import { afterEach, expect, test, vi } from 'vitest';
import { import_entry, note_entry_location } from '../../src/runtime/entry-locations.ts';

afterEach(() => vi.unstubAllGlobals());

test('the map names the failed file and the host does not say it is gone: the failure stands at once', async () => {
	const identity = '/test/browser/fixtures/ogygia/og-region.000000000aa6.js';
	const gone = './immutable/og-region.000000000aa6.Uu33Vv44.js';
	note_entry_location(identity, '/test/browser/fixtures/' + gone.slice(2));
	const real = fetch;
	let reads = 0;
	vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith('/ogygia.json')) {
			reads++;
			return Promise.resolve(Response.json({ './ogygia/og-region.000000000aa6.js': gone }));
		}
		if (url.endsWith(gone.slice(1))) return Promise.reject(new TypeError('network cut'));
		return real(input, init);
	});
	const started = performance.now();
	await expect(import_entry(identity)).rejects.toThrow();
	expect(performance.now() - started).toBeLessThan(900);
	expect(reads).toBe(1);
});
