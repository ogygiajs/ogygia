// A DEPLOY ROLLING OVER, where the host says the old file is GONE (410) rather than not found (404):
// either way the map that names it is the old one, asked again.
//
// Its own file: the maps read are module state shared by a file's tests.
import { afterEach, expect, test, vi } from 'vitest';
import { import_entry, note_entry_location } from '../../src/runtime/entry-locations.ts';

afterEach(() => vi.unstubAllGlobals());

test('a file the host answers 410 Gone for is gone too: the old map is asked again, and the island wakes', async () => {
	const identity = '/test/browser/fixtures/ogygia/og-region.000000000aa2.js';
	const gone = './immutable/og-region.000000000aa2.Gone410.js';
	note_entry_location(identity, `/test/browser/fixtures/${gone.slice(2)}`);
	const real = fetch;
	let reads = 0;
	vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith('/ogygia.json') && reads++ === 0)
			return Promise.resolve(Response.json({ './ogygia/og-region.000000000aa2.js': gone }));
		if (url.includes('Gone410') && init?.method === 'HEAD')
			return Promise.resolve(new Response(null, { status: 410 }));
		return real(input, init);
	});
	const m = await import_entry<{ default: string }>(identity);
	expect(m.default).toBe('current');
	expect(reads).toBe(2);
});
