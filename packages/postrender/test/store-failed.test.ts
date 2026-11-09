// A store that is down never fails a render: a read misses, a write and an evict are skipped. But a
// store down for a day, every page rendered fresh and nothing kept, must be said. Once per failing
// streak (again only after a store call worked), so an outage does not fill the log.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { install, reset_for_tests, self_evict, store_get, store_put } from '../src/registry.ts';
import type { PostrenderEntry, PostrenderStore } from '../src/types.ts';

const entry: PostrenderEntry = { kind: 'page', html: '<p>x</p>', headers: {}, created: 0 };

let down = true;
const store: PostrenderStore = {
	get: async () => {
		if (down) throw new Error('store down');
		return null;
	},
	put: async () => {
		if (down) throw new Error('store down');
	},
	evict: async () => {
		if (down) throw new Error('store down');
	},
	evictWhere: async () => {},
	evictByTag: async () => []
};

let warns: unknown[][];
beforeEach(() => {
	down = true;
	warns = [];
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
		warns.push(a);
	});
});
afterEach(() => {
	vi.restoreAllMocks();
	reset_for_tests();
});

const said = () => warns.filter((a) => String(a[0]).includes('postrender_store_failed'));

describe('a store that is down', () => {
	it('never fails a render, and is said once per failing streak, with the error', async () => {
		const runtime = install({ store });
		expect(await store_get(runtime, '/a/')).toBeNull();
		await expect(store_put(runtime, '/a/', entry, { ttl: 60, tags: [] })).resolves.toBeUndefined();
		// (an evict, a post's or a stale render's, is tried again; its tries spent: the same streak)
		await self_evict(runtime, '/a/');
		expect(said()).toHaveLength(1);
		expect((said()[0][1] as Error).message).toBe('store down');

		down = false;
		await store_get(runtime, '/a/');
		down = true;
		await store_put(runtime, '/a/', entry, { ttl: 60, tags: [] });
		expect(said()).toHaveLength(2);
	});

	it('a call that started before the outage and answers after it does not end the streak', async () => {
		// a slow read out when the store goes down answers late; the store is still down
		let answer_slow!: () => void;
		const slow = new Promise<void>((r) => (answer_slow = r));
		let calls = 0;
		const flaky: PostrenderStore = {
			...store,
			get: async () => {
				if (++calls === 1) {
					await slow;
					return null;
				}
				throw new Error('store down');
			}
		};
		const runtime = install({ store: flaky });
		const late = store_get(runtime, '/slow/');
		expect(await store_get(runtime, '/a/')).toBeNull(); // the outage: said
		answer_slow();
		await late;
		expect(await store_get(runtime, '/b/')).toBeNull(); // the same outage
		expect(said()).toHaveLength(1);
	});
});
