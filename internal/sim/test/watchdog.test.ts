// A run is hung when its loop stops, never only because it is slow.
import { describe, expect, it } from 'vitest';
import { Watchdog, worker_full } from '../src/watchdog.ts';

describe('a worker retires by its heap, not by a count of runs', () => {
	it('retires a worker whose heap is half full after only 9 runs (issues #2169 to #2187: on a 3.8 GB server the heap limit is 1.7 GB, each run keeps its server graph, and workers ran out of memory after 9 to 24 of the 25 runs they were allowed)', () => {
		const limit = 1700 * 2 ** 20;
		expect(worker_full({ used: 9 * 95 * 2 ** 20, limit })).toBe(true);
	});

	it('keeps a worker on a large heap well past 25 runs (a 4 GB heap holds 25 graphs of 80 MB with room left)', () => {
		const limit = 4096 * 2 ** 20;
		expect(worker_full({ used: 25 * 80 * 2 ** 20, limit })).toBe(false);
	});
});

describe('the watchdog', () => {
	it('never calls a slow run hung while its loop still runs tasks (run 43495274517: /bench-cms pages took over 60 s of real time on a loaded runner, so one twin of a seed was hung and the other was not, and each read as a replay leak)', () => {
		const dog = new Watchdog(60_000, 0);
		for (let t = 0, ran = 0; t <= 600_000; t += 1000, ran += 3)
			expect(dog.hung(ran, t)).toBe(false);
	});

	it('calls a run hung once its loop has run no task for the quiet time', () => {
		const dog = new Watchdog(60_000, 0);
		expect(dog.hung(10, 1000)).toBe(false);
		expect(dog.hung(10, 60_999)).toBe(false);
		expect(dog.hung(10, 61_000)).toBe(true);
	});

	it('calls a run hung that never ran a task (its world never came up)', () => {
		const dog = new Watchdog(60_000, 0);
		expect(dog.hung(-1, 30_000)).toBe(false);
		expect(dog.hung(-1, 60_000)).toBe(true);
	});
});
