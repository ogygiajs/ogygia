/**
 * What a page postrender will not keep says so to every cache after it (`private, no-store`, when
 * the app set nothing), and only a 200 HTML page is stamped. A stored page is served until it is
 * exactly ttl old, and an If-Modified-Since equal to its Last-Modified is a 304.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import server, { postrender_response, type PostrenderServerOptions } from '../src/server.ts';
import { install, invalidate, mark_handled, reset_for_tests } from '../src/registry.ts';
import { MemoryStore } from '../src/memory-store.ts';
import type { PostrenderEntry } from '../src/types.ts';

vi.mock('$app/env', () => ({ building: false, dev: false, version: 'v1' }));

const options: PostrenderServerOptions = { ttl: 60, default: true };
const { ctx } = startPlugin(server, { name: '@ogygia/postrender', options });
const jar = { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} };

afterEach(() => {
	reset_for_tests();
	vi.restoreAllMocks();
});

const HTML = '<html><head></head><body>page</body></html>';
const html_response = (headers: Record<string, string> = {}, status = 200) =>
	new Response(HTML, { status, headers: { 'content-type': 'text/html', ...headers } });

/**
 * One GET of `path` through the plugin: the stored copy when there is one, else `rendered()` as the
 * render's answer. What goes out (`res`), and whether it came from the store.
 */
async function visit(
	runtime: ReturnType<typeof install>,
	path: string,
	rendered: () => Response = () => html_response(),
	o: { headers?: Record<string, string>; during?: () => Promise<void> } = {}
): Promise<{ res: Response; hit: boolean }> {
	const c = ctx(new Request(`http://x.test${path}`, { headers: o.headers ?? {} }), {
		cookies: jar as never
	});
	mark_handled(c.event, runtime);
	try {
		const hit = await server.page?.(c);
		if (hit) return { res: hit, hit: true };
		await o.during?.();
		const res = rendered();
		const replaced = await server.response?.(c, res);
		return { res: replaced ?? res, hit: false };
	} finally {
		await server.done?.(c);
	}
}

describe('a refused page is stamped no-store when the app set nothing', () => {
	it('a 200 HTML page that sets a cookie is refused and stamped, and never stored', async () => {
		const runtime = install({ store: new MemoryStore() });
		const first = await visit(runtime, '/a/', () => html_response({ 'set-cookie': 'a=1' }));
		expect(first.res.headers.get('cache-control')).toBe('private, no-store');
		expect((await visit(runtime, '/a/')).hit).toBe(false);
	});

	it('a 404 page is refused but not stamped', async () => {
		const runtime = install({ store: new MemoryStore() });
		const { res } = await visit(runtime, '/gone/', () => html_response({}, 404));
		expect(res.headers.get('cache-control')).toBeNull();
	});

	it('a page the app marked `private` is refused, and keeps the app’s header', async () => {
		const runtime = install({ store: new MemoryStore() });
		const first = await visit(runtime, '/p/', () => html_response({ 'cache-control': 'private' }));
		expect(first.res.headers.get('cache-control')).toBe('private');
		expect((await visit(runtime, '/p/')).hit).toBe(false);
	});

	it('a page the app marked `no-store` is refused', async () => {
		const runtime = install({ store: new MemoryStore() });
		await visit(runtime, '/n/', () => html_response({ 'cache-control': 'no-store' }));
		expect((await visit(runtime, '/n/')).hit).toBe(false);
	});

	it('a page rendered for a visitor with credentials is stamped', async () => {
		const runtime = install({ store: new MemoryStore() });
		const { res } = await visit(runtime, '/me/', undefined, {
			headers: { authorization: 'Bearer x' }
		});
		expect(res.headers.get('cache-control')).toBe('private, no-store');
	});

	it('a render invalidated while it ran is stamped, and not stored', async () => {
		const runtime = install({ store: new MemoryStore() });
		const { res } = await visit(runtime, '/news/', undefined, {
			during: () => invalidate('/news/')
		});
		expect(res.headers.get('cache-control')).toBe('private, no-store');
		expect((await visit(runtime, '/news/')).hit).toBe(false);
	});

	it('a stored page is not stamped', async () => {
		const runtime = install({ store: new MemoryStore() });
		const { res } = await visit(runtime, '/ok/');
		expect(res.headers.get('cache-control')).not.toContain('no-store');
		expect((await visit(runtime, '/ok/')).hit).toBe(true);
	});
});

describe('a request that joined a render', () => {
	it('an invalidation ends the render it joined: it renders the page anew, and that render is stored', async () => {
		const runtime = install({ store: new MemoryStore() });
		const open = (path: string) => {
			const c = ctx(new Request(`http://x.test${path}`), { cookies: jar as never });
			mark_handled(c.event, runtime);
			return c;
		};
		const a = open('/news/');
		expect(await server.page?.(a)).toBeUndefined();
		const b = open('/news/');
		const joined = server.page?.(b);
		await new Promise((r) => setTimeout(r, 0));
		await invalidate('/news/');
		expect(await joined).toBeUndefined();
		await server.response?.(b, html_response());
		await server.done?.(b);
		const late = html_response();
		await server.response?.(a, late);
		expect(late.headers.get('cache-control')).toBe('private, no-store');
		await server.done?.(a);
		expect((await visit(runtime, '/news/')).hit).toBe(true);
	});
});

describe('the ttl backstop', () => {
	it('a page 1 ms under ttl old is served; exactly ttl old is a miss', async () => {
		const store = new MemoryStore();
		const runtime = install({ store });
		const t0 = 1_700_000_000_000;
		const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
		const entry: PostrenderEntry = {
			kind: 'page',
			html: HTML,
			headers: { 'content-type': 'text/html' },
			created: t0 - 60_000 + 1,
			build: 'v1'
		};
		await store.put('/young/', entry, { ttl: 600 });
		await store.put('/old/', { ...entry, created: t0 - 60_000 }, { ttl: 600 });
		expect((await visit(runtime, '/young/')).hit).toBe(true);
		expect((await visit(runtime, '/old/')).hit).toBe(false);
		now.mockRestore();
	});
});

describe('If-Modified-Since', () => {
	const LAST = 'Wed, 21 Oct 2026 07:28:00 GMT';
	const entry: PostrenderEntry = {
		kind: 'page',
		html: HTML,
		headers: { 'content-type': 'text/html', 'last-modified': LAST, etag: '"e1"' },
		created: 0
	};
	const ask = (headers: Record<string, string>) =>
		postrender_response(entry, 'hit', new Request('http://x.test/', { headers })).status;

	it('equal to Last-Modified is a 304; a second earlier is the page', () => {
		expect(ask({ 'if-modified-since': LAST })).toBe(304);
		expect(ask({ 'if-modified-since': 'Wed, 21 Oct 2026 07:27:59 GMT' })).toBe(200);
	});

	it('an If-None-Match that does not match wins over a later If-Modified-Since', () => {
		expect(
			ask({ 'if-none-match': '"other"', 'if-modified-since': 'Thu, 22 Oct 2026 00:00:00 GMT' })
		).toBe(200);
	});
});
