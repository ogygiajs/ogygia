// A hole that wakes is hydrated in `nested_context` (runtime/hydrate-core.ts), so its endpoint answer
// must be rendered in that context too, or a region inside it takes another branch on each side (#906).
// The capability says so: a signed "wakes" mark (`&w=1`), set where the hole is minted.
import { describe, it, expect, vi } from 'vitest';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/rate-limit', () => ({
	rate_limit: { max: 1000, windowMs: 60_000 }
}));
vi.mock('ogygia:server/server-plugins', () => ({ plugins: [] }));
vi.mock('ogygia:server/route-config', () => ({ route_config: {} }));
vi.mock('ogygia:server/devtools-boot-url', () => ({ devtools_boot_url: '' }));
const ID = 'abcdef012345';
vi.mock('ogygia:server/server-manifest', async () => {
	const probe = await import('./_fixtures/NestedProbe.svelte');
	return {
		load_server_regions: async () => ({ regions: { [ID]: async () => probe } }),
		region_url: { [ID]: '/x.js' },
		region_name: {},
		region_render: {},
		render_region: {},
		region_reads_page_data: null
	};
});

const { handle } = await import('../src/hooks.ts');
const { mint_server_region, make_region_endpoint } =
	await import('../src/server/region-endpoint.ts');

function event(url: string, init?: RequestInit) {
	const u = new URL(url, 'https://app.test');
	return {
		url: u,
		request: new Request(u, init),
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
const resolve = async () => new Response('page');
const get = async (url: string) => {
	const res = await handle()({ event: event(url), resolve } as never);
	return { status: res.status, body: await res.text() };
};

describe('a hole that wakes: the capability carries it', () => {
	it('a hole that wakes is answered as its hydrate renders it (inside an island)', async () => {
		const cap = mint_server_region(ID, {}, 0, true);
		expect(cap).toContain('&w=1');
		const { status, body } = await get(cap);
		expect(status).toBe(200);
		expect(body).toContain('inside-an-island');
	});

	it('a hole that does not wake is answered as a root, its address as before', async () => {
		const cap = mint_server_region(ID, {});
		expect(cap).not.toContain('&w=');
		const { status, body } = await get(cap);
		expect(status).toBe(200);
		expect(body).toContain('as-a-root');
	});

	it('the wakes mark is signed: dropping it or adding it is refused', async () => {
		const woken = mint_server_region(ID, { n: 1 }, 0, true);
		expect((await get(woken.replace('&w=1', ''))).status).toBe(403);
		const plain = mint_server_region(ID, { n: 1 });
		expect((await get(plain.replace('&sig=', '&w=1&sig='))).status).toBe(403);
	});

	it('a held region that wakes signs the mark too', async () => {
		const cap = make_region_endpoint(ID, {}, true);
		expect(cap).toContain('&w=1');
		expect((await get(cap)).body).toContain('inside-an-island');
		expect(make_region_endpoint(ID, {})).not.toContain('&w=');
	});

	it('a batched hole that wakes is answered inside an island too', async () => {
		const cap = mint_server_region(ID, { n: 2 }, 0, true);
		const res = await handle()({
			event: event('/__ogygia__', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify([cap])
			}),
			resolve
		} as never);
		const text = await res.text();
		expect(text).toContain('inside-an-island');
		expect(text).not.toContain('as-a-root');
	});
});
