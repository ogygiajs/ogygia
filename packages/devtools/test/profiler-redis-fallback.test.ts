/**
 * The Redis store given a URL uses ioredis when node-redis is not installed.
 */
import { describe, expect, it, vi } from 'vitest';

const made: string[] = [];

vi.mock('redis', () => {
	throw new Error("Cannot find package 'redis'");
});
vi.mock('ioredis', () => ({
	default: class {
		constructor(url: string) {
			made.push(url);
		}
		async zrange() {
			return [];
		}
		async zrem() {}
	}
}));

describe('a Redis store with no node-redis installed', () => {
	it('connects through ioredis', async () => {
		const { RedisStore } = await import('../src/profiler/storage/redis.ts');
		expect(await new RedisStore('redis://localhost:6379').listReports()).toEqual([]);
		expect(made).toEqual(['redis://localhost:6379']);
	});
});
