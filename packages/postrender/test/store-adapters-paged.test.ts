/**
 * The three bring-your-own stores against fakes that answer listings ONE key per page, the way a
 * big keyspace does: a subtree eviction follows the cursor to the end, an evicted key and an
 * evicted tag index are gone, and a tag set's expiry is only set when it would grow.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudflareKvStore, type KvNamespaceLike } from '../src/adapters/cloudflare-kv.ts';
import { UpstashStore } from '../src/adapters/upstash.ts';
import { ValkeyStore, type ValkeyLike } from '../src/adapters/valkey.ts';
import type { PostrenderEntry, PostrenderStore } from '../src/types.ts';

afterEach(() => vi.unstubAllGlobals());

const page = (): PostrenderEntry => ({
	kind: 'page',
	html: '<html>x</html>',
	headers: { 'content-type': 'text/html' },
	created: Date.now()
});

/** A Redis keyspace whose SCAN answers one key per call (cursor = index of the next key). */
function redis() {
	const data = new Map<string, string>();
	const sets = new Map<string, Set<string>>();
	const ttls = new Map<string, number>();
	const expires: [string, number][] = [];
	const glob = (pattern: string) => {
		const parts: string[] = [];
		for (let i = 0; i < pattern.length; i++) {
			const c = pattern[i];
			if (c === '\\') parts.push(`\\${pattern[++i]}`);
			else if (c === '*') parts.push('.*');
			else parts.push(/[\w/:#-]/.test(c) ? c : `\\${c}`);
		}
		return new RegExp(`^${parts.join('')}$`);
	};
	return {
		data,
		sets,
		ttls,
		expires,
		get: (k: string) => data.get(k) ?? null,
		set: (k: string, v: string) => void data.set(k, v),
		del: (keys: string[]) => {
			for (const k of keys) {
				data.delete(k);
				sets.delete(k);
			}
		},
		sadd: (k: string, m: string) => {
			let s = sets.get(k);
			if (!s) sets.set(k, (s = new Set()));
			s.add(m);
		},
		smembers: (k: string) => [...(sets.get(k) ?? [])],
		ttl: (k: string) => ttls.get(k) ?? -1,
		expire: (k: string, s: number) => {
			expires.push([k, s]);
			ttls.set(k, s);
		},
		// the cursor resumes after the last key it returned, so a key deleted between pages moves
		// nothing (SCAN's own guarantee: every key there from start to end is returned)
		scan: (cursor: string, pattern: string): [string, string[]] => {
			const after = cursor === '0' ? '' : cursor.slice(2);
			const keys = [...data.keys()].filter((k) => glob(pattern).test(k) && k > after).sort();
			if (keys.length === 0) return ['0', []];
			return [keys.length === 1 ? '0' : `k:${keys[0]}`, [keys[0]]];
		}
	};
}
type Redis = ReturnType<typeof redis>;

function valkey_client(r: Redis): ValkeyLike {
	return {
		get: async (k) => r.get(k),
		set: async (k, v) => r.set(k, v),
		del: async (...keys) => r.del(keys),
		sadd: async (k, ...m) => m.forEach((x) => r.sadd(k, x)),
		smembers: async (k) => r.smembers(k),
		ttl: async (k) => r.ttl(k),
		expire: async (k, s) => r.expire(k, s),
		scan: async (cursor, ...args) => r.scan(String(cursor), String(args[args.indexOf('MATCH') + 1]))
	};
}

/** Upstash's REST endpoint over the same keyspace; every request it got */
function upstash_rest(r: Redis): { url: string; auth: string }[] {
	const seen: { url: string; auth: string }[] = [];
	vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
		seen.push({
			url: String(url),
			auth: (init.headers as Record<string, string>).authorization
		});
		const [cmd, ...a] = JSON.parse(String(init.body)) as string[];
		let result: unknown = 'OK';
		if (cmd === 'GET') result = r.get(a[0]);
		if (cmd === 'SET') r.set(a[0], a[1]);
		if (cmd === 'DEL') r.del(a);
		if (cmd === 'SADD') r.sadd(a[0], a[1]);
		if (cmd === 'SMEMBERS') result = r.smembers(a[0]);
		if (cmd === 'TTL') result = r.ttl(a[0]);
		if (cmd === 'EXPIRE') r.expire(a[0], Number(a[1]));
		if (cmd === 'SCAN') result = r.scan(a[0], a[2]);
		return new Response(JSON.stringify({ result }));
	});
	return seen;
}

/** Workers KV whose list answers one key per page. */
function kv(): KvNamespaceLike & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		get: async (k) => data.get(k) ?? null,
		put: async (k, v) => void data.set(k, v),
		delete: async (k) => void data.delete(k),
		list: async ({ prefix, cursor }) => {
			const keys = [...data.keys()].filter((k) => k.startsWith(prefix)).sort();
			const at = Number(cursor ?? 0);
			const done = at + 1 >= keys.length;
			return {
				keys: keys.slice(at, at + 1).map((name) => ({ name })),
				list_complete: done,
				cursor: done ? undefined : String(at + 1)
			};
		}
	};
}

const stores: [string, () => PostrenderStore][] = [
	['valkey', () => new ValkeyStore(valkey_client(redis()))],
	[
		'upstash',
		() => {
			upstash_rest(redis());
			return new UpstashStore({ url: 'https://x.example', token: 't' });
		}
	],
	['cloudflare kv', () => new CloudflareKvStore(kv())]
];

for (const [name, make] of stores) {
	describe(`${name} store, one key per listing page`, () => {
		it('evict removes the key', async () => {
			const store = make();
			await store.put('/a/', page(), { ttl: 60 });
			await store.evict('/a/');
			expect(await store.get('/a/')).toBeNull();
		});

		it('evictWhere follows the cursor past the first page, and takes the prefix key itself', async () => {
			const store = make();
			for (const k of ['/fr/fr', '/fr/fr/a/', '/fr/fr/b/', '/fr/fr/c/', '/fr/fright/'])
				await store.put(k, page(), { ttl: 60 });
			await store.evictWhere({ prefix: '/fr/fr' });
			for (const k of ['/fr/fr', '/fr/fr/a/', '/fr/fr/b/', '/fr/fr/c/'])
				expect(await store.get(k), k).toBeNull();
			expect(await store.get('/fr/fright/')).not.toBeNull();
		});

		it('evictByTag empties the tag index: a second eviction finds nothing', async () => {
			const store = make();
			await store.put('/a/', page(), { ttl: 60, tags: ['t'] });
			await store.put('/b/', page(), { ttl: 60, tags: ['t'] });
			expect((await store.evictByTag!('t')).sort()).toEqual(['/a/', '/b/']);
			expect(await store.get('/a/')).toBeNull();
			expect(await store.evictByTag!('t')).toEqual([]);
		});
	});
}

describe('a tag set expiry is set only when it grows', () => {
	it('valkey: a put with the same ttl as the set has left sets no expiry', async () => {
		const r = redis();
		const store = new ValkeyStore(valkey_client(r));
		await store.put('/a/', page(), { ttl: 600, tags: ['t'] });
		await store.put('/b/', page(), { ttl: 600, tags: ['t'] });
		expect(r.expires).toEqual([['og:t:t', 600]]);
	});

	it('upstash: a put with the same ttl as the set has left sets no expiry', async () => {
		const r = redis();
		upstash_rest(r);
		const store = new UpstashStore({ url: 'https://x.example', token: 't' });
		await store.put('/a/', page(), { ttl: 600, tags: ['t'] });
		await store.put('/b/', page(), { ttl: 600, tags: ['t'] });
		expect(r.expires).toEqual([['og:t:t', 600]]);
	});
});

it('upstash: a trailing slash on the url is dropped, and the token is the bearer', async () => {
	const seen = upstash_rest(redis());
	await new UpstashStore({ url: 'https://x.example//', token: 'tok' }).get('/a/');
	expect(seen).toEqual([{ url: 'https://x.example', auth: 'Bearer tok' }]);
});
