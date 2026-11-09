// The Redis store given a URL imports node-redis, and only when node-redis is not installed tries
// ioredis. A node-redis that IS installed but cannot connect (a wrong password, a host that is not
// there) must fail with ITS error: falling through to ioredis replaced it with "cannot find
// ioredis", and the reason the store was down was lost.
import { describe, expect, it, vi } from 'vitest';

vi.mock('redis', () => ({
	createClient: () => ({
		async connect() {
			throw new Error('WRONGPASS invalid username-password pair');
		}
	})
}));

describe('a Redis store whose node-redis cannot connect', () => {
	it("fails with node-redis's own error, not a missing ioredis", async () => {
		const { RedisStore } = await import('../src/profiler/storage/redis.ts');
		const store = new RedisStore('redis://nobody@redis.test:6379');
		await expect(store.listReports(1)).rejects.toThrow('WRONGPASS');
	});
});
