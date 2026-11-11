// A package's e2e suite config (src/e2e/config.ts): what `suite()` gives Playwright.
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { e2e_browsers, suite } from '../src/e2e/config.ts';

const BUILD = fileURLToPath(new URL('../src/e2e/build.ts', import.meta.url));

type Server = { command: string; env: Record<string, string>; reuseExistingServer: boolean };
const server = (c: ReturnType<typeof suite>) => c.webServer as Server;

describe('suite', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('every spec runs in each engine: one project per browser', () => {
		vi.stubEnv('OGYGIA_BROWSERS', 'firefox,webkit');
		expect(suite({ port: 4100 }).projects).toEqual([
			{ name: 'firefox', use: { browserName: 'firefox' } },
			{ name: 'webkit', use: { browserName: 'webkit' } }
		]);
		vi.stubEnv('OGYGIA_BROWSERS', 'netscape');
		expect(() => e2e_browsers()).toThrow('"netscape" is not chromium, firefox or webkit');
	});

	it('the fixture apps under e2e/ are not read for specs', () => {
		expect(suite({ port: 4100 }).testIgnore).toEqual(['**/node_modules/**', '**/app/**']);
	});

	it('specs run one at a time: the fixture app keeps state they share', () => {
		const c = suite({ port: 4100 });
		expect(c.workers).toBe(1);
		expect(c.fullyParallel).toBe(false);
	});

	it('E2E_SHARD picks a share of the spec files (an env var, not a CLI flag); a bad one throws', () => {
		vi.stubEnv('E2E_SHARD', '2/3');
		expect(suite({ port: 4100 }).shard).toEqual({ current: 2, total: 3 });
		vi.stubEnv('E2E_SHARD', '');
		expect(suite({ port: 4100 }).shard).toBeNull();
		vi.stubEnv('E2E_SHARD', '4/3');
		expect(() => suite({ port: 4100 })).toThrow('E2E_SHARD must look like 2/3');
	});

	it('each lane of one suite writes its own output folder', () => {
		vi.stubEnv('E2E_LANE', '');
		expect(suite({ port: 4100 }).outputDir).toBe('test-results');
		vi.stubEnv('E2E_LANE', '2');
		expect(suite({ port: 4100 }).outputDir).toBe('test-results/lane-2');
	});

	it('E2E_PORT_OFFSET moves the served port', () => {
		vi.stubEnv('E2E_PORT_OFFSET', '50');
		expect(suite({ port: 4100 }).use?.baseURL).toBe('http://localhost:4150');
	});

	it('a served app is built and previewed in one command chain, never an earlier server', () => {
		vi.stubEnv('E2E_PORT_OFFSET', '');
		const s = server(suite({ port: 4100, serve: '/apps/x' }));
		expect(s.command).toBe(
			`node ${BUILD} && node node_modules/vite/bin/vite.js preview --port 4100 --strictPort`
		);
		expect(s.reuseExistingServer).toBe(false);
		expect(s.env.ORIGIN).toBe('http://localhost:4100');
	});

	it('a suite with no server builds its app in a globalSetup', () => {
		const c = suite({ port: 4100, build: '/apps/x' });
		expect(c.globalSetup).toBe(BUILD);
		expect(c.metadata).toEqual({ build: '/apps/x' });
		expect(c.webServer).toBeUndefined();
	});
});
