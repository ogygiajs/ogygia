// A CONTEXT A SERVER-ROUTER PAGE SETS (#1974): the router writes its document with `document()`,
// outside Kit's render, so no page transform adds the page's context marker after it. The document
// carries it itself, or an island on the page reads nothing.
import { expect, test } from 'vitest';
import { with_request_store } from '@sveltejs/kit/internal/server';
import { parse } from 'devalue';
import { region } from '../src/region.ts';
import SetsTheme from './_fixtures/SetsTheme.svelte';

const { handle } = await import('../src/hooks.ts');
const { document } = await import('../src/document.ts');

const MARKER = /<script[^>]*data-ogygia-provide-page[^>]*>([^<]*)<\/script>/g;

test('a router page’s document carries the context its page set, once', async () => {
	const url = new URL('https://app.test/theme');
	const event = {
		url,
		request: new Request(url),
		getClientAddress: () => '203.0.113.7',
		cookies: { get: () => undefined },
		route: { id: null },
		params: {},
		isDataRequest: false,
		setHeaders() {},
		platform: undefined,
		locals: {}
	};
	let html = '';
	await with_request_store({ event, state: {} } as never, () =>
		handle()({
			event: event as never,
			resolve: async () => {
				const res = await document(region(SetsTheme as never, {} as never), {
					pageState: { url: { href: url.href }, params: {}, route: { id: '/theme' } }
				});
				html = await res.text();
				return new Response(html, res);
			}
		})
	);
	expect(html).toContain('data-sets-theme');
	const found = [...html.matchAll(MARKER)];
	expect(found, 'one page-level context marker').toHaveLength(1);
	expect(parse(found[0][1])).toEqual({ 'router-page-theme': 'forest' });
});
