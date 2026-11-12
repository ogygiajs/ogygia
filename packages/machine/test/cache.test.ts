import { afterEach, describe, expect, it, vi } from 'vitest';
import { cache, clock, flights, MachineError, scope, world, type EvictWhy } from '../src/index.ts';
import { DISPOSE } from './_dispose.ts';

/** Steps the monotonic clock (the one ages are on) by `ms`, without running the timers due. */
function step_mono(ms: number): void {
	const at = clock.mono() + ms;
	vi.spyOn(clock, 'mono').mockImplementation(() => at);
}

/** A cache's notices, as `key:value:why`. */
function noted() {
	const seen: string[] = [];
	const onEvict = (key: unknown, value: unknown, why: EvictWhy) =>
		seen.push(`${String(key)}:${String(value)}:${why}`);
	return { seen, onEvict };
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('cache: bounded', () => {
	it('max is required: there is no unbounded default', () => {
		expect(() => cache({} as never)).toThrow(MachineError);
		expect(() => cache({ max: 0 })).toThrow(MachineError);
		expect(() => cache({ max: -1 })).toThrow(MachineError);
		expect(() => cache({ max: Number.NaN })).toThrow(MachineError);
		// a bound is a number: Infinity is no bound
		expect(() => cache({ max: Infinity })).toThrow(MachineError);
	});

	it('flights keeps at most 1000 answers by default, the least recently used out first', async () => {
		const pages = flights({ run: async (k: number) => k });
		for (let k = 0; k <= 1000; k++) await pages.get(k);
		expect(pages.peek(0)).toBeUndefined();
		expect(pages.peek(1)).toMatchObject({ kind: 'kept', answer: 1 });
		expect(pages.peek(1000)).toMatchObject({ kind: 'kept', answer: 1000 });
	});

	it('past max, the least recently used goes first, and a get is a use', () => {
		const n = noted();
		const c = cache<string, number>({ max: 2, onEvict: n.onEvict });
		c.set('a', 1);
		c.set('b', 2);
		expect(c.get('a')).toBe(1); // a is used: b is now the oldest
		c.set('c', 3);
		expect(c.has('b')).toBe(false);
		expect([...c.entries()]).toEqual([
			['a', 1],
			['c', 3]
		]);
		expect(n.seen).toEqual(['b:2:size']);
	});

	it('a peek is not a use', () => {
		const c = cache<string, number>({ max: 2 });
		c.set('a', 1);
		c.set('b', 2);
		expect(c.peek('a')).toBe(1);
		c.set('c', 3);
		expect(c.has('a')).toBe(false);
	});

	it('the least recently used order holds through repeated uses, replaces and lets go of the newest', () => {
		const n = noted();
		const c = cache<string | undefined, number>({ max: 3, onEvict: n.onEvict });
		c.set('a', 1);
		c.set('b', 2);
		c.get('b');
		c.get('b'); // (the newest used again: still the newest)
		c.set('b', 20); // (the newest replaced: still the newest)
		c.get('a'); // a is now the newest, b the oldest
		c.set(undefined, 9); // (any value is a key, undefined too)
		c.get(undefined);
		expect([...c.entries()]).toEqual([
			['b', 20],
			['a', 1],
			[undefined, 9]
		]);
		c.delete(undefined); // the newest goes
		c.set('c', 3);
		c.get('c');
		c.set('a', 10); // a replaced while c is the newest: a moves to the end
		c.set('d', 4); // past max: b, the oldest, goes
		expect([...c.entries()]).toEqual([
			['c', 3],
			['a', 10],
			['d', 4]
		]);
		expect(n.seen).toEqual(['b:2:delete', 'undefined:9:delete', 'a:1:delete', 'b:20:size']);
	});

	it('the newest value read after it left finds nothing, whichever way it left', () => {
		const c = cache<string, number>({ max: 2, keep: 1000, pinned: (v) => v === 0 });
		c.set('a', 1);
		c.delete('a');
		expect(c.get('a')).toBeUndefined();
		c.set('a', 1);
		c.clear();
		expect(c.get('a')).toBeUndefined();
		c.set('a', 1);
		step_mono(1000); // past its age: a read sweeps it
		expect(c.get('a')).toBeUndefined();
		expect(c.size).toBe(0);
		vi.restoreAllMocks();
		c.set('p', 0); // pinned
		c.set('b', 2);
		c.set('c', 3); // past max: p is pinned, so b goes, the newest as it goes
		expect(c.get('b')).toBeUndefined();
		expect(c.get('c')).toBe(3);
		c.set('c', 30); // the newest replaced in place
		expect(c.get('c')).toBe(30);
		expect(c.get('p')).toBe(0);
	});

	it('weigh counts against max: as many go as it takes, oldest first', () => {
		const n = noted();
		const c = cache<string, string>({ max: 10, weigh: (v) => v.length, onEvict: n.onEvict });
		c.set('a', 'xxxx');
		c.set('b', 'xxxx');
		expect(c.weight).toBe(8);
		c.set('c', 'xxxxxxx');
		expect(c.weight).toBe(7);
		expect(c.size).toBe(1);
		expect(n.seen).toEqual(['a:xxxx:size', 'b:xxxx:size']);
	});

	it('a pinned value counts against max but does not go for size: the next oldest goes', () => {
		const n = noted();
		const busy = new Set(['a']);
		const c = cache<string, number>({
			max: 2,
			pinned: (_v, k) => busy.has(k),
			onEvict: n.onEvict
		});
		c.set('a', 1);
		c.set('b', 2);
		c.set('c', 3);
		expect(n.seen).toEqual(['b:2:size']);
		busy.clear();
		c.set('d', 4);
		expect(n.seen).toEqual(['b:2:size', 'a:1:size']);
	});

	it('a set that only pinned values could make room for is not kept: it says false, nothing goes, and the old one stays', () => {
		const n = noted();
		const c = cache<string, number>({ max: 2, pinned: (_v, k) => k !== 'c', onEvict: n.onEvict });
		c.set('a', 1);
		c.set('b', 2);
		expect(c.set('c', 3)).toBe(false);
		expect(c.get('c')).toBe(undefined);
		expect(n.seen).toEqual([]);
		// a replace too heavy for the room the unpinned leave: the key keeps its value
		const d = cache<string, number>({
			max: 2,
			weigh: (v) => (v >= 100 ? 2 : 1),
			pinned: (_v, k) => k === 'a',
			onEvict: n.onEvict
		});
		d.set('a', 1);
		d.set('c', 30);
		expect(d.set('c', 300)).toBe(false);
		expect(d.get('c')).toBe(30);
		expect(n.seen).toEqual([]);
		// room the unpinned can make is made: the least recently used goes
		d.set('b', 2);
		expect(n.seen).toEqual(['c:30:size']);
	});

	it('a set that must make room replaces the key’s own value past its age: noticed as a replace, never as its age', () => {
		let now = 1_000_000;
		vi.spyOn(clock, 'mono').mockImplementation(() => now);
		const n = noted();
		const c = cache<string, number>({
			max: 2,
			keep: 1000,
			weigh: (v) => (v >= 10 ? 2 : 1),
			onEvict: n.onEvict
		});
		c.set('a', 1);
		c.set('b', 2);
		now += 2000; // both past their age, no sweep yet
		// a heavier value for `a`: room is made, `b` goes for its age, `a`'s old value is replaced
		expect(c.set('a', 10)).toBe(true);
		expect(n.seen).toEqual(['b:2:age', 'a:1:delete']);
		expect(c.get('a')).toBe(10);
	});

	it('a value heavier than max, or with a bad weight, is not kept, and the old one stays', () => {
		const c = cache<string, number>({ max: 5, weigh: (v) => v });
		c.set('a', 2);
		expect(c.set('a', 6)).toBe(false);
		expect(c.set('a', -1)).toBe(false);
		expect(c.set('a', Number.NaN)).toBe(false);
		expect(c.get('a')).toBe(2);
		expect(c.weight).toBe(2);
	});
});

describe('cache: ages', () => {
	it('keep is how long a value stays; one past its age is gone, noticed as age', () => {
		vi.useFakeTimers();
		const n = noted();
		const c = cache<string, number>({ max: 10, keep: 1000, onEvict: n.onEvict });
		c.set('a', 1);
		vi.advanceTimersByTime(999);
		expect(c.get('a')).toBe(1);
		vi.advanceTimersByTime(1);
		expect(c.has('a')).toBe(false);
		expect(c.size).toBe(0);
		expect(n.seen).toEqual(['a:1:age']);
	});

	it('keep made from the value and key; 0 keeps nothing', () => {
		vi.useFakeTimers();
		const c = cache<string, number>({ max: 10, keep: (v, k) => (k === 'never' ? 0 : v) });
		expect(c.set('never', 100)).toBe(false);
		c.set('short', 10);
		c.set('long', 100);
		vi.advanceTimersByTime(50);
		expect([...c.entries()].map(([k]) => k)).toEqual(['long']);
	});

	it('ages are swept at most once a second: a value due soon after a sweep goes with the next (reads are exact)', () => {
		vi.useFakeTimers();
		const n = noted();
		const c = cache<string, number>({
			max: 10,
			keep: (v) => v,
			onEvict: n.onEvict
		});
		c.set('a', 1000);
		c.set('b', 1500);
		vi.advanceTimersByTime(1000);
		expect(n.seen).toEqual(['a:1000:age']);
		vi.advanceTimersByTime(500); // b is past its age: a read says so, the sweep has not run yet
		expect(c.has('b')).toBe(false);
		expect(n.seen).toEqual(['a:1000:age']);
		vi.advanceTimersByTime(500);
		expect(n.seen).toEqual(['a:1000:age', 'b:1500:age']);
	});

	it('one timer for all the ages, owned by the cache', () => {
		vi.useFakeTimers();
		const c = cache<string, number>({ max: 10, keep: 1000 });
		for (let i = 0; i < 5; i++) c.set(String(i), i);
		expect(vi.getTimerCount()).toBe(1);
		c[DISPOSE]();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('the expired go before any live value goes for size', () => {
		vi.useFakeTimers();
		const n = noted();
		const c = cache<string, number>({
			max: 2,
			keep: (v) => (v === 1 ? 100 : Infinity),
			onEvict: n.onEvict
		});
		c.set('old', 1);
		c.set('b', 2);
		step_mono(200); // past old's age, its timer not run yet
		c.set('c', 3);
		expect(n.seen).toEqual(['old:1:age']);
		expect(c.has('b')).toBe(true);
	});
});

describe('cache: the eviction notice', () => {
	it('a value replaced after its age, before its timer ran, is noticed as delete, not age', () => {
		vi.useFakeTimers();
		const n = noted();
		const c = cache<string, number>({ max: 10, keep: 100, onEvict: n.onEvict });
		c.set('a', 1);
		step_mono(200); // past its age, its timer not run yet
		c.set('a', 2);
		expect(n.seen).toEqual(['a:1:delete']);
		expect(c.get('a')).toBe(2);
	});

	it('a flights answer that lands while the one it replaces is past its age is kept', async () => {
		vi.useFakeTimers();
		let round = 0;
		let land!: (v: string) => void;
		const pages = flights({
			run: () => (round++ === 0 ? Promise.resolve('old') : new Promise<string>((r) => (land = r))),
			keep: 100
		});
		expect(await pages.get()).toBe('old');
		const refresh = pages.get(undefined, { fresh: true });
		step_mono(200); // the kept answer is past its age; its timer has not run
		land('new');
		expect(await refresh).toBe('new');
		expect(pages.peek(undefined)).toMatchObject({ kind: 'kept', answer: 'new' });
	});

	it('a delete and a replace are noticed as delete; a clear notices each, oldest first', () => {
		const n = noted();
		const c = cache<string, number>({ max: 10, onEvict: n.onEvict });
		c.set('a', 1);
		c.set('b', 2);
		c.set('a', 3);
		expect(c.delete('b')).toBe(true);
		expect(c.delete('b')).toBe(false);
		c.set('c', 4);
		c.clear();
		expect(n.seen).toEqual(['a:1:delete', 'b:2:delete', 'a:3:delete', 'c:4:delete']);
		expect(c.size).toBe(0);
	});

	it('a notice that throws is reported with its code; the cache goes on', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const c = cache<string, number>({
			name: 'thrower',
			max: 1,
			onEvict: () => {
				throw new Error('cleanup broke');
			}
		});
		c.set('a', 1);
		c.set('b', 2);
		c.set('c', 3);
		expect([...c.entries()]).toEqual([['c', 3]]);
		expect(error).toHaveBeenCalledTimes(2);
		expect(String(error.mock.calls[0]![0])).toContain('machine_evict_failed');
	});

	it('a set or delete inside a notice is defined: its own notices come after the ones already due', () => {
		const n = noted();
		const c: ReturnType<typeof cache<string, number>> = cache<string, number>({
			max: 2,
			onEvict: (key, value, why) => {
				n.onEvict(key, value, why);
				if (key === 'a') c.set('a2', 10); // put back under a new key: evicts the oldest again
				if (key === 'b') c.delete('c');
			}
		});
		c.set('a', 1);
		c.set('b', 2);
		c.set('c', 3); // a goes (size); its notice sets a2, so b goes (size); b's notice deletes c
		expect(n.seen).toEqual(['a:1:size', 'b:2:size', 'c:3:delete']);
		expect([...c.entries()]).toEqual([['a2', 10]]);
	});
});

describe('cache: owned', () => {
	it('its owner ending ends it: every value noticed as end, oldest first, and nothing kept after', () => {
		const n = noted();
		const owner = scope();
		const c = cache<string, number>({ max: 10, owner, onEvict: n.onEvict });
		c.set('a', 1);
		c.set('b', 2);
		owner.close();
		expect(n.seen).toEqual(['a:1:end', 'b:2:end']);
		expect(c.set('c', 3)).toBe(false);
		expect(c.get('a')).toBeUndefined();
		expect(c.size).toBe(0);
	});

	it('with no owner it ends when disposed (a scope can adopt it)', () => {
		const n = noted();
		const owner = scope();
		const c = owner.adopt(cache<string, number>({ max: 10, onEvict: n.onEvict }));
		c.set('a', 1);
		owner.close();
		expect(n.seen).toEqual(['a:1:end']);
	});

	it('an ended owner gives an ended cache', () => {
		const owner = scope();
		owner.close();
		const c = cache<string, number>({ max: 10, owner });
		expect(c.set('a', 1)).toBe(false);
	});
});

describe('cache: freshness', () => {
	it('an older write never overwrites a newer one', () => {
		const w = world();
		const c = cache<string, string>({ max: 10, world: w });
		const early = w.stamp();
		w.bump();
		const late = w.stamp();
		expect(c.set('page', 'late', { stamp: late })).toBe(true);
		expect(c.set('page', 'early', { stamp: early })).toBe(false);
		expect(c.get('page')).toBe('late');
		// the same stamp, or a newer one, writes
		expect(c.set('page', 'again', { stamp: late })).toBe(true);
		expect(c.get('page')).toBe('again');
	});

	it('a write with no stamp takes the world now', () => {
		const w = world();
		const c = cache<string, string>({ max: 10, world: w });
		const before = w.stamp();
		w.bump();
		c.set('k', 'now');
		expect(c.set('k', 'before', { stamp: before })).toBe(false);
	});

	it('a stamp with no world is refused as a bad option', () => {
		const c = cache<string, string>({ max: 10 });
		expect(() => c.set('k', 'v', { stamp: 1 })).toThrow(MachineError);
	});
});
