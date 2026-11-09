import { describe, expect, it } from 'vitest';
import { scope } from '../src/index.ts';
import { registry } from '../src/registry.ts';

describe('registry: live entries, each owned', () => {
	it('iterates in add order', () => {
		const r = registry<string>();
		const owner = scope();
		r.add('a', owner);
		r.add('b', owner);
		r.add('c', owner);
		expect([...r]).toEqual(['a', 'b', 'c']);
		expect(r.size).toBe(3);
	});

	it('an owner ending removes exactly its own entries', () => {
		const r = registry<string>();
		const one = scope();
		const two = scope();
		r.add('a', one);
		r.add('b', two);
		r.add('c', one);
		one.close();
		expect([...r]).toEqual(['b']);
		two.close();
		expect([...r]).toEqual([]);
	});

	it('the removal takes its entry out, once, and leaves nothing behind in its owner', () => {
		const r = registry<string>();
		const owner = scope();
		const remove = r.add('a', owner);
		r.add('a', owner); // (the same value twice is two entries)
		remove();
		remove();
		expect([...r]).toEqual(['a']);
		owner.close();
		expect([...r]).toEqual([]);
	});

	it('adding with an owner that already ended is refused: nothing is added', () => {
		const r = registry<string>();
		const owner = scope();
		owner.close();
		const remove = r.add('a', owner);
		expect([...r]).toEqual([]);
		remove(); // (a no-op)
	});

	it('nothing is ever evicted: as many entries as their owners keep', () => {
		const r = registry<number>();
		const owner = scope();
		for (let i = 0; i < 5000; i++) r.add(i, owner);
		expect(r.size).toBe(5000);
	});

	it('an entry removed while the registry is walked is not walked after', () => {
		const r = registry<string>();
		const owner = scope();
		const removes = ['a', 'b', 'c'].map((v) => r.add(v, owner));
		const seen: string[] = [];
		for (const v of r) {
			seen.push(v);
			if (v === 'a') removes[1]!();
		}
		expect(seen).toEqual(['a', 'c']);
	});
});
