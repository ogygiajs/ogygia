// The batch POST's body cap holds whatever the headers say (#754): a body sent without a
// content-length (chunked) is refused once it passes the cap, without being read to its end.
import { it, expect, vi } from 'vitest';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/rate-limit', () => ({ rate_limit: { max: 0, windowMs: 60_000 } }));
vi.mock('ogygia:server/server-plugins', () => ({ plugins: [] }));
vi.mock('ogygia:server/route-config', () => ({ route_config: {} }));
vi.mock('ogygia:server/devtools-boot-url', () => ({ devtools_boot_url: '' }));
vi.mock('ogygia:server/server-manifest', () => ({
	load_server_regions: async () => ({ regions: {} }),
	region_url: {},
	region_name: {},
	region_render: {},
	render_region: {},
	region_reads_page_data: null
}));

const { handle } = await import('../src/hooks.ts');

const CHUNK = 64 * 1024;

/** A chunked body: an opening `[`, then `chunks` pieces of spaces, counting how many were pulled. */
function chunked(chunks: number) {
	const seen = { pulls: 0 };
	const piece = new TextEncoder().encode(' '.repeat(CHUNK));
	const body = new ReadableStream<Uint8Array>({
		pull(c) {
			seen.pulls++;
			if (seen.pulls === 1) c.enqueue(new TextEncoder().encode('['));
			else if (seen.pulls > chunks) c.close();
			else c.enqueue(piece);
		}
	});
	return { body, seen };
}

function event(body: ReadableStream<Uint8Array>) {
	const u = new URL('/__ogygia__', 'https://app.test');
	return {
		url: u,
		request: new Request(u, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body,
			duplex: 'half'
		} as RequestInit),
		getClientAddress: () => '203.0.113.7',
		cookies: { get: () => undefined },
		route: { id: null },
		params: {},
		isDataRequest: false,
		setHeaders() {},
		platform: undefined,
		locals: {}
	} as never;
}

it('a chunked batch body past the cap is refused with 413, read no further than the cap', async () => {
	const { body, seen } = chunked(200); // ~12.5 MB, no content-length
	const res = await handle()({
		event: event(body),
		resolve: async () => new Response('page')
	} as never);
	expect(res.status).toBe(413);
	// the cap is 512 kB: eight 64 kB pieces, the opening one and one past it at most
	expect(seen.pulls).toBeLessThanOrEqual(10);
});
