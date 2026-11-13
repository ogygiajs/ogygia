// The concurrency gate (runtime/concurrency.ts): hole renders on the server (REGION_RENDER_CONCURRENCY)
// and the runtime's hole fetches in the browser. Never more than `limit` bodies running that someone
// still waits on (#195); a body past its deadline is abandoned and never blocks the next call (a hung
// upstream must not take every hole down). Fake timers make each race exact.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConcurrencyGate } from '../src/runtime/concurrency.ts';

/** A body that runs until `end()`: counts how many run at once. */
function bodies() {
	let running = 0;
	let most = 0;
	const ends: Array<() => void> = [];
	const order: string[] = [];
	const body = (name: string) => () =>
		new Promise<string>((resolve) => {
			running++;
			most = Math.max(most, running);
			order.push(name);
			ends.push(() => {
				running--;
				resolve(name);
			});
		});
	return {
		body,
		order,
		end: (i: number) => ends[i](),
		get running() {
			return running;
		},
		get most() {
			return most;
		}
	};
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('ConcurrencyGate: never more than its limit running', () => {
	it('a freed slot goes to the next in line, not to a call that arrives in the same tick', async () => {
		const g = new ConcurrencyGate(1);
		const b = bodies();
		const a = g.run(b.body('a'));
		const queued = g.run(b.body('b'));
		await tick();
		b.end(0); // a ends: its slot frees one microtask from now, b resumes one after that …
		// … and c arrives in between (another request's code, resuming in the same turn)
		const late = Promise.resolve().then(() => g.run(b.body('c')));
		await tick();
		expect(b.most).toBe(1);
		expect(b.order).toEqual(['a', 'b']);
		b.end(1);
		await tick();
		b.end(2);
		expect(await Promise.all([a, queued, late])).toEqual(['a', 'b', 'c']);
		expect(b.most).toBe(1);
		expect(g.active).toBe(0);
	});

	it('first come, first served', async () => {
		const g = new ConcurrencyGate(2);
		const b = bodies();
		const all = ['a', 'b', 'c', 'd', 'e'].map((n) => g.run(b.body(n)));
		await tick();
		for (let i = 0; i < 5; i++) {
			b.end(i);
			await tick();
		}
		expect(await Promise.all(all)).toEqual(['a', 'b', 'c', 'd', 'e']);
		expect(b.order).toEqual(['a', 'b', 'c', 'd', 'e']);
		expect(b.most).toBe(2);
	});

	it('a body that throws frees its slot', async () => {
		const g = new ConcurrencyGate(1);
		await expect(g.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
		await expect(g.run(async () => 'next')).resolves.toBe('next');
		expect(g.active).toBe(0);
	});
});

describe('ConcurrencyGate: one deadline per call (the region render timeout, #195)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('a free slot is taken whatever the deadline: a deadline already due runs the body and is its run timeout', async () => {
		const g = new ConcurrencyGate(1);
		const b = bodies();
		const call = g.run(b.body('due'), { deadline_ms: 0 });
		const caught = call.catch((e: Error) => e.message);
		await vi.advanceTimersByTimeAsync(0);
		expect(b.order).toEqual(['due']); // it started
		expect(await caught).toBe('region render timeout'); // the run timeout, not the queue's
		b.end(0);
	});

	it('a body past its deadline is abandoned: its caller gets the timeout, its slot goes on', async () => {
		const g = new ConcurrencyGate(1);
		const b = bodies();
		const slow = g.run(b.body('slow'), { deadline_ms: 100 });
		const caught = slow.catch((e: Error) => e.message);
		const next = g.run(b.body('next'), { deadline_ms: 10_000 });
		await vi.advanceTimersByTimeAsync(100);
		expect(await caught).toBe('region render timeout'); // the caller stops waiting …
		expect(b.order).toEqual(['slow', 'next']); // … and the next call runs: nobody waits on `slow`
		expect(g.active).toBe(1); // the one someone waits on
		expect(g.abandoned).toBe(1); // and the one still running that nobody waits on
		b.end(1);
		await expect(next).resolves.toBe('next');
		b.end(0); // the abandoned render really ends: it frees nothing it gave away
		await vi.advanceTimersByTimeAsync(0);
		expect(g.abandoned).toBe(0);
		expect(g.active).toBe(0);
	});

	it('four renders on a hung upstream never stop the fifth hole: it renders at once', async () => {
		const g = new ConcurrencyGate(4);
		const b = bodies();
		const hung = Array.from({ length: 4 }, (_, i) =>
			g.run(b.body(`hung ${i}`), { deadline_ms: 10_000 }).catch((e: Error) => e.message)
		);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(await Promise.all(hung)).toEqual(Array(4).fill('region render timeout'));
		// minutes later, the upstream still hangs: a hole that never touches it renders anyway
		await vi.advanceTimersByTimeAsync(120_000);
		const fifth = g.run(async () => 'rendered', { deadline_ms: 10_000 });
		await expect(fifth).resolves.toBe('rendered');
		expect(g.abandoned).toBe(4);
		expect(g.waiting).toBe(0);
	});

	it('the deadline covers the wait and the run together: the call answers within it', async () => {
		const g = new ConcurrencyGate(1);
		const b = bodies();
		const first = g.run(b.body('first'));
		const second = g.run(b.body('second'), { deadline_ms: 10_000 }).catch((e: Error) => e.message);
		await vi.advanceTimersByTimeAsync(6_000);
		b.end(0); // the first ends at 6 s: the second enters, with 4 s of its deadline left
		await vi.advanceTimersByTimeAsync(0);
		expect(b.order).toEqual(['first', 'second']);
		await vi.advanceTimersByTimeAsync(4_000);
		expect(await second).toBe('region render timeout'); // at 10 s, never at 16 s
		await first;
	});

	it('eight bodies that never end, through a gate of four: four run, the rest give up waiting', async () => {
		const g = new ConcurrencyGate(4);
		const b = bodies();
		const calls = Array.from({ length: 8 }, (_, i) =>
			g.run(b.body(String(i)), { deadline_ms: 10_000 }).catch((e: Error) => e.message)
		);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(b.most).toBe(4); // never more than the limit while they are waited on
		const outcomes = await Promise.all(calls);
		expect(outcomes.filter((o) => o === 'region render timeout')).toHaveLength(4);
		// (a waiter whose deadline passed is never handed a slot: it would only start a body nobody
		// waits on)
		expect(outcomes.filter((o) => o === 'region render queue timeout')).toHaveLength(4);
		expect(b.order).toEqual(['0', '1', '2', '3']);
		expect(g.active).toBe(0);
		expect(g.abandoned).toBe(4);
	});

	it('a deadline longer than a timer can hold still waits, and does not time out at once', async () => {
		const g = new ConcurrencyGate(1);
		let end!: () => void;
		const long = g.run(() => new Promise<string>((resolve) => (end = () => resolve('done'))), {
			deadline_ms: 2 ** 31 + 1_000
		});
		const caller = long.catch((e: Error) => e.message);
		await vi.advanceTimersByTimeAsync(10);
		end();
		expect(await caller).toBe('done');
	});

	it('a body that ends in time leaves no timer behind', async () => {
		const g = new ConcurrencyGate(2);
		await g.run(async () => 'quick', { deadline_ms: 10_000 });
		expect(vi.getTimerCount()).toBe(0);
	});

	it('waiters that gave up leave the queue at once, even while no slot ever frees', async () => {
		const g = new ConcurrencyGate(1);
		void g.run(() => new Promise(() => {})); // a render with no deadline that never ends
		const gave_up = Array.from({ length: 100 }, () =>
			g.run(async () => 'never', { deadline_ms: 10 }).catch((e: Error) => e.message)
		);
		expect(g.waiting).toBe(100);
		await vi.advanceTimersByTimeAsync(10);
		expect(await Promise.all(gave_up)).toEqual(Array(100).fill('region render queue timeout'));
		expect(g.waiting).toBe(0); // not kept until a slot frees: one never does
		expect(g.active).toBe(1);
	});

	it('a waiter that gave up never runs, and frees nothing it never held', async () => {
		const g = new ConcurrencyGate(1);
		const b = bodies();
		const first = g.run(b.body('first'));
		const gave_up = g.run(b.body('gave-up'), { deadline_ms: 50 }).catch((e: Error) => e.message);
		await vi.advanceTimersByTimeAsync(50);
		expect(await gave_up).toBe('region render queue timeout');
		const after = g.run(b.body('after'));
		b.end(0);
		await vi.advanceTimersByTimeAsync(0);
		expect(b.order).toEqual(['first', 'after']);
		b.end(1);
		await Promise.all([first, after]);
		expect(g.active).toBe(0);
	});

	it('a late failure of a body nobody waits on any more is not an unhandled rejection', async () => {
		const g = new ConcurrencyGate(1);
		let fail!: (e: Error) => void;
		const slow = g.run(() => new Promise<string>((_, reject) => (fail = reject)), {
			deadline_ms: 10
		});
		// (the caller's handler is attached before its timeout fires, as a real caller's is)
		const caller = slow.catch((e: Error) => e.message);
		await vi.advanceTimersByTimeAsync(10);
		expect(await caller).toBe('region render timeout');
		const unhandled = vi.fn();
		process.on('unhandledRejection', unhandled);
		fail(new Error('after the caller left'));
		await vi.advanceTimersByTimeAsync(0);
		await Promise.resolve();
		process.off('unhandledRejection', unhandled);
		expect(unhandled).not.toHaveBeenCalled();
		expect(g.active).toBe(0);
		expect(g.abandoned).toBe(0);
	});
});
