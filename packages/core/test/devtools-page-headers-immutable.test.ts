// A DEVTOOLS BUILD, A PAGE WHOSE HEADERS CANNOT CHANGE (hooks.ts). For a browser that turned devtools
// on, the handle allows the page's main-thread profiling (`document-policy`) and names its route
// (`server-timing`). A platform whose response headers cannot change leaves both out: the page still
// goes out, never a 500. Its own file: the devtools build's flags are read once, as hooks.ts loads.
import { expect, it, vi } from 'vitest';

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

const flags = globalThis as { __OGYGIA_DEVTOOLS__?: boolean; __OGYGIA_DEVTOOLS_LAZY__?: boolean };
flags.__OGYGIA_DEVTOOLS__ = true;
flags.__OGYGIA_DEVTOOLS_LAZY__ = true;
const { handle } = await import('../src/hooks.ts');
const { DEVTOOLS_COOKIE, DEVTOOLS_ON } = await import('../src/contract/switch.ts');
delete flags.__OGYGIA_DEVTOOLS__;
delete flags.__OGYGIA_DEVTOOLS_LAZY__;

it('a devtools browser’s page whose headers cannot change goes out without the profiling headers', async () => {
	const u = new URL('/a', 'https://app.test');
	const event = {
		url: u,
		request: new Request(u),
		getClientAddress: () => '203.0.113.7',
		cookies: {
			get: (n: string) => (n === DEVTOOLS_COOKIE ? DEVTOOLS_ON : undefined),
			set() {},
			delete() {}
		},
		route: { id: '/a' },
		params: {},
		isDataRequest: false,
		setHeaders() {},
		platform: undefined,
		locals: {}
	} as never;
	const answer = new Response('page', { headers: { 'content-type': 'text/html' } });
	for (const m of ['set', 'append'])
		Object.defineProperty(answer.headers, m, {
			value: () => {
				throw new TypeError('immutable');
			}
		});
	const res = await handle()({ event, resolve: async () => answer } as never);
	expect(res.status).toBe(200);
	expect(res.headers.get('document-policy')).toBeNull();
	expect(res.headers.get('server-timing')).toBeNull();
});
