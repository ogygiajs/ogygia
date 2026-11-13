// THE HANDLE'S OWN FAILURES (hooks.ts). A request the handle cannot read (a path that does not
// decode, a batch body that is not JSON, a client the adapter cannot name) is answered with its
// status, never thrown; a page whose render throws still ends the request's owner; and options
// the handle refuses are refused when it is made.
import { afterEach, describe, expect, it, vi } from 'vitest';

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
const { request_scope } = await import('../src/plugin/request-scope.ts');
const { PAGE_FACTS_HEADER, PAGE_FACTS_ROUTE_HEADER } = await import('../src/server/page-facts.ts');

function event(
	path: string,
	o: {
		method?: string;
		body?: string;
		headers?: Record<string, string>;
		ip?: () => string;
		data?: boolean;
	} = {}
) {
	const u = new URL(path, 'https://app.test');
	return {
		url: u,
		request: new Request(u, {
			method: o.method ?? 'GET',
			headers: o.headers,
			body: o.body
		}),
		getClientAddress: o.ip ?? (() => '203.0.113.7'),
		cookies: { get: () => undefined },
		route: { id: '/x' },
		params: {},
		isDataRequest: !!o.data,
		setHeaders() {},
		platform: undefined,
		locals: {}
	} as never;
}

const page = async () => new Response('page', { headers: { 'content-type': 'text/html' } });

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe('a request the handle cannot read', () => {
	it('a path whose percent-encoding does not decode is a 400, and the page is never rendered', async () => {
		const resolve = vi.fn(page);
		const res = await handle()({ event: event('/a/%E0%A4%A'), resolve } as never);
		expect(res.status).toBe(400);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('a batch from a client the adapter cannot name is a 429 (fail closed)', async () => {
		const res = await handle()({
			event: event('/__ogygia__', {
				method: 'POST',
				body: '[]',
				headers: { 'content-type': 'application/json' },
				ip: () => {
					throw new Error('no address on this platform');
				}
			}),
			resolve: page
		} as never);
		expect(res.status).toBe(429);
	});

	it('a batch body that is not JSON is a 400', async () => {
		const res = await handle()({
			event: event('/__ogygia__', {
				method: 'POST',
				body: '[not json',
				headers: { 'content-type': 'application/json' }
			}),
			resolve: page
		} as never);
		expect(res.status).toBe(400);
	});
});

describe('a page whose render throws', () => {
	it('the throw goes on to Kit, and the request’s owner ends with it', async () => {
		const e = event('/a');
		const request = (e as { request: Request }).request;
		const owner = request_scope(request);
		await expect(
			handle()({
				event: e,
				resolve: async () => {
					throw new Error('the page threw');
				}
			} as never)
		).rejects.toThrow('the page threw');
		expect(owner.closed).toBe(true);
	});
});

describe('a page-facts data request', () => {
	it('an answer whose headers cannot change goes out as it is, without the route header', async () => {
		const answer = Response.redirect('https://app.test/elsewhere', 302);
		const res = await handle()({
			event: event('/a/__data.json', { data: true, headers: { [PAGE_FACTS_HEADER]: '1' } }),
			resolve: async () => answer
		} as never);
		expect(res.status).toBe(302);
		expect(res.headers.get(PAGE_FACTS_ROUTE_HEADER)).toBeNull();
	});
});

describe('options the handle refuses', () => {
	it('`transform` is told where it moved', () => {
		expect(() => handle({ transform: () => '' } as never)).toThrow(
			expect.objectContaining({ code: 'handle_transform_moved' })
		);
	});

	it('in production, a secret too short to sign with is refused', () => {
		vi.stubEnv('DEV', false);
		expect(() => handle({ secret: 'short' })).toThrow(
			expect.objectContaining({ code: 'handle_secret_too_short' })
		);
	});
});
