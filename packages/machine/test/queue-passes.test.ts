import { describe, expect, it, vi } from 'vitest';
import { queue, scope, type Place, type QueueOptions } from '../src/index.ts';

/** A job in these tests: its rank and readiness are read by the queue at its own moments. */
type Job = { id: string; rank: number; ready: boolean; bg: boolean; hole: boolean };

const job = (id: string, o: Partial<Omit<Job, 'id'>> = {}): Job => ({
	id,
	rank: 0,
	ready: true,
	bg: false,
	hole: false,
	...o
});

/** The yields a budget asked for, resumed by hand. */
function yields() {
	const waiting: Array<() => void> = [];
	return {
		yield: (resume: () => void) => void waiting.push(resume),
		get pending() {
			return waiting.length;
		},
		resume: () => waiting.shift()?.()
	};
}

/** A queue of `Job`s that records each start and keeps its place. */
function line(o: Omit<QueueOptions<Job>, 'start'> & { start?: (j: Job, place: Place) => void }) {
	const started: string[] = [];
	const places = new Map<string, Place>();
	const q = queue<Job>({
		...o,
		start: (j, place) => {
			started.push(j.id);
			places.set(j.id, place);
			o.start?.(j, place);
		}
	});
	return { q, started, release: (id: string) => places.get(id)!.release() };
}

const by_rank = { priority: (j: Job) => j.rank };

/** Silences and collects what the queue reports while `fn` runs. */
function reporting(fn: () => void): { said: string[]; thrown: unknown[] } {
	const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
	const page = globalThis as { reportError?: (e: unknown) => void };
	const own = page.reportError;
	const thrown: unknown[] = [];
	page.reportError = (e) => void thrown.push(e);
	try {
		fn();
		return { said: spy.mock.calls.map((call) => String(call[0])), thrown };
	} finally {
		page.reportError = own;
		spy.mockRestore();
	}
}

describe('priority', () => {
	it('the higher starts first, and ties keep the order pushed', () => {
		const { q, started, release } = line({ max: 1, ...by_rank });
		q.push(job('hold'));
		q.push(job('low1', { rank: 1 }));
		q.push(job('high1', { rank: 3 }));
		q.push(job('low2', { rank: 1 }));
		q.push(job('high2', { rank: 3 }));
		q.push(job('frac', { rank: 2.5 }));
		for (const id of ['hold', 'high1', 'high2', 'frac', 'low1']) release(id);
		expect(started).toEqual(['hold', 'high1', 'high2', 'frac', 'low1', 'low2']);
	});

	it('ranks far apart or not whole still go highest first, ties in the order pushed', () => {
		const { q, started, release } = line({ max: 1, ...by_rank });
		q.push(job('hold'));
		for (const [id, rank] of [
			['a', 1e9],
			['b', -5],
			['c', 1e9],
			['d', 0.5],
			['e', Number.NaN]
		] as const)
			q.push(job(id, { rank }));
		for (const id of ['hold', 'a', 'c', 'd', 'b']) release(id);
		expect(started).toEqual(['hold', 'a', 'c', 'd', 'b', 'e']);
	});

	it('a priority raised mid-drain, while it yields, counts at the pass after the yield', () => {
		let t = 0;
		const y = yields();
		const low = job('low', { rank: 1 });
		const { q, started } = line({
			...by_rank,
			now: () => t,
			budget: { ms: 1, yield: y.yield, defer: true },
			start: () => void t++
		});
		q.push(job('a', { rank: 2 }));
		q.push(job('b', { rank: 2 }));
		q.push(low);
		y.resume(); // a starts, and its start uses up the budget
		expect(started).toEqual(['a']);
		low.rank = 5; // raised while the drain waits for its resume
		y.resume();
		expect(started).toEqual(['a', 'low']);
		y.resume();
		expect(started).toEqual(['a', 'low', 'b']);
	});

	it('recheck() reads a raise at once when the queue is idle', () => {
		const { q, started, release } = line({ max: 1, ...by_rank });
		const later = job('later', { rank: 1, ready: false });
		q.push(job('hold'));
		q.push(job('first', { rank: 2 }));
		q.push(later);
		later.ready = true;
		later.rank = 3;
		q.recheck(); // (no room: nothing starts)
		expect(started).toEqual(['hold']);
		release('hold');
		expect(started).toEqual(['hold', 'later']);
	});
});

describe('ready', () => {
	it('a job that is not ready is passed over, and the jobs behind it start', () => {
		const gate = job('gated', { ready: false });
		const { q, started } = line({ ready: (j) => j.ready });
		q.push(gate);
		q.push(job('a'));
		q.push(job('b'));
		expect(started).toEqual(['a', 'b']);
		expect(q.waiting).toBe(1);
		gate.ready = true;
		expect(started).toEqual(['a', 'b']); // (nothing told the queue)
		q.recheck();
		expect(started).toEqual(['a', 'b', 'gated']);
		expect(q.waiting).toBe(0);
	});

	it('a not-ready job does not hold its place in the cap: the next ready one takes it', () => {
		const gate = job('gated', { ready: false });
		const { q, started, release } = line({ max: 1, ready: (j) => j.ready });
		q.push(job('hold'));
		q.push(gate);
		q.push(job('next'));
		release('hold');
		expect(started).toEqual(['hold', 'next']);
	});
});

describe('windows', () => {
	const windows = [
		{ max: 2, holds: (j: Job) => j.bg },
		{ max: 1, holds: (j: Job) => j.hole }
	];

	it('a window caps the jobs it holds; the others start beside them', () => {
		const { q, started, release } = line({ windows });
		q.push(job('bg1', { bg: true }));
		q.push(job('bg2', { bg: true }));
		q.push(job('bg3', { bg: true }));
		q.push(job('free'));
		expect(started).toEqual(['bg1', 'bg2', 'free']);
		release('bg1');
		expect(started).toEqual(['bg1', 'bg2', 'free', 'bg3']);
	});

	it('a job in two windows counts in both until its place is released, once', () => {
		const { q, started, release } = line({ windows });
		q.push(job('both', { bg: true, hole: true }));
		q.push(job('hole', { hole: true }));
		q.push(job('bg', { bg: true }));
		q.push(job('bg+', { bg: true }));
		expect(started).toEqual(['both', 'bg']); // the hole window is full; the background one too
		release('both');
		expect(started).toEqual(['both', 'bg', 'hole', 'bg+']);
		release('both'); // a second release frees no other job's place
		q.push(job('hole2', { hole: true }));
		q.push(job('bg2', { bg: true }));
		expect(started).toEqual(['both', 'bg', 'hole', 'bg+']);
		expect(q.holding).toBe(3);
	});

	it('the window is read as the job starts: a job that left it while waiting is not capped', () => {
		const { q, started } = line({ windows });
		q.push(job('bg1', { bg: true }));
		q.push(job('bg2', { bg: true }));
		const moved = job('moved', { bg: true });
		q.push(moved);
		expect(started).toEqual(['bg1', 'bg2']);
		moved.bg = false;
		q.recheck();
		expect(started).toEqual(['bg1', 'bg2', 'moved']);
	});

	it('a window freed mid-yield lets the next job in at the pass after the yield', () => {
		let t = 0;
		const y = yields();
		const { q, started, release } = line({
			windows,
			now: () => t,
			budget: { ms: 1, yield: y.yield, defer: true },
			start: () => void t++
		});
		q.push(job('bg1', { bg: true }));
		q.push(job('bg2', { bg: true }));
		q.push(job('bg3', { bg: true }));
		y.resume();
		expect(started).toEqual(['bg1']);
		y.resume();
		expect(started).toEqual(['bg1', 'bg2']);
		expect(y.pending).toBe(1);
		release('bg1'); // while the drain yields: the place waits for the next pass
		expect(started).toEqual(['bg1', 'bg2']);
		y.resume();
		expect(started).toEqual(['bg1', 'bg2', 'bg3']);
	});
});

describe('budget', () => {
	it('a drain starts jobs for ms, then yields, and goes on when resumed', () => {
		let t = 0;
		const y = yields();
		const { q, started } = line({
			now: () => t,
			budget: { ms: 3, yield: y.yield },
			start: (j) => {
				t++;
				if (j.id === 'a') for (const id of ['b', 'c', 'd', 'e', 'f', 'g']) q.push(job(id));
			}
		});
		q.push(job('a'));
		expect(started).toEqual(['a', 'b', 'c']);
		expect(y.pending).toBe(1);
		y.resume();
		expect(started).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
		y.resume();
		expect(started).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
		expect(y.pending).toBe(0);
	});

	it('a drain whose last start runs past its budget ends there, with no yield for nothing', () => {
		let t = 0;
		const y = yields();
		for (const settle of [false, true]) {
			const { q, started } = line({
				now: () => t,
				budget: { ms: 1, yield: y.yield, settle },
				start: () => void (t += 5)
			});
			q.push(job('a'));
			expect(started).toEqual(['a']);
		}
		return Promise.resolve().then(() => expect(y.pending).toBe(0));
	});

	it('the first start goes out at once, without a yield before it', () => {
		const y = yields();
		const { q, started } = line({ budget: { ms: 16, yield: y.yield } });
		q.push(job('a'));
		expect(started).toEqual(['a']);
		expect(y.pending).toBe(0);
	});

	it('defer: a drain begins with a yield, and one yield starts every job queued before it', () => {
		const y = yields();
		const { q, started } = line({ budget: { ms: 30, yield: y.yield, defer: true } });
		q.push(job('a'));
		q.push(job('b'));
		expect(started).toEqual([]);
		expect(y.pending).toBe(1);
		y.resume();
		y.resume(); // (a resume given twice starts nothing more)
		expect(started).toEqual(['a', 'b']);
		q.push(job('c'));
		expect(started).toEqual(['a', 'b']);
		expect(y.pending).toBe(1);
		y.resume();
		expect(started).toEqual(['a', 'b', 'c']);
	});

	it('settle: a start’s promise holder takes its first step before the next job is chosen', async () => {
		const steps: string[] = [];
		const resolvers = new Map<string, (p: Place) => void>();
		const y = yields();
		const q = queue<Job>({
			windows: [{ max: 1, holds: (j: Job) => j.bg }],
			budget: { ms: 1_000, yield: y.yield, settle: true },
			start: (j, place) => {
				steps.push(`start ${j.id}`);
				resolvers.get(j.id)!(place);
			}
		});
		const ask = (j: Job) => {
			void new Promise<Place>((r) => resolvers.set(j.id, r)).then((place) => {
				steps.push(`holder ${j.id}`);
				place.release(); // its work was done at once: the window lets the next one in
			});
			q.push(j);
		};
		ask(job('a', { bg: true }));
		ask(job('b', { bg: true }));
		ask(job('c', { bg: true }));
		await new Promise((r) => setTimeout(r, 0));
		expect(steps).toEqual(['start a', 'holder a', 'start b', 'holder b', 'start c', 'holder c']);
	});

	it('a yield that throws is reported, and the drain goes on without it', () => {
		let started: string[] = [];
		const { said, thrown } = reporting(() => {
			let t = 0;
			const run = line({
				name: 'yields',
				now: () => t,
				budget: {
					ms: 0,
					yield: () => {
						throw new Error('no task');
					}
				},
				start: (j) => {
					t++;
					if (j.id === 'a') for (const id of ['b', 'c']) run.q.push(job(id));
				}
			});
			started = run.started;
			run.q.push(job('a'));
		});
		expect(started).toEqual(['a', 'b', 'c']);
		expect(thrown).toHaveLength(2);
		expect(said[0]).toContain('machine_queue_yield_failed');
	});
});

describe('passes', () => {
	it('a job pushed while a pass runs goes after the pass’s jobs, in the order pushed', () => {
		const { q, started } = line({
			...by_rank,
			start: (j) => {
				if (j.id === 'v1') {
					q.push(job('late-low', { rank: 1 }));
					q.push(job('late-high', { rank: 9 }));
				}
			}
		});
		const gate = job('v1', { rank: 2 });
		q.push(gate);
		expect(started).toEqual(['v1', 'late-low', 'late-high']);
	});

	it('a start that throws is reported, its place and windows go back, and the pass goes on', () => {
		const { q, started } = line({
			name: 'passes',
			windows: [{ max: 1, holds: (j) => j.bg }],
			start: (j) => {
				if (j.id === 'bad') throw new Error('boom');
			}
		});
		const { said, thrown } = reporting(() => {
			q.push(job('bad', { bg: true }));
			q.push(job('next', { bg: true }));
		});
		expect(started).toEqual(['bad', 'next']);
		expect(q.holding).toBe(1);
		expect(thrown).toHaveLength(1);
		expect(said[0]).toContain('machine_queue_start_failed');
	});

	it('a rule that throws ends the drain and throws to the caller; the next wake drains again', () => {
		let broken = true;
		const { q, started } = line({
			ready: () => {
				if (broken) throw new Error('rule');
				return true;
			}
		});
		expect(() => q.push(job('a'))).toThrow('rule');
		expect(started).toEqual([]);
		broken = false;
		q.recheck();
		expect(started).toEqual(['a']);
	});

	it('a rule that throws in a drain its yield resumed at once throws to the caller, not as the yield’s failure', () => {
		let broken = false;
		const { q, started } = line({
			ready: () => {
				if (broken) throw new Error('rule');
				return true;
			},
			budget: { ms: 10, yield: (resume) => resume(), defer: true }
		});
		q.push(job('a'));
		expect(started).toEqual(['a']);
		broken = true;
		const { said } = reporting(() => {
			expect(() => q.push(job('b'))).toThrow('rule');
		});
		expect(said).toEqual([]);
		broken = false;
		q.recheck();
		expect(started).toEqual(['a', 'b']);
	});

	it('a job past its deadline is stale and never starts, ready or not', () => {
		let t = 0;
		const stale: string[] = [];
		const { q, started, release } = line({
			max: 1,
			...by_rank,
			now: () => t,
			stale: (j) => void stale.push(j.id)
		});
		q.push(job('hold'));
		q.push(job('late', { rank: 5 }), 10);
		q.push(job('next'));
		t = 20;
		release('hold');
		expect(started).toEqual(['hold', 'next']);
		expect(stale).toEqual(['late']);
	});

	it('cancel takes a waiting job out, stale; the owner closing mid-yield starts nothing more', () => {
		const owner = scope();
		let t = 0;
		const y = yields();
		const stale: string[] = [];
		const { q, started } = line({
			owner,
			now: () => t,
			budget: { ms: 1, yield: y.yield, defer: true },
			start: () => void t++,
			stale: (j) => void stale.push(j.id)
		});
		q.push(job('a'));
		const b = job('b');
		q.push(b);
		q.push(job('c'));
		y.resume();
		q.cancel(b);
		owner.close();
		y.resume();
		expect(started).toEqual(['a']);
		expect(stale).toEqual(['b', 'c']);
		expect(q.waiting).toBe(0);
	});

	it('no max: every ready job starts', () => {
		const { q, started } = line({ ready: () => true });
		for (let i = 0; i < 50; i++) q.push(job(`j${i}`));
		expect(started).toHaveLength(50);
		expect(q.holding).toBe(50);
	});
});

describe('options', () => {
	it('a bad window max, too many windows or a bad budget is refused with machine_bad_option', () => {
		const start = () => {};
		const holds = () => true;
		expect(() => queue({ start, windows: [{ max: 0, holds }] })).toThrow(/windows\[0\]\.max/);
		expect(() =>
			queue({ start, windows: Array.from({ length: 32 }, () => ({ max: 1, holds })) })
		).toThrow(/machine_bad_option/);
		expect(() => queue({ start, budget: { ms: -1, yield: () => {} } })).toThrow(/budget\.ms/);
		expect(() => queue({ start, budget: { ms: Infinity, yield: () => {} } })).toThrow(
			/machine_bad_option/
		);
	});
});

describe('seeded runs (DST)', () => {
	/** A seeded random source: the same seed gives the same run. */
	const random = (seed: number) => () =>
		(seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;

	it('priorities raised while drains yield: every start is the best job that may start, within every cap', () => {
		for (let seed = 1; seed <= 300; seed++) {
			const rand = random(seed);
			let t = 0;
			let pushed = 0;
			const y = yields();
			const max = 1 + Math.floor(rand() * 4);
			const caps = [1 + Math.floor(rand() * 2), 1 + Math.floor(rand() * 2)];
			const all: Array<Job & { order: number; state: 'waiting' | 'held' | 'done' }> = [];
			const places = new Map<Job, Place>();
			const held_in = (w: number) =>
				all.filter((j) => j.state === 'held' && (w === 0 ? j.bg : j.hole)).length;
			const fits = (j: Job) => (!j.bg || held_in(0) < caps[0]) && (!j.hole || held_in(1) < caps[1]);
			const q = queue<(typeof all)[number]>({
				max,
				priority: (j) => j.rank,
				ready: (j) => j.ready,
				windows: [
					{ max: caps[0], holds: (j) => j.bg },
					{ max: caps[1], holds: (j) => j.hole }
				],
				now: () => t,
				budget: { ms: 2, yield: y.yield },
				start: (j, place) => {
					t++;
					expect(j.state, `seed ${seed}: started once`).toBe('waiting');
					expect(j.ready, `seed ${seed}: ready`).toBe(true);
					expect(fits(j), `seed ${seed}: within its windows`).toBe(true);
					expect(all.filter((x) => x.state === 'held').length).toBeLessThan(max);
					for (const other of all) {
						if (other === j || other.state !== 'waiting' || !other.ready || !fits(other)) continue;
						const better = other.rank > j.rank || (other.rank === j.rank && other.order < j.order);
						expect(better, `seed ${seed}: ${other.id} before ${j.id}`).toBe(false);
					}
					j.state = 'held';
					places.set(j, place);
				}
			});
			for (let op = 0; op < 60; op++) {
				const r = rand();
				const waiting = all.filter((j) => j.state === 'waiting');
				const held = all.filter((j) => j.state === 'held');
				if (r < 0.35) {
					const j = {
						...job(`j${pushed}`, {
							rank: Math.floor(rand() * 4),
							ready: rand() < 0.8,
							bg: rand() < 0.5,
							hole: rand() < 0.3
						}),
						order: pushed++,
						state: 'waiting' as const
					};
					all.push(j as (typeof all)[number]);
					q.push(j as (typeof all)[number]);
				} else if (r < 0.5 && waiting.length) {
					waiting[Math.floor(rand() * waiting.length)].rank += 1 + Math.floor(rand() * 3);
				} else if (r < 0.6 && waiting.length) {
					const j = waiting[Math.floor(rand() * waiting.length)];
					j.ready = !j.ready;
					if (rand() < 0.5) q.recheck();
				} else if (r < 0.8 && held.length) {
					const j = held[Math.floor(rand() * held.length)];
					j.state = 'done';
					places.get(j)!.release();
				} else y.resume();
			}
			for (const j of all) j.ready = true;
			q.recheck();
			for (let guard = 0; guard < 1_000 && all.some((j) => j.state !== 'done'); guard++) {
				const held = all.find((j) => j.state === 'held');
				if (y.pending) y.resume();
				else if (held) {
					held.state = 'done';
					places.get(held)!.release();
				} else q.recheck();
			}
			expect(
				all.filter((j) => j.state !== 'done').map((j) => j.id),
				`seed ${seed}: every job started`
			).toEqual([]);
		}
	});

	it('raises and releases inside settled starts: caps hold and every job starts', async () => {
		for (let seed = 1; seed <= 100; seed++) {
			const rand = random(seed);
			let t = 0;
			let held = 0;
			let bg = 0;
			const jobs = Array.from({ length: 20 }, (_, i) =>
				job(`j${i}`, { rank: Math.floor(rand() * 4), bg: rand() < 0.6 })
			);
			const started = new Set<string>();
			const q = queue<Job>({
				max: 3,
				priority: (j) => j.rank,
				windows: [{ max: 2, holds: (j) => j.bg }],
				now: () => t,
				budget: { ms: 3, yield: (resume) => void setTimeout(resume, 0), settle: true },
				start: (j, place) => {
					t++;
					expect(started.has(j.id), `seed ${seed}`).toBe(false);
					started.add(j.id);
					held++;
					if (j.bg) bg++;
					expect(held, `seed ${seed}: max`).toBeLessThanOrEqual(3);
					expect(bg, `seed ${seed}: window`).toBeLessThanOrEqual(2);
					void Promise.resolve().then(() => {
						const other = jobs[Math.floor(rand() * jobs.length)];
						if (!started.has(other.id)) other.rank += 2; // a raise mid-drain
						if (rand() < 0.6) {
							held--;
							if (j.bg) bg--;
							place.release();
						} else
							setTimeout(() => {
								held--;
								if (j.bg) bg--;
								place.release();
							}, 0);
						q.recheck();
					});
				}
			});
			for (const j of jobs) q.push(j);
			for (let i = 0; i < 200 && started.size < jobs.length; i++)
				await new Promise((r) => setTimeout(r, 0));
			expect(started.size, `seed ${seed}: every job started`).toBe(jobs.length);
		}
	});
});
