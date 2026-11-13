// ENTRY IDENTITY → LOCATION, the browser's half (runtime/entry-locations.ts), in a real browser: real
// module fetches, real 404s. An island's `entry` is its identity (the stable name every key uses); the
// file to import is its location (content-hashed). Every loader resolves through one map, and a load
// whose location fails falls back — once — to the identity fetched fresh.
//
// The map is module state shared by every test in this file: each test uses its own URLs.
import { describe, expect, test } from 'vitest';
import {
	entry_location,
	import_entry,
	island_entry_of,
	note_entry_location,
	on_entry_fallback
} from '../../src/runtime/entry-locations.ts';
import {
	island_module_url,
	warm_island_module,
	is_warmed_module
} from '../../src/runtime/region-endpoint-url.ts';
import { register_island_graph } from '../../src/runtime/island-graph-preload.ts';
import { encode_island_graph } from '../../src/island-graph.ts';

// a build's identity (a name, no file) and its file, the iid in both names (only the same island's
// file is ever its location: runtime/code-origins.ts `is_location_of`); `?t=` keeps each test's
// module its own
const LOCATED = '/test/browser/fixtures/immutable/og-region.0000000000c1.Loc.js';
const LOCATED_ID = '/test/browser/fixtures/ogygia/og-region.0000000000c1.js';
// the dev server's module: an identity that is its own file
const IDENTITY = '/test/browser/fixtures/entry-identity.ts';
const abs = (u: string) => new URL(u, location.href).href;
const requested = (part: string) =>
	performance.getEntriesByType('resource').filter((r) => r.name.includes(part));

describe('the map', () => {
	test('an unknown entry resolves to itself', () => {
		expect(entry_location('/u/og-region.aaaaaaaaaaaa.js')).toBeUndefined();
		expect(island_module_url('/u/og-region.aaaaaaaaaaaa.js')).toBe('/u/og-region.aaaaaaaaaaaa.js');
	});

	test('a noted entry resolves to its location, absolute', () => {
		note_entry_location(
			'/n/ogygia/og-region.bbbbbbbbbbbb.js',
			'/n/og-region.bbbbbbbbbbbb.Ab12Cd34.js'
		);
		expect(island_module_url('/n/ogygia/og-region.bbbbbbbbbbbb.js')).toBe(
			abs('/n/og-region.bbbbbbbbbbbb.Ab12Cd34.js')
		);
	});

	test('relative pairs resolve against the document they were read from', () => {
		const at = `${location.origin}/deep/page/`;
		note_entry_location(
			'./_app/ogygia/og-region.cccccccccccc.js',
			'./_app/immutable/og-region.cccccccccccc.X1.js',
			at
		);
		expect(entry_location(`${at}_app/ogygia/og-region.cccccccccccc.js`)).toBe(
			`${at}_app/immutable/og-region.cccccccccccc.X1.js`
		);
		// …and the same identity written root-relative on that origin is the same key
		expect(entry_location('/deep/page/_app/ogygia/og-region.cccccccccccc.js', at)).toBe(
			`${at}_app/immutable/og-region.cccccccccccc.X1.js`
		);
	});

	test('nothing is noted for a missing location, or one that is the identity itself', () => {
		note_entry_location('/m/og-region.dddddddddddd.js', null);
		note_entry_location('/m/og-region.dddddddddddd.js', '');
		note_entry_location('/m/og-region.dddddddddddd.js', '/m/og-region.dddddddddddd.js');
		expect(entry_location('/m/og-region.dddddddddddd.js')).toBeUndefined();
		note_entry_location(null, '/m/chunks/Z.js');
		expect(entry_location('')).toBeUndefined();
	});

	test('the latest location wins (a page from a newer build, mid-session)', () => {
		note_entry_location('/w/og-region.eeeeeeeeeeee.js', '/w/og-region.eeeeeeeeeeee.Old11111.js');
		note_entry_location('/w/og-region.eeeeeeeeeeee.js', '/w/og-region.eeeeeeeeeeee.New22222.js');
		expect(island_module_url('/w/og-region.eeeeeeeeeeee.js')).toBe(
			abs('/w/og-region.eeeeeeeeeeee.New22222.js')
		);
	});

	test('an island element: its identity read, its `src` noted on the way', () => {
		const el = document.createElement('ogygia-region');
		el.setAttribute('entry', '/e/og-region.ffffffffffff.js');
		el.setAttribute('src', '/e/og-region.ffffffffffff.Ef56Gh78.js');
		expect(island_entry_of(el)).toBe('/e/og-region.ffffffffffff.js');
		expect(island_module_url('/e/og-region.ffffffffffff.js')).toBe(
			abs('/e/og-region.ffffffffffff.Ef56Gh78.js')
		);
		// no `src` (a page from before hashing, the dev server): the identity, nothing noted
		const bare = document.createElement('ogygia-region');
		bare.setAttribute('entry', '/e/og-region.000000000001.js');
		expect(island_entry_of(bare)).toBe('/e/og-region.000000000001.js');
		expect(entry_location('/e/og-region.000000000001.js')).toBeUndefined();
		expect(island_entry_of(document.createElement('ogygia-region'))).toBeNull();
	});

	test('an island graph script carries locations for entries no element has (its `s` map)', () => {
		const doc = `${location.origin}/p/`;
		const text = encode_island_graph(
			new Map([['./i/og-region.000000000002.js', ['./i/chunks/Dep.js']]]),
			new Map([['/i/og-region.000000000003.js', './i/og-region.000000000003.Snip1.js']])
		);
		register_island_graph(text, doc);
		expect(entry_location(`${location.origin}/i/og-region.000000000003.js`)).toBe(
			`${location.origin}/p/i/og-region.000000000003.Snip1.js`
		);
		// a graph without `s` (an older server) notes nothing
		register_island_graph(
			encode_island_graph(new Map([['/i/og-region.000000000004.js', []]])),
			doc
		);
		expect(entry_location(`${location.origin}/i/og-region.000000000004.js`)).toBeUndefined();
	});
});

describe('import_entry: the location, then the current build’s, once', () => {
	// a build's identities are names, no files (`fixtures/ogygia/` does not exist); the current
	// build's map sits in their app dir (`fixtures/ogygia.json`)
	const BUILD = '/test/browser/fixtures/ogygia/og-region.';
	const CURRENT_MAP = 'fixtures/ogygia.json';

	const GONE = '/test/browser/fixtures/immutable/og-region.';

	test('a known location is what gets imported', async () => {
		const identity = `${LOCATED_ID}?t=1`;
		note_entry_location(identity, `${LOCATED}?t=1`);
		const m = await import_entry<{ default: string }>(identity);
		expect(m.default).toBe('located');
		expect(requested('og-region.0000000000c1.js?t=1')).toHaveLength(0);
	});

	test('the location failing, the current build’s map names the file to load (a page that outlived its build)', async () => {
		const identity = `${BUILD}000000000aa1.js`;
		note_entry_location(identity, `${GONE}000000000aa1.Aa11Bb22.js`);
		const m = await import_entry<{ default: string }>(identity);
		expect(m.default).toBe('current');
		expect(requested('Aa11Bb22.js')).toHaveLength(1);
		expect(requested('og-region.000000000aa1.js')).toHaveLength(0); // a name, never fetched
	});

	test('no location anywhere on the page: the current build’s, without a failed load first', async () => {
		const m = await import_entry<{ default: string }>(`${BUILD}000000000aa2.js`);
		expect(m.default).toBe('current');
		expect(requested('og-region.000000000aa2.js')).toHaveLength(0);
		expect(requested(CURRENT_MAP)).toHaveLength(1); // read once for the document
	});

	test('not a build’s identity (the dev server’s module): no other file is its location, the module itself loads', async () => {
		const identity = `${IDENTITY}?t=3`;
		note_entry_location(identity, '/test/browser/fixtures/gone-Qq11Rr22.js');
		expect(entry_location(identity)).toBeUndefined();
		const m = await import_entry<{ default: string }>(identity);
		expect(m.default).toBe('identity');
		expect(requested('gone-Qq11Rr22.js')).toHaveLength(0);
	});

	test('not a build’s identity (the dev server’s module): itself, and its failure stands', async () => {
		const maps = requested(CURRENT_MAP).length;
		await expect(import_entry('/test/browser/fixtures/gone-Cc33Dd44.js')).rejects.toThrow();
		expect(requested(CURRENT_MAP)).toHaveLength(maps); // it never asks for a map
	});

	test('both gone: one try at the current build’s file, then the error stands (never a loop)', async () => {
		const identity = `${BUILD}000000000aa3.js`;
		note_entry_location(identity, `${GONE}000000000aa3.Gg77Hh88.js`);
		await expect(import_entry(identity)).rejects.toThrow();
		expect(requested('Gg77Hh88.js')).toHaveLength(1);
		expect(requested('og-region.000000000aa3.GoneToo9.js')).toHaveLength(1);
	});

	test('the current build’s map is asked past the browser cache: a fresh deploy’s map, never a stale copy', async () => {
		const file = abs('/test/browser/fixtures/nocache/ogygia.json');
		const asked: (RequestCache | undefined)[] = [];
		const real_fetch = window.fetch;
		window.fetch = (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			if (url !== file) return real_fetch(input, init);
			asked.push(init?.cache);
			return Promise.resolve(
				Response.json({
					'ogygia/og-region.0000000000c1.js': '../immutable/og-region.0000000000c1.Loc.js?t=nc'
				})
			);
		};
		try {
			const m = await import_entry<{ default: string }>(
				'/test/browser/fixtures/nocache/ogygia/og-region.0000000000c1.js'
			);
			expect(m.default).toBe('located');
		} finally {
			window.fetch = real_fetch;
		}
		expect(asked).toEqual(['no-cache']);
	});

	test('an explicit url wins over the map (the caller already resolved it)', async () => {
		const identity = `${IDENTITY}?t=5`;
		note_entry_location(identity, '/test/browser/fixtures/gone-Ii99Jj00.js');
		const m = await import_entry<{ default: string }>(identity, `${LOCATED}?t=5`);
		expect(m.default).toBe('located');
	});
});

describe('a fallback is reported (the runtime wires devtools and the beacon to it)', () => {
	test('recovered, and not: each once, with the identity and the location that failed', async () => {
		const reports: { entry: string; src: string; recovered: boolean }[] = [];
		on_entry_fallback((r) => reports.push(r));
		const ok = '/test/browser/fixtures/ogygia/og-region.000000000aa6.js';
		const GONE = '/test/browser/fixtures/immutable/og-region.';
		note_entry_location(ok, `${GONE}000000000aa6.Kk11Ll22.js`);
		await import_entry(ok);
		const bad = '/test/browser/fixtures/ogygia/og-region.000000000aa7.js';
		note_entry_location(bad, `${GONE}000000000aa7.Oo55Pp66.js`);
		await import_entry(bad).catch(() => {});
		await expect.poll(() => reports.length).toBe(2);
		expect(reports[0]).toEqual({
			entry: ok,
			src: abs(`${GONE}000000000aa6.Kk11Ll22.js`),
			recovered: true
		});
		expect(reports[1]).toMatchObject({ entry: bad, recovered: false });
		// a load that worked reports nothing
		const fine = `${LOCATED_ID}?t=8`;
		note_entry_location(fine, `${LOCATED}?t=8`);
		await import_entry(fine);
		await new Promise((r) => setTimeout(r, 50));
		expect(reports).toHaveLength(2);
	});
});

describe('the warmer goes to the location', () => {
	test('warming an identity fetches its location, and dedupes by it', async () => {
		const identity = `${LOCATED_ID}?t=6`;
		note_entry_location(identity, `${LOCATED}?t=6`);
		warm_island_module(identity);
		await expect.poll(() => requested('Loc.js?t=6').length, { timeout: 5000 }).toBe(1);
		expect(requested('og-region.0000000000c1.js?t=6')).toHaveLength(0);
		expect(is_warmed_module(identity)).toBe(true);
		expect(is_warmed_module(`${LOCATED}?t=6`)).toBe(true);
		warm_island_module(identity);
		await new Promise((r) => setTimeout(r, 100));
		expect(requested('Loc.js?t=6')).toHaveLength(1);
	});
});
