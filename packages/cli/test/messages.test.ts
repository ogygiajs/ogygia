import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe('cli messages', () => {
	it('a CLI message prints its wording, then its page, in a production build too', async () => {
		vi.stubEnv('DEV', false);
		vi.stubEnv('PROD', true);
		vi.resetModules();
		const { line } = await import('../src/messages.ts');
		const text = line('cli_server_not_ready', { url: 'http://h/', ms: 10, output: '' });
		expect(text).toContain('the server did not answer at http://h/ within 10 ms');
		expect(text).toContain('https://ogygiajs.dev/e/cli_server_not_ready');
		expect(text.indexOf('the server')).toBeLessThan(text.indexOf('https://ogygiajs.dev/e/'));
	});
});
