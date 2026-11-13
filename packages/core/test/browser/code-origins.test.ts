// CODE ORIGINS (runtime/code-origins.ts): island code loads only from the page's own origin, the
// runtime's, and the origins the server wrote on the runtime's script (a federation peer's). An
// element's `entry` / `src` is markup: one that came in some other way (a rich-text field, a
// sanitizer that keeps custom elements) must not turn into script from anywhere, nor re-point the
// code of the page's own regions.
//
// The origins are read once per document, at the first ask: the server's head is in place by then.
// This file's head names one peer before anything asks.
import { beforeAll, describe, expect, test } from 'vitest';
import {
	entry_location,
	import_entry,
	island_entry_of,
	note_entry_location
} from '../../src/runtime/entry-locations.ts';
import { warm_island_module } from '../../src/runtime/region-endpoint-url.ts';
import { code_url } from '../../src/runtime/code-origins.ts';
import {
	preload_island_graph,
	register_island_graph
} from '../../src/runtime/island-graph-preload.ts';
import { encode_island_graph } from '../../src/island-graph.ts';
import { OGYGIA_GRAPH_PRELOAD } from '../../src/wire-markup.ts';

const PEER = 'https://peer.example';
const requested = (part: string) =>
	performance.getEntriesByType('resource').filter((r) => r.name.includes(part));
const element = (entry: string, src: string) => {
	const el = document.createElement('ogygia-region');
	el.setAttribute('entry', entry);
	el.setAttribute('src', src);
	return el;
};

beforeAll(() => {
	const runtime = document.createElement('script');
	runtime.type = 'application/x-inert'; // (the attribute is what is read; nothing runs)
	runtime.setAttribute('data-ogygia-runtime', '');
	runtime.setAttribute('data-og-origins', PEER);
	document.head.prepend(runtime);
});

describe('which origins island code loads from', () => {
	test('the page’s own, and a peer the server named on the runtime’s script', () => {
		expect(code_url('/x/og-region.aaaaaaaaaaaa.js')).toBe('/x/og-region.aaaaaaaaaaaa.js');
		expect(code_url(`${PEER}/_app/immutable/og-region.aaaaaaaaaaaa.Ab12Cd34.js`)).not.toBeNull();
	});

	test('any other origin is refused', () => {
		expect(code_url('https://evil.example/x.js')).toBeNull();
		expect(code_url('//evil.example/x.js')).toBeNull();
		expect(code_url('data:text/javascript,1')).toBeNull();
		expect(code_url(`blob:${location.origin}/0000`)).toBeNull();
	});

	test('a runtime script added later does not widen the list', () => {
		const late = document.createElement('script');
		late.type = 'application/x-inert';
		late.setAttribute('data-ogygia-runtime', '');
		late.setAttribute('data-og-origins', 'https://evil.example');
		document.body.append(late);
		expect(code_url('https://evil.example/x.js')).toBeNull();
		late.remove();
	});
});

describe('an absolute entry on another origin', () => {
	test('is not imported as written: refused with its code, nothing requested', async () => {
		const entry = 'https://evil.example/_app/ogygia/og-region.111111111111.js';
		const error = await import_entry(entry).then(
			() => null,
			(e: unknown) => e as { code?: string }
		);
		expect(error?.code).toBe('island_code_refused');
		expect(requested('evil.example')).toHaveLength(0);
	});

	test('handed in as the location of a known identity: refused as a rejection, never thrown', async () => {
		const entry = '/a/_app/ogygia/og-region.444444444444.js';
		note_entry_location(entry, '/a/_app/immutable/og-region.444444444444.Ab12Cd34.js');
		let loading: Promise<unknown> | undefined;
		expect(() => {
			loading = import_entry(
				entry,
				'https://evil.example/a/_app/immutable/og-region.444444444444.Ab12Cd34.js'
			);
		}).not.toThrow();
		const error = await loading!.then(
			() => null,
			(e: unknown) => e as { code?: string }
		);
		expect(error?.code).toBe('island_code_refused');
		expect(requested('evil.example')).toHaveLength(0);
	});

	test('is not warmed either', async () => {
		warm_island_module('https://evil.example/src/lib/Island.svelte');
		await new Promise((r) => setTimeout(r, 50));
		expect(requested('evil.example')).toHaveLength(0);
	});
});

describe('an element’s `src`', () => {
	const IDENTITY = '/a/_app/ogygia/og-region.333333333333.js';

	test('cannot point an identity at another origin', () => {
		island_entry_of(
			element(IDENTITY, 'https://evil.example/a/_app/immutable/og-region.333333333333.Ab12Cd34.js')
		);
		expect(entry_location(IDENTITY)).toBeUndefined();
	});

	test('cannot point an identity at another file of the page’s own origin', () => {
		island_entry_of(element(IDENTITY, '/uploads/avatar.js'));
		island_entry_of(element(IDENTITY, '/a/_app/immutable/og-region.444444444444.Ab12Cd34.js'));
		note_entry_location(IDENTITY, '/a/_app/immutable/chunks/Ab12Cd34.js');
		expect(entry_location(IDENTITY)).toBeUndefined();
	});

	test('names the same island’s built file: kept', () => {
		island_entry_of(element(IDENTITY, '/a/_app/immutable/og-region.333333333333.Ab12Cd34.js'));
		expect(entry_location(IDENTITY)).toBe(
			new URL('/a/_app/immutable/og-region.333333333333.Ab12Cd34.js', location.href).href
		);
	});

	test('a peer’s island keeps its own file on the peer', () => {
		const identity = `${PEER}/_app/ogygia/og-region.555555555555.js`;
		note_entry_location(identity, `${PEER}/_app/immutable/og-region.555555555555.Zz9_-0Aa.js`);
		expect(entry_location(identity)).toBe(
			`${PEER}/_app/immutable/og-region.555555555555.Zz9_-0Aa.js`
		);
	});
});

describe('an island’s preload links', () => {
	test('name only chunks on the page’s code origins (#981)', () => {
		const entry = '/p/_app/ogygia/og-region.666666666666.js';
		register_island_graph(
			encode_island_graph(
				new Map([
					[
						entry,
						[
							'https://evil.example/_app/immutable/chunks/Ev1l.js',
							'/p/_app/immutable/chunks/Own1.js',
							`${PEER}/_app/immutable/chunks/Peer1.js`
						]
					]
				])
			)
		);
		preload_island_graph(entry);
		const hrefs = [...document.head.querySelectorAll(`link[${OGYGIA_GRAPH_PRELOAD}]`)].map(
			(l) => (l as HTMLLinkElement).href
		);
		expect(hrefs).toEqual([
			new URL('/p/_app/immutable/chunks/Own1.js', location.href).href,
			`${PEER}/_app/immutable/chunks/Peer1.js`
		]);
	});
});
