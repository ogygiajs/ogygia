// A FILE THAT FAILED WHILE ITS HOST STILL HAS IT (runtime/entry-locations.ts `is_gone`). The current
// map names the very file that just failed, and the host answers the HEAD for it with a 200: the file
// is there, so it failed another way (a broken module, a cut body). Asking the map again changes
// nothing: the failure stands at once, after one read.
//
// Its own file: the maps read are module state shared by a file's tests.
import { afterEach, expect, test, vi } from 'vitest';
import { import_entry, note_entry_location } from '../../src/runtime/entry-locations.ts';

afterEach(() => vi.unstubAllGlobals());

test('the host still has the failed file: the failure stands at once, after one read of the map', async () => {
	const identity = '/test/browser/fixtures/ogygia/og-region.000000000aa6.js';
	const failed = './immutable/og-region.000000000aa6.Yy77Zz88.js';
	note_entry_location(identity, `/test/browser/fixtures/${failed.slice(2)}`);
	const real = fetch;
	let reads = 0;
	vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith('/ogygia.json')) {
			reads++;
			return Promise.resolve(Response.json({ './ogygia/og-region.000000000aa6.js': failed }));
		}
		if (url.endsWith(failed.slice(1))) return Promise.resolve(new Response('', { status: 200 }));
		return real(input, init);
	});
	const started = performance.now();
	await expect(import_entry(identity)).rejects.toBeTruthy();
	expect(performance.now() - started).toBeLessThan(900);
	expect(reads).toBe(1);
});
