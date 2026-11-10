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
	it('a drain gives the thread back after its budget, and goes on when the pause resumes it', async () => {
		let clock = 0;
		let open = false;
		const pauses: Array<() => void> = [];
		const seen: string[] = [];
		const q = queue<string>({
			admit: () => open,
			// each job's start (6 ms of work) runs in the drain's step
			start: (j, s) => {
				seen.push(j);
				clock += 6;
				s.release();
			},
			budget: 10,
			now: () => clock,
			pause: (resume) => pauses.push(resume)
		});
		for (const j of ['a', 'b', 'c', 'd']) void q.add(j);
		open = true;
		q.drain(); // (the drain that found the gate shut ends a microtask later: it goes round again)
		await Promise.resolve();
		expect(seen).toEqual(['a', 'b']); // 12 ms: past the budget, it paused
		expect(pauses.length).toBe(1);
		pauses.shift()!(); // the new task: it goes on in it, at once
		expect(seen).toEqual(['a', 'b', 'c', 'd']);
	});

	it("a start's promise is its start-up: waited for, and counted, before the next start", async () => {
		let clock = 0;
		const pauses: Array<() => void> = [];
		const seen: string[] = [];
		const q = queue<string>({
			start: (j) =>
				Promise.resolve().then(() => {
					seen.push(j);
					clock += 6;
				}),
			budget: 10,
			now: () => clock,
			pause: (resume) => pauses.push(resume)
		});
		for (const j of ['a', 'b', 'c']) void q.add(j);
		await macrotask();
		expect(seen).toEqual(['a', 'b']);
		expect(pauses.length).toBe(1);
		pauses.shift()!();
		await macrotask();
		expect(seen).toEqual(['a', 'b', 'c']);
	});

	it('a start that throws is reported, and the jobs after it still start', () => {
		const said = vi.spyOn(console, 'error').mockImplementation(() => {});
		const page = globalThis as { reportError?: (e: unknown) => void };
		const own = page.reportError;
		const reported: unknown[] = [];
		page.reportError = (e) => reported.push(e);
		try {
			const seen: string[] = [];
			const q = queue<string>({
				name: 'starts',
				start: (j) => {
					if (j === 'bad') throw new Error('boom');
					seen.push(j);
				}
			});
			void q.add('bad');
			void q.add('good');
			expect(seen).toEqual(['good']);
			expect(String(said.mock.calls[0]?.[0])).toContain('machine_queue_start_failed');
			expect(reported).toHaveLength(1);
		} finally {
			page.reportError = own;
			said.mockRestore();
		}
	});

	it('deferred: a drain begins after a pause, and runs every job waiting in that task', () => {
		const pauses: Array<() => void> = [];
		const seen: string[] = [];
		const q = queue<string>({
			holds: () => false,
			start: (j) => void seen.push(j),
			deferred: true,
			pause: (resume) => pauses.push(resume)
		});
		void q.add('a');
		void q.add('b');
		expect(seen).toEqual([]);
		expect(pauses.length).toBe(1); // one pause for both
		pauses.shift()!();
		expect(seen).toEqual(['a', 'b']);
		void q.add('c'); // drained: a new pause
		expect(pauses.length).toBe(1);
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

describe('push', () => {
	it('queues a job with no promise: its start and stale hooks hear it', () => {
		const owner = scope();
		const heard: string[] = [];
		const q = queue<string>({
			max: 1,
			owner,
			start: (j, s) => void heard.push(`start ${j} at ${s.priority}`),
			stale: (j) => void heard.push(`stale ${j}`)
		});
		q.push('a', { priority: 2 });
		q.push('b');
		expect(heard).toEqual(['start a at 2']);
		owner.close();
		expect(heard).toEqual(['start a at 2', 'stale b']);
	});
});

describe('cancel', () => {
	it("push's cancel settles the job STALE while it waits, and does nothing once it started", () => {
		const heard: string[] = [];
		const q = queue<string>({
			max: 1,
			start: (j) => void heard.push(`start ${j}`),
			stale: (j) => void heard.push(`stale ${j}`)
		});
		const first = q.push('first');
		const second = q.push('second');
		second();
		expect(q.waiting).toBe(0);
		first();
		expect(heard).toEqual(['start first', 'stale second']);
	});

	it('many deadlines share one timer, and each settles at its own time', async () => {
		vi.useFakeTimers();
		const q = queue<string>({ max: 1, now: () => Date.now() });
		const t = track(q);
		void t.add('first');
		const late = [30, 10, 20].map((ms) => t.add(`${ms}`, { deadline: Date.now() + ms }));
		const settled: string[] = [];
		late.forEach((p, i) => void p.then((s) => s === STALE && settled.push(['30', '10', '20'][i])));
		await vi.advanceTimersByTimeAsync(15);
		expect(settled).toEqual(['10']);
		await vi.advanceTimersByTimeAsync(20);
		expect(settled).toEqual(['10', '20', '30']);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("the queue's owner", () => {
	it('closing it settles every waiting job STALE, and a job added after is STALE at once', async () => {
		const owner = scope();
		const q = queue<string>({ max: 1, owner });
		const t = track(q);
		void t.add('first');
		const a = t.add('a');
		const b = t.add('b');
		owner.close();
		expect(await a).toBe(STALE);
		expect(await b).toBe(STALE);
		expect(q.waiting).toBe(0);
		expect(await t.add('late')).toBe(STALE);
		t.release('first');
		await macrotask();
		expect(t.started).toEqual(['first']);
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
