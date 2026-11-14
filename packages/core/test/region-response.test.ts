import { describe, it, expect, vi } from 'vitest';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/rate-limit', () => ({ rate_limit: { max: 1000, windowMs: 60_000 } }));
vi.mock('ogygia:server/server-plugins', () => ({ plugins: [] }));
vi.mock('ogygia:server/route-config', () => ({ route_config: {} }));
vi.mock('ogygia:server/devtools-boot-url', () => ({ devtools_boot_url: '' }));
vi.mock('$app/paths', () => ({
	asset: (p: string) => {
		if (!p.startsWith('/')) throw new Error('Kit 2 takes the leading slash');
		return `https://cdn.test${p}`;
	},
	base: '',
	assets: 'https://cdn.test',
	resolve: (p: string) => p
}));
const ID = 'abcdef012345';
const OLD = 'fedcba543210';
const RENDER = 'c0ffee0c0ffe';
vi.mock('ogygia:server/server-manifest', async () => {
	const tiny = await import('./_fixtures/Tiny.svelte');
	return {
		load_server_regions: async () => ({ regions: { [ID]: async () => tiny } }),
		region_url: { [ID]: '/_app/x.js' },
		region_name: {},
		region_render: { [ID]: RENDER, [OLD]: RENDER },
		render_region: { [RENDER]: ID },
		region_reads_page_data: null
	};
});

const { handle } = await import('../src/hooks.ts');
const { mint_server_region } = await import('../src/server/region-endpoint.ts');
const { signing_key } = await import('../src/server/signing-key.ts');
const { set_island_css } = await import('./_stubs/server.region-deps.ts');

function event(url: string) {
	const u = new URL(url, 'https://app.test');
	return {
		url: u,
		request: new Request(u),
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
const get = async (url: string) => {
	const res = await handle()({ event: event(url), resolve: async () => new Response('page') });
	return { res, body: await res.text() };
};

/** A capability with its signature spoiled. */
const forged = () =>
	mint_server_region(ID, {}).replace(
		/&sig=[0-9a-f]/,
		(m) => m.slice(0, -1) + (m.endsWith('0') ? '1' : '0')
	);

describe('every region response', () => {
	const FRAMED = {
		'x-frame-options': 'DENY',
		'content-security-policy': "frame-ancestors 'none'",
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'no-referrer'
	};

	it('a refused one may not be framed, sniffed, or followed by its referrer, and is never stored', async () => {
		const { res } = await get(forged());
		expect(res.status).toBe(403);
		for (const [k, v] of Object.entries(FRAMED)) expect(res.headers.get(k)).toBe(v);
		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	it('an answered one may not be framed, sniffed, or followed by its referrer either', async () => {
		const { res, body } = await get(mint_server_region(ID, {}));
		expect(res.status).toBe(200);
		expect(body).toContain('data-tiny');
		for (const [k, v] of Object.entries(FRAMED)) expect(res.headers.get(k)).toBe(v);
	});
});

describe('a refused region request', () => {
	it('says why, and which key answered: the fingerprint a capability carries as `k`', async () => {
		const { res } = await get(forged());
		expect(res.headers.get('x-ogygia-deny')).toBe('sig');
		expect(res.headers.get('x-ogygia-key')).toBe(signing_key().fp);
		expect(mint_server_region(ID, {})).toContain(`&k=${encodeURIComponent(signing_key().fp)}`);
	});

	it('an id this build does not know, under a forged signature, is told only as a bad signature', async () => {
		const cap = forged().replace(`id=${ID}`, 'id=000000000000');
		const { res } = await get(cap);
		expect(res.headers.get('x-ogygia-deny')).toBe('sig');
	});

	it("a capability naming another deployment's key is refused as foreign-key", async () => {
		const cap = mint_server_region(ID, {}).replace(/&k=[^&]*/, '&k=another');
		const { res } = await get(cap);
		expect(res.status).toBe(403);
		expect(res.headers.get('x-ogygia-deny')).toBe('foreign-key');
	});

	it('a capability minted before capabilities named their key is left to its signature', async () => {
		const cap = mint_server_region(ID, {}).replace(/&k=[^&]*/, '');
		const { res } = await get(cap);
		expect(res.status).toBe(200);
	});
});

describe('a capability another build minted', () => {
	it('is answered by the entry of this build that renders the same component', async () => {
		const cap = mint_server_region(OLD, {});
		expect(cap).toContain(`r=${RENDER}`);
		const { res, body } = await get(cap);
		expect(res.status).toBe(200);
		expect(body).toContain('data-tiny');
	});
});

describe("a hole's answer", () => {
	it("carries the stylesheets its component needs, through Kit's asset()", async () => {
		set_island_css({ '/_app/x.js': ['/_app/x.css'] });
		try {
			const { body } = await get(mint_server_region(ID, { n: 1 }));
			expect(body).toContain('https://cdn.test/_app/x.css');
			expect(body).toContain('data-ogygia-region-css');
		} finally {
			set_island_css({});
		}
	});
});
