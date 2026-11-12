// SERVER-DELTA NAVIGATION IS OPT-IN (`router: { serverDelta: true }`, compiled to
// `__OGYGIA_SERVER_DELTA__`). With it, a router navigation names the regions the page already shows
// (`x-ogygia-known`) and the server skips their content. Off, the server does not honor the header
// (anyone can send it). On, a page says it varies by it, so a shared cache never keeps a copy with
// regions skipped for a visitor who asked for the whole page.
import { describe, it, expect, afterEach } from 'vitest';
import { set_request_event_stub } from './_stubs/server.request-event.ts';

const { reuse_known_region } = await import('../src/server/region-endpoint.ts');
const { handle } = await import('../src/hooks.ts');

const flag = globalThis as { __OGYGIA_SERVER_DELTA__?: boolean };
afterEach(() => {
	set_request_event_stub(null);
	delete flag.__OGYGIA_SERVER_DELTA__;
});

const delta_request = () =>
	new Request('https://app.test/', {
		headers: { 'x-ogygia-spa': '1', 'x-ogygia-known': 'f00dfeed,deadbeef' }
	});

describe('server-delta: the x-ogygia-known header', () => {
	it('is ignored when the app did not opt into serverDelta', () => {
		const request = delta_request();
		set_request_event_stub(() => ({ request }));
		expect(reuse_known_region('f00dfeed')).toBe(false);
		expect(reuse_known_region('deadbeef')).toBe(false);
	});

	it('is read when the app opted in', () => {
		flag.__OGYGIA_SERVER_DELTA__ = true;
		const request = delta_request();
		set_request_event_stub(() => ({ request }));
		expect(reuse_known_region('f00dfeed')).toBe(true);
		expect(reuse_known_region('deadbeef')).toBe(true);
		expect(reuse_known_region('0badc0de')).toBe(false);
	});

	it('when the app opted in, a page says it varies by the header', async () => {
		flag.__OGYGIA_SERVER_DELTA__ = true;
		const u = new URL('https://app.test/');
		const res = await handle()({
			event: {
				url: u,
				request: delta_request(),
				getClientAddress: () => '203.0.113.7',
				cookies: { get: () => undefined },
				route: { id: '/' },
				params: {},
				isDataRequest: false,
				setHeaders() {},
				platform: undefined,
				locals: {}
			},
			resolve: async () =>
				new Response('<!doctype html><html><head></head><body></body></html>', {
					headers: { 'content-type': 'text/html' }
				})
		} as never);
		const vary = (res.headers.get('vary') ?? '').toLowerCase();
		expect(vary).toContain('x-ogygia-spa');
		expect(vary).toContain('x-ogygia-known');
	});
});
