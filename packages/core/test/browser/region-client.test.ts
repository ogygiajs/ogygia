// What Region renders when the browser creates it (a client navigation, an island re-creating it,
// Kit mounting fresh), for every kind of input: each mode, held values of every kind, a promise,
// holes and lakes in and out of an island, a live snippet. The browser never writes the head, an
// opaque region comes up as an empty element its own source refills, and a live region hands each
// value to its element (`applyLive`). Snapshotted byte for byte, with what reached the console.
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { createRawSnippet, flushSync, mount, setContext, unmount, type Component } from 'svelte';
import RegionUnder from '../_fixtures/RegionUnder.svelte';
import Tiny from '../_fixtures/Tiny.svelte';
import IslandWithHole from '../_fixtures/IslandWithHole.svelte';
import { REGION_BRAND } from '../../src/region.ts';
import { setNested } from '../../src/nested.ts';
import { setInLake, setInLiveSnippet } from '../../src/context.ts';

type Props = Record<string, unknown>;
const snippet = (html: string) => createRawSnippet(() => ({ render: () => html }));

const ISLAND = {
	__mode: 'island',
	__entry: '/islands/tiny.js',
	__component: Tiny,
	__props: { n: 1 }
};
const HOLE = { __mode: 'server', __entry: 'hole-a', __component: Tiny, __props: { q: 'x' } };
const LAKE = { __mode: 'lake', __entry: 'lake-a', __props: { l: 1 } };
const brand = (v: Props) => ({ [REGION_BRAND]: true, ...v });
const dual = (extra: Props = {}) =>
	brand({
		kind: 'dual',
		component: Tiny,
		props: { d: 1 },
		id: 'dual-a',
		module: '/islands/dual.js',
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

type Place = {
	nested?: boolean;
	live_snippet?: boolean;
	in_lake?: boolean;
	context?: [string, string];
};
const setup = (place: Place) => (): void => {
	if (place.nested) setNested(true, () => 'load');
	if (place.live_snippet) setInLiveSnippet(true);
	if (place.in_lake) setInLake();
	if (place.context) setContext(place.context[0], place.context[1]);
};

const lived: unknown[] = [];
let proto: { applyLive?: unknown } | null = null;
beforeAll(() => {
	if (!customElements.get('ogygia-region'))
		customElements.define('ogygia-region', class extends HTMLElement {});
	proto = customElements.get('ogygia-region')!.prototype as { applyLive?: unknown };
	Object.defineProperty(proto, 'applyLive', {
		configurable: true,
		value(this: Element, v: unknown) {
			lived.push(v);
		}
	});
});
afterAll(() => {
	if (proto) delete proto.applyLive;
});
afterEach(() => {
	document.body.innerHTML = '';
	lived.length = 0;
	vi.restoreAllMocks();
});

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

async function out(regions: Props[], place: Place = {}): Promise<string> {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const error = vi.spyOn(console, 'error').mockImplementation(() => {});
	const target = document.body.appendChild(document.createElement('div'));
	const head_before = document.head.innerHTML;
	const app = mount(RegionUnder as unknown as Component<Props>, {
		target,
		props: { setup: setup(place), regions }
	});
	flushSync();
	await settle();
	const said = [...warn.mock.calls, ...error.mock.calls].map((c) => c.map(String).join(' '));
	const text = JSON.stringify(
		{
			body: target.innerHTML,
			head_changed: document.head.innerHTML !== head_before,
			apply_live: lived,
			console: said
		},
		null,
		1
	);
	await unmount(app);
	return text;
}

const CASES: Array<[name: string, regions: Props[], place?: Place]> = [
	['island', [ISLAND]],
	['island with children', [{ ...ISLAND, children: snippet('<i>kid</i>') }]],
	['island nested in an island', [{ ...ISLAND, idle: true }], { nested: true }],
	[
		'island nested whose wrapper loads late',
		[{ ...ISLAND, __component: undefined, __load: () => Promise.resolve(Tiny) }],
		{ nested: true }
	],
	[
		'island at the top whose wrapper has no component',
		[{ ...ISLAND, __component: undefined, __load: () => Promise.resolve(Tiny) }]
	],
	[
		'island in a live snippet, with a hole in it',
		[{ __mode: 'island', __entry: '/islands/host.js', __component: IslandWithHole, __props: {} }],
		{ nested: true, live_snippet: true }
	],
	['hole', [{ ...HOLE, ogygiaFallback: snippet('<p>wait</p>') }]],
	['hole nested in an island', [HOLE], { nested: true }],
	[
		'hole in a live snippet, created fresh: its fallback, with the page contexts',
		[{ ...HOLE, ogygiaFallback: snippet('<p>wait</p>') }],
		{ nested: true, live_snippet: true, context: ['page-key', 'page-value'] }
	],
	['hole in a live snippet with no fallback', [HOLE], { nested: true, live_snippet: true }],
	['lake in the shell', [{ ...LAKE, children: snippet('<p>lake</p>') }]],
	['lake in an island', [{ ...LAKE, children: snippet('<p>lake</p>') }], { nested: true }],
	[
		'held inline value',
		[{ of: brand({ kind: 'inline', component: Tiny, props: {} }), children: snippet('<i>kid</i>') }]
	],
	['held static dual', [{ of: dual() }]],
	['held interactive dual', [{ of: dual({ hydrate: 'idle' }) }]],
	['held deferred value', [{ of: deferred(), placeholder: snippet('<p>wait</p>') }]],
	[
		'held deferred value that wakes',
		[{ of: deferred({ module: '/islands/held.js', hydrate: 'load' }) }]
	],
	[
		'held live value',
		[
			{
				of: deferred({ html: '<b>live</b>', hydrate: 'load', module: '/islands/held.js' }),
				placeholder: snippet('<p>wait</p>')
			}
		]
	],
	[
		'held live value with only children',
		[{ of: deferred({ html: '<b>live</b>' }), children: snippet('<p>kid</p>') }]
	],
	['held baked value created fresh', [{ of: deferred({ html: '<b>baked</b>' }), __baked: true }]],
	[
		'held promise',
		[
			{
				of: Promise.resolve(deferred({ html: '<b>late</b>' })),
				placeholder: snippet('<p>wait</p>')
			}
		]
	],
	[
		'held promise that never lands',
		[{ of: new Promise(() => {}), placeholder: snippet('<p>wait</p>') }]
	]
];

for (const [name, regions, place] of CASES)
	test(name, async () => {
		expect(await out(regions, place)).toMatchSnapshot();
	});
