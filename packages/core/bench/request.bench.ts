// The server request path: what the handle does to a rendered page before it leaves
// (`transformPageChunk` -> `inject_client_seeds`): locate `</head>` and `</body>`, dedupe the head
// and put the runtime first, render the document tail (hints, the island graph, every props sidecar
// against the page seed), shape and serialize the seed, the remote seed, and assemble the document
// once. Per page, on a CMS home page: a header and a footer region around 250 blocks of a
// list (~2.5 MB of markup, ~1 MB of nested `page.data`), csr=false. Then the csr=true,
// region-less, streamed, router-fetched and profiler-recording forms of the same request, the whole
// `handle()` around it (Kit's `resolve`, the response read to its end), and the helpers on their own.
//
// Each setup renders the regions the way Region.svelte does during SSR: inside Kit's request store,
// through the handle's own recorders (`record_page`, the document tail, the request's measure memo),
// into a request bag built like the handle builds it. Only the handle's work after the render is in
// the measured window.
import { bench } from '@bench/heisenbench/bench';
import { scope } from '@ogygia/machine';
import type { RequestEvent } from '@sveltejs/kit';
import * as kit_server from '@sveltejs/kit/internal/server';
import type { RequestState } from '@sveltejs/kit/internal/server';
import { __heisenbench as hooks } from '../src/hooks.ts';
import { record_page } from '../src/page-seed-registry.ts';
import { facts_of } from '../src/plugin/facts.ts';
import { SeedIndex, json_culprit, plan_seed_refs } from '../src/seed-refs.ts';
import { DocumentTail, document_tail } from '../src/server/document-tail.ts';
import { region_fingerprint } from '../src/server/fingerprint.ts';
import {
	__heisenbench as page_stream,
	settle_deferred,
	stage_deferred,
	stream_page_deferred,
	type Deferred
} from '../src/server/page-stream.ts';
import { plan_props_wire } from '../src/server/props-wire.ts';
import {
	request_stats_detailed,
	set_request_stats_sink,
	type RequestStatsSink
} from '../src/server/request-stats.ts';
import { merge_seed_ask, shape_page_data, type SeedAsk } from '../src/server/seed-shape.ts';
import { set_island_deps } from '../test/_stubs/server.region-deps.ts';
import { csr_true_routes } from '../test/_stubs/server.route-csr.ts';
import {
	content_data,
	content_document,
	dictionary_data,
	footer_config,
	header,
	island_entry,
	listing_data,
	plain_document,
	type ContentData,
	type ListingData
} from './fixtures.ts';

// Kit runs every request inside its request store (`with_request_store`, exported at runtime but
// not in Kit's types): the handle's recorders and readers find the request bag through it.
const { with_request_store } = kit_server as unknown as {
	with_request_store: <T>(store: { event: RequestEvent; state: RequestState }, fn: () => T) => T;
};

type Handle = InstanceType<typeof hooks.OgygiaHandle>;
type Bag = NonNullable<Parameters<Handle['inject_client_seeds']>[3]>;

interface Request_ {
	handle: Handle;
	html: string;
	state: RequestState;
	event: RequestEvent;
	bag: Bag;
}

interface PageOptions {
	/** the route is Kit-hydrated (csr=true): its regions sit inside lakes */
	csr?: boolean;
	/** some island's client reads `$page` (the header the site settings, the cart the session) */
	reads?: boolean;
	/** a load returned a promise the page streams */
	streamed?: boolean;
	/** a browser navigation (`sec-fetch-mode: navigate`); false: the router fetched the page */
	navigate?: boolean;
	/** values the layout passed with the drop-in `setContext` */
	context?: boolean;
	/** the site settings carry a Date and an app type (the seed leaves the JSON lane) */
	rich?: boolean;
	/** a load returned a function in `page.data` (the seed leaves out that one value) */
	function_leaf?: boolean;
	/** remote queries resolved during the render, two of them callable by the page's islands */
	remotes?: boolean;
}

const CSR_FALSE_ROUTE = '/[...path]';
const CSR_TRUE_ROUTE = '/app/[...path]';
const REMOTE_HASH = 'a1b2c3';

/** An app type the app teaches Kit with `transport` (hooks.ts `transport` export). */
class Money {
	readonly amount: number;
	readonly currency: string;
	constructor(amount: number, currency: string) {
		this.amount = amount;
		this.currency = currency;
	}
}
const TRANSPORT = {
	Money: {
		encode: (v: unknown) => v instanceof Money && [v.amount, v.currency],
		decode: ([amount, currency]: [number, string]) => new Money(amount, currency)
	}
};

/** Kit's per-request remote state: the queries the render awaited, and their results. */
function remote_state() {
	const products = Array.from({ length: 40 }, (_, i) => ({ sku: `R-${i}`, price: i * 3 }));
	const implicit = new Map<{ id?: string; type: string }, Record<string, () => unknown>>([
		[
			{ id: `${REMOTE_HASH}/products`, type: 'query' },
			{ '"home"': () => Promise.resolve(products) }
		],
		[
			{ id: `${REMOTE_HASH}/stock`, type: 'query' },
			{ '"main"': () => Promise.resolve({ open: 3 }) }
		],
		[{ id: 'f0f0f0/admin', type: 'query' }, { '""': () => Promise.resolve({ private: true }) }]
	]);
	return { implicit, data: new Map() };
}

/** The request's event and Kit state: a browser navigation to the page. */
function event_of(
	csr: boolean,
	o: { route?: string | null; navigate?: boolean; remotes?: boolean } = {}
) {
	const url = new URL(`https://example.test${csr ? '/app' : ''}/`);
	const headers: Record<string, string> = { accept: 'text/html' };
	if (o.navigate ?? true) headers['sec-fetch-mode'] = 'navigate';
	else headers['x-ogygia-spa'] = '1';
	const event = {
		url,
		params: { path: '' },
		route: { id: o.route === undefined ? (csr ? CSR_TRUE_ROUTE : CSR_FALSE_ROUTE) : o.route },
		request: new Request(url, { headers }),
		isDataRequest: false,
		isRemoteRequest: false,
		cookies: { get: () => undefined },
		setHeaders: () => {}
	} as unknown as RequestEvent;
	const state = {
		transport: TRANSPORT,
		remote: o.remotes ? remote_state() : {}
	} as unknown as RequestState;
	return { event, state };
}

/** The request bag, the way the handle builds one before it resolves the page. */
function bag_of(request: Request): Bag {
	const bag: Bag = {
		request,
		ctx: new Map(),
		page: null,
		seed_wanted: false,
		seed_keys: null,
		seed_asks: request_stats_detailed() ? new Map() : null,
		remotes_wanted: new Set(),
		tail: new DocumentTail(),
		measure_memo: new Map(),
		deferred: null,
		defer_next_id: 0,
		late: null,
		seed_reducers: null,
		facts: facts_of(request)
	};
	hooks.bags.set(request, bag);
	return bag;
}

/** The chunks one island entry's code needs (its graph), as the build lists them. */
function graph_hrefs(entry: number, length = 8): string[] {
	return Array.from(
		{ length },
		(_, k) => `/_app/immutable/chunks/${((entry * 5 + k) % 40).toString(16).padStart(4, '0')}.js`
	);
}

/** One island region's server render: its page record, its wire plan, its tail entries. */
function render_island(
	data: unknown,
	entry: string,
	graph: string[],
	props: Record<string, unknown>,
	ask: SeedAsk,
	remotes: string[] = []
): void {
	record_page({ data, form: null, error: null, status: 200 }, ask, remotes, entry);
	const tail = document_tail()!;
	const wire = plan_props_wire(props, entry);
	const fp = region_fingerprint(entry, wire.canonical);
	tail.props(fp, wire, { entry, name: 'Block', module_url: entry, wake: 'visible' });
	const hrefs = tail.graph_of(entry) ?? graph;
	tail.graph(entry, hrefs, fp, entry);
}

/** A hole region's server render: its page record, its facts in the tail. */
function render_hole(data: ContentData, i: number, csr: boolean): void {
	record_page({ data, form: null, error: null, status: 200 }, false, [], '');
	const tail = document_tail()!;
	const endpoint = `/__ogygia__/r?id=${i.toString(16)}&p=${'eyJibG9jayI6'.repeat(8)}&k=${i}`;
	if (csr) tail.hole(`h${i}`, endpoint, '');
	tail.note_hole(`hole-${i % 4}`, 'visible', null, 0, 'Recommendations', { i }, `p${i}`);
	tail.graph(island_entry(800 + (i % 4)), graph_hrefs(800 + (i % 4)));
}

/** The CMS page as the handle receives it: rendered, its regions recorded in the bag. */
function content_request(blocks: number, o: PageOptions = {}): Request_ {
	const csr = o.csr ?? false;
	if (csr) csr_true_routes.add(CSR_TRUE_ROUTE);
	const { event, state } = event_of(csr, o);
	const bag = bag_of(event.request);
	const data = content_data(blocks) as ContentData & Record<string, unknown>;
	if (o.streamed) data.recommendations = Promise.resolve({ items: [1, 2, 3] });
	if (o.rich)
		Object.assign(data.site, {
			updated: new Date(Date.UTC(2026, 8, 10)),
			floor: new Money(9.99, 'USD')
		});
	if (o.function_leaf) Object.assign(data.site, { format_price: (n: number) => `${n} USD` });
	const reads = o.reads ?? true;
	with_request_store({ event, state }, () => {
		render_island(data, island_entry(900), graph_hrefs(900), header(), reads && ['site']);
		data.page.blocks.forEach((block, i) => {
			if (i % 11 === 5) return render_hole(data, i, csr);
			// twelve block components in the list; every instance takes its block from `page.data`
			render_island(data, island_entry(i % 12), graph_hrefs(i % 12), { block, index: i }, false);
		});
		render_island(data, island_entry(901), graph_hrefs(901), footer_config(), false);
		// the cart badge reads the session (and, on a streamed page, the recommendations it awaits),
		// and calls the products and stock queries
		if (reads)
			render_island(
				data,
				island_entry(902),
				graph_hrefs(902),
				{},
				o.streamed ? ['session', 'recommendations'] : ['session'],
				[REMOTE_HASH]
			);
	});
	if (o.context) {
		bag.ctx.set('theme', { tone: 'light', density: 'comfortable' });
		bag.ctx.set('locale', { code: 'en', dir: 'ltr', currency: 'USD' });
		bag.ctx.set('nav', { active: '/', crumbs: ['Home'] });
	}
	const handle = new hooks.OgygiaHandle({});
	return { handle, html: content_document(blocks), state, event, bag };
}

/** The handle's `transformPageChunk` on one chunk, inside the request's Kit store (as Kit calls it). */
function transform(r: Request_, html = r.html): Promise<string> {
	return with_request_store({ event: r.event, state: r.state }, () =>
		r.handle.inject_client_seeds(html, r.state, r.event, r.bag)
	);
}

const seeded = async (r: Request_) => (await transform(r)).length;

bench('inject_client_seeds: a CMS page, 250 blocks, csr=false, the seed read', seeded, {
	setup: () => content_request(250),
	scale: (_ctx, k) => content_request(25 * k)
});

bench('inject_client_seeds: the CMS page, no island reads the seed', seeded, {
	setup: () => content_request(250, { reads: false }),
	scale: (_ctx, k) => content_request(25 * k, { reads: false })
});

bench('inject_client_seeds: the CMS page with setContext values for its islands', seeded, {
	setup: () => content_request(250, { context: true })
});

bench('inject_client_seeds: a seed off the JSON lane (a Date, an app type)', seeded, {
	setup: () => content_request(250, { rich: true }),
	scale: (_ctx, k) => content_request(25 * k, { rich: true })
});

bench('inject_client_seeds: a load returned a function (its field left out of the seed)', seeded, {
	setup: () => content_request(250, { function_leaf: true })
});

bench('inject_client_seeds: three remote queries resolved in the render', seeded, {
	setup: () => content_request(250, { remotes: true })
});

bench('inject_client_seeds: a csr=true page, its islands inside lakes', seeded, {
	setup: () => content_request(250, { csr: true, context: true }),
	scale: (_ctx, k) => content_request(25 * k, { csr: true, context: true })
});

bench('inject_client_seeds: a streamed load, the promise staged for the browser', seeded, {
	setup: () => content_request(250, { streamed: true }),
	scale: (_ctx, k) => content_request(25 * k, { streamed: true })
});

bench('inject_client_seeds: a streamed load the router fetched, the promise settled', seeded, {
	setup: () => content_request(250, { streamed: true, navigate: false })
});

/** A profiler recording, as the handle sees it: a store that keeps nothing and wants detail. */
const RECORDING: RequestStatsSink = {
	page: () => {},
	hole: () => {},
	batchHole: () => {},
	wantsBatchHoles: () => false,
	detailed: () => true
};
bench(
	'inject_client_seeds: the profiler recording (island rows, the seed explainer)',
	async (r) => (await transform(r)).length,
	{
		setup: () => {
			set_request_stats_sink(RECORDING);
			return content_request(250, { rich: true });
		},
		scale: (_ctx, k) => {
			set_request_stats_sink(RECORDING);
			return content_request(25 * k, { rich: true });
		},
		teardown: () => set_request_stats_sink(null)
	}
);

/** A docs page: no region rendered on it (its bag has no page record); the router injects the
 *  runtime, which hints its own chunks. */
function plain_request(sections: number, runtime_deps = 6): Request_ {
	set_island_deps({ '/og-runtime.js': graph_hrefs(700, runtime_deps) });
	const { event, state } = event_of(false);
	const bag = bag_of(event.request);
	return { handle: new hooks.OgygiaHandle(), html: plain_document(sections), state, event, bag };
}

bench('inject_client_seeds: a 2.5 MB page no region rendered on', seeded, {
	setup: () => plain_request(250),
	// (the page's bytes are never walked; the runtime's chunk list is)
	scale: (_ctx, k) => plain_request(25 * k, 6 * k)
});

/** The CMS page cut where Kit flushes a streamed render: the head chunk, then the rest. */
function streamed_chunks(blocks: number) {
	const r = content_request(blocks);
	const cut = r.html.indexOf('<body>');
	return { r, head: r.html.slice(0, cut), body: r.html.slice(cut) };
}

bench(
	'inject_client_seeds: a streamed page, its head chunk then its body chunk',
	async ({ r, head, body }) =>
		(await transform(r, head)).length + (await transform(r, body)).length,
	{
		setup: () => streamed_chunks(250),
		scale: (_ctx, k) => streamed_chunks(25 * k)
	}
);

// THE WHOLE HANDLE: `handle()` with Kit's `resolve`, which hands the render's records to the bag the
// handle made (Region.svelte fills it during the render, which is the setup's) and runs
// `transformPageChunk`; the response is then read to its end, as the server sends it.

/** Kit's `resolve` for a page rendered in the setup. */
function resolve_of(r: Request_) {
	const { facts: _facts, ...records } = r.bag;
	return async (
		event: RequestEvent,
		opts?: { transformPageChunk?: (i: { html: string; done: boolean }) => unknown }
	) => {
		Object.assign(hooks.bags.get(event.request)!, records);
		const html = (await opts!.transformPageChunk!({ html: r.html, done: true })) as string;
		return new Response(html, { headers: { 'content-type': 'text/html' } });
	};
}

function handled(blocks: number, o: PageOptions = {}) {
	const r = content_request(blocks, o);
	return { r, resolve: resolve_of(r) };
}

const through_handle = async ({ r, resolve }: ReturnType<typeof handled>) => {
	const response = await with_request_store({ event: r.event, state: r.state }, () =>
		r.handle.handle({ event: r.event, resolve: resolve as never })
	);
	return (await response.text()).length;
};

bench('handle: the CMS page, from resolve to the last byte sent', through_handle, {
	setup: () => handled(250),
	scale: (_ctx, k) => handled(25 * k)
});

bench('handle: a streamed load, the resolve script sent after the document', through_handle, {
	setup: () => handled(250, { streamed: true })
});

// THE HELPERS on their own, each on the input its loops walk.

bench(
	'seed shaping: every region’s ask folded, then the page’s slice',
	({ data, asks }) => {
		let keys = null;
		for (const ask of asks) keys = merge_seed_ask(keys, ask);
		return shape_page_data(data, keys);
	},
	{
		setup: () => asks_of(250, 8),
		scale: (_ctx, k) => asks_of(250, 8 * k)
	}
);

/** `regions` asks over a `page.data` of `keys` top-level keys (a load returning one per section):
 *  every region reads a window of them. */
function asks_of(
	regions: number,
	keys: number
): { data: Record<string, unknown>; asks: SeedAsk[] } {
	const data: Record<string, unknown> = {};
	for (let i = 0; i < keys; i++) data[`section_${i}`] = { id: i };
	const asks: SeedAsk[] = [];
	for (let r = 0; r < regions; r++) {
		if (r % 3 === 0) asks.push(false);
		else
			asks.push(Array.from({ length: Math.ceil(keys / 2) }, (_, k) => `section_${(r + k) % keys}`));
	}
	return { data, asks };
}

bench(
	'seed index: a listing page’s products indexed for references',
	({ data }) => SeedIndex.of(data).size,
	{
		setup: () => ({ data: listing_data(2500) }),
		scale: (_ctx, k) => ({ data: listing_data(250 * k) })
	}
);

// Growth: linear in the products. It was quadratic while each copied product looked through
// every seed node of its byte size for its hash (same-shaped records share a size).
bench(
	'seed refs: a list island passed copies of the page’s products',
	({ index, props }) => plan_seed_refs(index, props).count,
	{ setup: () => copies_of(2500), scale: (_ctx, k) => copies_of(250 * k) }
);

/** The whole list copied (matched by structure as one node), and every third product copied (each
 *  matched on its own). */
function copies_of(items: number): { index: SeedIndex; props: Record<string, unknown> } {
	const data = listing_data(items);
	const index = SeedIndex.of(data);
	const list = data.page.items;
	return {
		index,
		props: {
			all: structuredClone(list),
			picks: list.filter((_, i) => i % 3 === 0).map((p) => structuredClone(p))
		}
	};
}

bench(
	'stage_deferred: a listing page’s data, its promise staged',
	({ data }) => stage_deferred(data, 0).next_id,
	{ setup: () => streamed_listing(2500), scale: (_ctx, k) => streamed_listing(250 * k) }
);

function streamed_listing(items: number): { data: ListingData & { reviews: Promise<unknown> } } {
	return { data: { ...listing_data(items), reviews: Promise.resolve([]) } };
}

bench(
	'explain_seed: per page.data key, its size and why it ships',
	({ handle, data, bag }) => handle.explain_seed(data, bag.seed_keys, bag).keys.length,
	{ setup: () => explained(250), scale: (_ctx, k) => explained(25 * k) }
);

/** A listing page whose `regions` islands each read a key, rendered with the profiler's detail on. */
function explained(regions: number) {
	const { event, state } = event_of(false);
	const bag = bag_of(event.request);
	bag.seed_asks = new Map();
	const data = listing_data(regions) as ListingData & Record<string, unknown>;
	with_request_store({ event, state }, () => {
		data.page.items.forEach((item, i) => {
			const entry = island_entry(i);
			render_island(data, entry, graph_hrefs(i % 12), { item }, i % 2 ? ['site'] : ['session']);
		});
	});
	bag.tail.render(SeedIndex.of(data), true);
	return { handle: new hooks.OgygiaHandle(), data, bag };
}

bench(
	'document tail: Kit-woken islands hint their whole closures',
	({ islands }) => {
		const tail = new DocumentTail();
		for (const [fp, hrefs] of islands) tail.hints(hrefs, fp);
		return tail.size.hints;
	},
	{ setup: () => closures(20, 40), scale: (_ctx, k) => closures(20, 40 * k) }
);

function closures(islands: number, chunks: number): { islands: Array<[string, string[]]> } {
	return {
		islands: Array.from({ length: islands }, (_, i) => [
			`fp${i}`,
			graph_hrefs(i, chunks).map((h, k) => `${h}?c=${k}`)
		])
	};
}

bench(
	'csr_page_of: a routeless answer, Kit’s bootstrap looked for before </body>',
	({ html, event }) => hooks.csr_page_of(html, html.lastIndexOf('</body>'), event),
	{
		setup: () => ({ html: content_document(250), event: event_of(false, { route: null }).event }),
		scale: (ctx, k) => ({ html: content_document(25 * k), event: ctx.event })
	}
);

bench(
	'page_ctx_script: the drop-in setContext values, one script',
	({ bag }) => hooks.page_ctx_script(bag).length,
	{
		setup: () => ctx_bag(12),
		scale: (_ctx, k) => ctx_bag(12 * k)
	}
);

function ctx_bag(keys: number): { bag: Bag } {
	const bag = bag_of(new Request('https://example.test/'));
	for (let i = 0; i < keys; i++)
		bag.ctx.set(`key-${i}`, { id: i, label: `Value ${i}`, items: [i, i + 1, i + 2] });
	return { bag };
}

bench(
	'has_body_close: every chunk of a streamed 2.5 MB page',
	({ chunks }) => {
		let found = 0;
		let carry: Uint8Array = new Uint8Array(0);
		for (const chunk of chunks) {
			if (page_stream.has_body_close(carry, chunk)) found++;
			carry = chunk.subarray(Math.max(0, chunk.length - 6));
		}
		return found;
	},
	{
		setup: () => ({ chunks: chunks_of(content_document(250)) }),
		scale: (_ctx, k) => ({ chunks: chunks_of(content_document(25 * k)) })
	}
);

/** The page as the server streams it: 16 KB chunks, cut anywhere (one cut inside `</body>`). */
function chunks_of(html: string): Uint8Array[] {
	const bytes = new TextEncoder().encode(html);
	const at = new TextEncoder().encode(html.slice(0, html.lastIndexOf('</body>') + 3)).length;
	const out: Uint8Array[] = [];
	for (let i = 0; i < bytes.length;) {
		const end = i < at && at < i + 16384 ? at : i + 16384;
		out.push(bytes.subarray(i, end));
		i = end;
	}
	return out;
}

bench('seed index: a page.data dictionary (prices by SKU)', ({ data }) => SeedIndex.of(data).size, {
	setup: () => ({ data: dictionary_data(2500) }),
	scale: (_ctx, k) => ({ data: dictionary_data(250 * k) })
});

bench(
	'seed refs: copies of the page’s list and dictionary, each matched whole',
	({ index, props }) => plan_seed_refs(index, props).count,
	{ setup: () => whole_copies(2500), scale: (_ctx, k) => whole_copies(250 * k) }
);

function whole_copies(entries: number): { index: SeedIndex; props: Record<string, unknown> } {
	const data = { ...listing_data(entries), prices: dictionary_data(entries).prices };
	return {
		index: SeedIndex.of(data),
		props: { items: structuredClone(data.page.items), prices: structuredClone(data.prices) }
	};
}

bench(
	'json_culprit: why the seed left the JSON lane, a Date after a long dictionary',
	({ data }) => json_culprit(data),
	{ setup: () => dated_prices(2500), scale: (_ctx, k) => dated_prices(250 * k) }
);

function dated_prices(entries: number): { data: Record<string, unknown> } {
	const data = dictionary_data(entries);
	return {
		data: { ...data, prices: { ...data.prices, updated: new Date(Date.UTC(2026, 8, 10)) } }
	};
}

bench(
	'shape_page_data: the read slice of a page.data of many sections',
	({ data, keys }) => shape_page_data(data, keys),
	{ setup: () => sections_of(400), scale: (_ctx, k) => sections_of(40 * k) }
);

function sections_of(count: number): { data: Record<string, unknown>; keys: Set<string> } {
	const data: Record<string, unknown> = {};
	const keys = new Set<string>();
	for (let i = 0; i < count; i++) {
		data[`section_${i}`] = { id: i };
		if (i % 4 !== 3) keys.add(`section_${i}`);
	}
	return { data, keys };
}

bench(
	'settle_deferred: a listing page’s data settled for the router (its promise awaited)',
	async ({ data }) => ((await settle_deferred(data)) as ListingData).page.items.length,
	{ setup: () => streamed_listing(2500), scale: (_ctx, k) => streamed_listing(250 * k) }
);

bench(
	'stream_page_deferred: one resolve script per promise, nested ones too',
	async ({ deferred }) => {
		const page = new Response('<!doctype html><html><body><p>page</p></body></html>');
		// (the request's owner: the response streams under it)
		const request = scope();
		return (await stream_page_deferred(request, page, deferred, deferred.length).text()).length;
	},
	{ setup: () => promises_of(40), scale: (_ctx, k) => promises_of(40 * k) }
);

/** A dashboard's streamed widgets: one promise each, every fifth resolving to a value that holds
 *  one more. */
function promises_of(count: number): { handle: Handle; deferred: Deferred[] } {
	const deferred: Deferred[] = Array.from({ length: count }, (_, id) => ({
		id,
		promise: Promise.resolve(
			id % 5 === 0
				? { rows: [id, id + 1], more: Promise.resolve({ total: id }) }
				: { rows: [id, id + 1, id + 2] }
		)
	}));
	return { handle: new hooks.OgygiaHandle(), deferred };
}

bench(
	'build_remote_seed_script: a page of many remote queries',
	({ handle, state, wanted }) => handle.build_remote_seed_script(state, wanted),
	{ setup: () => remotes_of(24, 8), scale: (_ctx, k) => remotes_of(24 * k, 8) }
);

bench(
	'build_remote_seed_script: one query answering a long list',
	({ handle, state, wanted }) => handle.build_remote_seed_script(state, wanted),
	{ setup: () => remotes_of(1, 400), scale: (_ctx, k) => remotes_of(1, 400 * k) }
);

/** Kit's remote state after a render that awaited `queries` queries of `rows` rows each, every
 *  fourth one no island on the page can call. */
function remotes_of(queries: number, rows: number) {
	const implicit = new Map<{ id?: string; type: string }, Record<string, () => unknown>>();
	for (let q = 0; q < queries; q++) {
		const value = Array.from({ length: rows }, (_, i) => ({ sku: `R-${q}-${i}`, price: i * 3 }));
		const hash = q % 4 === 3 ? 'f0f0f0' : REMOTE_HASH;
		implicit.set(
			{ id: `${hash}/query_${q}`, type: 'query' },
			{ [`"${q}"`]: () => Promise.resolve(value) }
		);
	}
	const state = {
		transport: TRANSPORT,
		remote: { implicit, data: new Map() }
	} as unknown as RequestState;
	return { handle: new hooks.OgygiaHandle(), state, wanted: new Set([REMOTE_HASH]) };
}
