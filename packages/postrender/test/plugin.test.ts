/**
 * The postrender plugin as core sees it: its Vite value (name, normalized options, the `postrender`
 * key it claims inside Kit's `config`) and its server realm started the way the handle starts it —
 * the shared hooks it calls (`invalidated`) and answers (`lastBuild`).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { clearRouteConfig, setPageRouteConfig, startPlugin } from '@ogygia/core/plugin/testing';
import { register_hooks, ask } from '../../core/src/plugin/hooks.ts';
import type { PluginDefinition } from '@ogygia/compiler/vite';
import { postrender as postrenderPlugin } from '../src/vite.ts';
import server, { type PostrenderServerOptions } from '../src/server.ts';
import { postrender } from '../src/index.ts';
import { install, mark_handled, reset_for_tests } from '../src/registry.ts';
import { MemoryStore } from '../src/memory-store.ts';
import type { PostrenderEntry } from '../src/types.ts';

/** the definition `definePlugin` put on the Vite plugin */
const definition = (plugin: ReturnType<typeof postrenderPlugin>) =>
	(plugin as unknown as Record<symbol, PluginDefinition<PostrenderServerOptions>>)[
		Symbol.for('ogygia.plugin')
	];

// The server half reads Kit's `$app/env`; outside an app, nothing is building and this is no dev server.
vi.mock('$app/env', () => ({ building: false, dev: false }));

describe('postrender() — the vite value', () => {
	it('names the package and normalizes its options', () => {
		const plugin = postrenderPlugin();
		const options = (o?: Parameters<typeof postrenderPlugin>[0]) =>
			definition(postrenderPlugin(o)).options;
		expect(plugin.name).toBe('@ogygia/postrender');
		expect(options()).toEqual({ ttl: 86400, default: true });
		expect(options({ ttl: 999_999 })?.ttl).toBe(86400);
		expect(options({ ttl: 0 })?.ttl).toBe(1);
		expect(options({ ttl: 12.7 })?.ttl).toBe(12);
		expect(options({ default: false })?.default).toBe(false);
	});

	it('its build hook claims the `postrender` key inside Kit’s `config`', () => {
		const keys: string[] = [];
		definition(postrenderPlugin()).build!({
			root: '/',
			dev: true,
			routeConfig: (k) => void keys.push(k),
			foreignHydrate: () => {},
			macro: () => {},
			markup: () => ({ transform: () => null }),
			events: () => {},
			measure: () => {},
			files: () => {},
			pageModules: () => {},
			transform: () => {},
			exports: { map: () => Promise.resolve(null) },
			pinnedImports: () => () => false,
			regions: { names: () => ({}), barrelWhy: () => [] }
		});
		expect(keys).toEqual(['postrender']);
	});
});

describe('the server realm, started', () => {
	const options: PostrenderServerOptions = { ttl: 60, default: true };
	const { ctx } = startPlugin(server, { name: '@ogygia/postrender', options });
	afterEach(() => reset_for_tests());

	// A successful form post on a page with a stored copy: the redirect's GET comes right after the
	// response, and must not get the copy from before the post.
	it('a POST evicts its page before its response goes out: the GET right after renders fresh (#283)', async () => {
		const store = new MemoryStore();
		const evict = store.evict.bind(store);
		// a remote store: an evict is a 200 ms round trip
		store.evict = async (key) => {
			await new Promise((r) => setTimeout(r, 200));
			return evict(key);
		};
		const runtime = install({ store });
		const before: PostrenderEntry = {
			kind: 'page',
			html: '<p>cart: empty</p>',
			headers: { 'content-type': 'text/html' },
			created: Date.now()
		};
		await store.put('/cart/', before, { ttl: 60, tags: [] });

		const post = ctx(new Request('http://x.test/cart/', { method: 'POST' }));
		mark_handled(post.event, runtime);
		await server.page?.(post);
		await server.response?.(
			post,
			new Response(null, { status: 303, headers: { location: '/cart/' } })
		);
		server.done?.(post);

		// the browser follows the 303 at once
		const jar = {
			get: () => undefined,
			getAll: () => [],
			set: () => {},
			delete: () => {}
		};
		const get = ctx(new Request('http://x.test/cart/'), { cookies: jar as never });
		mark_handled(get.event, runtime);
		const answered = await server.page?.(get);
		server.done?.(get);
		expect(answered).toBeUndefined(); // a miss: the page renders fresh, with the post applied
	});

	it('an invalidation announces what it dropped through the shared `invalidated` hook', async () => {
		const heard: (string[] | 'all')[] = [];
		const leave = register_hooks({
			invalidated: (tags: string[] | 'all') => void heard.push(tags)
		});
		try {
			await postrender.invalidate('/x');
			await postrender.invalidateWhere({ prefix: '/a/' });
			await Promise.resolve();
			expect(heard).toEqual([['p:/x'], 'all']);
		} finally {
			leave();
		}
	});

	// A render's store write is out when a publish evicts its page: the write lands after the evict,
	// and the render (now stale) takes its page back out. A GET between the two must not get it.
	it('a page written after a publish evicted it is never served while it is taken back out', async () => {
		const store = new MemoryStore();
		const held: Array<() => void> = [];
		const hold =
			<A extends unknown[], R>(op: (...a: A) => Promise<R>) =>
			(...a: A) =>
				new Promise<R>((r) => held.push(() => r(op(...a))));
		const real_put = store.put.bind(store);
		const real_evict = store.evict.bind(store);
		const runtime = install({ store });
		const jar = { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} };
		const get = () => {
			const c = ctx(new Request('http://x.test/news/'), { cookies: jar as never });
			mark_handled(c.event, runtime);
			return c;
		};

		// a visitor's render of /news/ is stored: its write to a remote store is slow
		store.put = hold(real_put);
		const first = get();
		expect(await server.page?.(first)).toBeUndefined();
		const html = '<html><head></head><body><p>news: before</p></body></html>';
		const responded = server.response?.(
			first,
			new Response(html, { headers: { 'content-type': 'text/html' } })
		);
		await new Promise((r) => setTimeout(r, 0));
		expect(held).toHaveLength(1); // the write is out
		// the editor publishes /news/: its evict runs (there is nothing stored yet)
		await postrender.invalidate('/news/');
		// the write lands now, after the evict; the render, stale, takes it back out (slow too)
		store.evict = hold(real_evict);
		held.shift()!();
		await new Promise((r) => setTimeout(r, 0));
		expect(held).toHaveLength(1); // the evict is out
		// a GET in between: the copy in the store is the page from before the publish
		const second = get();
		const answered = await server.page?.(second);
		server.done?.(second);
		expect(answered).toBeUndefined(); // a miss: it renders the page as it is now
		held.shift()!();
		await responded;
		server.done?.(first);
	});

	it('answers `lastBuild`: nothing the first time, the previous build after that', async () => {
		expect(await ask.lastBuild('v1')).toBeUndefined();
		expect(await ask.lastBuild('v2')).toBe('v1');
	});

	it('remembers the build past the pages’ TTL: a deploy a month later still finds it', async () => {
		const puts: { key: string; ttl: number }[] = [];
		const store = new MemoryStore();
		const put = store.put.bind(store);
		store.put = (key, entry, options) => {
			puts.push({ key, ttl: options.ttl });
			return put(key, entry, options);
		};
		install({ store });
		const now = vi.spyOn(Date, 'now');
		const t0 = Date.now();
		now.mockReturnValue(t0);
		try {
			expect(await ask.lastBuild('v1')).toBeUndefined();
			now.mockReturnValue(t0 + 30 * 86_400_000);
			expect(await ask.lastBuild('v1')).toBe('v1'); // the same build booting again
			now.mockReturnValue(t0 + 60 * 86_400_000);
			expect(await ask.lastBuild('v2')).toBe('v1');
			// written on every ask, never under the pages' one-day cap
			expect(puts).toHaveLength(3);
			for (const p of puts) expect(p.ttl).toBeGreaterThan(365 * 86_400);
		} finally {
			now.mockRestore();
		}
	});
});

describe('a page rendered for one visitor is never served to another', () => {
	const options: PostrenderServerOptions = { ttl: 60, default: true };
	const { ctx } = startPlugin(server, { name: '@ogygia/postrender', options });
	afterEach(() => {
		reset_for_tests();
		clearRouteConfig();
	});

	const jar = (cookies: Record<string, string>) => ({
		get: (n: string) => cookies[n],
		getAll: () => Object.entries(cookies).map(([name, value]) => ({ name, value })),
		set: () => {},
		delete: () => {}
	});
	/** One visitor's request for /account/: the render runs `render` against the event, answers its
	 *  HTML, and the request ends. What the plugin answered first (a stored page, or nothing). */
	async function visit(
		runtime: ReturnType<typeof install>,
		who: { cookie?: string; auth?: () => Promise<{ name: string } | null> },
		render: (event: { locals: Record<string, unknown> }) => Promise<string>
	) {
		const request = new Request('http://x.test/account/', {
			headers: who.cookie ? { cookie: who.cookie } : {}
		});
		const session = who.cookie ? Object.fromEntries([who.cookie.split('=')]) : {};
		const c = ctx(request, {
			cookies: jar(session) as never,
			locals: { auth: who.auth ?? (async () => null) } as never,
			route: { id: '/account' } as never
		});
		mark_handled(c.event, runtime);
		const answered = await server.page?.(c);
		if (answered) {
			server.done?.(c);
			return answered;
		}
		const html = `<html><head></head><body>${await render(c.event as never)}</body></html>`;
		await server.response?.(c, new Response(html, { headers: { 'content-type': 'text/html' } }));
		server.done?.(c);
		return undefined;
	}
	const greeting = async (event: { locals: Record<string, unknown> }) => {
		const user = await (event.locals.auth as () => Promise<{ name: string } | null>)();
		return `<p>hello ${user?.name ?? 'guest'}</p>`;
	};

	it('two visitors: Alice’s signed-in page never reaches Bob', async () => {
		const runtime = install({ store: new MemoryStore() });
		const alice = { cookie: 'session=alice', auth: async () => ({ name: 'Alice' }) };
		expect(await visit(runtime, alice, greeting)).toBeUndefined();
		const bob = await visit(runtime, {}, greeting);
		const body = bob ? await bob.text() : '';
		expect(body).not.toContain('Alice');
	});

	it('a request with a cookie or authorization is not stored, even when the render read nothing', async () => {
		const store = new MemoryStore();
		const runtime = install({ store });
		const plain = async () => '<p>same for all</p>';
		await visit(runtime, { cookie: 'consent=yes' }, plain);
		expect(await store.get('/account/')).toBeNull();
	});

	it("a route that sets `config.postrender = 'with-credentials'` is stored from such a request", async () => {
		setPageRouteConfig({ '/account': { postrender: 'with-credentials' } });
		const store = new MemoryStore();
		const runtime = install({ store });
		await visit(runtime, { cookie: 'consent=yes' }, async () => '<p>same for all</p>');
		expect(await store.get('/account/')).not.toBeNull();
	});

	it('the opt-in never stores a render that read the visitor', async () => {
		setPageRouteConfig({ '/account': { postrender: 'with-credentials' } });
		const store = new MemoryStore();
		const runtime = install({ store });
		const alice = { cookie: 'session=alice', auth: async () => ({ name: 'Alice' }) };
		await visit(runtime, alice, greeting);
		expect(await store.get('/account/')).toBeNull();
	});
});
