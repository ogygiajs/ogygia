// A hole whose server render throws answers an opaque 500 (the visitor learns nothing of why), and
// the server says why with a code, in production as in dev: a hole that throws only in production
// is otherwise a blind hunt.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/server-plugins', () => ({ plugins: [] }));
vi.mock('ogygia:server/route-config', () => ({ route_config: {} }));
vi.mock('ogygia:server/devtools-boot-url', () => ({ devtools_boot_url: '' }));
const ID = 'abcdef012345';
const Throws = () => {
	throw new Error('upstream said no: secret-internal-detail');
};
vi.mock('ogygia:server/server-manifest', () => ({
	load_server_regions: async () => ({ regions: { [ID]: async () => ({ default: Throws }) } }),
	region_url: { [ID]: '/x.js' },
	region_name: {},
	region_render: {},
	render_region: {},
	region_reads_page_data: null
}));

const { handle } = await import('../src/hooks.ts');
const { mint_server_region } = await import('../src/server/region-endpoint.ts');

const event = (url: string) => {
	const u = new URL(url, 'https://app.test');
	return {
		url: u,
		request: new Request(u),
		getClientAddress: () => '1.2.3.4',
		cookies: { get: () => undefined },
		route: { id: null },
		params: {},
		isDataRequest: false,
		setHeaders() {},
		platform: undefined,
		locals: {}
	} as never;
};
const resolve = async () => new Response('page');
let logged: string[] = [];

describe('a hole that throws', () => {
	beforeEach(() => {
		logged = [];
		const keep = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
		vi.spyOn(console, 'warn').mockImplementation(keep);
		vi.spyOn(console, 'error').mockImplementation(keep);
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it('in production: the server says it with a code and the error; the visitor gets an opaque 500', async () => {
		vi.stubEnv('DEV', false);
		const res = await handle()({ event: event(mint_server_region(ID, {})), resolve } as never);
		expect(res.status).toBe(500);
		expect(await res.text()).not.toContain('secret-internal-detail');
		expect(logged.some((l) => l.includes('region_render_failed'))).toBe(true);
		expect(logged.some((l) => l.includes('secret-internal-detail'))).toBe(true);
	});
});
