// A PLUGIN'S SIGNED HOLE FINDS THE HANDLE SERVING IT, WHICHEVER RUN OF THE HANDLE MODULE THAT IS (#1598).
// In dev the handle module can run twice while the bundler keeps serving the first run's handle. A
// plugin keeps the app of its latest `setup` (federation's `fed_app()` is process-wide), so it opens
// its capability through the second run's budgets. Every hole once answered 429 there: the second run
// did not know the request the first run's handle was serving.
import { describe, expect, it, vi } from 'vitest';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));

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
				request(ctx: { event: { url: URL } }) {
					if (ctx.event.url.pathname !== '/plug/hole') return;
					const opened = plugin.app!.capability.open(ctx.event as never, MESSAGE);
					return opened.ok ? new Response('hole') : opened.response;
				}
			}
		}
	]
}));

async function ask(h: ReturnType<typeof import('../src/hooks.ts').handle>, path: string) {
	const url = new URL(path, 'https://app.test');
	return h({
		event: {
			url,
			request: new Request(url),
			getClientAddress: () => '203.0.113.9',
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

describe('a plugin hole when the handle module has run twice', () => {
	it("the first run's handle serves a hole the plugin opens through the second run's app", async () => {
		const first = (await import('../src/hooks.ts')).handle();
		vi.resetModules();
		await import('../src/hooks.ts');
		const { exp, sig, k } = plugin.app!.capability.mint(MESSAGE);
		const res = await ask(first, `/plug/hole?exp=${exp}&sig=${sig}&k=${k}`);
		expect(res.status, await res.clone().text()).toBe(200);
		expect(await res.text()).toBe('hole');
	});
});
