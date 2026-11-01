/**
 * `postrender.handle()` and the read path that depends on it: the handle's settings reach the stage
 * inside ogygia's handle through the request it marked; the two setup mistakes are named, never
 * silent (no handle → the memory store and one warning; a handle that runs after ogygia's → an error in
 * dev, one warning in production); and Kit's `config` decides which pages are eligible.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { startPlugin, setPageRouteConfig, clearRouteConfig } from '@ogygia/core/plugin/testing';
import server, {
	MISSING_HANDLE,
	MISORDERED_HANDLE,
	type PostrenderServerOptions
} from '../src/server.ts';
import { postrender } from '../src/index.ts';
import { memory_store } from '../src/memory-store.ts';
import { current_runtime, reset_for_tests } from '../src/registry.ts';
import { set_postrender_app } from '../src/app.ts';
import type { PostrenderEntry, PostrenderStore } from '../src/types.ts';

const env = vi.hoisted(() => ({ dev: false }));
vi.mock('$app/env', () => ({
	building: false,
	get dev() {
		return env.dev;
	}
}));

const page_entry = (html = '<html><head></head><body>stored</body></html>'): PostrenderEntry => ({
	kind: 'page',
	html,
	headers: { 'content-type': 'text/html' },
	created: Date.now()
});

/** A store already holding `/a` and `/p`. */
async function seeded(): Promise<PostrenderStore> {
	const store = memory_store();
	await store.put('/a', page_entry(), { ttl: 60 });
	await store.put('/p', page_entry(), { ttl: 60 });
	return store;
}

/** Start the server realm and make a request context for `path` (a cookie jar the observer can patch). */
function start(options: PostrenderServerOptions = { ttl: 60, default: true }) {
	const { ctx } = startPlugin(server, { name: '@ogygia/postrender', options });
	return (path: string, route_id: string | null = null) =>
		ctx(new Request(`http://x${path}`), {
			route: { id: route_id },
			cookies: {
				get: () => undefined,
				getAll: () => [],
				set: () => {},
				delete: () => {},
				serialize: () => ''
			}
		} as unknown as Partial<RequestEvent>);
}

/** Run `handle` the way Kit's `sequence()` does: the same event, then resolve. */
async function run(handle: ReturnType<typeof postrender.handle>, event: RequestEvent) {
	await handle({ event, resolve: async () => new Response('resolved') });
}

const via = (res: unknown) => (res as Response | undefined)?.headers.get('x-ogygia-postrender');

let warn: ReturnType<typeof vi.spyOn>;
const warned = (text: string) =>
	warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes(text)).length;

beforeEach(() => {
	env.dev = false;
	reset_for_tests();
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	warn.mockRestore();
	clearRouteConfig();
	reset_for_tests();
});

describe('postrender.handle() — settings reach the read path through the request', () => {
	it('returns a Kit handle that resolves; its store answers the request it saw', async () => {
		const ctx = start();
		const handle = postrender.handle({ store: await seeded() });
		const c = ctx('/a');
		// Kit's `sequence()` hands each handle its own traced copy of the event: only the request is shared
		const traced = { ...c.event } as RequestEvent;
		const res = await handle({ event: traced, resolve: async () => new Response('resolved') });
		expect(await res.text()).toBe('resolved');
		const answer = await server.page!(c);
		expect(via(answer)).toBe('hit');
		expect(warned('postrender.handle()')).toBe(0); // the right order: nothing to say
	});

	it('invalidate reaches the store the handle was given, with no configure step', async () => {
		start();
		const store = await seeded();
		postrender.handle({ store });
		await postrender.invalidate('/a');
		expect(await store.get('/a')).toBeNull();
		expect(await store.get('/p')).not.toBeNull();
		await postrender.invalidateWhere({ prefix: '/' });
		expect(await store.get('/p')).toBeNull();
	});

	it('warns once when vite.config does not list postrender() (the server half never started)', async () => {
		const handle = postrender.handle();
		set_postrender_app(null);
		const event = { request: new Request('http://x/') } as RequestEvent;
		await run(handle, event);
		await run(handle, event);
		expect(warned('`postrender()` is not listed')).toBe(1);
	});
});

describe('a missing postrender.handle()', () => {
	for (const dev of [true, false])
		it(`falls back to the memory store and warns once, naming the fix (${dev ? 'dev' : 'production'})`, async () => {
			env.dev = dev;
			const ctx = start();
			await current_runtime().store.put('/a', page_entry(), { ttl: 60 });
			const first = await server.page!(ctx('/a'));
			await server.page!(ctx('/a'));
			expect(warned(MISSING_HANDLE)).toBe(1);
			expect(MISSING_HANDLE).toContain(
				'export const handle = sequence(postrender.handle(), ogygia.handle());'
			);
			if (!dev) expect(via(first)).toBe('hit'); // the memory default serves
		});
});

describe('postrender.handle() after ogygia.handle()', () => {
	it('dev: the read path throws a clear error naming the fix', async () => {
		env.dev = true;
		const ctx = start();
		postrender.handle({ store: await seeded() }); // made, but this request never went through it
		await expect(server.page!(ctx('/a'))).rejects.toThrow(MISORDERED_HANDLE);
		expect(MISORDERED_HANDLE).toContain('must run before ogygia.handle()');
		expect(MISORDERED_HANDLE).toContain('sequence(postrender.handle(), ogygia.handle())');
	});

	it('production: warns once and still serves from the handle’s store', async () => {
		const ctx = start();
		postrender.handle({ store: await seeded() });
		const first = await server.page!(ctx('/a'));
		const second = await server.page!(ctx('/a'));
		expect(via(first)).toBe('hit');
		expect(via(second)).toBe('hit');
		expect(warned(MISORDERED_HANDLE)).toBe(1);
	});
});

describe('the TTL backstop on read', () => {
	/** A store with no expiry of its own: it keeps whatever it is given until it is evicted. */
	function keeping_store(): PostrenderStore {
		const map = new Map<string, PostrenderEntry>();
		return {
			get: async (key) => map.get(key) ?? null,
			put: async (key, entry) => void map.set(key, entry),
			evict: async (key) => void map.delete(key),
			evictWhere: async () => {}
		};
	}

	it('a page older than the ttl is a miss, even from a store that never expires it', async () => {
		const ctx = start({ ttl: 60, default: true });
		const store = keeping_store();
		await store.put('/fresh', page_entry(), { ttl: 60 });
		await store.put('/stale', { ...page_entry(), created: Date.now() - 61_000 }, { ttl: 60 });
		const handle = postrender.handle({ store });
		const fresh = ctx('/fresh');
		await run(handle, fresh.event);
		expect(via(await server.page!(fresh))).toBe('hit');
		const stale = ctx('/stale');
		await run(handle, stale.event);
		expect(await server.page!(stale)).toBeUndefined(); // rendered again (and stored over it)
	});
});

describe('Kit’s `config` decides eligibility', () => {
	it('`config.postrender: false` on the route turns the read path off (default on)', async () => {
		setPageRouteConfig({ '/p': { postrender: false } });
		const ctx = start();
		const handle = postrender.handle({ store: await seeded() });
		const off = ctx('/p', '/p');
		await run(handle, off.event);
		expect(await server.page!(off)).toBeUndefined(); // the stored copy is never served
		const on = ctx('/a', '/a');
		await run(handle, on.event);
		expect(via(await server.page!(on))).toBe('hit');
	});

	it('`config.postrender: true` turns it on when the app-wide default is off', async () => {
		setPageRouteConfig({ '/p': { postrender: true } });
		const ctx = start({ ttl: 60, default: false });
		const handle = postrender.handle({ store: await seeded() });
		const on = ctx('/p', '/(group)/p'); // Kit's route id, groups and all
		await run(handle, on.event);
		expect(via(await server.page!(on))).toBe('hit');
		const off = ctx('/a', '/a'); // sets nothing: the default (off) applies
		await run(handle, off.event);
		expect(await server.page!(off)).toBeUndefined();
	});

	it('a value that is not a boolean warns once and leaves the default in charge', async () => {
		setPageRouteConfig({ '/p': { postrender: 'yes' } });
		const ctx = start();
		const handle = postrender.handle({ store: await seeded() });
		const c = ctx('/p', '/p');
		await run(handle, c.event);
		expect(via(await server.page!(c))).toBe('hit'); // default on
		expect(warned('`config.postrender` must be true or false')).toBe(1);
	});
});
