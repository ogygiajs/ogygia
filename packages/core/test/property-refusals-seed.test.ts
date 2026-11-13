// Properties of what the server refuses and what it writes into a page (INVARIANTS CAPABILITY-URL,
// PAGE-SEED), over generated inputs rather than picked ones:
// - a capability with any one of its signed fields changed is refused the same way (403, the same
//   body), never rendered, never a server error;
// - the page seed, whatever the page's data holds, has no `<` in its script text (so nothing in it
//   can end the script or open a comment state), and reads back as the same data.
import { describe, it, expect, vi } from 'vitest';
import { parse } from 'devalue';
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
const { mint_server_region } = await import('../src/server/region-endpoint.ts');
const { PageSeed } = await import('../src/server/page-seed.ts');

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

/** The signed fields of a capability URL, and the one the minter's key names (outside the MAC). */
const SIGNED = ['id', 'props', 'exp', 'sig'] as const;
const ALPHABET = '0123456789abcdefABCDEF-_.~%z';

describe('properties: refusals', () => {
	it('any one signed field changed: refused the same way, never rendered, never a 500', async () => {
		const h = handle();
		const cap = mint_server_region(ID, { n: 1, text: 'hello' });
		const good = await h({ event: event(cap), resolve } as never);
		expect(good.status).toBe(200);
		const refusals = new Set<string>();
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom(...SIGNED),
				fc.nat(),
				fc.constantFrom(...ALPHABET.split('')),
				async (field, at, ch) => {
					const u = new URL(cap, 'https://app.test');
					const was = u.searchParams.get(field)!;
					const i = at % was.length;
					const changed = was.slice(0, i) + ch + was.slice(i + 1);
					fc.pre(changed !== was);
					u.searchParams.set(field, changed);
					const before = renders;
					const res = await h({ event: event(u.pathname + u.search), resolve } as never);
					expect(res.status).toBe(403);
					expect(renders).toBe(before);
					refusals.add(`${res.status} ${await res.text()}`);
				}
			),
			{ numRuns: 300 }
		);
		// one refusal, whatever was changed (the reason header aside)
		expect(refusals.size).toBe(1);
	});
});

describe('properties: the page seed', () => {
	it('whatever the data holds, the seed text has no `<` and reads back as the data', () => {
		const text = fc.string({
			unit: fc.constantFrom(
				'<',
				'/',
				's',
				'c',
				'r',
				'i',
				'p',
				't',
				'>',
				'!',
				'-',
				' ',
				'"',
				' ',
				'a'
			)
		});
		const data = fc.dictionary(text, fc.oneof(text, fc.integer(), fc.boolean(), fc.array(text)));
		fc.assert(
			fc.property(data, fc.boolean(), (d, json) => {
				const page = {
					url: new URL('https://app.test/x'),
					params: {},
					route: { id: '/x' },
					status: 200,
					data: d
				};
				const seed = PageSeed.serialize(page as never, undefined, json)!;
				expect(seed.text.includes('<')).toBe(false);
				const back = (seed.json ? JSON.parse(seed.text) : parse(seed.text)) as { data: unknown };
				expect(back.data).toEqual(d);
			}),
			{ numRuns: 500 }
		);
	});
});
