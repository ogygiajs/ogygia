import { afterEach, describe, expect, it, vi } from 'vitest';
import { federate } from '../src/federate.ts';
import { set_federation } from '../src/registry.ts';
import { reset_deploy_thaw_for_tests, serve_federation } from '../src/serve.ts';
import { startPlugin } from '@ogygia/core/plugin/testing';
import fed_server from '../src/server.ts';

startPlugin(fed_server, { name: '@ogygia/federation' });

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	set_federation(null);
	reset_deploy_thaw_for_tests();
});

/** An app that exposes its table, and the URL every request the table got carried. */
function exposing(): string[] {
	const seen: string[] = [];
	vi.stubGlobal('fetch', async () => new Response('{}'));
	federate({
		name: 'cms',
		expose: {
			fetch: async (req: Request) => {
				seen.push(req.url);
				return new Response('<html><head></head><body>ok</body></html>', {
					headers: { 'content-type': 'text/html' }
				});
			}
		} as never,
		peers: {},
		open: true
	});
	return seen;
}

const ask = (path: string, search = '') => {
	const url = new URL('https://cms.internal/og/fragment/page');
	url.searchParams.set('path', path);
	if (search) url.searchParams.set('search', search);
	return serve_federation({ url, request: new Request(url) } as never);
};

describe('an exposed table is asked on its own origin, whatever path the caller sent', () => {
	for (const path of ['//other.example/me', '/\\other.example/me', '///other.example', '\\\\x']) {
		it(`path ${JSON.stringify(path)} is refused, and never reaches the table`, async () => {
			const seen = exposing();
			const res = (await ask(path))!;
			expect(res.status).toBe(400);
			expect(seen).toEqual([]);
		});
	}

	it('a path without its leading slash gets one, on the app’s origin', async () => {
		const seen = exposing();
		await ask('me');
		expect(seen).toEqual(['https://cms.internal/me']);
	});

	it('a search that is not a query string stays the query', async () => {
		const seen = exposing();
		await ask('/me', '@other.example/x');
		expect(new URL(seen[0]).origin).toBe('https://cms.internal');
		expect(new URL(seen[0]).pathname).toBe('/me');
	});

	it('a plain path and query reach the table as sent', async () => {
		const seen = exposing();
		await ask('/me', '?a=1');
		expect(seen[0]).toBe('https://cms.internal/me?a=1');
	});
});
