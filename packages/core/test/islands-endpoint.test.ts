// ONE ISLANDS ENDPOINT (server/endpoint.ts): `handle({ endpoint })` moves the handler AND every URL
// minted for it. REGRESSION (field report, 0.8.0): the option moved only the handler — pages still
// minted `/__ogygia__?…`, the handler answered only on the new path, and every hole 404'd (behind a
// proxy forwarding only the app's own prefixes, and without one).
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('ogygia:server/secret', () => ({ build_key: 'test-secret', build_had_secret: false }));
vi.mock('ogygia:server/session-cookie', () => ({ session_cookie: null }));
vi.mock('ogygia:server/region-ttl', () => ({ region_ttl: 3600, renew_window: 691200 }));
vi.mock('ogygia:server/server-manifest', () => ({
	region_url: {},
	region_render: { rnd123: 'c0ffee0c0ffe' }
}));
vi.mock('ogygia:server/sign', () => ({
	sign: (_k: string, m: string) => `sig${m.length}`,
	region_sign: (
		_k: string,
		audience: string,
		exp: number,
		c: { id: string; payload: string; session: string; ttl: string; render: string; wakes: string }
	) =>
		`sig${[audience, c.id, exp, c.payload, c.session, c.ttl, c.render, c.wakes].join('|').length}`
}));

const {
	configure_islands_endpoint,
	islands_endpoint,
	reset_islands_endpoint,
	DEFAULT_ISLANDS_ENDPOINT
} = await import('../src/server/endpoint.ts');
const { mint_server_region, make_region_endpoint } =
	await import('../src/server/region-endpoint.ts');
const { renders_for_a_page } = await import('../src/server/render-page.ts');
const { mpaSpeculationRules } = await import('../src/server/speculation.ts');

afterEach(() => {
	reset_islands_endpoint();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

const at = (path: string) => ({ url: new URL(`https://a.test${path}`) }) as never;

describe('the islands endpoint', () => {
	it('defaults to /__ogygia__, for the handler and the mint alike', () => {
		expect(islands_endpoint()).toBe(DEFAULT_ISLANDS_ENDPOINT);
		expect(mint_server_region('abc123', {})).toMatch(/^\/__ogygia__\?id=abc123&/);
	});

	it('handle({ endpoint }) moves every minted URL with the handler', () => {
		configure_islands_endpoint('/_server/api/__ogygia__');
		expect(mint_server_region('abc123', { a: 1 })).toMatch(
			/^\/_server\/api\/__ogygia__\?id=abc123&props=/
		);
		expect(make_region_endpoint('abc123', {})).toMatch(/^\/_server\/api\/__ogygia__\?id=abc123&/);
		// a render on the new path is a hole render (it renders for a page); the old path is a page now
		expect(renders_for_a_page(at('/_server/api/__ogygia__'))).toBe(true);
		expect(renders_for_a_page(at('/__ogygia__'))).toBe(false);
	});

	it('the endpoint is one path, the one minted: a page whose path ends the same is a page', () => {
		configure_islands_endpoint('/api');
		expect(renders_for_a_page(at('/api'))).toBe(true);
		expect(renders_for_a_page(at('/docs/api'))).toBe(false);
		expect(renders_for_a_page(at('/sub/api'))).toBe(false);
	});

	it('a second handle naming another endpoint is said, in production; the same one again is not', () => {
		vi.stubEnv('DEV', false);
		const errors: unknown[] = [];
		vi.spyOn(console, 'error').mockImplementation((e: unknown) => void errors.push(e));
		configure_islands_endpoint('/a');
		configure_islands_endpoint('/a');
		expect(errors).toEqual([]);
		configure_islands_endpoint('/b');
		expect(String(errors[0])).toContain('islands_endpoint_conflict');
		expect(islands_endpoint()).toBe('/b');
	});

	it('a minted capability names its signing key (`&k=`, outside the MAC)', () => {
		expect(mint_server_region('abc123', {})).toMatch(/&sig=[^&]+&k=[^&]+$/);
	});

	it('a minted capability names what it renders (`&r=`, its render identity, signed)', () => {
		const url = mint_server_region('rnd123', {});
		expect(url).toMatch(/\?id=rnd123&r=c0ffee0c0ffe&props=/);
		// (the mocked sign hashes the message by length: the render identity is part of it)
		const sig = new URL(url, 'http://x').searchParams.get('sig');
		expect(sig).toBe(
			`sig${
				[
					'/__ogygia__',
					'rnd123',
					new URL(url, 'http://x').searchParams.get('exp'),
					'W3t9XQ',
					'',
					'',
					'c0ffee0c0ffe',
					// (wakes: '' for a hole that does not wake)
					''
				].join('|').length
			}`
		);
	});

	it('a region with no render identity mints as before (no `r`)', () => {
		expect(mint_server_region('def456', {})).not.toContain('&r=');
	});

	it('a path without its leading slash gets one', () => {
		configure_islands_endpoint('api/__ogygia__');
		expect(islands_endpoint()).toBe('/api/__ogygia__');
		expect(renders_for_a_page(at('/myapi/__ogygia__'))).toBe(false);
	});

	it('MPA speculation rules leave out the endpoint the handle serves', () => {
		expect(mpaSpeculationRules('/_server/api/__ogygia__')).toContain(
			'"href_matches":"/_server/api/__ogygia__*"'
		);
		expect(mpaSpeculationRules()).toContain('"href_matches":"/__ogygia__*"');
	});
});
