// The region capability URL, over generated inputs (INVARIANTS CAPABILITY-URL):
// - its query reads back as the fields it was written from (the one spelling a mint and a renewal
//   share: server/endpoint.ts `capability_query`);
// - any query a browser can send, of any keys, repeats and escapes, is refused with a 403 or a 429
//   and a reason, never rendered, never a server error, and leaves Object.prototype alone.
import { describe, it, expect, vi } from 'vitest';
import { fc } from '@ogygia/config/sim';

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
const { capability_query, REGION_CAPABILITY_VERSION } = await import('../src/server/endpoint.ts');
const { mint_server_region } = await import('../src/server/region-endpoint.ts');

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
const resolve = async () => new Response('page');

const hex = (n: number) =>
	fc.string({ unit: fc.constantFrom(...'0123456789abcdef'.split('')), minLength: n, maxLength: n });
const b64url = fc.string({
	unit: fc.constantFrom(
		...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('')
	),
	maxLength: 64
});
const digits = (max: number) =>
	fc.string({ unit: fc.constantFrom(...'0123456789'.split('')), minLength: 1, maxLength: max });

describe('the capability query', () => {
	it('reads back as the fields it was written from', () => {
		fc.assert(
			fc.property(
				hex(12),
				fc.oneof(fc.constant(''), hex(12)),
				b64url,
				fc.oneof(fc.constant(''), digits(7)),
				fc.constantFrom('', '1'),
				digits(10),
				hex(64),
				hex(16),
				(id, render, payload, ttl, wakes, exp, sig, k) => {
					const q = new URLSearchParams(
						capability_query({ id, render, payload, ttl, wakes }, exp, sig, k).slice(1)
					);
					const back = {
						id: q.get('id'),
						render: q.get('r') ?? '',
						payload: q.get('props'),
						ttl: q.get('ttl') ?? '',
						wakes: q.get('w') ?? '',
						exp: q.get('exp'),
						v: q.get('v'),
						sig: q.get('sig'),
						k: q.get('k')
					};
					expect(back).toEqual({
						id,
						render,
						payload,
						ttl,
						wakes,
						exp,
						v: REGION_CAPABILITY_VERSION,
						sig,
						k
					});
				}
			),
			{ numRuns: 500 }
		);
	});

	it('any query a browser can send is refused with a reason, never rendered, never a 500', async () => {
		const h = handle();
		const good = new URL(mint_server_region(ID, { n: 1 }), 'https://app.test');
		const proto = Object.getOwnPropertyNames(Object.prototype).sort();
		// the real fields and values, and the pieces a forger would try between them
		const key = fc.constantFrom(
			'id',
			'r',
			'props',
			'exp',
			'v',
			'ttl',
			'w',
			'sig',
			'k',
			'renew',
			'__proto__',
			'constructor',
			'id[]',
			''
		);
		const value = fc.oneof(
			fc.constantFrom(...good.searchParams.values()),
			fc.constantFrom('', '1', '3', '0', '-1', 'NaN', 'Infinity', '1e999', '%', '%zz', '%00', '+'),
			fc.string({ maxLength: 12 }),
			hex(12),
			hex(64)
		);
		await fc.assert(
			fc.asyncProperty(fc.array(fc.tuple(key, value), { maxLength: 12 }), async (pairs) => {
				const search = pairs
					.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
					.join('&');
				// (a query that holds the minted capability's fields as minted is the capability)
				const q = new URLSearchParams(search);
				fc.pre([...good.searchParams].some(([k, v]) => q.get(k) !== v) || q.get('renew') !== null);
				const before = renders;
				const res = await h({ event: event(`${good.pathname}?${search}`), resolve } as never);
				expect([403, 429]).toContain(res.status);
				if (res.status === 403) expect(res.headers.get('x-ogygia-deny')).toBeTruthy();
				expect(renders).toBe(before);
				expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(proto);
			}),
			{ numRuns: 400 }
		);
	});
});
