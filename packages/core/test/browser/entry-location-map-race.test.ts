// TWO ISLANDS' RECOVERIES, ONE MAP (runtime/entry-locations.ts `current_location`). Both islands'
// files went with the old build, and the edge still answers the old map, which names both. Each
// recovery drops that map once its host says the file is gone, and reads it again. One drop lands
// while the other recovery's read of the map is out: that read gives STALE. It is a map not read
// yet: the recovery waits and reads again, and the island wakes on the current build's file.
//
// Its own file: the maps read are module state shared by a file's tests.
import { afterEach, expect, test, vi } from 'vitest';
import { import_entry, note_entry_location } from '../../src/runtime/entry-locations.ts';

afterEach(() => vi.unstubAllGlobals());

const BASE = '/test/browser/fixtures';
const A = `${BASE}/ogygia/og-region.000000000aa1.js`;
const B = `${BASE}/ogygia/og-region.000000000aa2.js`;
const A_GONE = './immutable/og-region.000000000aa1.Race11.js';
const B_GONE = './immutable/og-region.000000000aa2.Race22.js';

test('a read of the map that another recovery drops while it is out is read again, and both islands wake', async () => {
	note_entry_location(A, `${BASE}/${A_GONE.slice(2)}`);
	note_entry_location(B, `${BASE}/${B_GONE.slice(2)}`);
	const real = fetch;
	let reads = 0;
	let let_b_hear!: () => void;
	const b_heard = new Promise<void>((r) => (let_b_hear = r));
	let b_dropped!: () => void;
	const after_b_drop = new Promise<void>((r) => (b_dropped = r));
	vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.endsWith('/ogygia.json')) {
			reads++;
			if (reads === 1)
				return Response.json({
					'./ogygia/og-region.000000000aa1.js': A_GONE,
					'./ogygia/og-region.000000000aa2.js': B_GONE
				});
			if (reads === 2) {
				let_b_hear();
				await after_b_drop;
			}
			return real(input, init);
		}
		if (init?.method === 'HEAD' && url.endsWith(B_GONE.slice(1))) {
			await b_heard;
			const res = await real(input, init);
			setTimeout(b_dropped, 0);
			return res;
		}
		return real(input, init);
	});
	const [a, b] = await Promise.all([
		import_entry<{ default: string }>(A),
		import_entry<{ default: string }>(B)
	]);
	expect(a.default).toBe('current');
	expect(b.default).toBe('current');
	expect(reads).toBeGreaterThanOrEqual(3);
});
