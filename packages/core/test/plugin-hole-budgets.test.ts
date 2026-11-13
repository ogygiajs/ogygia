// A PLUGIN'S SIGNED HOLE PAYS THE REGION BUDGETS, IN THE SAME ORDER (PROBE-THEN-RENDER,
// internal/notes/INVARIANTS.md). A capability a plugin mints (federation's `/og/frag` hole) is opened
// as a region hole is: the visitor's probe budget before any HMAC, so a forged flood costs no HMAC
// past it; the render budget after the signature checks, so a flood of one valid link stops there too.
// And a plugin cannot open one any other way: its plain `sign` / `verify` refuse a capability message.
import { describe, expect, it, vi } from 'vitest';

const hmac = vi.hoisted(() => ({ verifies: 0 }));
vi.mock('../src/server/hmac.ts', async (orig) => {
	const m = (await orig()) as Record<string, (...a: unknown[]) => unknown>;
	return {
		...m,
		verify: (...a: unknown[]) => {
			hmac.verifies++;
			return m.verify(...a);
		}
	};
});
vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
// render budget 2 a minute; the probe budget is then its floor, 120
vi.mock('ogygia:server/rate-limit', () => ({ rate_limit: { max: 2, windowMs: 60_000 } }));

const plugin = vi.hoisted(() => ({
	app: null as null | import('../src/plugin/index.ts').ServerApp
}));
const MESSAGE = (exp: string) => `hole|${exp}`;
vi.mock('ogygia:server/server-plugins', () => ({
	plugins: [
		{
			name: 'holes',
			options: undefined,
			server: {
				setup(app: NonNullable<typeof plugin.app>) {
					plugin.app = app;
				},
				request(ctx: { event: { url: URL }; app: NonNullable<typeof plugin.app> }) {
					if (ctx.event.url.pathname !== '/plug/hole') return;
					const opened = ctx.app.capability.open(ctx.event as never, MESSAGE);
					return opened.ok ? new Response('hole') : opened.response;
				}
			}
		}
	]
}));

const { handle } = await import('../src/hooks.ts');
const h = handle();

function hole_url(sig?: string): string {
	const { exp, sig: good, k } = plugin.app!.capability.mint(MESSAGE);
	return `/plug/hole?exp=${exp}&sig=${sig ?? good}&k=${k}`;
}

async function ask(path: string, address: string): Promise<Response> {
	const url = new URL(path, 'https://app.test');
	return h({
		event: {
			url,
			request: new Request(url),
			getClientAddress: () => address,
			cookies: { get: () => undefined, getAll: () => [] },
			route: { id: null },
			params: {},
			isDataRequest: false,
			setHeaders() {},
			platform: undefined,
			locals: {}
		} as never,
		resolve: async () => new Response('page')
	});
}

describe('a plugin hole and the region budgets', () => {
	it('a forged flood is refused by the probe budget before any HMAC', async () => {
		const forged = hole_url('forged');
		let last: Response | null = null;
		for (let i = 0; i < 120; i++) last = await ask(forged, '203.0.113.1');
		expect(last!.status, 'within the probe budget: the signature refuses').toBe(403);
		const before = hmac.verifies;
		const over = await ask(forged, '203.0.113.1');
		expect(over.status).toBe(429);
		expect(over.headers.get('retry-after')).toMatch(/^\d+$/);
		expect(hmac.verifies, 'no HMAC for a request over the probe budget').toBe(before);
	});

	it('a flood of one valid link stops at the render budget', async () => {
		const good = hole_url();
		expect((await ask(good, '203.0.113.2')).status).toBe(200);
		expect((await ask(good, '203.0.113.2')).status).toBe(200);
		const over = await ask(good, '203.0.113.2');
		expect(over.status).toBe(429);
		expect(over.headers.get('retry-after')).toMatch(/^\d+$/);
		expect((await ask(good, '203.0.113.3')).status, 'another visitor has its own').toBe(200);
	});

	it("a plugin's plain sign and verify refuse a capability message", () => {
		const app = plugin.app!;
		expect(() => app.sign('cap|hole|1')).toThrow(/plugin_capability_message/);
		expect(() => app.verify('cap|hole|1', 'x')).toThrow(/plugin_capability_message/);
		expect(app.verify('hole|1', app.sign('hole|1'))).toBe(true);
	});
});
