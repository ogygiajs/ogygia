import { afterAll, expect, it, vi } from 'vitest';

vi.mock('$app/env', () => ({ building: true, browser: false, dev: false, version: 'test' }));
vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/server-plugins', () => ({ plugins: [] }));
vi.mock('ogygia:server/route-config', () => ({ route_config: {} }));
vi.mock('ogygia:server/devtools-boot-url', () => ({ devtools_boot_url: '' }));

const g = globalThis as unknown as Record<symbol, unknown>;
delete g[Symbol.for('ogygia.messages')];
delete g[Symbol.for('ogygia.prerendering')];
vi.stubEnv('DEV', false);
vi.stubEnv('SSR', true);
await import('../src/hooks.ts');
const island = await import('../src/messages/island.ts');

afterAll(() => {
	vi.unstubAllEnvs();
	delete g[Symbol.for('ogygia.prerendering')];
});

it("while prerendering, a message from code the server's render shares with islands is worded, not only its link", () => {
	const err = new island.OgygiaError('goto_not_http') as Error;
	expect(err.message).toContain('https://ogygiajs.dev/e/goto_not_http');
	expect(err.message.startsWith('[ogygia] https://')).toBe(false);
});
