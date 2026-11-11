// HOW LOADED THE SERVER IS, ONLY FOR A BROWSER THAT MEASURES. A region answer carries its queue and
// render time (`server-timing`) in dev, for a browser that turned devtools on, and for one a plugin
// vouches for (the profiler: its logged-in user, `measures`). A cookie any visitor can set on its own
// is not that.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/rate-limit', () => ({ rate_limit: { max: 60, windowMs: 60_000 } }));
const ID = 'abcdef012345';
const Comp = ($$renderer: { push(s: string): void }) => $$renderer.push('<p>hole</p>');
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
const { register_hooks } = await import('../src/plugin/hooks.ts');

function event(url: string, cookies: Record<string, string> = {}) {
	const u = new URL(url, 'https://app.test');
	return {
		url: u,
		request: new Request(u),
		getClientAddress: () => '203.0.113.7',
		cookies: { get: (name: string) => cookies[name] },
		route: { id: null },
		params: {},
		isDataRequest: false,
		setHeaders() {},
		platform: undefined,
		locals: {}
	} as never;
}
const resolve = async () => new Response('page');

describe('server-timing on a region answer', () => {
	// (a production server: in dev every answer is timed)
	beforeEach(() => void vi.stubEnv('DEV', false));
	afterEach(() => void vi.unstubAllEnvs());

	it('a visitor cannot ask for it by setting a cookie itself', async () => {
		const res = await handle()({
			event: event(mint_server_region(ID, {}), { og_profiler_beacon: '1' }),
			resolve
		} as never);
		expect(res.status).toBe(200);
		expect(res.headers.get('server-timing')).toBeNull();
	});

	it('a visitor a plugin vouches for gets it', async () => {
		const leave = register_hooks({ measures: () => true });
		try {
			const res = await handle()({
				event: event(mint_server_region(ID, { n: 2 })),
				resolve
			} as never);
			expect(res.headers.get('server-timing')).toContain('og-render');
		} finally {
			leave();
		}
	});
});
