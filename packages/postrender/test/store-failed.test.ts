// A store that is down never fails a render: a read misses, a write and an evict are skipped. But a
// store down for a day, every page rendered fresh and nothing kept, must be said. Once per failing
// streak (again only after a store call worked), so an outage does not fill the log.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	install,
	reset_for_tests,
	self_evict,
	store_evict,
	store_get,
	store_put
} from '../src/registry.ts';
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
		await expect(store_evict(runtime, '/a/')).resolves.toBeUndefined();
		self_evict(runtime, '/a/');
		await new Promise((r) => setTimeout(r, 0));
		expect(said()).toHaveLength(1);
		expect((said()[0][1] as Error).message).toBe('store down');

		down = false;
		await store_get(runtime, '/a/');
		down = true;
		await store_put(runtime, '/a/', entry, { ttl: 60, tags: [] });
		expect(said()).toHaveLength(2);
	});
});
