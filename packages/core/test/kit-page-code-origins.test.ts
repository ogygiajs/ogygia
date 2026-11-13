import { describe, expect, it } from 'vitest';

const { handle } = await import('../src/hooks.ts');
const { facts_of } = await import('../src/plugin/facts.ts');

const DOC =
	'<!doctype html><html><head><title>t</title><script type="module" data-ogygia-runtime src="/og-runtime.js"></script></head><body><p>page</p></body></html>';

describe("a Kit page's runtime script (#1746)", () => {
	it('names the code origins its render learned, though Kit runs the page transform with no request store', async () => {
		const u = new URL('https://app.test/peer/q0');
		let html = '';
		await handle()({
			event: {
				url: u,
				request: new Request(u),
				getClientAddress: () => '203.0.113.7',
				cookies: { get: () => undefined },
				route: { id: '/peer/[...rest]' },
				params: { rest: 'q0' },
				isDataRequest: false,
				setHeaders() {},
				platform: undefined,
				locals: {}
			} as never,
			resolve: async (event, opts) => {
				facts_of(event.request).codeOrigins = ['https://cdn.peer.test/_app/runtime.js'];
				html = (await opts!.transformPageChunk!({ html: DOC, done: true })) ?? '';
				return new Response(html, { headers: { 'content-type': 'text/html' } });
			}
		});
		expect(html).toMatch(/<script [^>]*data-og-origins="https:\/\/cdn\.peer\.test"/);
	});
});
