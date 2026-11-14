// In dev nothing is stored, but the verdict still runs and teaches: a page it would store gets a
// `would-store` header, one it would refuse gets a note. The note must say what production does with
// the same response, so it is the store's own verdict, not a second list beside it.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { clearRouteConfig, startPlugin } from '@ogygia/core/plugin/testing';
import server, { type PostrenderServerOptions } from '../src/server.ts';
import { install, mark_handled, reset_for_tests } from '../src/registry.ts';
import { MemoryStore } from '../src/memory-store.ts';

vi.mock('$app/env', () => ({ building: false, dev: true, version: 'test' }));

const options: PostrenderServerOptions = { ttl: 60, default: true };
const { ctx } = startPlugin(server, { name: '@ogygia/postrender', options });
afterEach(() => {
	reset_for_tests();
	clearRouteConfig();
});

/** The dev answer for one GET of /page/ that the app answered with `response`. */
async function dev_answer(response: Response): Promise<string | null> {
	const runtime = install({ store: new MemoryStore() });
	const cookies = { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} };
	const c = ctx(new Request('http://x.test/page/'), {
		cookies: cookies as never,
		route: { id: '/page' } as never
	});
	mark_handled(c.event, runtime);
	await server.page?.(c);
	await server.response?.(c, response);
	await server.done?.(c);
	return response.headers.get('x-ogygia-postrender');
}

const html = (headers: Record<string, string> = {}) =>
	new Response('<html><head></head><body>hi</body></html>', {
		headers: { 'content-type': 'text/html', ...headers }
	});

describe('the dev note says what production does', () => {
	it('a plain page: would store', async () => {
		expect(await dev_answer(html())).toBe('would-store');
	});

	it('a page the app marked no-store: not would-store (production refuses it)', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await dev_answer(html({ 'cache-control': 'no-store' }))).toBeNull();
		expect(await dev_answer(html({ 'cache-control': 'private, max-age=60' }))).toBeNull();
	});

	it('a permanent redirect: would store (production stores it)', async () => {
		const redirect = new Response(null, { status: 301, headers: { location: '/new/' } });
		expect(await dev_answer(redirect)).toBe('would-store');
	});
});
