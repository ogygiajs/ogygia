/**
 * The Postgres and Redis stores connect once and set up once (#197): a setup that fails (one
 * connection blip at the first write) is tried again by the next call, and two first calls at
 * once share one client. The drivers are stand-ins shaped like `pg` and `redis` (test/_drivers).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PostgresStore } from '../src/profiler/storage/postgres.ts';
import { RedisStore } from '../src/profiler/storage/redis.ts';
import type { ProfilerRecord } from '../src/profiler/storage/index.ts';
import { Pool, made as pools } from './_drivers/pg.ts';
import { made as redis_clients } from './_drivers/redis.ts';

const rec = (id: string): ProfilerRecord => ({
	id,
	created: 1,
	page: '/p',
	trigger: 'page',
	label: '/p',
	median: 1,
	dump: '{}'
});

beforeEach(() => {
	pools.length = 0;
	redis_clients.length = 0;
});

describe('the Postgres store', () => {
	it('a setup that fails once is set up again by the next call', async () => {
		const pool = new Pool();
		pool.fail = 1;
		const store = new PostgresStore(pool);
		await expect(store.init()).rejects.toThrow('connection reset');
		await store.putReport(rec('a'));
		// the first table's query that failed, then both tables made
		expect(pool.queries.filter((q) => q.startsWith('CREATE TABLE')).length).toBe(3);
		expect(pool.queries.some((q) => q.startsWith('INSERT INTO'))).toBe(true);
	});

	it('two first calls at once open one pool', async () => {
		const store = new PostgresStore('postgres://localhost/db');
		await Promise.all([store.putReport(rec('a')), store.putReport(rec('b'))]);
		expect(pools.length).toBe(1);
	});
});

describe('the Redis store', () => {
	it('two first calls at once open one client', async () => {
		const store = new RedisStore('redis://localhost:6379');
		await Promise.all([store.putReport(rec('a')), store.putReport(rec('b'))]);
		expect(redis_clients.length).toBe(1);
	});
});
