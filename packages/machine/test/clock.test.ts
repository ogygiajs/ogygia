// Durations are measured on the monotonic clock (`clock.mono()`), never on the wall clock: a wall
// step (an NTP correction, a VM resume, a laptop waking) moves neither a `keep` TTL nor a retry
// deadline (#472). A seeded run steps the wall clock forward and back by hours between reads.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clock, flights, policy } from '../src/index.ts';
import { under_policy } from '../src/policy.ts';

afterEach(() => {
	vi.restoreAllMocks();
});

/** Steps the wall clock by `ms` from now on, leaving the monotonic clock alone. */
function step_wall(ms: number): void {
	const real = Date.now.bind(Date);
	const prior = vi.isMockFunction(Date.now) ? (Date.now as () => number) : real;
	vi.spyOn(Date, 'now').mockImplementation(() => prior() + ms);
}

/** mulberry32: a small seeded generator, so a failing seed replays exactly. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe('clock', () => {
	it('mono is the monotonic clock, wall the wall clock', () => {
		step_wall(3_600_000);
		expect(Math.abs(clock.wall() - (Date.now() as number))).toBeLessThan(5);
		const a = clock.mono();
		const b = clock.mono();
		expect(b).toBeGreaterThanOrEqual(a);
		expect(Math.abs(clock.mono() - performance.now())).toBeLessThan(5);
	});
});

describe('a wall-clock step moves no duration', () => {
	it('a kept answer stays kept for its TTL, however the wall clock steps (seeded)', async () => {
		for (const seed of [1, 7, 42, 452, 472]) {
			const rand = rng(seed);
			let runs = 0;
			const pages = flights({ keep: 10_000, run: async (k: string) => (runs++, k) });
			await pages.get('a');
			for (let i = 0; i < 6; i++) {
				// forward or back, by up to two hours
				step_wall(Math.round((rand() * 2 - 1) * 7_200_000));
				expect(pages.peek('a')?.kind, `seed ${seed}, step ${i}`).toBe('kept');
				await pages.get('a');
			}
			expect(runs, `seed ${seed}`).toBe(1);
			vi.restoreAllMocks();
		}
	});

	it('a retry policy keeps its deadline when the wall clock jumps forward mid-run', async () => {
		let tries = 0;
		const p = policy({ attempts: 3, backoff: 5, jitter: 0, deadline: 5_000 });
		const answer = await under_policy(p, async () => {
			tries++;
			if (tries === 1) {
				step_wall(3_600_000); // an hour, between the failure and its retry
				throw new Error('blip');
			}
			return 'ok';
		});
		expect(answer).toBe('ok');
		expect(tries).toBe(2);
	});
});
