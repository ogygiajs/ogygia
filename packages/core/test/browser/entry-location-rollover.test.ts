// A DEPLOY ROLLING OVER (runtime/entry-locations.ts `current_location`). For a few seconds an edge can
// still answer `<appDir>/ogygia.json` with the OLD build's map, which names the very file that just
// failed. That answer is not the current map: it is not kept, and the recovery asks again.
//
// Its own file: the maps read are module state shared by a file's tests.
import { afterEach, expect, test, vi } from 'vitest';
import { import_entry, note_entry_location } from '../../src/runtime/entry-locations.ts';

afterEach(() => vi.unstubAllGlobals());

test('a map that names the file that just failed is the old one: asked again, and wakes', async () => {
	const identity = '/test/browser/fixtures/ogygia/og-region.000000000aa1.js';
	const gone = './immutable/og-region.000000000aa1.Ss11Tt22.js';
	note_entry_location(identity, '/test/browser/fixtures/' + gone.slice(2));
	const real = fetch;
	let reads = 0;
	vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
		if (String(input).endsWith('/ogygia.json') && reads++ === 0)
			return Promise.resolve(Response.json({ './ogygia/og-region.000000000aa1.js': gone }));
		return real(input, init);
	});
	const m = await import_entry<{ default: string }>(identity);
	expect(m.default).toBe('current');
	expect(reads).toBe(2);
});
