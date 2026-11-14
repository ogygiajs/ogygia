// A capability minted before v3 (no `v`, its `v1|`/`v2|` MAC: what ogygia 0.12.x mints) comes from a
// page of an earlier build, whose runtime cannot read this build's answer: the answer names this
// build's island module, which hydrates against the earlier build's chunks and throws (#1769, the
// simulator's internal/sim/test/older-page-newer-server.node.test.ts). The endpoint refuses it as
// `shape` before any HMAC, on its own, as a renewal and in a batch, and never renders it, so the
// earlier page keeps its fallback.
import { createHmac, hkdfSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

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
const { signing_key } = await import('../src/server/signing-key.ts');

const lp = (s: string) => `${Buffer.byteLength(s, 'utf8')}:${s}`;

/** A hole's capability as ogygia 0.12.3 mints it: this build's link with its `v` dropped and its
 *  signature the `v1|` MAC (`v2|` with a render identity) under the same key. */
function released_link(props: Record<string, unknown>, render = ''): URL {
	const u = new URL(mint_server_region(ID, props), 'https://app.test');
	const p = u.searchParams;
	p.delete('v');
	if (render !== '') p.set('r', render);
	const head = [ID, p.get('exp')!, p.get('props')!, '', p.get('ttl') ?? ''].map(lp).join('|');
	const message = render === '' ? `v1|${head}` : `v2|${head}|${lp(render)}`;
	const key = Buffer.from(
		hkdfSync('sha256', signing_key().secret, Buffer.alloc(0), 'ogygia-mac-v1', 32)
	);
	p.set('sig', createHmac('sha256', key).update(message, 'utf8').digest('hex'));
	return u;
}

function event(url: URL, init?: RequestInit) {
	return {
		url,
		request: new Request(url, init),
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

describe("a capability an earlier build minted (before v3) is refused as another build's", () => {
	it('on its own: 403 shape, never rendered', async () => {
		const h = handle();
		for (const link of [released_link({ n: 1 }), released_link({ n: 2 }, 'c0ffee0c0ffe')]) {
			const before = renders;
			const res = await h({ event: event(link), resolve } as never);
			expect([res.status, res.headers.get('x-ogygia-deny')]).toEqual([403, 'shape']);
			expect(renders).toBe(before);
		}
	});

	it('expired, as a renewal: 403 shape, and no fresh capability handed back', async () => {
		const link = released_link({ n: 3 });
		link.searchParams.set('renew', '1');
		vi.useFakeTimers();
		try {
			vi.setSystemTime((Number(link.searchParams.get('exp')) + 60) * 1000);
			const res = await handle()({ event: event(link), resolve } as never);
			expect([res.status, res.headers.get('x-ogygia-deny')]).toEqual([403, 'shape']);
			expect(res.headers.get('x-ogygia-capability')).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('in a batch: its hole gets no answer, while a v3 hole beside it does', async () => {
		const old = released_link({ n: 4 });
		const fresh = mint_server_region(ID, { n: 5 });
		const before = renders;
		const res = await handle()({
			event: event(new URL('/__ogygia__', 'https://app.test'), {
				method: 'POST',
				body: JSON.stringify([old.pathname + old.search, fresh]),
				headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }
			}),
			resolve
		} as never);
		const body = await res.text();
		expect(body).not.toContain(`data-ogygia-slot="${old.searchParams.get('sig')}"`);
		expect(body).toContain(
			`data-ogygia-slot="${new URL(fresh, 'https://app.test').searchParams.get('sig')}"`
		);
		expect(renders).toBe(before + 1);
	});
});
