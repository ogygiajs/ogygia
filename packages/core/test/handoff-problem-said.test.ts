// A production server with no client-build handoff (og-region-deps.json) renders every hole without
// its CSS and preloads. The handle says so, with a code, once while the problem lasts; a handoff
// found again ends it, and a new problem is said again.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/server-plugins', () => ({ plugins: [] }));
vi.mock('ogygia:server/route-config', () => ({ route_config: {} }));
vi.mock('ogygia:server/devtools-boot-url', () => ({ devtools_boot_url: '' }));

const { handle } = await import('../src/hooks.ts');
const { set_handoff_problem } = await import('./_stubs/server.region-deps.ts');

const event = () => {
	const u = new URL('/page', 'https://app.test');
	return {
		url: u,
		request: new Request(u),
		getClientAddress: () => '1.2.3.4',
		cookies: { get: () => undefined },
		route: { id: null },
		params: {},
		isDataRequest: false,
		setHeaders() {},
		platform: undefined,
		locals: {}
	} as never;
};
const resolve = async () => new Response('page');
let errors: string[] = [];
const said = () => errors.filter((e) => e.includes('island_deps_handoff_missing')).length;

describe('the client build handoff, in production', () => {
	beforeEach(() => {
		errors = [];
		vi.stubEnv('DEV', false);
		vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
			errors.push(a.map(String).join(' '));
		});
	});
	afterEach(() => {
		set_handoff_problem(null);
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it('a missing handoff is said once, with the paths tried, however many requests follow', async () => {
		set_handoff_problem({ kind: 'missing', tried: ['/srv/og-region-deps.json'] });
		const h = handle();
		for (let i = 0; i < 3; i++) await h({ event: event(), resolve } as never);
		expect(said()).toBe(1);
		const message = errors.find((e) => e.includes('island_deps_handoff_missing'))!;
		expect(decodeURIComponent(message)).toContain('/srv/og-region-deps.json');
	});

	it('a handoff found again ends the problem; a new one is said again', async () => {
		const h = handle();
		set_handoff_problem({ kind: 'unreadable', tried: ['/a'], error: 'bad json' });
		await h({ event: event(), resolve } as never);
		set_handoff_problem(null);
		await h({ event: event(), resolve } as never);
		set_handoff_problem({ kind: 'unreadable', tried: ['/a'], error: 'bad json' });
		await h({ event: event(), resolve } as never);
		expect(said()).toBe(2);
	});

	it('a server with its handoff says nothing', async () => {
		await handle()({ event: event(), resolve } as never);
		expect(said()).toBe(0);
	});
});
