/**
 * Redis report store — for a fleet that already runs Redis, or a serverless deployment using a
 * hosted Redis (Upstash, ElastiCache). Reports are strings under `<prefix>report:<id>`, a sorted set
 * `<prefix>reports` (score = created ms) drives the list and the LRU prune, and visits mirror that.
 * The prefix defaults to `og:`.
 *
 *   // src/hooks.server.ts
 *   import { setProfilerStore } from '@ogygia/devtools/profiler/storage';
 *   import { RedisStore } from '@ogygia/devtools/profiler/storage/redis';
 *   // pass a connection string (node-redis / ioredis is imported on demand)…
 *   setProfilerStore(new RedisStore('redis://localhost:6379'));
 *   // …or an already-connected client (node-redis or ioredis both work)
 *   setProfilerStore(new RedisStore(myClient));
 *
 * A TTL (seconds) expires reports on their own — handy on a shared instance where you only want the
 * last day of recordings. The index sets drop an expired report's id the next time they are read or
 * pruned, so they do not grow with every report that expired.
 */
import type {
	ProfilerStore,
	ProfilerRecord,
	ProfilerSummary,
	ProfilerVisitRecord
} from './index.ts';
import { flights, STALE, type Flights } from '@ogygia/machine';
import { MAX_VISITS_PER_KEY } from './visits.ts';

/** The subset of a Redis client this store uses — node-redis and ioredis both satisfy it (their
 *  method names differ in case, and a few calls take options objects on one and arguments on the
 *  other; the flavour is read once, below). */
interface RedisLike {
	set(key: string, val: string, ...rest: unknown[]): Promise<unknown>;
	get(key: string): Promise<string | null>;
	del(key: string | string[]): Promise<unknown>;
	zadd?(key: string, ...rest: unknown[]): Promise<unknown>;
	zrem?(key: string, ...members: string[]): Promise<unknown>;
	zrange?(key: string, start: number, stop: number, ...rest: unknown[]): Promise<string[]>;
	zcard?(key: string): Promise<number>;
	connect?(): Promise<void>;
}

/** node-redis (v4+): camelCase methods, options objects */
interface NodeRedis {
	set(key: string, val: string, opts?: { EX: number }): Promise<unknown>;
	zAdd(key: string, m: { score: number; value: string }): Promise<unknown>;
	zRem(key: string, members: string | string[]): Promise<unknown>;
	zRange(key: string, a: number, b: number, o?: { REV: true }): Promise<string[]>;
	zCard(key: string): Promise<number>;
}

/** reports kept at most, whatever the host prunes to (a store used on its own still has a cap) */
const MAX_REPORTS = 1000;

async function resolve(client: RedisLike | string): Promise<RedisLike> {
	if (typeof client !== 'string') return client;
	// a URL: import node-redis if present, else ioredis. Indirect specifiers so the type checker does
	// not require these optional peers to be installed (they resolve at runtime only).
	const nodeRedis = 'redis';
	const ioRedis = 'ioredis';
	try {
		const { createClient } = (await import(nodeRedis)) as {
			createClient: (o: { url: string }) => RedisLike;
		};
		const c = createClient({ url: client });
		await c.connect?.();
		return c;
	} catch {
		/* try ioredis */
	}
	const mod = (await import(ioRedis)) as unknown as { default: new (url: string) => RedisLike };
	return new mod.default(client);
}

// THE FLAVOUR, read once from the client's own methods: node-redis has `zAdd`, ioredis `zadd`.
// (Trying one form and falling back on the error cost ioredis a round trip on every write.)
const node = (r: RedisLike): NodeRedis | null =>
	typeof (r as unknown as NodeRedis).zAdd === 'function' ? (r as unknown as NodeRedis) : null;
const zadd = (r: RedisLike, key: string, score: number, member: string) => {
	const n = node(r);
	return n ? n.zAdd(key, { score, value: member }) : r.zadd!(key, score, member);
};
const zrem = (r: RedisLike, key: string, members: string[]) => {
	if (!members.length) return Promise.resolve();
	const n = node(r);
	return n ? n.zRem(key, members) : r.zrem!(key, ...members);
};
const zrange = (
	r: RedisLike,
	key: string,
	a: number,
	b: number,
	rev = false
): Promise<string[]> => {
	const n = node(r);
	if (n) return rev ? n.zRange(key, a, b, { REV: true }) : n.zRange(key, a, b);
	return rev ? r.zrange!(key, a, b, 'REV') : r.zrange!(key, a, b);
};
const zcard = (r: RedisLike, key: string): Promise<number> => {
	const n = node(r);
	return n ? n.zCard(key) : r.zcard!(key);
};
/** drop every member but the newest `keep`, with the keys they name */
const trim = async (r: RedisLike, key: string, item: string, keep: number) => {
	const stale = await zrange(r, key, 0, -(keep + 1));
	if (!stale.length) return;
	await r.del(stale.map((m) => item + m));
	await zrem(r, key, stale);
};

export class RedisStore implements ProfilerStore {
	readonly kind: string = 'redis';
	#client: RedisLike | string;
	#ttl: number | undefined;
	#R: string;
	#RZ: string;
	#V: string;
	/** the client, made once: two first calls share it, and a failure to make it is not kept */
	#connect: Flights<void, RedisLike>;
	/** the client made, for `close` */
	#made: RedisLike | null = null;

	constructor(client: RedisLike | string, opts: { ttlSeconds?: number; prefix?: string } = {}) {
		const prefix = opts.prefix ?? 'og:';
		this.#client = client;
		this.#ttl = opts.ttlSeconds;
		this.#R = `${prefix}report:`;
		this.#RZ = `${prefix}reports`;
		this.#V = `${prefix}visit:`;
		this.#connect = this.#connector();
	}

	async init(): Promise<void> {
		await this.#need();
	}

	async putReport(rec: ProfilerRecord): Promise<void> {
		const r = await this.#need();
		const summary: ProfilerSummary = {
			id: rec.id,
			created: rec.created,
			page: rec.page,
			trigger: rec.trigger,
			label: rec.label,
			median: rec.median
		};
		await this.#set_str(r, this.#R + rec.id, JSON.stringify({ summary, dump: rec.dump }));
		await zadd(r, this.#RZ, rec.created, rec.id);
		// the store's own cap, whatever the host prunes to: one ZCARD, a trim only past it
		if ((await zcard(r, this.#RZ)) > MAX_REPORTS) await trim(r, this.#RZ, this.#R, MAX_REPORTS);
	}

	async getReport(id: string): Promise<string | null> {
		const raw = await (await this.#need()).get(this.#R + id);
		if (!raw) return null;
		try {
			return (JSON.parse(raw) as { dump: string }).dump;
		} catch {
			return null;
		}
	}

	async listReports(limit = 30): Promise<ProfilerSummary[]> {
		const r = await this.#need();
		const ids = await zrange(r, this.#RZ, 0, limit - 1, true);
		const out: ProfilerSummary[] = [];
		const gone: string[] = [];
		for (const id of ids) {
			const raw = await r.get(this.#R + id);
			if (!raw) {
				gone.push(id); // expired (TTL) or deleted elsewhere: its id leaves the index too
				continue;
			}
			try {
				out.push((JSON.parse(raw) as { summary: ProfilerSummary }).summary);
			} catch {
				/* skip */
			}
		}
		await zrem(r, this.#RZ, gone);
		return out;
	}

	async deleteReport(id: string): Promise<void> {
		const r = await this.#need();
		await r.del(this.#R + id);
		await zrem(r, this.#RZ, [id]);
	}

	async prune(keep: number): Promise<void> {
		await trim(await this.#need(), this.#RZ, this.#R, keep);
	}

	async putVisit(rec: ProfilerVisitRecord): Promise<void> {
		const r = await this.#need();
		const vz = this.#VZ(rec.page);
		await this.#set_str(r, this.#V + rec.key, JSON.stringify(rec));
		await zadd(r, vz, rec.at, rec.key);
		if ((await zcard(r, vz)) > MAX_VISITS_PER_KEY) await trim(r, vz, this.#V, MAX_VISITS_PER_KEY);
	}

	async listVisits(page: string, limit = 10): Promise<ProfilerVisitRecord[]> {
		const r = await this.#need();
		const keys = await zrange(r, this.#VZ(page), 0, limit - 1, true);
		const out: ProfilerVisitRecord[] = [];
		const gone: string[] = [];
		for (const k of keys) {
			const raw = await r.get(this.#V + k);
			if (!raw) {
				gone.push(k);
				continue;
			}
			try {
				out.push(JSON.parse(raw) as ProfilerVisitRecord);
			} catch {
				/* skip */
			}
		}
		await zrem(r, this.#VZ(page), gone);
		return out;
	}

	async close(): Promise<void> {
		const made = this.#made;
		this.#made = null;
		// (the next call connects again)
		this.#connect = this.#connector();
		await (made as unknown as { quit?: () => Promise<void>; disconnect?: () => void })
			?.quit?.()
			.catch(() => {});
	}

	#connector(): Flights<void, RedisLike> {
		return flights({
			name: 'profiler redis client',
			run: async () => (this.#made = await resolve(this.#client))
		});
	}

	async #need(): Promise<RedisLike> {
		// (nothing drops a connector, so it is never STALE; were it, the current one is asked)
		const c = await this.#connect.get();
		return c === STALE ? this.#need() : c;
	}

	#VZ(page: string): string {
		return `${this.#V}z:${page}`;
	}

	async #set_str(r: RedisLike, key: string, val: string): Promise<void> {
		const n = node(r);
		const ttl = this.#ttl;
		if (!ttl) await r.set(key, val);
		else if (n) await n.set(key, val, { EX: ttl });
		else await r.set(key, val, 'EX', ttl);
	}
}
