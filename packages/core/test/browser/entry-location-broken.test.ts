// A FILE THAT FAILED ANOTHER WAY (runtime/entry-locations.ts `recover_location`). The current map names
// the very file that just failed, and the host does not say that file is gone: the network cut it, or
// the module is broken. Asking the map again changes nothing, so the failure stands at once (the
// wake logs it and disarms) — the rollover's patience is only for a map an edge has not updated yet.
//
// Its own file: the maps read are module state shared by a file's tests.
import { afterEach, expect, test, vi } from 'vitest';
import { Downloads, timeline_full } from '@ogygia/tooling/vitest/downloads';
import { import_entry, note_entry_location } from '../../src/runtime/entry-locations.ts';

const downloads = new Downloads();

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test('the map names the failed file and the host does not say it is gone: the failure stands at once, with no timer run, the map read once and the file not asked for again', async () => {
	timeline_full();
	const identity = '/test/browser/fixtures/ogygia/og-region.000000000aa6.js';
	const gone = './immutable/og-region.000000000aa6.Uu33Vv44.js';
	note_entry_location(identity, `/test/browser/fixtures/${gone.slice(2)}`);
	const real = fetch;
	let reads = 0;
	let asked_gone = 0;
	vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith('/ogygia.json')) {
			reads++;
			return Promise.resolve(Response.json({ './ogygia/og-region.000000000aa6.js': gone }));
		}
		if (url.endsWith(gone.slice(1))) {
			asked_gone++;
			return Promise.reject(new TypeError('network cut'));
		}
		return real(input, init);
	});
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
	await expect(import_entry(identity)).rejects.toThrow();
	expect(vi.getTimerCount()).toBe(0);
	expect(reads).toBe(1);
	expect(asked_gone).toBe(1);
	expect(downloads.named('Uu33Vv44')).toHaveLength(1);
});
