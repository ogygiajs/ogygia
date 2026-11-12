// A RENDER BUDGET SPENT BY A PROXY'S ADDRESS (#894). The region endpoint's budget is per client
// address (`event.getClientAddress()`). Behind a reverse proxy whose adapter was not told which header
// holds the visitor's address, every request has the proxy's address, so every visitor shares one
// budget and normal traffic gets 429s. When the budget refuses an address no visitor on the internet
// has (loopback, private, link-local), the server says so once: `rate_limit_shared_address`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/rate-limit', () => ({ rate_limit: { max: 2, windowMs: 60_000 } }));
vi.mock('ogygia:server/server-plugins', () => ({ plugins: [] }));
vi.mock('ogygia:server/route-config', () => ({ route_config: {} }));
vi.mock('ogygia:server/devtools-boot-url', () => ({ devtools_boot_url: '' }));
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

function event(url: string, address: string) {
	const u = new URL(url, 'https://app.test');
	return {
		url: u,
		request: new Request(u),
		getClientAddress: () => address,
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
let warned: string[] = [];

/** `n` GETs of one hole from `address` on a fresh handle (a fresh budget): their statuses. */
async function gets(address: string, n: number): Promise<number[]> {
	const h = handle();
	const cap = mint_server_region(ID, { n: 1 });
	const out: number[] = [];
	for (let i = 0; i < n; i++)
		out.push((await h({ event: event(cap, address), resolve } as never)).status);
	return out;
}
const said = () => warned.filter((w) => w.includes('rate_limit_shared_address')).length;

describe('region endpoint: a render budget spent by a shared address', () => {
	beforeEach(() => {
		warned = [];
		vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
			warned.push(args.map(String).join(' '));
		});
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('a private address that spends the budget is said once, however many 429s follow', async () => {
		expect(await gets('10.0.0.5', 5)).toEqual([200, 200, 429, 429, 429]);
		expect(said()).toBe(1);
	});

	it('so is a loopback address, IPv4 or IPv6', async () => {
		await gets('127.0.0.1', 3);
		await gets('::1', 3);
		expect(said()).toBeGreaterThanOrEqual(1);
	});

	it('a public address that spends the budget is not: that is one visitor', async () => {
		expect(await gets('203.0.113.7', 3)).toEqual([200, 200, 429]);
		expect(said()).toBe(0);
	});

	it('a private address within the budget is not said', async () => {
		expect(await gets('192.168.1.20', 2)).toEqual([200, 200]);
		expect(said()).toBe(0);
	});
});
