// PROBE-THEN-RENDER as a machine (internal/notes/INVARIANTS.md): a region request is received,
// prechecked (shape, expiry, key), charged a probe, verified (its MAC), charged a render, then
// rendered and sent, or refused at any step. Rendering, or charging the render budget, before the
// capability verifies is an illegal move, for a GET, a renewal and each hole of a batch.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { trace } from '@ogygia/machine';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/rate-limit', () => ({ rate_limit: { max: 100, windowMs: 60_000 } }));
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
const { region_request } = await import('../src/server/region-request.ts');

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
const forge = (url: string) => url.replace(/sig=[0-9a-f]+/, 'sig=' + '0'.repeat(64));

let moves: ReturnType<typeof trace> | null = null;
afterEach(() => {
	moves?.stop();
	moves = null;
});
/** The region-request moves, one line each, without the machine's number. */
const lines = () =>
	moves!
		.text()
		.split('\n')
		.filter((l) => l.startsWith('region request'))
		.map((l) => l.replace(/^region request#\d+ /, ''));

describe('a region request, as a machine', () => {
	it('the only way to rendering is through verified, then charged', () => {
		const into = (to: string) =>
			region_request
				.graph()
				.states.filter((s) => (s.steps as readonly string[]).includes(to))
				.map((s) => s.kind);
		expect(into('rendering')).toEqual(['charged']);
		expect(into('charged')).toEqual(['verified']);
		expect(into('verified')).toEqual(['probed']);
		expect(into('probed')).toEqual(['prechecked']);
		expect(into('prechecked')).toEqual(['received']);
	});

	it('render before verify is an illegal move', () => {
		const r = region_request.create();
		r.go('prechecked');
		r.go('probed');
		expect(() => r.go('rendering')).toThrow(/machine_illegal_move/);
		expect(() => r.go('charged')).toThrow(/machine_illegal_move/);
	});

	it('a GET walks every step in order', async () => {
		const h = handle();
		moves = trace();
		const res = await h({ event: event(mint_server_region(ID, { n: 1 })), resolve } as never);
		expect(res.status).toBe(200);
		expect(lines()).toEqual([
			'received -> prechecked',
			'prechecked -> probed',
			'probed -> verified',
			'verified -> charged',
			'charged -> rendering',
			'rendering -> sent'
		]);
	});

	it('a forged GET is refused after its probe, before any render charge', async () => {
		const h = handle();
		moves = trace();
		const res = await h({
			event: event(forge(mint_server_region(ID, { n: 1 }))),
			resolve
		} as never);
		expect(res.status).toBe(403);
		expect(lines()).toEqual([
			'received -> prechecked',
			'prechecked -> probed',
			'probed -> refused'
		]);
	});

	it('each hole of a batch walks the same steps; a forged one stops at verify', async () => {
		const h = handle();
		moves = trace();
		const calls = [mint_server_region(ID, { n: 1 }), forge(mint_server_region(ID, { n: 2 }))];
		const res = await h({
			event: event('/__ogygia__', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(calls)
			}),
			resolve
		} as never);
		await res.text();
		const all = lines();
		expect(all.filter((l) => l === 'rendering -> sent')).toHaveLength(1);
		expect(all.filter((l) => l === 'probed -> refused')).toHaveLength(1);
		expect(all.filter((l) => l === 'verified -> charged')).toHaveLength(1);
	});
});
