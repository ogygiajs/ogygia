/**
 * Postrender stores and serves PAGE requests only (#954). Kit hands a remote function call (a
 * `query`, a `query.live`) the URL of the page that made it and marks it `isRemoteRequest`; by its
 * URL alone it looked like a GET of a stored page, and got the page's HTML for its answer.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import server, { type PostrenderServerOptions } from '../src/server.ts';
import { install, mark_handled, reset_for_tests } from '../src/registry.ts';
import { MemoryStore } from '../src/memory-store.ts';

vi.mock('$app/env', () => ({ building: false, dev: false, version: 'test' }));

const options: PostrenderServerOptions = { ttl: 60, default: true };
const { ctx } = startPlugin(server, { name: '@ogygia/postrender', options });
const jar = { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} };
const PAGE = '<html><head></head><body><p>the page</p></body></html>';

afterEach(() => reset_for_tests());

describe('a remote call made from a stored page', () => {
	it('is not answered with the stored page: the call runs', async () => {
		const runtime = install({ store: new MemoryStore() });
		const request = (remote: boolean) => {
			const c = ctx(new Request('http://x.test/p/'), {
				cookies: jar as never,
				...(remote ? { isRemoteRequest: true } : {})
			} as never);
			mark_handled(c.event, runtime);
			return c;
		};
		// the page is rendered and stored
		const first = request(false);
		expect(await server.page?.(first)).toBeUndefined();
		await server.response?.(
			first,
			new Response(PAGE, { headers: { 'content-type': 'text/html' } })
		);
		server.done?.(first);
		const again = request(false);
		expect(await server.page?.(again)).toBeInstanceOf(Response); // stored: a page GET is a hit
		server.done?.(again);

		// the page's island calls a query: Kit gives the call the page's URL
		const call = request(true);
		expect(await server.page?.(call)).toBeUndefined();
		server.done?.(call);
	});

	it('is never stored as the page on a miss', async () => {
		const store = new MemoryStore();
		const runtime = install({ store });
		const c = ctx(new Request('http://x.test/q/'), {
			cookies: jar as never,
			isRemoteRequest: true
		} as never);
		mark_handled(c.event, runtime);
		expect(await server.page?.(c)).toBeUndefined();
		await server.response?.(
			c,
			new Response('{"type":"result","result":"1"}', {
				headers: { 'content-type': 'text/html' }
			})
		);
		server.done?.(c);
		expect(await store.get('/q/')).toBeNull();
	});
});
