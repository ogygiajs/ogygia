import { afterEach, describe, expect, it, vi } from 'vitest';
import { queue, scope } from '../src/index.ts';
import { macrotask } from './_tick.ts';

afterEach(() => {
	vi.useRealTimers();
});

/** A queue whose start and stale record what they hear. */
function heard(o: { max: number; now?: () => number; owner?: ReturnType<typeof scope> }) {
	const log: string[] = [];
	const q = queue<string>({
		...o,
		start: (job) => void log.push(job),
		stale: (job) => void log.push(`stale ${job}`)
	});
	return { q, log };
}

describe('max', () => {
	it('at most max start; a release hands its place to the next in the same step', () => {
		const { q, log } = heard({ max: 2 });
		q.push('a');
		q.push('b');
		q.push('c');
		expect(log).toEqual(['a', 'b']);
		expect(q.waiting).toBe(1);
		q.release();
		expect(log).toEqual(['a', 'b', 'c']); // handed on in this step, never free in between
		expect(q.holding).toBe(2);
	});

	it('first come, first served', () => {
		const { q, log } = heard({ max: 1 });
		for (const j of ['a', 'b', 'c', 'd']) q.push(j);
		for (let i = 0; i < 3; i++) q.release();
		expect(log).toEqual(['a', 'b', 'c', 'd']);
	});

	it('a start that pushes or releases inside the drain keeps the order and the cap', () => {
		const log: string[] = [];
		const q = queue<string>({
			max: 1,
			start: (job) => {
				log.push(job);
				if (job === 'a') {
					q.push('nested');
					q.release(); // a's work was done at once
				}
			}
		});
		q.push('a');
		q.push('b');
		q.release();
		expect(log).toEqual(['a', 'nested', 'b']);
		expect(q.holding).toBe(1);
	});
});

describe('deadline', () => {
	it('a job still waiting at its deadline is stale and never starts', async () => {
		vi.useFakeTimers();
		const { q, log } = heard({ max: 1, now: () => Date.now() });
		q.push('first');
		q.push('late', Date.now() + 50);
		await vi.advanceTimersByTimeAsync(60);
		expect(log).toEqual(['first', 'stale late']);
		expect(q.waiting).toBe(0);
		q.release();
		expect(log).toEqual(['first', 'stale late']);
	});

	it('one whose deadline came is passed over at a release, even before its timer ran', () => {
		let clock = 0;
		const { q, log } = heard({ max: 1, now: () => clock });
		q.push('first');
		q.push('late', 10);
		q.push('next');
		clock = 20;
		q.release();
		expect(log).toEqual(['first', 'stale late', 'next']);
	});

	it('many deadlines share one timer, each settles at its own time, and none is left', async () => {
		vi.useFakeTimers();
		const { q, log } = heard({ max: 1, now: () => Date.now() });
		q.push('first');
		for (const ms of [30, 10, 20]) q.push(`${ms}`, Date.now() + ms);
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(15);
		expect(log).toEqual(['first', 'stale 10']);
		await vi.advanceTimersByTimeAsync(20);
		expect(log).toEqual(['first', 'stale 10', 'stale 20', 'stale 30']);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('the timer goes once no job with a deadline waits', async () => {
		vi.useFakeTimers();
		const { q } = heard({ max: 1, now: () => Date.now() });
		q.push('first');
		q.push('soon', Date.now() + 1000);
		q.release();
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('cancel', () => {
	it('a waiting job leaves at once and is stale; a started one is untouched', () => {
		const { q, log } = heard({ max: 1 });
		q.push('first');
		q.push('second');
		q.cancel('second');
		expect(q.waiting).toBe(0);
		q.cancel('first');
		expect(q.holding).toBe(1);
		expect(log).toEqual(['first', 'stale second']);
	});
});

describe("the queue's owner", () => {
	it('closing it makes every waiting job stale, and a job pushed after is stale at once', async () => {
		const owner = scope();
		const { q, log } = heard({ max: 1, owner });
		q.push('first');
		q.push('a');
		q.push('b');
		owner.close();
		expect(log).toEqual(['first', 'stale a', 'stale b']);
		expect(q.waiting).toBe(0);
		q.push('late');
		expect(log.at(-1)).toBe('stale late');
		q.release();
		await macrotask();
		expect(log).toEqual(['first', 'stale a', 'stale b', 'stale late']);
	});
});

describe('start', () => {
	it('a start that throws is reported, and the jobs after it still start', () => {
		const said = vi.spyOn(console, 'error').mockImplementation(() => {});
		const page = globalThis as { reportError?: (e: unknown) => void };
		const own = page.reportError;
		const reported: unknown[] = [];
		page.reportError = (e) => reported.push(e);
		try {
			const log: string[] = [];
			const q = queue<string>({
				name: 'starts',
				max: 2,
				start: (job) => {
					if (job === 'bad') throw new Error('boom');
					log.push(job);
				}
			});
			q.push('bad');
			q.push('good');
			expect(log).toEqual(['good']);
			expect(String(said.mock.calls[0]?.[0])).toContain('machine_queue_start_failed');
			expect(reported).toHaveLength(1);
		} finally {
			page.reportError = own;
			said.mockRestore();
		}
	});
});

describe('options', () => {
	it('a bad max is refused with machine_bad_option', () => {
		const start = () => {};
		expect(() => queue({ max: 0, start })).toThrow(/machine_bad_option/);
		expect(() => queue({ max: 1.5, start })).toThrow(/max/);
	});
});
