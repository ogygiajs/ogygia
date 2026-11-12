/**
 * What the bundled report stores keep, and how they come back after `close()`. The Redis and
 * Postgres drivers are stand-ins (test/_drivers); SQLite runs on the built-in `node:sqlite`.
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { RedisStore } from '../src/profiler/storage/redis.ts';
import { PostgresStore } from '../src/profiler/storage/postgres.ts';
import { SqliteStore } from '../src/profiler/storage/sqlite.ts';
import { MAX_VISITS_PER_KEY } from '../src/profiler/storage/visits.ts';
import type { ProfilerRecord } from '../src/profiler/storage/index.ts';
import { Pool, made as pools } from './_drivers/pg.ts';
import { made as redis_clients } from './_drivers/redis.ts';

const rec = (id: string, created: number): ProfilerRecord => ({
	id,
	created,
	page: '/p',
	trigger: 'page',
	label: '/p',
	median: 1,
	dump: `{"id":"${id}"}`
});

/** An in-memory client shaped like ioredis (lowercase methods, positional arguments). */
function ioredis() {
	const kv = new Map<string, string>();
	const z = new Map<string, Map<string, number>>();
	const calls: string[] = [];
	const zset = (k: string) => z.get(k) ?? z.set(k, new Map()).get(k)!;
	return {
		kv,
		z,
		calls,
		client: {
			async set(k: string, v: string) {
				calls.push('set');
				kv.set(k, v);
			},
			async get(k: string) {
				calls.push('get');
				return kv.get(k) ?? null;
			},
			async del(k: string | string[]) {
				calls.push('del');
				for (const x of Array.isArray(k) ? k : [k]) kv.delete(x);
			},
			async zadd(k: string, score: number, member: string) {
				calls.push('zadd');
				zset(k).set(member, score);
			},
			async zrem(k: string, ...m: string[]) {
				calls.push('zrem');
				for (const x of m) zset(k).delete(x);
			},
			async zrange(k: string, a: number, b: number, rev?: string) {
				calls.push('zrange');
				const members = [...zset(k)].sort((x, y) => x[1] - y[1]).map(([m]) => m);
				if (rev === 'REV') members.reverse();
				const n = members.length;
				const s = a < 0 ? n + a : a;
				const e = b < 0 ? n + b : b;
				return members.slice(Math.max(0, s), Math.max(0, e + 1));
			},
			async zcard(k: string) {
				calls.push('zcard');
				return zset(k).size;
			}
		}
	};
}

beforeEach(() => {
	pools.length = 0;
	redis_clients.length = 0;
});

describe('the Redis store', () => {
	it('keeps at most 1000 reports with no prune from the host, and trims only past that', async () => {
		const f = ioredis();
		const s = new RedisStore(f.client as never);
		for (let i = 0; i < 1000; i++) await s.putReport(rec(`r${i}`, i));
		expect(f.calls).not.toContain('zrange');
		await s.putReport(rec('r1000', 1000));
		expect(f.z.get('og:reports')!.size).toBe(1000);
		expect(f.kv.has('og:report:r0')).toBe(false);
		expect(f.kv.has('og:report:r1000')).toBe(true);
	});

	it("a visit that expired leaves its page's index when the visits are listed", async () => {
		const f = ioredis();
		const s = new RedisStore(f.client as never);
		await s.putVisit({ key: '/p\u00001', page: '/p', at: 1, visit: '{}' });
		await s.putVisit({ key: '/p\u00002', page: '/p', at: 2, visit: '{}' });
		f.kv.delete('og:visit:/p\u00001');
		expect((await s.listVisits('/p')).map((v) => v.at)).toEqual([2]);
		expect([...f.z.get('og:visit:z:/p')!.keys()]).toEqual(['/p\u00002']);
	});

	it('after close, the next call connects a new client', async () => {
		const s = new RedisStore('redis://localhost:6379');
		await s.listReports();
		await s.close();
		await s.listReports();
		expect(redis_clients.length).toBe(2);
	});
});

describe('the Postgres store', () => {
	it('`schema` and `table` name the tables, and the dump column is jsonb', async () => {
		const pool = new Pool();
		const s = new PostgresStore(pool, { schema: 'prof', table: 'app' });
		await s.putReport(rec('a', 1));
		expect(pool.queries[0]).toBe('CREATE SCHEMA IF NOT EXISTS "prof"');
		const create = pool.queries.find((q) => q.includes('"prof"."app_reports" (id'))!;
		expect(create).toContain('dump JSONB NOT NULL');
		expect(pool.queries.some((q) => q.startsWith('INSERT INTO "prof"."app_reports"'))).toBe(true);
		expect(pool.queries.some((q) => q.includes('"prof"."app_visits"'))).toBe(true);
	});

	it('the default tables are ogygia_reports and ogygia_visits', async () => {
		const pool = new Pool();
		await new PostgresStore(pool).init();
		expect(pool.queries.some((q) => q.includes('"ogygia_reports"'))).toBe(true);
		expect(pool.queries.some((q) => q.includes('"ogygia_visits"'))).toBe(true);
	});

	it('a visit write trims its page to the newest MAX_VISITS_PER_KEY', async () => {
		const pool = new Pool();
		const s = new PostgresStore(pool);
		await s.putVisit({ key: '/p\u00001', page: '/p', at: 1, visit: '{}' });
		const last = pool.queries.at(-1)!;
		expect(last).toMatch(/^DELETE FROM "ogygia_visits" WHERE page = \$1/);
	});

	it('after close, the next call opens a new pool and the old one is ended', async () => {
		const s = new PostgresStore('postgres://localhost/db');
		await s.listReports();
		await s.close();
		await s.listReports();
		expect(pools.length).toBe(2);
		expect(pools[0].ended).toBe(true);
	});
});

describe('the SQLite store', () => {
	it("makes its file's parent folders", () => {
		const dir = mkdtempSync(join(tmpdir(), 'og-sqlite-'));
		const file = join(dir, 'a', 'b', 'profiles.db');
		const s = new SqliteStore(file);
		s.putReport(rec('a', 1));
		expect(s.getReport('a')).toBe('{"id":"a"}');
		s.close();
		expect(existsSync(file)).toBe(true);
	});

	it('keeps the newest MAX_VISITS_PER_KEY visits per page', () => {
		const s = new SqliteStore(':memory:');
		const n = MAX_VISITS_PER_KEY + 3;
		for (let i = 0; i < n; i++) s.putVisit({ key: `/p\u0000${i}`, page: '/p', at: i, visit: '{}' });
		s.putVisit({ key: '/q\u00000', page: '/q', at: 0, visit: '{}' });
		const kept = s.listVisits('/p', n);
		expect(kept.length).toBe(MAX_VISITS_PER_KEY);
		expect(kept.at(-1)!.at).toBe(3);
		expect(s.listVisits('/q').length).toBe(1);
		s.close();
	});
});
