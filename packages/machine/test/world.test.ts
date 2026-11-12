import { describe, expect, it, vi } from 'vitest';
import { flights, STALE, world } from '../src/index.ts';
import { KEYS_KEPT, watch_world } from '../src/world.ts';
import { macrotask } from './_tick.ts';
import { DISPOSE } from './_dispose.ts';

/** A promise and its two ends. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('a world', () => {
	it('a stamp is fresh until the world moves, and only moves forward', () => {
		const w = world();
		const a = w.stamp();
		expect(w.fresh(a)).toBe(true);
		w.bump();
		expect(w.fresh(a)).toBe(false);
		const b = w.stamp();
		expect(b).toBeGreaterThan(a);
		expect(w.fresh(b)).toBe(true);
		// a stamp from ahead of it is no stamp of this world
		expect(w.fresh(b + 1)).toBe(false);
	});

	it('a keyed world moves only what read the keys it moved', () => {
		const w = world.keyed<string>();
		const s = w.stamp();
		w.bump(['x']);
		expect(w.fresh(s, ['y'])).toBe(true);
		expect(w.fresh(s, ['x', 'y'])).toBe(false);
		expect(w.fresh(s, [])).toBe(true);
		// no keys: did anything at all move
		expect(w.fresh(s)).toBe(false);
		expect(w.fresh(w.stamp())).toBe(true);
		// made after the move: fresh for x too
		expect(w.fresh(w.stamp(), ['x'])).toBe(true);
	});

	it('a whole move of a keyed world puts every stamp before it out of date', () => {
		const w = world.keyed<string>();
		const s = w.stamp();
		w.bump();
		expect(w.fresh(s, ['never-moved'])).toBe(false);
		expect(w.fresh(w.stamp(), ['never-moved'])).toBe(true);
	});

	it('an empty move moves nothing', () => {
		const w = world.keyed<string>();
		const s = w.stamp();
		w.bump([]);
		expect(w.stamp()).toBe(s);
		expect(w.fresh(s)).toBe(true);
	});

	it('past KEYS_KEPT keys, the oldest move folds into the floor: never fresh when it is not', () => {
		const w = world.keyed<number>();
		const before = w.stamp();
		w.bump([-1]); // the oldest move, folded once the map is full
		const mid = w.stamp();
		for (let i = 0; i < KEYS_KEPT; i++) w.bump([i]);
		// -1's move is forgotten, so a stamp from before it is out of date for every key
		expect(w.fresh(before, [-1])).toBe(false);
		expect(w.fresh(before, [KEYS_KEPT + 7])).toBe(false);
		// a stamp from after the folded move still reads exactly
		expect(w.fresh(mid, [-1])).toBe(true);
		expect(w.fresh(mid, [0])).toBe(false);
	});

	it('one move of more than KEYS_KEPT keys folds into the floor: out of date for every key, never fresh by mistake', () => {
		const w = world.keyed<number>();
		const before = w.stamp();
		const many = Array.from({ length: KEYS_KEPT + 500 }, (_, i) => i);
		w.bump(many);
		const moved = (w as unknown as { _moved: Map<number, number> })._moved;
		expect(moved.size).toBeLessThanOrEqual(KEYS_KEPT);
		for (const key of [0, KEYS_KEPT + 499, -1]) expect(w.fresh(before, [key])).toBe(false);
		const after = w.stamp();
		for (const key of [0, KEYS_KEPT + 499, -1]) expect(w.fresh(after, [key])).toBe(true);
	});

	it('a key moved again goes to the back of the line: past KEYS_KEPT, the oldest move folds, not its newest', () => {
		const w = world.keyed<number>();
		w.bump([-1]);
		for (let i = 0; i < KEYS_KEPT - 1; i++) w.bump([i]);
		const read = w.stamp();
		w.bump([-1]);
		w.bump([KEYS_KEPT]);
		// 0's move folds into the floor; it came before `read`, so what read 1 is still good
		expect(w.fresh(read, [1])).toBe(true);
		expect(w.fresh(read, [-1])).toBe(false);
	});

	it('a watcher hears each move, the keys it moved or null, until it stops watching', () => {
		const w = world.keyed<string>();
		const heard: (string[] | null)[] = [];
		const owner = {};
		const stop = watch_world(w, owner, (o, keys) => {
			expect(o).toBe(owner);
			heard.push(keys === null ? null : [...keys]);
		});
		w.bump(['a']);
		w.bump();
		stop?.();
		w.bump(['b']);
		expect(heard).toEqual([['a'], null]);
		expect(
			watch_world({ stamp: () => 0, fresh: () => true, bump: () => {} }, owner, () => {})
		).toBe(null);
	});

	it('a whole move is never undone by a later key folding into the floor', () => {
		const w = world.keyed<number>();
		w.bump(Array.from({ length: KEYS_KEPT }, (_, i) => i));
		const before = w.stamp();
		w.bump(); // every stamp so far is out of date, for every key
		w.bump([-1]);
		expect(w.fresh(before, [-5])).toBe(false);
	});

	it('a key moved again is the newest in line: the next fold takes an older key', () => {
		const w = world.keyed<number>();
		w.bump([-1]);
		w.bump(Array.from({ length: KEYS_KEPT - 1 }, (_, i) => i));
		const mid = w.stamp();
		w.bump([-1]); // -1 again: now the newest, not the oldest
		w.bump([-2]); // one key too many: the oldest (0..) folds, at mid
		expect(w.fresh(mid, [-3])).toBe(true);
		expect(w.fresh(mid, [-1])).toBe(false);
	});

	it('a watcher let go hears no more moves, and its owner is no longer watched for collection', () => {
		const w = world();
		const hear = vi.fn();
		const unregister = vi.spyOn(FinalizationRegistry.prototype, 'unregister');
		const unwatch = watch_world(w, {}, hear)!;
		w.bump();
		unwatch();
		w.bump();
		expect(hear).toHaveBeenCalledOnce();
		expect(unregister).toHaveBeenCalledOnce();
		unregister.mockRestore();
	});

	it('a stamp from the future is never fresh', () => {
		const w = world();
		expect(w.fresh(w.stamp() + 1)).toBe(false);
		const keyed = world.keyed<string>();
		keyed.bump(['a']);
		expect(keyed.fresh(keyed.stamp() + 1, ['b'])).toBe(false);
		expect(keyed.fresh(keyed.stamp() + 1)).toBe(false);
	});
});

describe('flights in a world', () => {
	it('a move drops the kept answers and ends the flights out: their callers get STALE', async () => {
		const w = world();
		const d = deferred<string>();
		let aborted = false;
		const pages = flights({
			world: w,
			run: (href: string, signal) => {
				signal.addEventListener('abort', () => (aborted = true));
				return href === '/out' ? d.promise : Promise.resolve(href);
			}
		});
		expect(await pages.get('/kept')).toBe('/kept');
		const out = pages.get('/out');
		w.bump();
		expect(await out).toBe(STALE);
		expect(aborted).toBe(true);
		expect(pages.peek('/kept')).toBeUndefined();
		d.resolve('late');
		await macrotask();
		expect(pages.peek('/out')).toBeUndefined();
	});

	it('an answer whose world moved on its way is STALE for every joiner, and not kept', async () => {
		const w = world.keyed<string>();
		const d = deferred<{ tags: string[] }>();
		const docs = flights({
			world: w,
			touches: (answer: { tags: string[] }) => answer.tags,
			run: () => d.promise
		});
		const pinned = docs.get();
		const held = docs.get(undefined, { signal: new AbortController().signal });
		w.bump(['x']); // nothing kept yet: the flight goes on, to be judged by its answer
		expect(docs.peek(undefined)).toEqual({ kind: 'flying' });
		d.resolve({ tags: ['x'] });
		expect(await pinned).toBe(STALE);
		expect(await held).toBe(STALE);
		expect(docs.peek(undefined)).toBeUndefined();
	});

	it('a move of other keys keeps the flight out and its answer (#294)', async () => {
		const w = world.keyed<string>();
		const d = deferred<{ tags: string[] }>();
		const run = vi.fn(() => d.promise);
		const docs = flights({ world: w, touches: (a: { tags: string[] }) => a.tags, run });
		const y = docs.get();
		w.bump(['x']);
		d.resolve({ tags: ['y'] });
		expect(await y).toEqual({ tags: ['y'] });
		expect(docs.peek(undefined)?.kind).toBe('kept');
		await docs.get();
		expect(run).toHaveBeenCalledOnce();
	});

	it('a keyed move drops the kept answers made from its keys, and only those', async () => {
		const w = world.keyed<string>();
		const docs = flights({
			world: w,
			touches: (a: { tags: string[] }) => a.tags,
			run: async (p: string) => ({ tags: [p] })
		});
		await docs.get('x');
		await docs.get('y');
		w.bump(['x']);
		expect(docs.peek('x')).toBeUndefined();
		expect(docs.peek('y')?.kind).toBe('kept');
	});

	it('a refresh beside a kept answer: an answer made stale on the way leaves the kept one', async () => {
		const w = world.keyed<string>();
		let next = deferred<{ v: number; tags: string[] }>();
		const docs = flights({
			world: w,
			touches: (a: { v: number; tags: string[] }) => a.tags,
			run: () => next.promise
		});
		const first = docs.get();
		next.resolve({ v: 1, tags: ['a'] });
		await first;
		next = deferred();
		const refresh = docs.get(undefined, { fresh: true });
		w.bump(['b']); // the kept answer read a: it stays; the refresh is judged when it lands
		next.resolve({ v: 2, tags: ['b'] });
		expect(await refresh).toBe(STALE);
		const kept = docs.peek(undefined);
		expect(kept?.kind === 'kept' && kept.answer.v).toBe(1);
	});

	it('a touches that throws: the kept answer goes on a move, a landing fails its callers', async () => {
		const w = world.keyed<string>();
		const bad = new Error('cannot tell');
		let throws = false;
		const docs = flights({
			world: w,
			touches: () => {
				if (throws) throw bad;
				return ['a'];
			},
			run: async () => 1
		});
		await docs.get();
		throws = true;
		w.bump(['z']);
		expect(docs.peek(undefined)).toBeUndefined();
		await expect(docs.get()).rejects.toBe(bad);
		expect(docs.peek(undefined)).toBeUndefined();
	});

	it('with no touches, a move of some keys still ends the flights out at once', async () => {
		const w = world.keyed<string>();
		const d = deferred<string>();
		let aborted = false;
		const pages = flights({
			world: w,
			run: (_: string, signal) => {
				signal.addEventListener('abort', () => (aborted = true));
				return d.promise;
			}
		});
		const out = pages.get('/out');
		w.bump(['x']);
		expect(aborted).toBe(true);
		expect(await out).toBe(STALE);
	});

	it('with touches, a whole move drops every kept answer and ends the flights out', async () => {
		const w = world.keyed<string>();
		const d = deferred<{ tags: string[] }>();
		const docs = flights({
			world: w,
			touches: (a: { tags: string[] }) => a.tags,
			run: (p: string) => (p === 'out' ? d.promise : Promise.resolve({ tags: [p] }))
		});
		await docs.get('kept');
		const out = docs.get('out');
		w.bump();
		expect(docs.peek('kept')).toBeUndefined();
		expect(await out).toBe(STALE);
	});

	it('a disposed flights lets go of its world: the world holds no watcher for it', async () => {
		const w = world();
		const docs = flights({ world: w, run: async () => 1 });
		const watchers = (w as unknown as { _watchers: Set<unknown> })._watchers;
		expect(watchers.size).toBe(1);
		docs[DISPOSE]();
		expect(watchers.size).toBe(0);
	});

	it('a disposed flights stops hearing its world', async () => {
		const w = world();
		const run = vi.fn(async () => 1);
		const docs = flights({ world: w, run });
		await docs.get();
		docs[DISPOSE]();
		w.bump();
		expect(await docs.get()).toBe(STALE);
	});

	it('takes only a world made by world()', () => {
		expect(() =>
			flights({
				world: { stamp: () => 0, fresh: () => true, bump: () => {} },
				run: () => 1
			})
		).toThrow(/world/);
	});
});
