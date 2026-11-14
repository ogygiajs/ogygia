// What Region renders on the server, byte for byte, for every kind of input: each mode, each wake
// schedule, held values of every kind, a promise, holes and lakes in and out of an island, a live
// snippet, a lake's inside, csr=true and csr=false documents, Kit's page pass with its tail, an
// error page, and dev and production. The build's answers (deps, sheets, locations, endpoints) are
// stand-ins that name their inputs, so a change to what Region asks for shows in the output.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { render } from 'svelte/server';
import { normalize_hashes } from './_normalize-hashes.ts';
import { setContext, type Component } from 'svelte';

const build = vi.hoisted(() => ({ known: new Set<string>() }));
vi.mock('ogygia:server/region-endpoint', async (original) => ({
	...((await original()) as object),
	hole_css: (entry: string) => [`/holes/${entry}.css`],
	mint_server_region: (entry: string, props: unknown, ttl: number, wakes: boolean) =>
		`/__ogygia__?id=${entry}&p=${encodeURIComponent(JSON.stringify(props))}&ttl=${ttl}&w=${wakes}`,
	make_region_endpoint: (entry: string, props: unknown) =>
		`/__ogygia__?lake=${entry}&p=${encodeURIComponent(JSON.stringify(props))}`,
	reuse_known_region: (fp: string) => build.known.delete(fp)
}));

(globalThis as unknown as { __OGYGIA_DEVTOOLS__: boolean }).__OGYGIA_DEVTOOLS__ = true;
const { set_server_devtools_recorder } = await import('../src/events/server-registry.ts');
const { set_page_recorder } = await import('../src/page-seed-registry.ts');
const { take_early_holes } = await import('../src/context.ts');
const { set_building } = await import('./_stubs/app-env.ts');
const { default: Tiny } = await import('./_fixtures/Tiny.svelte');
const { default: IslandWithHole } = await import('./_fixtures/IslandWithHole.svelte');
const { default: Wrap } = await import('./_fixtures/Wrap.svelte');
const { default: EventProbe } = await import('./_fixtures/EventProbe.svelte');
const { default: RegionC } = await import('../src/Region.svelte');
const region_fn = RegionC as unknown as (r: unknown, p: unknown) => void;
const { REGION_BRAND } = await import('../src/region.ts');
const { set_request_event_stub } = await import('./_stubs/server.request-event.ts');
const { csr_true_routes, error_csr_true_routes } = await import('./_stubs/server.route-csr.ts');
const { setNested } = await import('../src/nested.ts');
const { setInLake, setInLiveSnippet } = await import('../src/context.ts');
const { KIT_REQUEST_CONTEXT, set_kit_event_reader, set_render_page_port } =
	await import('../src/server/kit-context.ts');
const { og_portable, hole_slot_sequence, HOLE_SLOT_SEQUENCE } =
	await import('../src/region-snippet.ts');
const { default: SnippetProp } = await import('./_fixtures/SnippetProp.svelte');
const { DocumentTail, set_tail_reader } = await import('../src/server/document-tail.ts');
const { page } = await import('./_stubs/app-state.ts');
const deps = await import('./_stubs/server.region-deps.ts');

const LIVE_ENTRY = '/_app/ogygia/og-region.abc123.js';
const ENTRIES = [
	'/islands/tiny.js',
	'/islands/host.js',
	'/islands/dual.js',
	'/islands/hole.js',
	'/islands/held.js',
	LIVE_ENTRY
];
beforeAll(() => {
	deps.set_island_deps(
		Object.fromEntries(ENTRIES.map((e) => [e, [`${e}~dep-a.js`, `${e}~dep-b.js`]]))
	);
	deps.set_island_css(Object.fromEntries(ENTRIES.map((e) => [e, [`${e}~sheet.css`]])));
	deps.set_entry_locations(Object.fromEntries(ENTRIES.map((e) => [e, `${e}.hashed.js`])));
	deps.set_content_css({ 'post-1': ['/content/post-1.css'] });
});
afterAll(() => {
	deps.set_island_deps({});
	deps.set_island_css({});
	deps.set_entry_locations({});
	deps.set_content_css({});
});

type Props = Record<string, unknown>;
type Renderer = { push(html: string): void };
const snippet =
	(html: string) =>
	(r: Renderer): void =>
		r.push(html);

const ISLAND = {
	__mode: 'island',
	__entry: '/islands/tiny.js',
	__component: Tiny,
	__props: { n: 1 }
};
const HOLE = { __mode: 'server', __entry: 'hole-a', __component: Tiny, __props: { q: 'x' } };
const LAKE = {
	__mode: 'lake',
	__entry: 'lake-a',
	__props: { l: 1 },
	children: snippet('<p>lake</p>')
};

const dual = (extra: Props = {}) => ({
	[REGION_BRAND]: true,
	kind: 'dual',
	component: Tiny,
	props: { d: 1 },
	id: 'dual-a',
	module: '/islands/dual.js',
	sign: () => '/signed',
	...extra
});
const deferred = (extra: Props = {}) => ({
	[REGION_BRAND]: true,
	kind: 'deferred',
	id: 'held-a',
	props: { h: 1 },
	url: '/__ogygia__?id=held-a',
	module: '',
	...extra
});
const live = () => og_portable(snippet('<u>live</u>') as never, Tiny, { k: 1 }, LIVE_ENTRY);
const inline = (extra: Props = {}) => ({
	[REGION_BRAND]: true,
	kind: 'inline',
	component: Tiny,
	props: {},
	...extra
});

/** Where a region renders: what its parents set in context, and the document around it. */
type Place = {
	nested?: boolean;
	live_snippet?: boolean;
	in_lake?: boolean;
	kit_pass?: boolean;
	ogygia_root?: boolean;
	csr?: boolean;
	error?: boolean;
	building?: boolean;
	warn?: boolean;
	hole_answer?: boolean;
	page_version?: boolean;
};

const { default: RegionUnder } = await import('./_fixtures/RegionUnder.svelte');
const under = RegionUnder as unknown as Component<{ setup: () => void; regions: Props[] }>;
const setup = (place: Place) => (): void => {
	if (place.nested) setNested(true, () => 'load');
	if (place.live_snippet) setInLiveSnippet(true);
	if (place.in_lake) setInLake();
	if (place.kit_pass) setContext(KIT_REQUEST_CONTEXT, { page: {} });
	if (place.ogygia_root) setContext(KIT_REQUEST_CONTEXT, { page: {}, event: {} });
	if (place.hole_answer) setContext(HOLE_SLOT_SEQUENCE, hole_slot_sequence('abcdef0123'));
};

let tail: InstanceType<typeof DocumentTail> | null = null;
afterEach(() => {
	set_request_event_stub(null);
	set_tail_reader(null);
	set_kit_event_reader(null);
	set_render_page_port(null);
	csr_true_routes.clear();
	error_csr_true_routes.clear();
	page.error = null;
	build.known.clear();
	tail = null;
});

/** One request's render of `regions`, placed at `place`: head, body and (on Kit's pass) the tail. */
function out(regions: Props[], place: Place = {}): string {
	const route = place.csr ? '/csr' : '/plain';
	if (place.csr) (place.error ? error_csr_true_routes : csr_true_routes).add(route);
	if (place.error) page.error = new Error('not found');
	const event = {
		route: { id: route },
		request: new Request(`https://app.test${route}`),
		url: new URL(`https://app.test${route}`),
		locals: { user: 'ada' }
	};
	set_request_event_stub(() => event);
	set_kit_event_reader(() => event);
	if (place.kit_pass) {
		tail = new DocumentTail();
		const t = tail;
		set_tail_reader(() => t);
	}
	if (place.page_version)
		set_render_page_port({ ready: () => {}, tail: () => '', version: (id) => `&pv=${id}` });
	const events: unknown[] = [];
	const records: unknown[] = [];
	set_server_devtools_recorder((e) => events.push(e));
	set_page_recorder((_snap, seed, remotes, entry) => records.push({ seed, remotes, entry }));
	set_building(!!place.building);
	const warned = vi.mocked(console.warn);
	warned.mockClear();
	let r: { head: string; body: string };
	try {
		r = render(under, { props: { setup: setup(place), regions } });
		r = { head: r.head, body: r.body };
	} finally {
		set_server_devtools_recorder(null);
		set_page_recorder(null);
		set_building(false);
	}
	const parts = [`<!-- head -->${r.head}`, `<!-- body -->${r.body}`];
	if (tail) parts.push(`<!-- tail -->${tail.render(null, true)}`);
	if (tail) parts.push(`<!-- tail holes -->${JSON.stringify(tail.hole_rows())}`);
	if (tail) parts.push(`<!-- tail islands -->${JSON.stringify(tail.island_rows())}`);
	parts.push(`<!-- early holes -->${take_early_holes(event.request).join(' ')}`);
	parts.push(`<!-- page records -->${JSON.stringify(records)}`);
	parts.push(`<!-- devtools -->${JSON.stringify(events)}`);
	parts.push(`<!-- warnings -->${JSON.stringify(warned.mock.calls.map((c) => String(c[0])))}`);
	return parts.join('\n');
}

const CASES: Array<[name: string, regions: Props[], place?: Place]> = [
	['island, wake load', [{ ...ISLAND, load: true }]],
	['island, wake idle', [{ ...ISLAND, idle: true }]],
	['island, wake visible', [{ ...ISLAND, visible: true }]],
	['island, wake visible with a margin', [{ ...ISLAND, visible: '200px' }]],
	['island, wake on a media query', [{ ...ISLAND, media: '(min-width: 600px)' }]],
	['island, wake on interaction', [{ ...ISLAND, interaction: true }]],
	['island, kept across navigations', [{ ...ISLAND, __keep: 'nav' }]],
	['island with children', [{ ...ISLAND, children: snippet('<i>kid</i>') }]],
	['island with a snippet prop', [{ ...ISLAND, __props: { s: snippet('<u>s</u>') } }]],
	['island with no location', [{ ...ISLAND, __entry: '/no-location/x.js' }]],
	['island, twice in one request', [ISLAND, ISLAND]],
	[
		'island nested in an island',
		[{ ...ISLAND, children: snippet('<i>kid</i>') }],
		{ nested: true }
	],
	['island nested, its own wake', [{ ...ISLAND, idle: true }], { nested: true }],
	['island on a csr=true page', [ISLAND, ISLAND], { csr: true }],
	['island on a csr=true page, idle', [{ ...ISLAND, idle: true }], { csr: true }],
	['island on a csr=true page inside a lake', [ISLAND], { csr: true, in_lake: true }],
	[
		'island on a csr=true page in a root ogygia started',
		[ISLAND],
		{ csr: true, ogygia_root: true }
	],
	['island on a csr=true error page', [ISLAND], { csr: true, error: true }],
	[
		'island in a live snippet',
		[{ __mode: 'island', __entry: '/islands/host.js', __component: IslandWithHole, __props: {} }],
		{ nested: true, live_snippet: true }
	],
	[
		'island with a hole, in the page',
		[{ __mode: 'island', __entry: '/islands/host.js', __component: IslandWithHole, __props: {} }]
	],
	['island in Kit page pass', [ISLAND, { ...ISLAND, idle: true }], { kit_pass: true }],
	['island in Kit page pass, csr=true', [ISLAND], { kit_pass: true, csr: true }],
	[
		'island whose wrapper loads late',
		[{ ...ISLAND, __component: undefined, __load: () => Promise.resolve(Tiny) }],
		{ nested: true }
	],
	['hole, defer load', [HOLE]],
	[
		'hole, defer idle, wakes visible',
		[
			{
				...HOLE,
				__defer: 'idle',
				__hydrate: 'visible',
				__module: '/islands/hole.js',
				__hydrateMargin: '50px',
				__margin: '10px'
			}
		]
	],
	[
		'hole, stitched and prefetched',
		[{ ...HOLE, __stitch: 'edge', __prefetch: 'idle', __cacheTtl: 60 }]
	],
	['hole with a fallback', [{ ...HOLE, ogygiaFallback: snippet('<p>wait</p>') }]],
	['hole, twice in one request', [HOLE, HOLE]],
	['hole nested in an island', [HOLE], { nested: true }],
	[
		'hole in a live snippet',
		[{ ...HOLE, ogygiaFallback: snippet('<p>wait</p>') }],
		{ nested: true, live_snippet: true }
	],
	[
		'hole on a csr=true page',
		[{ ...HOLE, __hydrate: 'load', __module: '/islands/hole.js' }],
		{ csr: true }
	],
	[
		'hole in Kit page pass, csr=true',
		[{ ...HOLE, __hydrate: 'load', __module: '/islands/hole.js' }],
		{ kit_pass: true, csr: true }
	],
	[
		'hole in Kit page pass, csr=false, wakes',
		[{ ...HOLE, __hydrate: 'load', __module: '/islands/hole.js' }],
		{ kit_pass: true }
	],
	['lake in the shell', [LAKE]],
	['lake in an island, cache', [LAKE], { nested: true }],
	[
		'lake in an island, swr',
		[
			{
				...LAKE,
				__remount: 'swr',
				__when: 'idle',
				__margin: '5px',
				__maxAge: 30,
				__onExpire: 'fetch'
			}
		],
		{ nested: true }
	],
	['lake on a csr=true page', [LAKE], { csr: true }],
	['held inline value', [{ of: inline(), children: snippet('<i>kid</i>') }]],
	['held inline content value', [{ of: inline({ content_id: 'post-1' }) }]],
	['held static dual', [{ of: dual() }]],
	['held interactive dual', [{ of: dual({ hydrate: 'idle', hydrateMargin: '9px' }) }]],
	['held interactive dual on a csr=true page', [{ of: dual({ hydrate: 'load' }) }], { csr: true }],
	['held deferred value', [{ of: deferred(), placeholder: snippet('<p>wait</p>') }]],
	[
		'held deferred value that wakes',
		[{ of: deferred({ module: '/islands/held.js', hydrate: 'load', hydrateMargin: '3px' }) }]
	],
	[
		'held live value',
		[{ of: deferred({ html: '<b>live</b>' }), placeholder: snippet('<p>wait</p>') }]
	],
	[
		'held live value, children as the placeholder',
		[{ of: deferred({ html: '<b>live</b>' }), children: snippet('<p>kid</p>') }]
	],
	['held baked value', [{ of: deferred({ html: '<b>baked</b>' }), __baked: true }]],
	['held promise', [{ of: new Promise(() => {}), placeholder: snippet('<p>wait</p>') }]],
	['held promise with no waiting UI', [{ of: new Promise(() => {}) }]],
	[
		'held promise, children as the waiting UI',
		[{ of: new Promise(() => {}), children: snippet('<p>kid</p>') }]
	],
	[
		'held promise of an awaitable dual is a value',
		// oxlint-disable-next-line unicorn/no-thenable -- an awaitable dual is thenable by design (region.ts AwaitableRegion)
		[{ of: Object.assign(dual({ hydrate: 'load' }), { then: () => {} }) }]
	],
	['hole in a prerender', [HOLE], { building: true }],
	['hole, defer visible', [{ ...HOLE, __defer: 'visible' }]],
	[
		'island with children that render',
		[{ ...ISLAND, __component: Wrap, children: snippet('<i>kid</i>') }]
	],
	[
		'island whose children hold an island',
		[
			{
				...ISLAND,
				__component: Wrap,
				children: (r: Renderer) => region_fn(r, { ...ISLAND, idle: true })
			}
		]
	],
	[
		'island reading the request, in Kit page pass',
		[{ ...ISLAND, __component: EventProbe }],
		{ kit_pass: true }
	],
	[
		'hole whose fallback holds an island, in Kit page pass',
		[{ ...HOLE, ogygiaFallback: (r: Renderer) => region_fn(r, ISLAND) }],
		{ kit_pass: true }
	],
	[
		'hole in a live snippet, in Kit page pass',
		[HOLE],
		{ kit_pass: true, nested: true, live_snippet: true }
	],
	[
		'hole in Kit page pass',
		[
			HOLE,
			{ ...HOLE, __defer: 'idle', __hydrate: 'load', __module: '/islands/hole.js', __cacheTtl: 30 }
		],
		{ kit_pass: true }
	],
	['nothing held', [{}]],
	[
		'island rendering a snippet prop',
		[{ ...ISLAND, __component: SnippetProp, __props: { s: snippet('<u>s</u>') } }]
	],
	[
		'island nested in an island, rendering a snippet prop',
		[{ ...ISLAND, __component: SnippetProp, __props: { s: snippet('<u>s</u>') } }],
		{ nested: true }
	],
	[
		'island on a csr=true page, rendering a snippet prop',
		[{ ...ISLAND, __component: SnippetProp, __props: { s: snippet('<u>s</u>') } }],
		{ csr: true }
	],
	['island with a live snippet prop', [{ ...ISLAND, __props: { s: live() } }]],
	[
		'island with a live snippet prop, in Kit page pass',
		[{ ...ISLAND, __props: { s: live() } }],
		{ kit_pass: true }
	],
	[
		'island with children, in a hole answer',
		[{ ...ISLAND, children: snippet('<i>kid</i>') }],
		{ hole_answer: true }
	],
	['hole rendered for a page', [HOLE], { page_version: true }]
];

for (const dev of [true, false])
	describe(dev ? 'dev' : 'production', () => {
		beforeEach(() => {
			vi.stubEnv('DEV', dev);
			vi.spyOn(console, 'warn').mockImplementation(() => {});
		});
		afterEach(() => {
			vi.unstubAllEnvs();
			vi.restoreAllMocks();
		});
		for (const [name, regions, place] of CASES)
			it(name, () => {
				expect(normalize_hashes(out(regions, place))).toMatchSnapshot();
			});
		const KNOWN: Array<[name: string, island: Props]> = [
			['island the browser already has, on a navigation that names it', ISLAND],
			[
				'island with children the browser already has',
				{ ...ISLAND, __component: Wrap, children: snippet('<i>kid</i>') }
			],
			['cached island the browser already has', { ...ISLAND, __cacheTtl: 60 }]
		];
		for (const [name, island] of KNOWN)
			it(name, () => {
				(globalThis as { __OGYGIA_SERVER_DELTA__?: boolean }).__OGYGIA_SERVER_DELTA__ = true;
				try {
					const fp = /data-og-fp="([0-9a-f]+)"/.exec(out([island]))![1];
					build.known.add(fp);
					expect(normalize_hashes(out([island]))).toMatchSnapshot();
				} finally {
					delete (globalThis as { __OGYGIA_SERVER_DELTA__?: boolean }).__OGYGIA_SERVER_DELTA__;
				}
			});
	});

test("in Kit's page pass, a page with an island three times asks the build for its graph once", () => {
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	const asked: string[] = [];
	const known = Object.fromEntries(ENTRIES.map((e) => [e, [`${e}~dep-a.js`]]));
	deps.set_island_deps(
		new Proxy(known, {
			get: (map, key) => {
				if (typeof key === 'string') asked.push(key);
				return map[key as string];
			}
		})
	);
	try {
		out([ISLAND, ISLAND, { ...ISLAND, idle: true }], { kit_pass: true });
	} finally {
		deps.set_island_deps(
			Object.fromEntries(ENTRIES.map((e) => [e, [`${e}~dep-a.js`, `${e}~dep-b.js`]]))
		);
		vi.restoreAllMocks();
	}
	expect(asked.filter((k) => k === ISLAND.__entry)).toEqual([ISLAND.__entry]);
});

test("an island's graph lists each chunk once, leaving out the island's own module, when a live snippet's module shares them", () => {
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	const self = ISLAND.__entry;
	deps.set_island_deps({
		[ISLAND.__entry]: ['/chunks/shared.js', '/chunks/a.js'],
		[LIVE_ENTRY]: ['/chunks/shared.js', self, '/chunks/b.js']
	});
	let head: string;
	try {
		head = out([{ ...ISLAND, __props: { s: live() } }]).split('<!-- body -->')[0]!;
	} finally {
		deps.set_island_deps(
			Object.fromEntries(ENTRIES.map((e) => [e, [`${e}~dep-a.js`, `${e}~dep-b.js`]]))
		);
		vi.restoreAllMocks();
	}
	const graph = /<script type="application\/json" data-ogygia-graph>([^<]*)<\/script>/.exec(head);
	expect(graph, head).not.toBeNull();
	expect(JSON.parse(graph![1]!)).toEqual({
		h: ['/chunks/shared.js', '/chunks/a.js', `${LIVE_ENTRY}.hashed.js`, '/chunks/b.js'],
		e: { [ISLAND.__entry]: [0, 1, 2, 3] },
		s: { [LIVE_ENTRY]: `${LIVE_ENTRY}.hashed.js` }
	});
});

test('the real hashes: what the tables show as placeholders, for a few inputs', () => {
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const hashes = (regions: Props[], place: Place = {}) =>
			out(regions, place).match(
				/data-og-(?:fp|hole|lake)="[0-9a-f]{16}"|"s[0-9a-f]{16}"|slot:og[0-9a-z]+-1/g
			);
		expect(hashes([{ ...ISLAND, load: true }])).toEqual(['data-og-fp="7dd6306730e68332"']);
		expect(hashes([HOLE])).toContain('data-og-hole="6c88c728d5741256"');
		expect(hashes([LAKE], { nested: true })).toContain('data-og-lake="7c63ab05a88aab38"');
		expect(hashes([{ ...ISLAND, __props: { s: snippet('<u>s</u>') } }])).toContain(
			'"se9de2e38b5c3313b"'
		);
		expect(hashes([{ ...ISLAND, children: snippet('<i>kid</i>') }])).toEqual(
			expect.arrayContaining(['data-og-fp="c2690e78672f61b6"', 'slot:ogsrnm90-1'])
		);
	} finally {
		vi.restoreAllMocks();
	}
});
