// A state that ends on its own (`after`): the step it takes when its time is up, and everything
// that must cancel or restart that time. Fake timers make every edge exact.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { machine, observe, STALE } from '../src/index.ts';

const hole = machine<{
	idle: {};
	fetching: { attempt: number };
	failed: { error: string; attempt: number };
	answered: {};
	gone: {};
}>()({
	name: 'hole',
	initial: 'idle',
	steps: {
		idle: ['fetching', 'gone'],
		fetching: ['answered', 'failed', 'fetching'],
		failed: ['fetching', 'gone'],
		answered: ['fetching'],
		gone: []
	},
	after: {
		fetching: {
			ms: 10_000,
			to: 'failed',
			data: (s) => ({ error: 'timed out', attempt: s.attempt })
		},
		failed: {
			ms: (s) => 500 * s.attempt,
			to: 'fetching',
			data: (s) => ({ attempt: s.attempt + 1 })
		}
	}
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('after: a state that ends on its own', () => {
	it('still in the state when its time is up: the machine takes the step, with its data', async () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		await vi.advanceTimersByTimeAsync(9_999);
		expect(m.now.kind).toBe('fetching');
		await vi.advanceTimersByTimeAsync(1);
		expect(m.now).toEqual({ kind: 'failed', error: 'timed out', attempt: 1 });
	});

	it('a time made from the state’s value: the retry waits longer each attempt', async () => {
		const m = hole.create();
		m.go('fetching', { attempt: 3 });
		await vi.advanceTimersByTimeAsync(10_000); // fetching → failed (attempt 3)
		expect(m.now.kind).toBe('failed');
		await vi.advanceTimersByTimeAsync(1_499);
		expect(m.now.kind).toBe('failed');
		await vi.advanceTimersByTimeAsync(1); // 500 × 3
		expect(m.now).toEqual({ kind: 'fetching', attempt: 4 });
	});

	it('a move out first cancels it: no late step, no timer left', async () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		await vi.advanceTimersByTimeAsync(5_000);
		m.move('fetching', 'answered');
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(20_000);
		expect(m.now.kind).toBe('answered');
	});

	it('coming back starts the time again (the old visit’s time never fires)', async () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		await vi.advanceTimersByTimeAsync(8_000);
		m.go('answered');
		m.go('fetching', { attempt: 2 }); // a new visit: a full 10 s from now
		await vi.advanceTimersByTimeAsync(8_000);
		expect(m.now.kind).toBe('fetching');
		await vi.advanceTimersByTimeAsync(2_000);
		expect(m.now).toEqual({ kind: 'failed', error: 'timed out', attempt: 2 });
	});

	it('a step to itself is a new visit too', async () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		await vi.advanceTimersByTimeAsync(9_000);
		m.go('fetching', { attempt: 2 });
		await vi.advanceTimersByTimeAsync(9_000);
		expect(m.now.kind).toBe('fetching');
		expect(vi.getTimerCount()).toBe(1);
	});

	it('stop() cancels it', async () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		m.stop();
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(20_000);
		expect(m.now.kind).toBe('fetching');
	});

	it('a state with no `after` costs no timer', () => {
		const m = hole.create();
		m.go('gone');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('the timed step is a move like any other: tasks end, cleanups run, waits and observers hear it', async () => {
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		const task = m.task(() => new Promise(() => {}));
		const cleanup = vi.fn();
		m.onLeave(cleanup);
		const failed = m.wait('failed');
		const heard: string[] = [];
		const off = observe(
			(name, from, to) => name === 'hole' && heard.push(`${from.kind}>${to?.kind}`)
		);
		await vi.advanceTimersByTimeAsync(10_000);
		off();
		expect(await task).toBe(STALE);
		expect(cleanup).toHaveBeenCalledOnce();
		expect(await failed).toEqual({ kind: 'failed', error: 'timed out', attempt: 1 });
		expect(heard).toEqual(['fetching>failed']);
	});

	it('an initial state with a timeout starts its time when the machine is made', async () => {
		const pending = machine<{ waiting: {}; expired: {} }>()({
			name: 'pending',
			initial: 'waiting',
			steps: { waiting: ['expired'], expired: [] },
			after: { waiting: { ms: 100, to: 'expired' } }
		});
		const m = pending.create();
		await vi.advanceTimersByTimeAsync(100);
		expect(m.now.kind).toBe('expired');
	});

	it('a timed step that fails (its data throws) is reported; the machine stays where it is', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const flaky = machine<{ a: {}; b: { n: number } }>()({
			name: 'flaky',
			initial: 'a',
			steps: { a: ['b'], b: [] },
			after: {
				a: {
					ms: 10,
					to: 'b',
					data: () => {
						throw new Error('no data');
					}
				}
			}
		});
		const m = flaky.create();
		await vi.advanceTimersByTimeAsync(10);
		expect(m.now.kind).toBe('a');
		expect(error).toHaveBeenCalledOnce();
	});

	it('a cleanup that throws during the timed step is reported, and the step is still taken', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const m = hole.create();
		m.go('fetching', { attempt: 1 });
		m.onLeave(() => {
			throw new Error('cleanup');
		});
		await vi.advanceTimersByTimeAsync(10_000);
		expect(m.now.kind).toBe('failed');
		expect(error).toHaveBeenCalledOnce();
	});

	it('an observer that moves the machine during the timed step leaves no stray timer', async () => {
		const m = hole.create();
		const off = observe((_, __, to) => {
			if (to?.kind === 'failed') m.go('gone');
		});
		m.go('fetching', { attempt: 1 });
		await vi.advanceTimersByTimeAsync(10_000);
		off();
		expect(m.now.kind).toBe('gone');
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('after: refused definitions', () => {
	it('a target that is not one of the state’s steps', () => {
		expect(() =>
			machine<{ a: {}; b: {}; c: {} }>()({
				name: 'bad',
				initial: 'a',
				steps: { a: ['b'], b: ['c'], c: [] },
				after: { a: { ms: 1, to: 'c' as 'b' } }
			})
		).toThrow(/machine_bad_timeout/);
	});

	it('a time that is not a time', () => {
		for (const ms of [-1, Number.NaN, Infinity, '10' as unknown as number])
			expect(() =>
				machine<{ a: {}; b: {} }>()({
					name: 'bad',
					initial: 'a',
					steps: { a: ['b'], b: [] },
					after: { a: { ms, to: 'b' } }
				})
			).toThrow(/machine_bad_timeout/);
	});

	it('a state that is not a state', () => {
		expect(() =>
			machine<{ a: {}; b: {} }>()({
				name: 'bad',
				initial: 'a',
				steps: { a: ['b'], b: [] },
				after: { nope: { ms: 1, to: 'b' } } as never
			})
		).toThrow(/machine_unknown_state/);
	});
});
