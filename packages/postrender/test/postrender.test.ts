// postrender — unit legs: keying, the store CONTRACT (lane 1 memory always; lane 2 real Valkey
// when REDIS_URL is set), observed purity, single-flight + fan-out, and the two edge adapters'
// REAL request shapes (signing included) captured through a stubbed fetch.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { STALE } from '@ogygia/machine';
import { store_key, normalize_prefix, prefix_tags, PREFIX_TAG_DEPTH } from '../src/key.ts';
import { MemoryStore } from '../src/memory-store.ts';
import { ValkeyStore, type ValkeyLike } from '../src/adapters/valkey.ts';
import { AkamaiEdge } from '../src/adapters/akamai.ts';
import { CloudFrontEdge } from '../src/adapters/cloudfront.ts';
import {
	install,
	current_runtime,
	reset_for_tests,
	store_get,
	store_put,
	enter_flight,
	type Flight,
	invalidate,
	invalidateWhere,
	invalidate_tags,
	self_evict
} from '../src/registry.ts';
import server from '../src/server.ts';
import { observe_event } from '../src/observe.ts';
import { defineServer } from '@ogygia/core/plugin';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { find_stitch_holes, stitch_html } from '../src/stitch.ts';
import type { PostrenderEntry, PostrenderStore, EdgeAdapter } from '../src/types.ts';

const page_entry = (html = '<html>x</html>'): PostrenderEntry => ({
	kind: 'page',
	html,
	headers: { 'content-type': 'text/html' },
	created: Date.now()
});

// ── keying ─────────────────────────────────────────────────────────────────────────────────────

describe('postrender/key', () => {
	it('key is the pathname, verbatim (trailing slash preserved)', () => {
		expect(store_key('/fr/fr/')).toBe('/fr/fr/');
		expect(store_key('/fr/fr')).toBe('/fr/fr');
	});

	it('normalize_prefix enforces the leading slash and strips trailing ones (root survives)', () => {
		expect(normalize_prefix('fr/fr')).toBe('/fr/fr');
		expect(normalize_prefix('/fr/fr/')).toBe('/fr/fr');
		expect(normalize_prefix('/')).toBe('/');
	});

	it('prefix_tags is depth-capped', () => {
		expect(prefix_tags('/fr/fr/solar/panels/x')).toEqual(['/fr', '/fr/fr', '/fr/fr/solar']);
		expect(prefix_tags('/docs')).toEqual(['/docs']);
		expect(prefix_tags('/')).toEqual([]);
		expect(prefix_tags('/a/b/c').length).toBeLessThanOrEqual(PREFIX_TAG_DEPTH);
	});
});

// ── the store CONTRACT (one spec, every implementation) ────────────────────────────────────────

function store_contract(name: string, make: () => Promise<PostrenderStore> | PostrenderStore) {
	describe(`store contract: ${name}`, () => {
		let store: PostrenderStore;
		beforeEach(async () => {
			store = await make();
		});

		it('round-trips a page entry', async () => {
			await store.put('/a/', page_entry('<html>A</html>'), { ttl: 60 });
			const got = await store.get('/a/');
			expect(got?.kind).toBe('page');
			expect(got && got.kind === 'page' ? got.html : '').toBe('<html>A</html>');
		});

		it('round-trips a redirect entry', async () => {
			await store.put(
				'/old/',
				{ kind: 'redirect', status: 301, location: '/new/', created: Date.now() },
				{ ttl: 60 }
			);
			const got = await store.get('/old/');
			expect(got?.kind).toBe('redirect');
			expect(got && got.kind === 'redirect' ? got.location : '').toBe('/new/');
		});

		it('misses on unknown keys', async () => {
			expect(await store.get('/nope/')).toBeNull();
		});

		it('evict removes exactly one key', async () => {
			await store.put('/a/', page_entry(), { ttl: 60 });
			await store.put('/b/', page_entry(), { ttl: 60 });
			await store.evict('/a/');
			expect(await store.get('/a/')).toBeNull();
			expect(await store.get('/b/')).not.toBeNull();
		});

		it('TTL backstop: an expired entry is a miss', async () => {
			await store.put('/short/', page_entry(), { ttl: 1 });
			expect(await store.get('/short/')).not.toBeNull();
			await new Promise((r) => setTimeout(r, 1100));
			expect(await store.get('/short/')).toBeNull();
		});

		it('evictWhere removes the subtree and never a lookalike sibling', async () => {
			await store.put('/fr/fr', page_entry(), { ttl: 60 });
			await store.put('/fr/fr/solar/', page_entry(), { ttl: 60 });
			await store.put('/fr/fright/', page_entry(), { ttl: 60 });
			await store.evictWhere({ prefix: '/fr/fr/' });
			expect(await store.get('/fr/fr')).toBeNull();
			expect(await store.get('/fr/fr/solar/')).toBeNull();
			expect(await store.get('/fr/fright/')).not.toBeNull();
		});

		it('evictWhere at the root clears every key (the deploy thaw)', async () => {
			await store.put('/', page_entry(), { ttl: 60 });
			await store.put('/a/', page_entry(), { ttl: 60 });
			await store.put('/fr/fr/solar/', page_entry(), { ttl: 60 });
			await store.evictWhere({ prefix: '/' });
			expect(await store.get('/')).toBeNull();
			expect(await store.get('/a/')).toBeNull();
			expect(await store.get('/fr/fr/solar/')).toBeNull();
		});
	});
}

store_contract('memory (tier 1)', () => new MemoryStore());

// A faithful little Valkey fake (get/set EX/del/scan MATCH+COUNT with cursor) so the adapter's
// command usage is exercised on every PR; the REAL server runs the same contract below.
// (RegExp.escape is not in Node 22, which CI runs)
const REGEX_SPECIAL_G = /[\\^$.*+?()[\]{}|/-]/g;
const regex_escape = (s: string): string => s.replace(REGEX_SPECIAL_G, '\\$&');

function fake_valkey(): ValkeyLike & { data: Map<string, string>; expiry: Map<string, number> } {
	const data = new Map<string, string>();
	const sets = new Map<string, Set<string>>();
	const expiry = new Map<string, number>();
	const alive = (key: string) => {
		const at = expiry.get(key);
		if (at !== undefined && Date.now() >= at) {
			data.delete(key);
			expiry.delete(key);
		}
		return data.has(key);
	};
	const alive_set = (key: string) => {
		const at = expiry.get(key);
		if (at !== undefined && Date.now() >= at) {
			sets.delete(key);
			expiry.delete(key);
		}
		return sets.has(key);
	};
	return {
		data,
		expiry,
		async get(key) {
			return alive(key) ? (data.get(key) ?? null) : null;
		},
		async set(key, value, ...args) {
			data.set(key, value);
			// honor BOTH client families' EX spellings, like the real servers do
			const positional = args[0] === 'EX' ? Number(args[1]) : null;
			const bag = (args[0] as { EX?: number } | undefined)?.EX;
			const ttl = positional ?? bag ?? null;
			if (ttl !== null) expiry.set(key, Date.now() + ttl * 1000);
			else expiry.delete(key);
		},
		async del(...keys) {
			for (const k of keys) {
				data.delete(k);
				sets.delete(k);
				expiry.delete(k);
			}
		},
		async sadd(key, ...members) {
			let set = sets.get(key);
			if (!set) sets.set(key, (set = new Set()));
			for (const m of members) set.add(m);
		},
		async smembers(key) {
			return alive_set(key) ? [...sets.get(key)!] : [];
		},
		async expire(key, seconds) {
			expiry.set(key, Date.now() + seconds * 1000);
		},
		async ttl(key) {
			if (!alive_set(key) && !alive(key)) return -2;
			const at = expiry.get(key);
			return at === undefined ? -1 : Math.ceil((at - Date.now()) / 1000);
		},
		async scan(cursor, ...args) {
			// single-page cursor; honor MATCH with the same glob subset the adapter emits
			const match = String(args[args.indexOf('MATCH') + 1]);
			let source = '';
			for (let i = 0; i < match.length; i++) {
				const c = match[i];
				if (c === '\\') source += regex_escape(match[++i]);
				else if (c === '*') source = `${source}.*`;
				else if (c === '?') source = `${source}.`;
				else source += regex_escape(c);
			}
			const re = new RegExp(`^${source}$`);
			return ['0', [...data.keys()].filter((k) => re.test(k))] as unknown;
		}
	};
}

store_contract('valkey (fake client)', () => new ValkeyStore(fake_valkey()));

describe('valkey tag index lifetime', () => {
	it('a short-lived entry never shortens the tag set of a long-lived one', async () => {
		const client = fake_valkey();
		const store = new ValkeyStore(client);
		await store.put('/page/', page_entry(), { ttl: 86_400, tags: ['s:cms#nav:x'] });
		await store.put('/short/', page_entry(), { ttl: 600, tags: ['s:cms#nav:x'] });
		const left = (client.expiry.get('og:t:s:cms#nav:x')! - Date.now()) / 1000;
		expect(left).toBeGreaterThan(86_000);
		expect((await store.evictByTag!('s:cms#nav:x')).sort()).toEqual(['/page/', '/short/']);
		expect(await store.get('/page/')).toBeNull();
	});

	it('a longer-lived entry extends the tag set', async () => {
		const client = fake_valkey();
		const store = new ValkeyStore(client);
		await store.put('/short/', page_entry(), { ttl: 600, tags: ['t'] });
		await store.put('/page/', page_entry(), { ttl: 86_400, tags: ['t'] });
		const left = (client.expiry.get('og:t:t')! - Date.now()) / 1000;
		expect(left).toBeGreaterThan(86_000);
	});
});

describe('valkey client families and glob paths', () => {
	it('evicts a prefix that holds a glob character literally, never a sibling it would match as a glob', async () => {
		const store = new ValkeyStore(fake_valkey());
		await store.put('/a*/x/', page_entry(), { ttl: 60 });
		await store.put('/ab/x/', page_entry(), { ttl: 60 });
		await store.evictWhere({ prefix: '/a*/' });
		expect(await store.get('/a*/x/')).toBeNull();
		expect(await store.get('/ab/x/')).not.toBeNull();
	});

	it('speaks node-redis v4: SET with an options bag after the positional form throws, and an object SCAN reply', async () => {
		const base = fake_valkey();
		const sets: unknown[][] = [];
		const client: ValkeyLike = {
			...base,
			async set(key, value, ...args) {
				sets.push(args);
				if (args[0] === 'EX') throw new Error('ERR syntax error');
				return base.set(key, value, ...args);
			},
			async scan(cursor, ...args) {
				const [next, keys] = (await base.scan(cursor, ...args)) as [string, string[]];
				return { cursor: Number(next), keys } as unknown;
			}
		};
		const store = new ValkeyStore(client);
		await store.put('/fr/a/', page_entry(), { ttl: 60 });
		expect(sets).toEqual([['EX', 60], [{ EX: 60 }]]);
		expect(base.expiry.has('og:a:/fr/a/')).toBe(true);
		await store.evictWhere({ prefix: '/fr/' });
		expect(await store.get('/fr/a/')).toBeNull();
	});

	it('speaks ioredis: SET … EX positionally, never the options bag', async () => {
		const base = fake_valkey();
		const sets: unknown[][] = [];
		const store = new ValkeyStore({
			...base,
			async set(key, value, ...args) {
				sets.push(args);
				return base.set(key, value, ...args);
			}
		});
		await store.put('/x/', page_entry(), { ttl: 60 });
		expect(sets).toEqual([['EX', 60]]);
	});
});

const REDIS_URL = process.env.REDIS_URL;
describe.skipIf(!REDIS_URL)('store contract: valkey (REAL server via REDIS_URL)', () => {
	// Lane 2: identical spec against a live server. Loaded lazily so the suite has no redis dep.
	it('runs the shared contract', async () => {
		// a variable specifier: the typecheck never needs redis installed either
		const redis = 'redis';
		const { createClient } = (await import(/* @vite-ignore */ redis)) as {
			createClient(options: { url?: string }): {
				connect(): Promise<unknown>;
				quit(): Promise<unknown>;
			};
		};
		const client = createClient({ url: REDIS_URL });
		await client.connect();
		try {
			const store = new ValkeyStore(client as unknown as ValkeyLike);
			await store.put('/contract/x/', page_entry(), { ttl: 30 });
			expect((await store.get('/contract/x/'))?.kind).toBe('page');
			await store.evictWhere({ prefix: '/contract/' });
			expect(await store.get('/contract/x/')).toBeNull();
		} finally {
			await client.quit();
		}
	});
});

// ── registry: single-flight + invalidation fan-out ─────────────────────────────────────────────

describe('postrender/registry', () => {
	beforeEach(() => reset_for_tests());
	afterEach(() => reset_for_tests());

	/** Opens the flight for `key` (none may be out). */
	const open = (key: string): Flight => {
		const f = enter_flight(key);
		if (!('opened' in f)) throw new Error(`a flight is already out for ${key}`);
		return f.opened;
	};
	/** Joins the flight out for `key` (one must be). */
	const join = (key: string) => {
		const f = enter_flight(key);
		if (!('joined' in f)) throw new Error(`no flight is out for ${key}`);
		return f.joined;
	};
	const tick = () => new Promise((r) => setTimeout(r, 0));

	it('single-flight: joiners see the first render’s outcome', async () => {
		const flight = open('/hot/');
		const joined = join('/hot/');
		const entry = page_entry();
		flight.settle({ stored: entry });
		expect(await joined).toEqual({ stored: entry });
		// the flight is gone once settled: the next request opens one
		expect('opened' in enter_flight('/hot/')).toBe(true);
	});

	it('single-flight: a flight settles once, and a late settle never ends a newer flight (#194)', async () => {
		const first = open('/hot/');
		const joined_first = join('/hot/');
		first.settle({ stored: null }); // the request that opened it ended (its `done`)
		expect(await joined_first).toEqual({ stored: null });
		const second = open('/hot/');
		const joined_second = join('/hot/');
		first.settle({ stored: page_entry() }); // a late, second settle of the old flight
		await tick();
		expect(second.stale).toBe(false); // the newer flight is still open …
		const third = join('/hot/'); // … and still the one joiners find
		const entry = page_entry();
		second.settle({ stored: entry });
		expect(await joined_second).toEqual({ stored: entry });
		expect(await third).toEqual({ stored: entry });
	});

	it('single-flight: an invalidation ends the flights of the pages it evicts, and only those (#194)', async () => {
		// a flight is stale when the invalidation would have evicted its page, had it been stored
		const a = open('/a/');
		const fr = open('/fr/fr/x');
		const fright = open('/fr/fright');
		const b = open('/b/');
		const done = open('/done/');
		done.settle({ stored: null });
		const stale = () => [a, fr, fright, b].map((f) => f.stale);

		await invalidate('/somewhere-else/'); // evicts one other page: no flight here renders it
		expect(stale()).toEqual([false, false, false, false]);

		await invalidate('/a/');
		expect(stale()).toEqual([true, false, false, false]);

		await invalidateWhere({ prefix: '/fr/fr/' }); // the subtree, never `/fr/fright`
		expect(stale()).toEqual([true, true, false, false]);

		await self_evict(current_runtime(), '/b/'); // a form post on /b/ evicts /b/
		expect(stale()).toEqual([true, true, false, true]);

		// a tag names pages by what they read, and a render's receipts are not all in until it ends:
		// every flight still rendering may carry it
		await invalidate_tags(['r:promo']);
		expect(stale()).toEqual([true, true, true, true]);
		expect(done.stale).toBe(false); // a settled one stays as it was
		for (const f of [a, fr, fright, b]) f.settle({ stored: null });
		expect(a.stale).toBe(false);
	});

	it('single-flight: the requests waiting on a render an invalidation ended are let go at once, and the next one opens a new flight', async () => {
		const first = open('/hot/');
		const waiting = [join('/hot/'), join('/hot/')];
		await invalidate('/hot/'); // a publish while it renders
		expect(await Promise.all(waiting)).toEqual([STALE, STALE]); // (the render is still out)
		expect(first.stale).toBe(true);
		const again = open('/hot/'); // a request let go asks again: it renders the page anew
		const joined = join('/hot/'); // and the other joins it
		const entry = page_entry();
		again.settle({ stored: entry });
		first.settle({ stored: null }); // (the old render ends after: it touches nothing)
		expect(await joined).toEqual({ stored: entry });
	});

	it('store failures never throw through store_get/put', async () => {
		const runtime = install({
			store: {
				get: () => Promise.reject(new Error('down')),
				put: () => Promise.reject(new Error('down')),
				evict: () => Promise.reject(new Error('down')),
				evictWhere: () => Promise.reject(new Error('down'))
			}
		});
		expect(await store_get(runtime, '/x/')).toBeNull();
		await expect(store_put(runtime, '/x/', page_entry(), { ttl: 10 })).resolves.toBeUndefined();
	});

	it('the latest handle made is the server’s runtime; none made is the memory default', () => {
		const fallback = current_runtime();
		expect(fallback.edges).toEqual([]);
		expect(current_runtime()).toBe(fallback); // one default, kept
		const store = new MemoryStore();
		const first = install({ store });
		expect(current_runtime()).toBe(first);
		expect(first.store).toBe(store);
		const second = install({}); // dev re-evaluates hooks.server.ts: the new handle replaces it
		expect(current_runtime()).toBe(second);
		expect(second.store).not.toBe(store);
	});

	it('warns ONCE when edges are configured over the per-instance memory default', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const edge: EdgeAdapter = {
			name: 'e',
			headers: () => ({}),
			purgeUrl: async () => {},
			purgeWhere: async () => {}
		};
		install({ edge: [edge] });
		const first = warn.mock.calls.filter((c) => String(c[0]).includes('other replicas')).length;
		install({ edge: [edge] });
		const second = warn.mock.calls.filter((c) => String(c[0]).includes('other replicas')).length;
		expect(first).toBe(1);
		expect(second).toBe(1); // once per process, never nagging
		warn.mockRestore();
	});

	it('invalidate fans out to store + every edge; one edge down never throws', async () => {
		const calls: string[] = [];
		const edge = (name: string, fail = false): EdgeAdapter => ({
			name,
			headers: () => ({}),
			purgeUrl: async (url) => {
				calls.push(`${name}:url:${url}`);
				if (fail) throw new Error('edge down');
			},
			purgeWhere: async ({ prefix }) => {
				calls.push(`${name}:prefix:${prefix}`);
				if (fail) throw new Error('edge down');
			}
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const runtime = install({ edge: [edge('a'), edge('b', true)] });
		await store_put(runtime, '/gone/', page_entry(), { ttl: 60 });
		await invalidate('/gone/');
		expect(await store_get(runtime, '/gone/')).toBeNull();
		expect(calls).toContain('a:url:/gone/');
		expect(calls).toContain('b:url:/gone/');
		await invalidateWhere({ prefix: '/fr/fr/' });
		expect(calls).toContain('a:prefix:/fr/fr');
		warn.mockRestore();
	});

	it('a store that throws is reported as the store, and the rest of the invalidation still runs', async () => {
		const purged: string[] = [];
		const edge: EdgeAdapter = {
			name: 'cdn',
			headers: () => ({}),
			purgeUrl: async (url) => void purged.push(url),
			purgeWhere: async ({ prefix }) => void purged.push(`prefix:${prefix}`)
		};
		const broken: PostrenderStore = {
			get: async () => null,
			put: async () => {},
			evict: () => Promise.reject(new Error('store down')),
			evictWhere: () => {
				throw new Error('store down'); // even a synchronous throw
			},
			evictByTag: async (tag) => {
				if (tag === 's:bad:1') throw new Error('store down');
				return ['/good/'];
			}
		};
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const said = () => warn.mock.calls.map((c) => String(c[0]));
		const runtime = install({ store: broken, edge: [edge] });

		// tags: the failing one is named, the other still evicts and its page is purged at the edge
		expect(await invalidate_tags(['s:bad:1', 's:good:1'], runtime)).toEqual(['/good/']);
		expect(purged).toEqual(['/good/']);
		expect(said()).toContainEqual(expect.stringContaining('the store failed to evict tag s:bad:1'));
		// the shared `invalidate` hook (a peer's thaw notice) throws once it has evicted what it could:
		// the peer must not answer "done" for a thaw it did not apply (#287)
		purged.length = 0;
		await expect(server.invalidate!(['s:bad:1', 's:good:1'])).rejects.toThrow('store down');
		expect(purged).toEqual(['/good/']);

		// a url and a prefix: the edge still purges, and the warning blames the store, not an edge
		await invalidate('/x/');
		await invalidateWhere({ prefix: '/fr/' });
		expect(purged).toContain('/x/');
		expect(purged).toContain('prefix:/fr');
		expect(said()).toContainEqual(expect.stringContaining('the store failed to evict /x/'));
		expect(said()).toContainEqual(expect.stringContaining('the store failed to evict prefix /fr'));
		expect(said().some((s) => s.includes('edge'))).toBe(false);
		warn.mockRestore();
	});
});

// ── observed purity ────────────────────────────────────────────────────────────────────────────

type AnyEvent = {
	cookies: {
		get: (n: string) => string | undefined;
		getAll: () => { name: string; value: string }[];
		set: (n: string, v: string, o: unknown) => void;
		delete: (n: string, o: unknown) => void;
	};
	locals: Record<string, unknown>;
	request: Request;
	url: URL;
	fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
	getClientAddress: () => string;
	platform: Record<string, unknown>;
};

function fake_event(init?: {
	cookies?: Record<string, string>;
	locals?: Record<string, unknown>;
	headers?: Record<string, string>;
	platform?: Record<string, unknown>;
}): AnyEvent {
	const jar = new Map(Object.entries(init?.cookies ?? {}));
	return {
		url: new URL('http://x/'),
		fetch: async () => new Response('{}'),
		getClientAddress: () => '203.0.113.7',
		platform: init?.platform ?? {},
		cookies: {
			get: (n: string) => jar.get(n),
			getAll: () => [...jar].map(([name, value]) => ({ name, value })),
			set: (n: string, v: string) => void jar.set(n, v),
			delete: (n: string) => void jar.delete(n)
		},
		locals: init?.locals ?? {},
		request: new Request('http://x/', { headers: init?.headers })
	};
}

const observer = startPlugin(defineServer({}), { name: 'observe-test' });
/** The observation of `event` (its request's facts made fresh with it). */
const observe = (event: AnyEvent) =>
	observe_event({
		event: event as never,
		facts: observer.app.facts(event.request),
		app: observer.app as never
	});

describe('postrender/observe', () => {
	it('default-valued reads still store (the canonical render)', () => {
		const event = fake_event({ locals: { user: {}, flags: [], nothing: null } });
		const obs = observe(event);
		event.cookies.get('consent'); // absent → undefined = default
		void event.locals.user; // {} = default
		void event.locals.flags; // [] = default
		expect(obs.disqualified_by).toBeNull();
		expect(obs.wrote_cookie).toBe(false);
	});

	it('a NON-default cookie read disqualifies, named', () => {
		const event = fake_event({ cookies: { session: 'abc' } });
		const obs = observe(event);
		event.cookies.get('session');
		expect(obs.disqualified_by).toBe('cookie:session');
	});

	it('a cookie WRITE disqualifies', () => {
		const event = fake_event();
		const obs = observe(event);
		event.cookies.set('theme', 'dark', { path: '/' });
		expect(obs.wrote_cookie).toBe(true);
	});

	it('personalization headers disqualify; delivery plumbing does not', () => {
		const event = fake_event({ headers: { 'accept-language': 'fr', host: 'x' } });
		const obs = observe(event);
		event.request.headers.get('host');
		expect(obs.disqualified_by).toBeNull();
		event.request.headers.get('Accept-Language');
		expect(obs.disqualified_by).toBe('header:accept-language');
	});

	it('a populated locals read disqualifies, named', () => {
		const event = fake_event({ locals: { user: { id: 7 } } });
		const obs = observe(event);
		void event.locals.user;
		expect(obs.disqualified_by).toBe('locals.user');
	});

	it("the reason lands in the request's read set; the first one wins", () => {
		const event = fake_event({ cookies: { session: 'abc' }, locals: { user: { id: 7 } } });
		const obs = observe(event);
		event.cookies.get('session');
		void event.locals.user;
		expect(observer.app.facts(event.request).reads.perVisitor).toBe('cookie:session');
		expect(obs.disqualified_by).toBe('cookie:session');
	});

	describe('every way a render reaches the visitor is a per-visitor read', () => {
		const personal = {
			cookie: 'session=alice',
			authorization: 'Bearer alice',
			'x-forwarded-for': '203.0.113.7'
		};
		const cases: [string, Parameters<typeof fake_event>[0], (e: AnyEvent) => unknown][] = [
			[
				'a function-valued locals entry (a session getter)',
				{ locals: { auth: async () => ({ user: 'alice' }) } },
				(e) => (e.locals.auth as () => Promise<unknown>)()
			],
			['`in` on locals', { locals: { user: { id: 7 } } }, (e) => 'user' in e.locals],
			['the keys of locals', { locals: { user: { id: 7 } } }, (e) => Object.keys(e.locals)],
			[
				'a copy of the request headers',
				{ headers: personal },
				(e) => new Request('http://api.example/me', { headers: e.request.headers })
			],
			[
				'the request headers as entries',
				{ headers: personal },
				(e) => Object.fromEntries(e.request.headers)
			],
			[
				'a clone of the request',
				{ headers: personal },
				(e) => e.request.clone().headers.get('cookie')
			],
			[
				'`has` on a personal header',
				{ headers: personal },
				(e) => e.request.headers.has('authorization')
			],
			[
				'the client address header',
				{ headers: personal },
				(e) => e.request.headers.get('x-forwarded-for')
			],
			[
				'the forwarded host',
				{ headers: { 'x-forwarded-host': 'other.example' } },
				(e) => e.request.headers.get('x-forwarded-host')
			],
			[
				'a geo header',
				{ headers: { 'x-geo-country': 'DE' } },
				(e) => e.request.headers.get('x-geo-country')
			],
			['the client address', {}, (e) => e.getClientAddress()],
			[
				'per-request platform data',
				{ platform: { geo: { country: 'DE' } } },
				(e) => (e.platform.geo as { country: string }).country
			],
			[
				'a fetch to its own origin that carries the visitor’s cookies',
				{ headers: personal },
				(e) => e.fetch('/api/me')
			]
		];
		for (const [name, init, read] of cases)
			it(name, async () => {
				const event = fake_event(init);
				const obs = observe(event);
				await read(event);
				expect(obs.disqualified_by).not.toBeNull();
			});

		it('reads that are the same for every visitor still store', async () => {
			const event = fake_event({
				headers: { host: 'x', accept: 'text/html' },
				platform: { env: { API: 'k' }, context: { waitUntil: () => {} } }
			});
			const obs = observe(event);
			Object.fromEntries(event.request.headers);
			void (event.platform.env as { API: string }).API;
			void (event.platform.context as { waitUntil: unknown }).waitUntil;
			await event.fetch('/api/public');
			await event.fetch('http://other.example/feed');
			expect(obs.disqualified_by).toBeNull();
		});
	});

	it('a reason already in the read set (a flag read) is what the observation reports', () => {
		const event = fake_event();
		observer.app.perVisitor(event.request, 'flag:hero');
		expect(observe(event).disqualified_by).toBe('flag:hero');
	});
});

// ── serve-time stitching: the balanced scanner + splicer ───────────────────────────────────────

describe('postrender/stitch', () => {
	const hole = (endpoint: string, inner: string, marked = true) =>
		`<ogygia-region entry="" render="defer" when="load"${marked ? ' stitch=""' : ''} endpoint="${endpoint}">${inner}</ogygia-region>`;

	it('finds top-level stitch holes, unescaping the endpoint', async () => {
		const html = `<main>${hole('/__ogygia__?id=a&amp;props=p&amp;exp=9&amp;sig=s', '<p>fb</p>')}</main>`;
		const holes = find_stitch_holes(html);
		expect(holes).toHaveLength(1);
		expect(holes[0].endpoint).toBe('/__ogygia__?id=a&props=p&exp=9&sig=s');
	});

	it('handles NESTED regions inside the fallback (balanced, not lazy)', () => {
		const inner = `<ogygia-region entry="x" wake="load">island</ogygia-region>`;
		const html = `${hole('/e?a=1', `<p>fb</p>${inner}`)}<footer>after</footer>`;
		const holes = find_stitch_holes(html);
		expect(holes).toHaveLength(1);
		expect(html.slice(holes[0].end)).toBe('<footer>after</footer>');
	});

	it('ignores unmarked regions', () => {
		expect(find_stitch_holes(hole('/e', 'fb', false))).toHaveLength(0);
	});

	it('reads region tags as a browser does: a quoted `>`, any case, single quotes, not in a comment, not a value', () => {
		const html = `<!-- <ogygia-region stitch="edge" endpoint="/gone"></ogygia-region> --><ogygia-region class="stitch" endpoint="/no">fb</ogygia-region><ogygia-region data-note="a>b" STITCH='edge' ENDPOINT='/e?a=1&amp;b=2'>fb</ogygia-region>`;
		const holes = find_stitch_holes(html);
		expect(holes.map((h) => [h.endpoint, h.mode])).toEqual([['/e?a=1&b=2', 'edge']]);
		expect(html.slice(holes[0].start, holes[0].end)).toBe(
			"<ogygia-region data-note=\"a>b\" STITCH='edge' ENDPOINT='/e?a=1&amp;b=2'>fb</ogygia-region>"
		);
	});

	it('splices renders in place; nested islands land under a neutral display:contents div', async () => {
		const html = `<a>${hole('/e1?x=1', 'fb1')}</a><b>${hole('/e2?x=2', 'fb2')}</b>`;
		const out = await stitch_html(html, async (e) => `<h1>fresh:${e}</h1>`);
		expect(out).toContain(
			'<a><div style="display:contents" data-og-stitched=""><h1>fresh:/e1?x=1</h1></div></a>'
		);
		expect(out).toContain(
			'<b><div style="display:contents" data-og-stitched=""><h1>fresh:/e2?x=2</h1></div></b>'
		);
		expect(out).not.toContain('fb1');
	});

	it('FAIL-OPEN: a null/throwing render keeps that hole verbatim, others still splice', async () => {
		const html = hole('/dead', 'fallback-stays') + hole('/alive', 'fb2');
		const out = await stitch_html(html, async (e) => (e === '/dead' ? null : '<p>ok</p>'));
		expect(out).toContain('fallback-stays');
		expect(out).toContain('render="defer"'); // the dead hole still client-fetches
		expect(out).toContain('<p>ok</p>');
		const thrown = await stitch_html(html, async (e) => {
			if (e === '/dead') throw new Error('upstream down');
			return '<p>ok</p>';
		});
		expect(thrown).toContain('fallback-stays');
		expect(thrown).toContain('<p>ok</p>');
	});
});

// ── edge adapters: REAL request shapes through a stubbed fetch ─────────────────────────────────

describe('edge adapters', () => {
	const captured: { url: string; init: RequestInit }[] = [];
	beforeEach(() => {
		captured.length = 0;
		vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
			captured.push({ url: String(url), init: init ?? {} });
			return new Response('{}', { status: 201 });
		});
	});
	afterEach(() => vi.unstubAllGlobals());

	it('akamai: EdgeGrid-signed Fast Purge by url + prefix tag; headers stamp prefix tags', async () => {
		const edge = new AkamaiEdge({
			host: 'akab-test.purge.akamaiapis.net',
			clientToken: 'ct',
			clientSecret: 'cs',
			accessToken: 'at',
			site: 'https://www.example.com'
		});
		const headers = edge.headers({ url: '/fr/fr/solar/', ttl: 3600 });
		expect(headers['edge-cache-tag']).toBe('p:/fr, p:/fr/fr, p:/fr/fr/solar');
		expect(headers['cache-control']).toContain('s-maxage=3600');

		await edge.purgeUrl('/fr/fr/solar/');
		expect(captured[0].url).toContain('/ccu/v3/invalidate/url/production');
		expect(JSON.parse(String(captured[0].init.body))).toEqual({
			objects: ['https://www.example.com/fr/fr/solar/']
		});
		const auth = (captured[0].init.headers as Record<string, string>).authorization;
		expect(auth).toMatch(
			/^EG1-HMAC-SHA256 client_token=ct;access_token=at;timestamp=\d{8}T\d\d:\d\d:\d\d\+0000;nonce=[0-9a-f-]{36};signature=[A-Za-z0-9+/=]+$/
		);

		const fields = Object.fromEntries(
			auth
				.slice('EG1-HMAC-SHA256 '.length)
				.split(';')
				.map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)])
		);
		const url = new URL(captured[0].url);
		const auth_prefix = auth.slice(0, auth.indexOf('signature='));
		const content_hash = createHash('sha256')
			.update(String(captured[0].init.body))
			.digest('base64');
		const data = [
			'POST',
			'https',
			'akab-test.purge.akamaiapis.net',
			url.pathname + url.search,
			'',
			content_hash,
			auth_prefix
		].join('\t');
		const key = createHmac('sha256', 'cs').update(fields.timestamp).digest('base64');
		expect(fields.signature).toBe(createHmac('sha256', key).update(data).digest('base64'));

		await edge.purgeWhere({ prefix: '/fr/fr/' });
		expect(captured[1].url).toContain('/ccu/v3/invalidate/tag/production');
		expect(JSON.parse(String(captured[1].init.body))).toEqual({ objects: ['p:/fr/fr'] });
	});

	it('cloudfront: SigV4-signed CreateInvalidation; prefix becomes path + wildcard', async () => {
		const edge = new CloudFrontEdge({
			distributionId: 'E123',
			accessKeyId: 'AKIA',
			secretAccessKey: 'shh'
		});
		expect(edge.headers({ url: '/x/', ttl: 60 })).toEqual({});

		await edge.purgeWhere({ prefix: '/fr/fr' });
		expect(captured[0].url).toContain('/2020-05-31/distribution/E123/invalidation');
		const body = String(captured[0].init.body);
		expect(body).toContain('<Path>/fr/fr</Path>');
		expect(body).toContain('<Path>/fr/fr/*</Path>');
		const h = captured[0].init.headers as Record<string, string>;
		expect(h.authorization).toMatch(
			/^AWS4-HMAC-SHA256 Credential=AKIA\/\d{8}\/us-east-1\/cloudfront\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
		);
		expect(h['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
	});
});
