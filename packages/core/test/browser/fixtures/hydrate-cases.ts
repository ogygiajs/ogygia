// The regions a browser HYDRATES (Kit's pass over a csr=true document, an island's hydrate over its
// nested regions, a live snippet's body), built the same way on both legs: setup.ts renders each on
// the server, region-hydrate.test.ts hydrates the same one over that HTML.
import { createRawSnippet } from 'svelte';
import Tiny from '../../_fixtures/Tiny.svelte';
import { REGION_BRAND } from '../../../src/region.ts';
import { setNested } from '../../../src/nested.ts';
import { setInLiveSnippet } from '../../../src/context.ts';

type Props = Record<string, unknown>;
export type HydratePlace = { csr?: boolean; nested?: boolean; live_snippet?: boolean };

const snippet = (html: string) => createRawSnippet(() => ({ render: () => html }));

const ISLAND = {
	__mode: 'island',
	__entry: '/islands/tiny.js',
	__component: Tiny,
	__props: { n: 1 }
};
const HOLE = { __mode: 'server', __entry: 'hole-a', __component: Tiny, __props: { q: 'x' } };
const LAKE = { __mode: 'lake', __entry: 'lake-a', __props: { l: 1 } };
const brand = (v: Props): Props => ({ [REGION_BRAND]: true, ...v });
const dual = (extra: Props = {}) =>
	brand({
		kind: 'dual',
		component: Tiny,
		props: { d: 1 },
		id: 'dual-a',
		module: '/islands/dual.js',
		sign: () => '/signed',
		...extra
	});
const deferred = (extra: Props = {}) =>
	brand({
		kind: 'deferred',
		id: 'held-a',
		props: { h: 1 },
		url: '/__ogygia__?id=held-a',
		module: '',
		...extra
	});

/** Each case: its name, the regions (made fresh per leg: snippets are per-render values), where. */
export const HYDRATE_CASES: Array<[name: string, regions: () => Props[], place: HydratePlace]> = [
	['island on a csr=true page', () => [ISLAND], { csr: true }],
	[
		'island with children on a csr=true page',
		() => [{ ...ISLAND, children: snippet('<i>kid</i>') }],
		{ csr: true }
	],
	[
		'hole that wakes on a csr=true page',
		() => [
			{
				...HOLE,
				__hydrate: 'load',
				__module: '/islands/hole.js',
				ogygiaFallback: snippet('<p>wait</p>')
			}
		],
		{ csr: true }
	],
	['lake on a csr=true page', () => [{ ...LAKE, children: snippet('<p>lake</p>') }], { csr: true }],
	[
		'held inline value on a csr=true page',
		() => [{ of: brand({ kind: 'inline', component: Tiny, props: {} }) }],
		{ csr: true }
	],
	['held static dual on a csr=true page', () => [{ of: dual() }], { csr: true }],
	[
		'held interactive dual on a csr=true page',
		() => [{ of: dual({ hydrate: 'load' }) }],
		{ csr: true }
	],
	[
		'held deferred value on a csr=true page',
		() => [{ of: deferred(), placeholder: snippet('<p>wait</p>') }],
		{ csr: true }
	],
	[
		'held deferred value that wakes on a csr=true page',
		() => [{ of: deferred({ module: '/islands/held.js', hydrate: 'load' }) }],
		{ csr: true }
	],
	[
		'held live value on a csr=true page',
		() => [{ of: deferred({ html: '<b>live</b>' }), placeholder: snippet('<p>wait</p>') }],
		{ csr: true }
	],
	[
		'held baked value on a csr=true page',
		() => [{ of: deferred({ html: '<b>baked</b>' }), __baked: true }],
		{ csr: true }
	],
	['island nested in an island', () => [{ ...ISLAND, idle: true }], { nested: true }],
	['hole nested in an island', () => [HOLE], { nested: true }],
	[
		'lake nested in an island',
		() => [{ ...LAKE, children: snippet('<p>lake</p>') }],
		{ nested: true }
	],
	[
		'hole in a live snippet',
		() => [{ ...HOLE, ogygiaFallback: snippet('<p>wait</p>') }],
		{ nested: true, live_snippet: true }
	]
];

/** What the parents of a case's regions set in context, on either leg. */
export const place_setup = (place: HydratePlace) => (): void => {
	if (place.nested) setNested(true, () => 'load');
	if (place.live_snippet) setInLiveSnippet(true);
};
