// THE DEV CSS BRIDGE'S SCOPE IS THE ROUTE GROUP'S NAME, AS THE PLUGIN DERIVES IT. The handle stamps
// the page's first route segment in `<meta name="ogygia-dev-scope">`; the bridge joins a changed
// stylesheet only when that scope is among the owners the plugin derives from the module graph
// (compiler dev/css-scope.ts, the folder name as it is). A segment the meta changed matches nothing.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/dev-hmr-url.ts', () => ({ dev_hmr_url: '/@id/ogygia:dev/hmr' }));

const { handle } = await import('../src/hooks.ts');

const DOC = '<!doctype html><html><head><title>t</title></head><body><p>page</p></body></html>';
const SCOPE_RE = /<meta name="ogygia-dev-scope" content="([^"]*)">/;

/** The attribute value as a browser reads it. */
function attr_value(raw: string): string {
	return raw.replaceAll('&quot;', '"').replaceAll('&amp;', '&');
}

async function scope_of(route_id: string): Promise<string | null> {
	const u = new URL('https://app.test/x');
	let html = '';
	await handle()({
		event: {
			url: u,
			request: new Request(u),
			getClientAddress: () => '203.0.113.7',
			cookies: { get: () => undefined },
			route: { id: route_id },
			params: {},
			isDataRequest: false,
			setHeaders() {},
			platform: undefined,
			locals: {}
		} as never,
		resolve: async (_event, opts) => {
			html = (await opts!.transformPageChunk!({ html: DOC, done: true })) ?? '';
			return new Response(html, { headers: { 'content-type': 'text/html' } });
		}
	});
	const m = SCOPE_RE.exec(html);
	return m ? attr_value(m[1]) : null;
}

describe('the dev-scope meta', () => {
	it('names a plain route group as it is', async () => {
		expect(await scope_of('/(docs)/guide')).toBe('(docs)');
	});

	it('a route group whose name holds a quote or an ampersand reads back as that name', async () => {
		expect(await scope_of('/(a"b)/x')).toBe('(a"b)');
		expect(await scope_of('/(a&amp;b)/x')).toBe('(a&amp;b)');
	});
});
