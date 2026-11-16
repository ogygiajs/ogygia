// A REQUEST'S BAG IS ONE PER PROCESS, like the ports that read it (src/server-ports.ts): dev serves the
// handle's module twice (#1974: from a dev server's second request on, a page's context marker was
// gone), and an app can bundle core twice. The copy whose handle serves the request and the copy
// whose recorders the render calls must find the same bag.
import { expect, test } from 'vitest';
import { with_request_store } from '@sveltejs/kit/internal/server';

const { handle } = await import('../src/hooks.ts');
// (a query makes the module loader evaluate a second, separate copy: its recorders are installed last)
await import('../src/hooks.ts?copy' as string);
const { record_ctx } = await import('../src/context-registry.ts');
const { record_page } = await import('../src/page-seed-registry.ts');

const DOC = '<!doctype html><html><head><title>t</title></head><body><p>page</p></body></html>';

test('a context set during the render reaches the page served by the other copy of the handle', async () => {
	const url = new URL('https://app.test/p');
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
			resolve: async (ev, opts) => {
				with_request_store({ event: { ...ev }, state: {} } as never, () => {
					record_page({ data: {} }, false);
					record_ctx('theme', 'forest');
				});
				html = (await opts!.transformPageChunk!({ html: DOC, done: true })) ?? '';
				return new Response(html, { headers: { 'content-type': 'text/html' } });
			}
		})
	);
	expect(html.match(/data-ogygia-provide-page/g)?.length).toBe(1);
	expect(html).toContain('forest');
});
