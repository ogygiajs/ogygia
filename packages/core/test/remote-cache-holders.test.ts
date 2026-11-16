// A Kit query entry belongs to the islands that read it while they hydrated (#817): after a
// navigation only the entries every holder left behind are destroyed; a kept island's keep running,
// and one no island held is Kit's to keep (its own references decide).
import { afterEach, describe, expect, it } from 'vitest';
import { remote_cache, release_remote_instances } from '../src/shims/kit-remote/remote-cache.ts';
import { set_current_region } from '../src/current-region.ts';

// (the cache's own entry shape: Kit's resource and its destroy may be missing)
type Entry = { resource?: { destroy?: () => void } };

/** A region stand-in: the cache asks only whether it is still in the page. */
function region(): Element & { isConnected: boolean } {
	return { isConnected: true } as Element & { isConnected: boolean };
}

/** Insert an entry the way Kit's `ensure_entry` does: its own inner map, stored, then filled. */
function kit_insert(
	map: Map<string, Map<string, Entry>>,
	id: string,
	payload: string,
	destroyed: string[]
): Entry {
	let entries = map.get(id);
	if (!entries) {
		entries = new Map();
		map.set(id, entries);
	}
	const entry: Entry = {
		resource: { destroy: () => destroyed.push(`${id}/${payload}`) }
	};
	entries.set(payload, entry);
	return entry;
}

/** Run `fn` as the island of `r` hydrating (the runtime's cursor, hydrate-core.ts). */
function hydrating<T>(r: Element, fn: () => T): T {
	set_current_region(r);
	try {
		return fn();
	} finally {
		set_current_region(null);
	}
}

afterEach(() => {
	remote_cache.query_map.clear();
	remote_cache.live_query_map.clear();
});

describe('remote query entries are held by the islands that read them', () => {
	it('a navigation that keeps an island keeps its live query entry', () => {
		const destroyed: string[] = [];
		const kept = region();
		hydrating(kept, () => kit_insert(remote_cache.live_query_map, 'clock', '', destroyed));
		release_remote_instances();
		expect(destroyed).toEqual([]);
		expect(remote_cache.live_query_map.get('clock')?.has('')).toBe(true);
	});

	it('an entry whose only holder left the page is destroyed and dropped', () => {
		const destroyed: string[] = [];
		const gone = region();
		hydrating(gone, () => kit_insert(remote_cache.query_map, 'count', '1', destroyed));
		gone.isConnected = false;
		release_remote_instances();
		expect(destroyed).toEqual(['count/1']);
		expect(remote_cache.query_map.has('count')).toBe(false);
	});

	it('an entry shared by a departed island and a kept one stays', () => {
		const destroyed: string[] = [];
		const gone = region();
		const kept = region();
		hydrating(gone, () => kit_insert(remote_cache.live_query_map, 'clock', '', destroyed));
		// the kept island's proxy finds the existing entry (a lookup, no insert)
		hydrating(kept, () => remote_cache.live_query_map.get('clock')?.get(''));
		gone.isConnected = false;
		release_remote_instances();
		expect(destroyed).toEqual([]);
	});

	it('an entry no island held while hydrating is left to Kit', () => {
		const destroyed: string[] = [];
		kit_insert(remote_cache.query_map, 'later', '', destroyed);
		release_remote_instances();
		expect(destroyed).toEqual([]);
		expect(remote_cache.query_map.get('later')?.has('')).toBe(true);
	});

	it('a query whose island left mid-command refreshes as a no-op, and the next page reads it fresh (#2007)', async () => {
		const destroyed: string[] = [];
		const gone = region();
		const entry = hydrating(gone, () =>
			kit_insert(remote_cache.query_map, 'count', '1', destroyed)
		) as Entry & { proxy_count: number; cleanup: () => void };
		let cleaned = 0;
		entry.proxy_count = 1;
		entry.cleanup = () => cleaned++;
		gone.isConnected = false;
		release_remote_instances();
		expect(destroyed).toEqual(['count/1']);

		const after_await = remote_cache.query_map.get('count')?.get('1') as
			| (Entry & { resource: Record<string, unknown> })
			| undefined;
		expect(after_await).toBeDefined();
		const left = after_await!.resource as {
			refresh: () => Promise<unknown>;
			set: (v: unknown) => void;
			current: unknown;
		};
		await expect(left.refresh()).resolves.toBeUndefined();
		left.set(5);
		expect(left.current).toBeUndefined();
		expect(destroyed).toEqual(['count/1']);
		expect(cleaned).toBe(1);

		const next = region();
		expect(hydrating(next, () => remote_cache.query_map.get('count')?.get('1'))).toBeUndefined();
		expect(remote_cache.query_map.get('count')?.has('1')).toBe(false);
	});

	it('a left query entry lives exactly as long as the departed island’s proxies (#2007)', () => {
		const destroyed: string[] = [];
		const gone = region();
		const entry = hydrating(gone, () =>
			kit_insert(remote_cache.query_map, 'count', '1', destroyed)
		) as Entry & { proxy_count: number };
		entry.proxy_count = 2;
		gone.isConnected = false;
		release_remote_instances();
		const left = remote_cache.query_map.get('count')?.get('1') as {
			proxy_count: number;
		};
		expect(left.proxy_count).toBe(2);
		left.proxy_count++;
		entry.proxy_count--;
		left.proxy_count--;
		expect(left.proxy_count).toBe(1);
		entry.proxy_count--;
		expect(left.proxy_count).toBe(0);
		release_remote_instances();
		expect(remote_cache.query_map.get('count')?.get('1')).toBe(left);
	});

	it('an entry with no live proxy is dropped outright when its island leaves', () => {
		const destroyed: string[] = [];
		const gone = region();
		const entry = hydrating(gone, () =>
			kit_insert(remote_cache.query_map, 'count', '1', destroyed)
		) as Entry & { proxy_count: number };
		entry.proxy_count = 0;
		gone.isConnected = false;
		release_remote_instances();
		expect(remote_cache.query_map.has('count')).toBe(false);
	});

	it('only the departed payloads of one query go; the map for the id stays while one remains', () => {
		const destroyed: string[] = [];
		const gone = region();
		const kept = region();
		hydrating(gone, () => kit_insert(remote_cache.query_map, 'square', '2', destroyed));
		hydrating(kept, () => kit_insert(remote_cache.query_map, 'square', '5', destroyed));
		gone.isConnected = false;
		release_remote_instances();
		expect(destroyed).toEqual(['square/2']);
		expect([...(remote_cache.query_map.get('square')?.keys() ?? [])]).toEqual(['5']);
	});
});
