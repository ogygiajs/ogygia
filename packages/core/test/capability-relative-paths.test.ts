// A region capability is a path from the root (`rule_capability_not_path`), whatever Kit's paths
// config. Kit's default is `paths.relative: true`, and its server `resolve()` then answers relative
// to the URL being rendered (`./__ogygia__` at `/p0`). The HTML that carries a capability moves: a
// hole's answer lands in a page at another depth, a peer's widget in another app's page, so a
// relative one points somewhere else. Found by the DST sim (a generated app, every seed).
import { describe, expect, it, vi } from 'vitest';

vi.mock('ogygia:server/secret', () => ({ build_key: 'test-secret', build_had_secret: false }));
vi.mock('ogygia:server/session-cookie', () => ({ session_cookie: null }));
vi.mock('ogygia:server/region-ttl', () => ({ region_ttl: 3600, renew_window: 691200 }));
vi.mock('ogygia:server/server-manifest', () => ({ region_url: {}, region_render: {} }));
vi.mock('ogygia:server/sign', () => ({
	sign: (_k: string, m: string) => 'sig' + m.length,
	region_sign: (_k: string, audience: string) => 'sig' + audience.length
}));
// Kit 2's server `resolve` with `paths.relative` (the default), while rendering `/p0`
vi.mock('$app/paths', () => ({
	base: '.',
	assets: '',
	asset: (p: string) => '.' + p,
	resolve: (p: string) => '.' + p
}));

const { mint_server_region } = await import('../src/server/region-endpoint.ts');

describe("a capability minted under Kit's relative paths", () => {
	it('is a path from the root, not one relative to the page being rendered', () => {
		expect(mint_server_region('abc123', {})).toMatch(/^\/__ogygia__\?id=abc123&/);
	});

	it("is a path from the root under the app's base (paths.base)", async () => {
		// Kit's build define: the configured base, absolute, whatever `paths.relative` says
		const g = globalThis as { __SVELTEKIT_PATHS_BASE__?: string };
		g.__SVELTEKIT_PATHS_BASE__ = '/shop';
		vi.resetModules();
		try {
			const fresh = await import('../src/server/region-endpoint.ts');
			expect(fresh.mint_server_region('abc123', {})).toMatch(/^\/shop\/__ogygia__\?id=abc123&/);
		} finally {
			delete g.__SVELTEKIT_PATHS_BASE__;
		}
	});
});
