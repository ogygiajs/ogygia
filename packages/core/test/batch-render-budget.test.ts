// ONE BUDGET UNIT, ONE RENDER, WHICHEVER DOOR (PROBE-THEN-RENDER, internal/notes/INVARIANTS.md). The
// region endpoint's per-visitor render budget bounds render CPU under a valid capability. A batch
// POST of holes is held to the same budget as the holes' own GETs: each hole it renders is charged
// once, after its MAC verifies, and one call asked twice in a batch renders once.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/rate-limit', () => ({ rate_limit: { max: 2, windowMs: 60_000 } }));
vi.mock('ogygia:server/server-plugins', () => ({ plugins: [] }));
vi.mock('ogygia:server/route-config', () => ({ route_config: {} }));
vi.mock('ogygia:server/devtools-boot-url', () => ({ devtools_boot_url: '' }));
const ID = 'abcdef012345';
let renders = 0;
// a Svelte 5 server component, by hand: counts how often the endpoint really renders it
const Comp = ($$renderer: { push(s: string): void }) => {
	renders++;
	$$renderer.push('<p>hole</p>');
};
vi.mock('ogygia:server/server-manifest', () => ({
	load_server_regions: async () => ({ regions: { [ID]: async () => ({ default: Comp }) } }),
	region_url: { [ID]: '/x.js' },
	region_name: {},
	region_render: {},
	render_region: {},
	region_reads_page_data: null
}));

const { handle } = await import('../src/hooks.ts');
const { mint_server_region } = await import('../src/server/region-endpoint.ts');

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
const batch = (calls: string[]) =>
	event('/__ogygia__', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(calls)
	});

describe('region endpoint: the render budget', () => {
	beforeEach(() => {
		renders = 0;
	});

	it('a batch POST is charged one render per hole it renders, as GETs are', async () => {
		const h = handle();
		const cap = mint_server_region(ID, { n: 1 });
		// the budget (max 2) admits two GET renders, then refuses
		const gets = [];
		for (let i = 0; i < 3; i++)
			gets.push((await h({ event: event(cap), resolve } as never)).status);
		expect(gets).toEqual([200, 200, 429]);
		const by_get = renders;

		// a fresh handle (fresh budget): distinct holes, 32 in ONE batch POST
		renders = 0;
		const h2 = handle();
		const calls = Array.from({ length: 32 }, (_, n) => mint_server_region(ID, { n }));
		await (await h2({ event: batch(calls), resolve } as never)).text();
		expect(renders).toBeLessThanOrEqual(by_get);
	});

	it('one call asked many times in a batch renders once', async () => {
		const h = handle();
		const cap = mint_server_region(ID, { n: 1 });
		await (await h({ event: batch(Array(32).fill(cap)), resolve } as never)).text();
		expect(renders).toBe(1);
	});

	it('a forged batch never spends the render budget', async () => {
		const h = handle();
		const forged = mint_server_region(ID, { n: 1 }).replace(/sig=[0-9a-f]+/, 'sig=' + '0'.repeat(64));
		await (await h({ event: batch([forged]), resolve } as never)).text();
		// the budget (max 2) still admits two renders
		const cap = mint_server_region(ID, { n: 2 });
		const after = [];
		for (let i = 0; i < 2; i++)
			after.push((await h({ event: event(cap), resolve } as never)).status);
		expect(after).toEqual([200, 200]);
	});
});
