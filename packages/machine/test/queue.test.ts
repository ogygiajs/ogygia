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

describe('a stale hook that pushes or releases', () => {
	it('mid-expiry: every expired job is stale once, none skipped, after the list is compacted under it', async () => {
		vi.useFakeTimers();
		const log: string[] = [];
		const q: ReturnType<typeof queue<string>> = queue<string>({
			max: 1,
			now: () => Date.now(),
			start: (job) => void log.push(job),
			stale: (job) => {
				log.push(`stale ${job}`);
				q.release(); // the holder's work ends as a waiter gives up: the next one starts
			}
		});
		// 40 started and released: the front of the list is long enough to be compacted
		for (let i = 0; i < 40; i++) {
			q.push(`s${i}`);
			q.release();
		}
		q.push('holder');
		for (const j of ['a', 'b', 'c']) q.push(j, Date.now() + 10);
		q.push('after');
		await vi.advanceTimersByTimeAsync(20);
		const stale = log.filter((l) => l.startsWith('stale'));
		expect(stale).toEqual(['stale a', 'stale b', 'stale c']);
		expect(log.at(-1)).toBe('after');
	});

	it('when the owner closes: every waiting job is stale once', () => {
		const owner = scope();
		const log: string[] = [];
		const q: ReturnType<typeof queue<string>> = queue<string>({
			max: 1,
			owner,
			start: (job) => void log.push(job),
			stale: (job) => {
				log.push(`stale ${job}`);
				q.release();
			}
		});
		for (let i = 0; i < 40; i++) {
			q.push(`s${i}`);
			q.release();
		}
		q.push('holder');
		for (const j of ['a', 'b', 'c']) q.push(j);
		owner.close();
		expect(log.filter((l) => l.startsWith('stale'))).toEqual(['stale a', 'stale b', 'stale c']);
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

	it('a job with a deadline still goes stale on time after another waiting job is cancelled', async () => {
		vi.useFakeTimers();
		// a job with no deadline cancelled: the timer stays for the one with a deadline
		const a = heard({ max: 1, now: () => Date.now() });
		a.q.push('first');
		a.q.push('plain');
		a.q.push('later', Date.now() + 40);
		a.q.cancel('plain');
		// a job with an earlier deadline cancelled: the timer moves on to the later one
		const b = heard({ max: 1, now: () => Date.now() });
		b.q.push('first');
		b.q.push('later', Date.now() + 40);
		b.q.push('sooner', Date.now() + 20);
		b.q.cancel('sooner');
		await vi.advanceTimersByTimeAsync(50);
		expect(a.log).toEqual(['first', 'stale plain', 'stale later']);
		expect(b.log).toEqual(['first', 'stale sooner', 'stale later']);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('a deadline pushed after the timer went (cancelled or expired) arms a new one', async () => {
		vi.useFakeTimers();
		const { q, log } = heard({ max: 1, now: () => Date.now() });
		q.push('first');
		q.push('cancelled', Date.now() + 10);
		q.cancel('cancelled');
		q.push('after a cancel', Date.now() + 30);
		await vi.advanceTimersByTimeAsync(35);
		expect(log).toEqual(['first', 'stale cancelled', 'stale after a cancel']);
		q.push('after an expiry', Date.now() + 30);
		await vi.advanceTimersByTimeAsync(35);
		expect(log.at(-1)).toBe('stale after an expiry');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('after the list compacts, a job past its deadline is still passed over', () => {
		let clock = 0;
		const { q, log } = heard({ max: 1, now: () => clock });
		for (let i = 0; i < 40; i++) q.push(`job ${i}`);
		q.push('late', 100);
		q.push('next');
		for (let i = 0; i < 39; i++) q.release(); // (the started front is compacted away)
		clock = 200;
		q.release();
		expect(log.slice(-3)).toEqual(['job 39', 'stale late', 'next']);
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

	it('a start that throws gives its place back: the next job starts in it', () => {
		const said = vi.spyOn(console, 'error').mockImplementation(() => {});
		const page = globalThis as { reportError?: (e: unknown) => void };
		const own = page.reportError;
		page.reportError = () => {};
		try {
			const log: string[] = [];
			const q = queue<string>({
				max: 1,
				start: (job) => {
					if (job === 'bad') throw new Error('boom');
					log.push(job);
				}
			});
			q.push('bad');
			q.push('next');
			expect(log).toEqual(['next']);
			expect(q.holding).toBe(1);
		} finally {
			page.reportError = own;
			said.mockRestore();
		}
	});
});

describe('stale', () => {
	it('a stale hook that throws is reported, and the other waiting jobs still go stale and none hangs', async () => {
		vi.useFakeTimers();
		const said = vi.spyOn(console, 'error').mockImplementation(() => {});
		const page = globalThis as { reportError?: (e: unknown) => void };
		const own = page.reportError;
		const reported: unknown[] = [];
		page.reportError = (e) => reported.push(e);
		try {
			const log: string[] = [];
			const q = queue<string>({
				name: 'stales',
				max: 1,
				now: () => Date.now(),
				start: (job) => void log.push(job),
				stale: (job) => {
					if (job === 'bad') throw new Error('boom');
					log.push(`stale ${job}`);
				}
			});
			q.push('holder');
			q.push('bad', Date.now() + 50);
			q.push('good', Date.now() + 50);
			q.push('later', Date.now() + 100);
			await vi.advanceTimersByTimeAsync(60);
			expect(log).toEqual(['holder', 'stale good']);
			await vi.advanceTimersByTimeAsync(50);
			expect(log).toEqual(['holder', 'stale good', 'stale later']);
			expect(q.waiting).toBe(0);
			expect(String(said.mock.calls[0]?.[0])).toContain('machine_queue_stale_failed');
			expect(reported).toHaveLength(1);
		} finally {
			page.reportError = own;
			said.mockRestore();
			vi.useRealTimers();
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
