import { describe, expect, it, vi } from 'vitest';

vi.mock('ogygia:server/router-config', () => ({ router_enabled: false, view_transitions: false }));

const { handle } = await import('../src/hooks.ts');
const { facts_of } = await import('../src/plugin/facts.ts');

const DOC =
	'<!doctype html><html><head><title>t</title></head><body><ogygia-region entry="https://peer.test/_app/ogygia/og-region.js" wake="load"><p>peer</p></ogygia-region></body></html>';

async function serve(learned: string[] | null): Promise<string> {
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
			if (learned) facts_of(event.request).codeOrigins = learned;
			html = (await opts!.transformPageChunk!({ html: DOC, done: true })) ?? '';
			return new Response(html, { headers: { 'content-type': 'text/html' } });
		}
	});
	return html;
}

describe('a page with no router whose render placed island code from another origin (#1697)', () => {
	it('loads the runtime, which may load that code', async () => {
		const html = await serve(['https://peer.test/_app/ogygia/runtime.js']);
		const head = html.slice(0, html.indexOf('</head>'));
		expect(head).toMatch(/<script [^>]*data-ogygia-runtime/);
		expect(head).toContain('data-og-origins="https://peer.test"');
	});

	it('a page with no router whose render learned no code origin ships no runtime', async () => {
		expect(await serve(null)).not.toContain('data-ogygia-runtime');
	});
});
