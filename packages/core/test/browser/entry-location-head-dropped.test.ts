// A FILE THAT FAILED, ITS HOST NOT ANSWERING (runtime/entry-locations.ts `is_gone`). The current map
// names the very file that just failed, and the HEAD that asks whether the host still has it gets no
// answer. No answer is not "gone": the import's own failure stands, at once, with the import's own
// error (the wake logs that one), and nothing is said to have recovered.
//
// Its own file: the maps read are module state shared by a file's tests.
import { afterEach, expect, test, vi } from 'vitest';
import {
	import_entry,
	note_entry_location,
	on_entry_fallback
} from '../../src/runtime/entry-locations.ts';
import { is_failed_import } from '../../src/runtime/import-again.ts';

afterEach(() => vi.unstubAllGlobals());

test('the HEAD for the failed file gets no answer: the import’s own failure stands at once', async () => {
	const identity = '/test/browser/fixtures/ogygia/og-region.000000000aa6.js';
	const gone = './immutable/og-region.000000000aa6.Ww55Xx66.js';
	note_entry_location(identity, `/test/browser/fixtures/${gone.slice(2)}`);
	const real = fetch;
	let reads = 0;
	vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith('/ogygia.json')) {
			reads++;
			return Promise.resolve(Response.json({ './ogygia/og-region.000000000aa6.js': gone }));
		}
		if (url.endsWith(gone.slice(1))) return Promise.reject(new TypeError('the HEAD was dropped'));
		return real(input, init);
	});
	const reported: boolean[] = [];
	on_entry_fallback((r) => reported.push(r.recovered));
	const started = performance.now();
	const error = await import_entry(identity).catch((e: unknown) => e);
	expect(performance.now() - started).toBeLessThan(900);
	expect(is_failed_import(error), String(error)).toBe(true);
	expect(reads).toBe(1);
	expect(reported, 'a recovery onto the file that just failed is no recovery').toEqual([]);
});
