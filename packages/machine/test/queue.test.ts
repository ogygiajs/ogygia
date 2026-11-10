import { afterEach, describe, expect, it, vi } from 'vitest';
import { flights, queue, scope, STALE, type Started } from '../src/index.ts';
import { macrotask } from './_tick.ts';

afterEach(() => {
	vi.useRealTimers();
});

/** Adds `jobs` to `q` and records the order they start in. */
function track<J>(q: { add(job: J, o?: object): Promise<Started | typeof STALE> }) {
	const started: J[] = [];
	const held = new Map<J, Started>();
	const add = (job: J, o?: object) =>
		q.add(job, o).then((s) => {
			if (s === STALE) return STALE;
			started.push(job);
			held.set(job, s);
			return s;
		});
	const release = (job: J) => held.get(job)!.release();
	return { started, add, release };
}

describe('max', () => {
	it('at most max start; a release hands its place to the next in the same step', async () => {
		const q = queue<string>({ max: 2 });
		const t = track(q);
		void t.add('a');
		void t.add('b');
		void t.add('c');
		await macrotask();
		expect(t.started).toEqual(['a', 'b']);
		expect(q.waiting).toBe(1);
		t.release('a');
		expect(q.holding).toBe(2); // handed, never free in between
		await macrotask();
		expect(t.started).toEqual(['a', 'b', 'c']);
	});

	it('a release is given back once, however often it is called', async () => {
		const q = queue<string>({ max: 1 });
		const t = track(q);
		void t.add('a');
		void t.add('b');
		void t.add('c');
		await macrotask();
		t.release('a');
		t.release('a');
		await macrotask();
		expect(t.started).toEqual(['a', 'b']);
	});

	it('a job its queue says holds no place starts past the cap', async () => {
		const q = queue<string>({ max: 1, holds: (priority) => priority < 2 });
		const t = track(q);
		void t.add('low 1', { priority: 0 });
		void t.add('low 2', { priority: 0 });
		void t.add('high', { priority: 2 });
		await macrotask();
		expect(t.started).toEqual(['low 1', 'high']); // low 2 waits for low 1's place
		t.release('high');
		await macrotask();
		expect(t.started).toEqual(['low 1', 'high']);
		t.release('low 1');
		await macrotask();
		expect(t.started).toEqual(['low 1', 'high', 'low 2']);
	});
});

describe('priority', () => {
	it('the highest starts first, and equal ones in the order they were added', async () => {
		const q = queue<string>({ max: 1 });
		const t = track(q);
		void t.add('first');
		void t.add('a0', { priority: 0 });
		void t.add('b1', { priority: 1 });
		void t.add('c0', { priority: 0 });
		void t.add('d1', { priority: 1 });
		await macrotask();
		for (const j of ['first', 'b1', 'd1', 'a0']) {
			t.release(j);
			await macrotask();
		}
		expect(t.started).toEqual(['first', 'b1', 'd1', 'a0', 'c0']);
	});

	it('a getter is read again at each drain', async () => {
		const q = queue<string>({ max: 1 });
		const t = track(q);
		let late = 0;
		void t.add('first');
		void t.add('early', { priority: 1 });
		void t.add('late', { priority: () => late });
		await macrotask();
		late = 3;
		t.release('first');
		await macrotask();
		expect(t.started).toEqual(['first', 'late']);
	});

	it('a job serving a flight is at least at its priority, and a raise moves it up while it waits', async () => {
		const q = queue<string>({ max: 1 });
		const t = track(q);
		const raised: Array<{ readonly priority: number; onRaise(f: (p: number) => void): void }> = [];
		const warm = flights({
			keep: 0,
			run: (_k: 'x', _signal, flight) => {
				raised.push(flight);
				return new Promise<number>(() => {});
			}
		});
		void t.add('first');
		void t.add('other', { priority: 1 });
		void warm.get('x', { priority: 0 });
		void t.add('warm', { priority: 0, flight: raised[0] });
		void warm.get('x', { priority: 3 }); // a caller who needs it more joined
		await macrotask();
		t.release('first');
		await macrotask();
		expect(t.started).toEqual(['first', 'warm']);
	});

	it('a raise drains: a job a gate held starts at the raised priority', async () => {
		const q = queue<string>({ admit: (_job, priority) => priority >= 2 });
		const t = track(q);
		let flight!: { readonly priority: number; onRaise(f: (p: number) => void): void };
		const warm = flights({
			keep: 0,
			run: (_k: 'x', _signal, f) => ((flight = f), new Promise<number>(() => {}))
		});
		void warm.get('x', { priority: 0 });
		void t.add('warm', { priority: 0, flight });
		await macrotask();
		expect(t.started).toEqual([]);
		void warm.get('x', { priority: 2 });
		await macrotask();
		expect(t.started).toEqual(['warm']);
	});
});

describe('admit', () => {
	it('a job the gate refuses keeps its place; drain() looks again', async () => {
		let open = false;
		const q = queue<string>({ admit: () => open });
		const t = track(q);
		void t.add('a');
		void t.add('b');
		await macrotask();
		expect(t.started).toEqual([]);
		open = true;
		q.drain();
		await macrotask();
		expect(t.started).toEqual(['a', 'b']);
	});
});

describe('budget', () => {
	it('a drain gives the thread back after its budget, and goes on after the pause', async () => {
		let clock = 0;
		const pauses: Array<() => void> = [];
		const q = queue<string>({
			budget: 10,
			now: () => clock,
			pause: () => new Promise<void>((r) => pauses.push(r))
		});
		// each job's own start-up (6 ms) runs before the budget is read again
		const seen: string[] = [];
		for (const j of ['a', 'b', 'c', 'd'])
			void q.add(j).then((s) => {
				if (s === STALE) return;
				seen.push(j);
				clock += 6;
				s.release();
			});
		await macrotask();
		expect(seen).toEqual(['a', 'b']); // 12 ms: past the budget, it paused
		expect(pauses.length).toBe(1);
		pauses.shift()!();
		await macrotask();
		expect(seen).toEqual(['a', 'b', 'c', 'd']);
	});

	it('deferred: a drain begins after a pause, never in the step that added', async () => {
		const pauses: Array<() => void> = [];
		const q = queue<string>({
			deferred: true,
			pause: () => new Promise<void>((r) => pauses.push(r))
		});
		const t = track(q);
		void t.add('a');
		void t.add('b');
		await macrotask();
		expect(t.started).toEqual([]);
		expect(pauses.length).toBe(1); // one pause for both
		pauses.shift()!();
		await macrotask();
		expect(t.started).toEqual(['a', 'b']);
	});
});

describe('deadline', () => {
	it('a job still waiting at its deadline settles STALE and never starts', async () => {
		vi.useFakeTimers();
		const q = queue<string>({ max: 1, now: () => Date.now() });
		const t = track(q);
		void t.add('first');
		const late = t.add('late', { deadline: Date.now() + 50 });
		await vi.advanceTimersByTimeAsync(60);
		expect(await late).toBe(STALE);
		expect(q.waiting).toBe(0);
		t.release('first');
		await vi.advanceTimersByTimeAsync(0);
		expect(t.started).toEqual(['first']);
	});

	it('one whose deadline came is passed over at a release, even before its timer ran', async () => {
		let clock = 0;
		const q = queue<string>({ max: 1, now: () => clock });
		const t = track(q);
		void t.add('first');
		const late = t.add('late', { deadline: 10 });
		void t.add('next');
		await macrotask();
		clock = 20;
		t.release('first');
		expect(await late).toBe(STALE);
		await macrotask();
		expect(t.started).toEqual(['first', 'next']);
	});
});

describe('owner', () => {
	it('its owner closing while it waits: STALE, it never starts, and it leaves the queue', async () => {
		const q = queue<string>({ max: 1 });
		const t = track(q);
		const owner = scope();
		void t.add('first');
		const gone = t.add('gone', { owner });
		owner.close();
		expect(await gone).toBe(STALE);
		expect(q.waiting).toBe(0);
		t.release('first');
		await macrotask();
		expect(t.started).toEqual(['first']);
	});

	it('its owner closing while it runs gives its place back', async () => {
		const q = queue<string>({ max: 1 });
		const t = track(q);
		const owner = scope();
		void t.add('owned', { owner });
		void t.add('next');
		await macrotask();
		owner.close();
		await macrotask();
		expect(t.started).toEqual(['owned', 'next']);
	});
});

describe('options', () => {
	it('a bad max, budget or priority is refused with machine_bad_option', () => {
		expect(() => queue({ max: 0 })).toThrow(/machine_bad_option/);
		expect(() => queue({ max: 1.5 })).toThrow(/max/);
		expect(() => queue({ budget: 5 })).toThrow(/pause/);
		expect(() => queue({ deferred: true })).toThrow(/pause/);
		expect(() => queue({}).add('a', { priority: NaN })).toThrow(/priority/);
	});
});
