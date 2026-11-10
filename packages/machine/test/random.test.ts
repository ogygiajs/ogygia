// Random runs against a plain model: for many seeds, a random machine (random states and steps)
// gets a random mix of moves, tasks, cleanups, waits and a stop, and after every step the machine
// must agree with the model. Each seed is replayable: a failure names it.
import { describe, expect, it } from 'vitest';
import { machine, observe, STALE } from '../src/index.ts';
import { macrotask } from './_tick.ts';

/** mulberry32: a small seeded generator, so a failing seed replays exactly. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

type Steps = Record<string, string[]>;

/** Random steps over `n` states, every state reachable from s0 (a random tree, then extra edges). */
function random_steps(rand: () => number, n: number): Steps {
	const names = Array.from({ length: n }, (_, i) => `s${i}`);
	const steps: Steps = Object.fromEntries(names.map((s) => [s, []]));
	for (let i = 1; i < n; i++) steps[names[Math.floor(rand() * i)]].push(names[i]);
	const extra = Math.floor(rand() * n * 2);
	for (let i = 0; i < extra; i++) {
		const from = names[Math.floor(rand() * n)];
		const to = names[Math.floor(rand() * n)];
		if (!steps[from].includes(to)) steps[from].push(to);
	}
	return steps;
}

function reachable(steps: Steps, from: string): Set<string> {
	const seen = new Set<string>();
	const queue = [...steps[from]];
	while (queue.length) {
		const s = queue.pop() as string;
		if (seen.has(s)) continue;
		seen.add(s);
		queue.push(...steps[s]);
	}
	return seen;
}

type AnyM = {
	now: { kind: string };
	go(to: string): boolean;
	move(from: string, to: string): boolean;
	scope: {
		task<R>(work: (signal: AbortSignal) => R): Promise<unknown>;
		defer(cleanup: () => void): void;
	};
	wait(kind: string): Promise<unknown>;
	stop(): void;
};

async function run(seed: number): Promise<void> {
	const rand = rng(seed);
	const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
	const n = 1 + Math.floor(rand() * 7);
	const steps = random_steps(rand, n);
	const names = Object.keys(steps);
	const def = machine<Record<string, {}>>()({
		name: `r${seed}`,
		initial: 's0',
		steps
	} as never) as {
		create(): AnyM;
	};
	const m = def.create();

	// the model
	let kind = 's0';
	let visit = 0;
	let stopped = false;
	const moves: string[] = [];
	const heard: string[] = [];
	const off = observe((name, from, to) => {
		if (name === `r${seed}`) heard.push(`${from.kind}>${to?.kind ?? '#'}`);
	});
	type Cleanup = { visit: number; runs: number };
	const cleanups: Cleanup[] = [];
	type Task = {
		visit: number;
		finish: (v: number) => void;
		value: number;
		finished: boolean;
		/** what the task must settle with: 'pending' until the model knows */
		expect: unknown;
		result: unknown;
		signal: AbortSignal | null;
	};
	const tasks: Task[] = [];
	type Wait = { kind: string; result: unknown; expect: unknown; at_visit: number };
	const waits: Wait[] = [];

	/** The visit ends: every task of it still unsettled settles STALE right then. */
	const end_visit = () => {
		for (const t of tasks) if (t.expect === 'pending' && t.visit === visit) t.expect = STALE;
		visit++;
	};
	/** Answers are delivered: a finished task of the current visit settles with its value. */
	const deliver = async () => {
		await macrotask();
		for (const t of tasks)
			if (t.expect === 'pending' && t.finished && t.visit === visit) t.expect = t.value;
		for (const t of tasks) expect(t.result).toBe(t.expect);
		for (const w of waits) expect(w.result).toBe(w.expect);
	};

	const enter = (to: string) => {
		moves.push(`${kind}>${to}`);
		kind = to;
		end_visit();
		for (const w of waits) {
			if (w.expect !== 'pending') continue;
			if (w.kind === to) w.expect = to;
			else if (!reachable(steps, to).has(w.kind)) w.expect = STALE;
		}
	};

	try {
		for (let op = 0; op < 120; op++) {
			const r = rand();
			if (r < 0.3) {
				const to = pick(names);
				const legal = !stopped && steps[kind].includes(to);
				if (stopped) expect(m.go(to)).toBe(false);
				else if (legal) {
					expect(m.go(to)).toBe(true);
					enter(to);
				} else expect(() => m.go(to)).toThrow(/machine_illegal_move/);
			} else if (r < 0.5) {
				const from = pick(names);
				if (steps[from].length === 0) continue;
				const to = pick(steps[from]);
				const moved = !stopped && kind === from;
				expect(m.move(from, to)).toBe(moved);
				if (moved) enter(to);
			} else if (r < 0.6) {
				const t: Task = {
					visit: stopped ? -1 : visit,
					finish: () => {},
					value: op,
					finished: false,
					expect: stopped ? STALE : 'pending',
					result: 'pending',
					signal: null
				};
				tasks.push(t);
				void m.scope
					.task(
						(signal) =>
							new Promise<number>((resolve) => {
								t.signal = signal;
								t.finish = resolve;
							})
					)
					.then((v) => (t.result = v));
				if (stopped) expect(t.signal).toBe(null); // a stopped machine never runs the work
			} else if (r < 0.68) {
				const open = tasks.filter((t) => !t.finished && t.visit !== -1);
				if (open.length === 0) continue;
				const t = pick(open);
				t.finished = true;
				t.finish(t.value);
			} else if (r < 0.74) {
				await deliver();
			} else if (r < 0.84) {
				const c: Cleanup = { visit: stopped ? -1 : visit, runs: 0 };
				cleanups.push(c);
				m.scope.defer(() => c.runs++);
			} else if (r < 0.97) {
				const target = pick(names);
				const w: Wait = {
					kind: target,
					result: 'pending',
					at_visit: visit,
					expect: stopped
						? STALE
						: target === kind
							? kind
							: reachable(steps, kind).has(target)
								? 'pending'
								: STALE
				};
				waits.push(w);
				void m
					.wait(target)
					.then((v) => (w.result = v === STALE ? STALE : (v as { kind: string }).kind));
			} else if (!stopped) {
				m.stop();
				stopped = true;
				moves.push(`${kind}>#`);
				end_visit();
				for (const w of waits) if (w.expect === 'pending') w.expect = STALE;
			}

			// after every step: the machine agrees with the model
			expect(m.now.kind).toBe(kind);
			for (const c of cleanups) {
				const left = c.visit === -1 || c.visit < visit;
				expect(c.runs).toBe(left ? 1 : 0);
			}
			for (const t of tasks) {
				if (t.visit === -1) continue;
				expect(t.signal?.aborted ?? false).toBe(t.visit < visit);
			}
		}
		await deliver();
		expect(heard).toEqual(moves);
	} catch (error) {
		throw new Error(
			`seed ${seed} failed (steps ${JSON.stringify(steps)}): ${(error as Error).message}`,
			{
				cause: error
			}
		);
	} finally {
		off();
	}
}

describe('random runs agree with the model', () => {
	it('2000 seeds × 120 steps', async () => {
		for (let seed = 1; seed <= 2000; seed++) await run(seed);
	}, 60_000);
});
