import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { setContext, type Component } from 'svelte';
import RegionUnder from './_fixtures/RegionUnder.svelte';
import Tiny from './_fixtures/Tiny.svelte';
import { DocumentTail, set_tail_reader } from '../src/server/document-tail.ts';
import { KIT_REQUEST_CONTEXT } from '../src/server/kit-context.ts';
import { set_request_event_stub } from './_stubs/server.request-event.ts';
import {
	set_entry_locations,
	set_island_css,
	set_island_deps
} from './_stubs/server.region-deps.ts';
import type { RegionSettings } from '../src/region-plan.ts';

vi.mock('$app/paths', () => ({
	asset: (p: string) => `/base${p.startsWith('/') ? p : `/${p}`}`,
	base: '/base',
	assets: '',
	resolve: (p: string) => `/base${p}`
}));

type Props = Record<string, unknown>;
const under = RegionUnder as unknown as Component<{ setup?: () => void; regions: Props[] }>;
const ENTRY = '/islands/tiny.js';
const SHEET = `${ENTRY}~sheet.css`;
const ISLAND: RegionSettings = { mode: 'island', entry: ENTRY, component: Tiny as never };
const GRAPH_RE = /<script type="application\/json" data-ogygia-graph>([^<]*)<\/script>/;
const OWNERS_RE = /<script type="application\/json" data-og-owners>([^<]*)<\/script>/;

beforeEach(() => {
	set_island_deps({ [ENTRY]: [`${ENTRY}~dep.js`] });
	set_island_css({ [ENTRY]: [SHEET] });
	const event = { route: { id: '/page' } };
	set_request_event_stub(() => event);
});
afterEach(() => {
	set_island_deps({});
	set_island_css({});
	set_entry_locations({});
	set_request_event_stub(null);
	set_tail_reader(null);
});

function page(regions: Props[], on_kit_pass = false) {
	const tail = on_kit_pass ? new DocumentTail() : null;
	if (tail) set_tail_reader(() => tail);
	const setup = on_kit_pass ? () => setContext(KIT_REQUEST_CONTEXT, { page: {} }) : undefined;
	const r = render(under, { props: { setup, regions } });
	return { head: r.head, body: r.body, tail: tail?.render() ?? '' };
}

describe('a region in an app with a Kit base path', () => {
	it("an island's element names its entry under the base, and its graph is keyed by that url", () => {
		const { head, body } = page([{ __og: ISLAND, __props: { n: 1 } }]);
		expect(body).toContain(`entry="/base${ENTRY}"`);
		const graph = JSON.parse(GRAPH_RE.exec(head)![1]!) as { e: Record<string, unknown> };
		expect(Object.keys(graph.e)).toEqual([`/base${ENTRY}`]);
	});

	it("an island's sheet is linked under the base", () => {
		const { head } = page([{ __og: ISLAND, __props: { n: 1 } }]);
		expect(head).toContain(`href="/base${SHEET}"`);
		expect(head).not.toContain(`href="${SHEET}"`);
	});

	it("two islands sharing a sheet on Kit's tail record its second owner under the url the page links", () => {
		const { head, tail } = page(
			[
				{ __og: ISLAND, __props: { n: 1 } },
				{ __og: ISLAND, __props: { n: 2 } }
			],
			true
		);
		expect(head.match(/data-ogygia-region-css/g)).toHaveLength(1);
		const owners = JSON.parse(OWNERS_RE.exec(tail)![1]!) as Record<string, string[]>;
		expect(Object.keys(owners)).toEqual([`/base${SHEET}`]);
		expect(owners[`/base${SHEET}`]).toHaveLength(1);
	});

	it("an island's built chunk and the chunks its graph lists are under the base", () => {
		set_entry_locations({ [ENTRY]: '/_app/immutable/tiny.hashed.js' });
		const { head, body } = page([{ __og: ISLAND, __props: { n: 1 } }]);
		expect(body).toContain('src="/base/_app/immutable/tiny.hashed.js"');
		const graph = JSON.parse(GRAPH_RE.exec(head)![1]!) as { h: string[] };
		expect(graph.h).toEqual([`/base${ENTRY}~dep.js`]);
	});

	it('a hole that wakes names its module under the base', () => {
		const hole: RegionSettings = {
			mode: 'server',
			entry: 'hole-a',
			component: Tiny as never,
			wake: 'load',
			module: '/islands/hole.js'
		};
		const { body } = page([{ __og: hole, __props: {} }]);
		expect(body).toContain('entry="/base/islands/hole.js"');
	});
});
