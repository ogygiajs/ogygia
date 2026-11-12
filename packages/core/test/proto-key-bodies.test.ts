// A body from the browser with a `__proto__` key is refused or read as plain data wherever the server
// parses one: a batch POST of holes (JSON), and a remote function's argument (devalue, through
// ogygia's transport decoders). Nothing reaches Object.prototype, and a batch never answers 500.
// (The profiler's beacon, report and unlock: packages/devtools/test/proto-key-bodies.test.ts.)
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as devalue from 'devalue';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/rate-limit', () => ({ rate_limit: { max: 1000, windowMs: 60_000 } }));
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
const { ogygiaTransport } = await import('../src/transport.ts');

const PROTO_NAMES = Object.getOwnPropertyNames(Object.prototype).sort();
const POLLUTION = '{"og_polluted":"yes","k":"fn","i":"x"}';

afterEach(() => {
	expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(PROTO_NAMES);
	expect(({} as Record<string, unknown>).og_polluted).toBeUndefined();
	expect(([] as unknown as Record<string, unknown>).og_polluted).toBeUndefined();
});

function event(url: string, init?: RequestInit) {
	const u = new URL(url, 'https://app.test');
	return {
		url: u,
		request: new Request(u, init),
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

describe('a batch POST of holes', () => {
	it('with a `__proto__` or `constructor` key is refused, or its holes render', async () => {
		const h = handle();
		const cap = JSON.stringify(mint_server_region(ID, { n: 1 }));
		const bodies = [
			`{"__proto__":[${cap}]}`,
			`{"__proto__":${POLLUTION}}`,
			`{"constructor":{"prototype":${POLLUTION}},"length":1,"0":${cap}}`,
			`[${cap},{"__proto__":${POLLUTION}}]`,
			`[{"constructor":{"prototype":${POLLUTION}}},${cap}]`
		];
		const statuses: number[] = [];
		for (const body of bodies) {
			const res = await h({
				event: event('/__ogygia__', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body
				}),
				resolve
			} as never);
			statuses.push(res.status);
			const text = await res.text();
			if (res.status === 200) expect(text).toContain('<p>hole</p>');
		}
		// not an array: refused; an array: its strings are the calls, anything else is left out
		expect(statuses).toEqual([400, 400, 400, 200, 200]);
	});
});

describe('a remote function’s argument', () => {
	// Kit decodes a remote argument with devalue and the app's `transport` decoders
	// (`parse_remote_arg`): the decoders here are ogygia's
	const decoders = Object.fromEntries(
		Object.entries(ogygiaTransport).map(([k, v]) => [k, (x: never) => v.decode(x)])
	) as Record<string, (v: unknown) => unknown>;

	it('with a `__proto__` key at any depth is refused by the decode', () => {
		const raws = [
			// {__proto__: {...}} at the top
			`[{"__proto__":1},${POLLUTION}]`,
			// one level down, in an array
			`[[1],{"__proto__":2},${POLLUTION}]`,
			// inside an ogygia ref's payload, and inside a region's
			`[["OgygiaRef",1],{"__proto__":2},${POLLUTION}]`,
			`[["Region",1],{"__proto__":2},${POLLUTION}]`
		];
		for (const raw of raws) expect(() => devalue.parse(raw, decoders), raw).toThrow(/__proto__/);
	});

	it('with a `constructor.prototype` key is plain data, its own keys only', () => {
		const v = devalue.parse(
			`[{"constructor":1},{"prototype":2},{"og_polluted":3},"yes"]`,
			decoders
		);
		expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
		expect(Object.keys(v as object)).toEqual(['constructor']);
	});
});
