/**
 * SizedLru (server/sized-lru.ts) — the byte-bounded LRU behind the postrender memory store: bytes
 * first, entries second, per-entry expiry, LRU touch on read (a multi-MB entry can never blow the
 * budget). (The region render cache is a `flights()` with the same bounds: render-cache.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { SizedLru } from '../src/server/sized-lru.ts';

describe('SizedLru', () => {
	it('bounds bytes: the least recently used entries evict until the new one fits', () => {
		const lru = new SizedLru<string>(100, 100);
		lru.set('a', 'A', 40, 1e9);
		lru.set('b', 'B', 40, 1e9);
		expect(lru.bytes).toBe(80);
		lru.set('c', 'C', 40, 1e9); // 120 > 100 → 'a' goes
		expect(lru.get('a', 0)).toBeNull();
		expect(lru.get('b', 0)).toBe('B');
		expect(lru.bytes).toBe(80);
		expect(lru.size).toBe(2);
	});

	it('a read is an LRU touch: the touched entry survives, the untouched one evicts', () => {
		const lru = new SizedLru<string>(100, 100);
		lru.set('a', 'A', 40, 1e9);
		lru.set('b', 'B', 40, 1e9);
		lru.get('a', 0);
		lru.set('c', 'C', 40, 1e9);
		expect(lru.get('b', 0)).toBeNull();
		expect(lru.get('a', 0)).toBe('A');
	});

	it('bounds entries too, and an entry larger than the whole budget is refused', () => {
		const lru = new SizedLru<string>(1000, 2);
		lru.set('a', 'A', 1, 1e9);
		lru.set('b', 'B', 1, 1e9);
		lru.set('c', 'C', 1, 1e9);
		expect(lru.size).toBe(2);
		expect(lru.has('a')).toBe(false);
		lru.set('huge', 'H', 5000, 1e9);
		expect(lru.has('huge')).toBe(false);
		expect(lru.bytes).toBe(2);
	});

	it('expiry: a read past `expires` misses and frees the bytes; sweep drops every expired entry', () => {
		const lru = new SizedLru<string>(1000, 10);
		lru.set('a', 'A', 10, 100);
		lru.set('b', 'B', 10, 200);
		expect(lru.get('a', 150)).toBeNull();
		expect(lru.bytes).toBe(10);
		lru.sweep(250);
		expect(lru.size).toBe(0);
		expect(lru.bytes).toBe(0);
	});

	it('overwriting a key replaces its bytes, never double-counts', () => {
		const lru = new SizedLru<string>(1000, 10);
		lru.set('a', 'A', 10, 1e9);
		lru.set('a', 'AA', 30, 1e9);
		expect(lru.bytes).toBe(30);
		expect(lru.size).toBe(1);
		lru.clear();
		expect(lru.bytes).toBe(0);
	});
});
