// Every number in a signed region URL has one spelling (#1113): plain digits, no leading zero. A
// minted capability with its `exp` or `ttl` spelled another way is refused as `shape`, before the
// MAC, and never rendered; the spelling ogygia mints renders.
import { it, expect, vi } from 'vitest';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/rate-limit', () => ({ rate_limit: { max: 0, windowMs: 60_000 } }));
vi.mock('ogygia:server/server-plugins', () => ({ plugins: [] }));
vi.mock('ogygia:server/route-config', () => ({ route_config: {} }));
vi.mock('ogygia:server/devtools-boot-url', () => ({ devtools_boot_url: '' }));
const ID = 'abcdef012345';
let renders = 0;
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

function event(url: URL) {
	return {
		url,
		request: new Request(url),
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

it('an exp spelled any other way than plain digits is refused as shape, never rendered', async () => {
	const h = handle();
	const u = new URL(mint_server_region(ID, { n: 1 }), 'https://app.test');
	const exp = u.searchParams.get('exp')!;
	expect((await h({ event: event(u), resolve } as never)).status).toBe(200);
	const n = Number(exp);
	for (const other of [
		`0${exp}`,
		`+${exp}`,
		` ${exp}`,
		`${exp} `,
		`${exp}.0`,
		`${n / 1000}e3`,
		`0x${n.toString(16)}`,
		`${exp}\u0000`
	]) {
		const v = new URL(u);
		v.searchParams.set('exp', other);
		const before = renders;
		const res = await h({ event: event(v), resolve } as never);
		expect([other, res.status, res.headers.get('x-ogygia-deny')]).toEqual([other, 403, 'shape']);
		expect(renders).toBe(before);
	}
});

it('a ttl with a leading zero is refused as shape', async () => {
	const h = handle();
	const u = new URL(mint_server_region(ID, { n: 2 }), 'https://app.test');
	u.searchParams.set('ttl', '060');
	const res = await h({ event: event(u), resolve } as never);
	expect(res.status).toBe(403);
	expect(res.headers.get('x-ogygia-deny')).toBe('shape');
});
