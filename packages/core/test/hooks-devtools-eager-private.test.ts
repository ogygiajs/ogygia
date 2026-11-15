// A BUILD WITH DEVTOOLS EVENTS ON FOR EVERY PAGE (a plugin's `b.events()` without `lazy`): each page
// carries its own request's server events, so each page is one visitor's and never shared-cached.
// Its own file: the build's flags are read once, as hooks.ts loads.
import { afterAll, expect, it, vi } from 'vitest';

vi.mock('$app/env', () => ({ building: false, browser: false, dev: false, version: 'test' }));

const g = globalThis as Record<string, unknown>;
g.__OGYGIA_DEVTOOLS__ = true;
g.__OGYGIA_DEVTOOLS_LAZY__ = false;
const { handle } = await import('../src/hooks.ts');
afterAll(() => {
	delete g.__OGYGIA_DEVTOOLS__;
	delete g.__OGYGIA_DEVTOOLS_LAZY__;
});

const DOC = '<!doctype html><html><head><title>t</title></head><body><p>page</p></body></html>';

it('a page that carries its own server events is private and never stored', async () => {
	const u = new URL('/p', 'https://app.test');
	const response = await handle()({
		event: {
			url: u,
			request: new Request(u),
			getClientAddress: () => '203.0.113.7',
			cookies: { get: () => undefined, set() {}, delete() {} },
			route: { id: '/p' },
			params: {},
			isDataRequest: false,
			setHeaders() {},
			platform: undefined,
			locals: {}
		} as never,
		resolve: async (_event, opts) =>
			new Response((await opts!.transformPageChunk!({ html: DOC, done: true })) ?? '', {
				headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=600' }
			})
	});
	expect(response.headers.get('cache-control')).toBe('private, no-store');
});
