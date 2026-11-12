// A build's dock adds the beacon only to the documents of a browser that switched devtools on (a
// cookie, or `?og-devtools=on`), so such a document is that browser's own: a shared cache must not keep it.
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { DEVTOOLS_COOKIE, DEVTOOLS_ON, DEVTOOLS_PARAM } from '@ogygia/insights';

// (the dock's build flags are read once, as the module loads: one copy of it, loaded as a build's)
let server: typeof import('../src/server.ts').default;
beforeAll(async () => {
	vi.stubGlobal('__OGYGIA_DEVTOOLS__', true);
	vi.stubGlobal('__OGYGIA_DEVTOOLS_LAZY__', true);
	vi.resetModules();
	server = (await import('../src/server.ts')).default;
}, 60_000);
afterAll(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

function document_event(url: string, cookie?: string) {
	const headers = new Headers({ 'sec-fetch-dest': 'document' });
	return {
		request: new Request(url, { headers }),
		url: new URL(url),
		cookies: { get: (name: string) => (name === DEVTOOLS_COOKIE ? cookie : undefined) }
	};
}

async function handle(url: string, cookie?: string): Promise<Response> {
	const next = () =>
		Promise.resolve(
			new Response('<html><head></head></html>', {
				headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=60' }
			})
		);
	return server.handle!(
		{ event: document_event(url, cookie), options: {} } as never,
		next as never
	);
}

test('a document the beacon is added to (devtools switched on in the URL) is private and never stored', async () => {
	const res = await handle(`http://x.test/?${DEVTOOLS_PARAM}=${DEVTOOLS_ON}`);
	expect(res.headers.get('cache-control')).toBe('private, no-store');
});

test('a document the beacon is added to (devtools switched on by the cookie) is private and never stored', async () => {
	const res = await handle('http://x.test/', DEVTOOLS_ON);
	expect(res.headers.get('cache-control')).toBe('private, no-store');
});

test("a document of a browser that did not switch devtools on keeps the app's caching", async () => {
	const res = await handle('http://x.test/');
	expect(res.headers.get('cache-control')).toBe('public, max-age=60');
});
