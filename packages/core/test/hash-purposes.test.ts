// Content hashes by purpose (src/contract/hash.ts, #484): `id64` where a collision would serve the
// wrong thing (a bundle addressed by its inputs, a region skipped on a match), `bucket32` where it
// only spreads (a split, a short display key). One implementation of each.
import { describe, expect, it } from 'vitest';
import { bucket32, fnv1a, fnv1a32, id64 } from '../src/contract/hash.ts';

describe('hash purposes', () => {
	it('id64 is 64 bits (16 hex), and the same function as the region fingerprint', () => {
		expect(id64('a')).toMatch(/^[0-9a-f]{16}$/);
		expect(id64('a')).toBe(fnv1a('a'));
		expect(id64('a')).not.toBe(id64('b'));
	});

	it('bucket32 is the 32-bit FNV-1a, unchanged', () => {
		expect(bucket32('hello')).toBe(fnv1a32('hello'));
		expect(bucket32('hello')).toBe(0x4f9f2cab);
	});
});
