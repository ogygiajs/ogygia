// THE NAVIGATION CHUNK'S PAGE FETCH (runtime/router-nav.ts), as the chunk loads: what it hands the
// rules, what each fetch asks the server, which pages it keeps, and what a prefetch warms.
import { afterAll, beforeEach, expect, test } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { KNOWN_HEADER_CAP } from '../../src/contract/known-copies.ts';
import { is_dangerous_head_node } from '../../src/runtime/head-deny.ts';
import type { PageGlobals } from '../../src/page-globals.ts';

const real_fetch = window.fetch;
const page_globals = globalThis as PageGlobals & { __OGYGIA_SERVER_DELTA__?: boolean };

/** Each request the page made, and its answer: a cacheable HTML page, or what `answer` says. */
const asked: Array<{ url: string; method: string; headers: Headers }> = [];
let answer = (url: string): Response =>
	new Response(`<!doctype html><title>${url}</title>`, {
		status: 200,
		headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=60' }
	});
window.fetch = async (input, init) => {
	const request = new Request(input, init);
	asked.push({ url: request.url, method: request.method, headers: request.headers });
	return answer(request.url);
};
const denies: unknown[] = [];
page_globals.__og_head_deny = (deny) => denies.push(deny);
page_globals.__OGYGIA_SERVER_DELTA__ = true;
link_boot();
const nav = await import('../../src/runtime/router-nav.ts');
/** The app's `fetch`, as the navigation chunk left it once loaded. */
const app_fetch = window.fetch;
delete page_globals.__OGYGIA_SERVER_DELTA__;

beforeEach(() => {
	asked.length = 0;
	nav.bust_page_cache();
	document.body.innerHTML = '';
});
afterAll(() => {
	window.fetch = real_fetch;
	delete page_globals.__og_head_deny;
});

const href = (path: string) => new URL(path, location.href).href;
const fetches_of = (path: string) => asked.filter((a) => a.url === href(path)).length;

test('the navigation chunk hands the rules its own head deny when it loads', () => {
	expect(denies).toEqual([is_dangerous_head_node]);
});

test('a page fetch names each hydrated region copy up to the first copy of its fingerprint still server markup', async () => {
	document.body.innerHTML = [
		'<ogygia-region data-og-fp="a" data-hydrated></ogygia-region>',
		'<ogygia-region data-og-fp="a" data-hydrated></ogygia-region>',
		'<ogygia-region data-og-fp="b" data-hydrated></ogygia-region>',
		'<ogygia-region data-og-fp="a"></ogygia-region>',
		'<ogygia-region data-og-fp="a" data-hydrated></ogygia-region>',
		'<ogygia-region data-og-fp="c"></ogygia-region>',
		'<ogygia-region data-og-fp="c" data-hydrated></ogygia-region>'
	].join('');
	await nav.fetch_page(href('/known-copies'));
	expect(asked[0].headers.get('x-ogygia-known')).toBe('a,a,b');
});

test('a known list past the header cap is not sent: the server renders every region', async () => {
	const fp = 'f'.repeat(64);
	const copies = Math.ceil(KNOWN_HEADER_CAP / (fp.length + 1)) + 1;
	document.body.innerHTML =
		`<ogygia-region data-og-fp="${fp}" data-hydrated></ogygia-region>`.repeat(copies);
	await nav.fetch_page(href('/known-cap'));
	expect(asked[0].headers.has('x-ogygia-known')).toBe(false);
	expect(asked[0].headers.get('x-ogygia-spa')).toBe('1');
});

test('a page fetch asks as a document navigation does, and names a prefetch or a history restore', async () => {
	await nav.fetch_page(href('/purpose-nav'));
	await nav.fetch_page(href('/purpose-prefetch'), undefined, 'prefetch');
	await nav.fetch_page(href('/purpose-history'), undefined, 'history');
	const [plain, prefetch, history] = asked;
	for (const a of asked) expect(a.headers.get('accept')).toBe(nav.DOCUMENT_ACCEPT);
	expect(plain.headers.has('x-ogygia-purpose')).toBe(false);
	expect(prefetch.headers.get('x-ogygia-purpose')).toBe('prefetch');
	expect(history.headers.get('x-ogygia-purpose')).toBe('history');
});

test.each([
	['a successful remote POST', 'POST', '/_app/remote/abc', 200, 2],
	['a remote POST under a custom app dir', 'POST', '/assets/remote?x=1', 200, 2],
	['a POST elsewhere', 'POST', '/api/save', 200, 1],
	['a remote GET', 'GET', '/_app/remote/abc', 200, 1],
	['a failed remote POST', 'POST', '/_app/remote/abc', 500, 1]
])(
	'%s: a kept page is fetched again only after a mutation landed',
	async (_, method, path, status, fetches) => {
		await nav.fetch_page(href('/kept-page'), undefined, 'prefetch');
		const plain = answer;
		answer = (url) => (url === href(path) ? new Response('{}', { status }) : plain(url));
		try {
			await app_fetch(path, { method });
		} finally {
			answer = plain;
		}
		await nav.fetch_page(href('/kept-page'), undefined, 'prefetch');
		expect(fetches_of('/kept-page')).toBe(fetches);
	}
);

test('a page sent as a file to save is no page: the router leaves it to the browser', async () => {
	const plain = answer;
	answer = () =>
		new Response('<!doctype html><title>report</title>', {
			status: 200,
			headers: {
				'content-type': 'text/html',
				'content-disposition': 'attachment; filename="report.html"'
			}
		});
	try {
		expect(await nav.fetch_page(href('/report'))).toBe(null);
	} finally {
		answer = plain;
	}
});

test('a page answered no-store is not kept: the next ask fetches it again', async () => {
	const plain = answer;
	answer = (url) =>
		new Response(`<!doctype html><title>${url}</title>`, {
			status: 200,
			headers: { 'content-type': 'text/html', 'cache-control': 'no-store' }
		});
	try {
		await nav.fetch_page(href('/not-kept'), undefined, 'prefetch');
		await nav.fetch_page(href('/not-kept'), undefined, 'prefetch');
	} finally {
		answer = plain;
	}
	expect(fetches_of('/not-kept')).toBe(2);
});

test('a prefetched page warms its island graph and the regions the browser runs, once per page', async () => {
	const graphs: string[] = [];
	const warmed: string[] = [];
	const located: string[] = [];
	const { slots } = await import('../../src/runtime/slots.ts');
	const real = { ...slots.boot! };
	slots.boot!.register_island_graph = (text) => void graphs.push(text);
	slots.boot!.warm_island_module = (entry) => void warmed.push(entry);
	slots.boot!.note_entry_location = (entry, src) => void located.push(`${entry} ${src}`);
	const plain = answer;
	answer = () =>
		new Response(
			`<!doctype html><script type="application/json" data-ogygia-graph>{"g":1}</script><ogygia-region entry="/runs.js" src="/_app/runs-1.js" wake="load"></ogygia-region><ogygia-region entry="/lake.js" wake="none"></ogygia-region>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
	try {
		await nav.fetch_page(href('/warm-page'), undefined, 'prefetch');
		await nav.fetch_page(href('/warm-page'), undefined, 'prefetch');
	} finally {
		answer = plain;
		Object.assign(slots.boot!, real);
	}
	expect(graphs).toEqual(['{"g":1}']);
	expect(warmed).toEqual(['/runs.js']);
	expect(located).toEqual(['/runs.js /_app/runs-1.js']);
});
