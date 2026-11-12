/**
 * THE PAGE OF A CACHED HOLE IS ITS IDENTITY, NOT THE VISITOR'S (#1031). A hole finds the page it
 * renders for from its request's Referer (server/render-page.ts `page_url_of`). That look-up is
 * ogygia's own, and the page is in the render cache key: it is not a read about the visitor. A
 * render's own read of the Referer still is, and a render that sees its page while keyed without
 * one is not kept for other pages.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as devalue from 'devalue';
import type { RequestEvent } from '@sveltejs/kit';
import { observe_reads, read_set } from '../src/plugin/reads.ts';
import { configure_islands_endpoint } from '../src/server/endpoint.ts';
import {
	cached_render,
	render_cache_clear,
	render_cache_get,
	render_cache_key
} from '../src/server/render-cache.ts';
import {
	configure_render_page,
	page_url_of,
	prepare_render_page,
	render_page
} from '../src/server/render-page.ts';

const kit_data = (data: Record<string, unknown>) =>
	`${JSON.stringify({
		type: 'data',
		nodes: [{ type: 'data', data: JSON.parse(devalue.stringify(data)), uses: {} }]
	})}\n`;

/** An anonymous visitor's hole request, asked from `page`, its personal reads observed. */
function hole_request(page: string): RequestEvent {
	const url = 'https://a.test/__ogygia__?id=1';
	const event = {
		url: new URL(url),
		request: new Request(url, { headers: { referer: page } }),
		params: {},
		route: { id: null },
		isRemoteRequest: false,
		locals: {},
		fetch: (async () =>
			new Response(kit_data({ title: 'T' }), {
				headers: { 'content-type': 'text/sveltekit-data' }
			})) as RequestEvent['fetch'],
		cookies: { get: () => undefined, getAll: () => [] }
	} as unknown as RequestEvent;
	observe_reads(event, read_set());
	return event;
}

beforeEach(() => {
	render_cache_clear();
	configure_islands_endpoint(undefined);
	configure_render_page({ warn: null });
});

describe('a cached hole render and the page it renders for (#1031)', () => {
	it('is kept when it looks up its page and reads page.data: the page is in its key', async () => {
		const event = hole_request('https://a.test/p');
		const key = render_cache_key('h1', 'p', '', page_url_of(event).href);
		const html = await cached_render(
			async () => {
				await prepare_render_page(event, undefined, true);
				const page = render_page(undefined, event)!;
				return `<p>${(page.data as { title: string }).title} ${page.url?.pathname}</p>`;
			},
			{ key, ttl: 60 }
		);
		expect(html).toBe('<p>T /p</p>');
		expect(render_cache_get(key)).toBe('<p>T /p</p>');
	});

	it('is not kept when the render reads the Referer itself', async () => {
		const event = hole_request('https://a.test/p');
		const key = render_cache_key('h2', 'p', '', page_url_of(event).href);
		await cached_render(async () => event.request.headers.get('referer') ?? '', { key, ttl: 60 });
		expect(render_cache_get(key)).toBe(null);
	});

	it('is not kept when it sees its page while keyed without one', async () => {
		const event = hole_request('https://a.test/p');
		const key = render_cache_key('h3', 'p', '', null);
		await cached_render(async () => String(render_page(undefined, event)!.url?.pathname), {
			key,
			ttl: 60
		});
		expect(render_cache_get(key)).toBe(null);
	});
});
