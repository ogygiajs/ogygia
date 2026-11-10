// SIMULATION of a raise during a drain (@ogygia/machine src/queue.ts, #460): the load scheduler's
// queue paces its starts (a time budget, then a pause), and a queued shared download is raised when
// a caller who needs it more joins its flight. Whenever the raise lands (before the drain, while it
// pauses, between a start and the next), the queue:
// - never has more than `max` holding a place;
// - starts nothing lower than the raised job once the raise has landed, while it still waits;
// - starts every job in the end (a raise mid-drain is never lost).
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { flights, queue, STALE, type InFlight, type Started } from '@ogygia/machine';

describe('a queue raise during its drain, simulated', () => {
	it('seeded: the raised job goes next, in every order of raise, pauses and releases', async () => {
		/** runs whose order put the raise while the warm still waited */
		let raised_waiting = 0;
		await fc.assert(
			fc.asyncProperty(fc.scheduler(), async (s) => {
				let clock = 0;
				const q = queue<string>({
					name: 'simulated downloads',
					max: 1,
					budget: 0, // every start ends a slice: the drain pauses after each
					now: () => clock,
					pause: (resume) => void s.schedule(Promise.resolve(), 'the drain pauses').then(resume)
				});
				let flight!: InFlight;
				const warm = flights({
					keep: 0,
					run: (_k: 'chunk', _signal, f) => ((flight = f), new Promise<string>(() => {}))
				});
				void warm.get('chunk', { priority: 0 }); // a speculative warm queues its download

				const order: string[] = [];
				const priority_of = new Map<string, number>([
					['a', 1],
					['b', 1],
					['c', 1],
					['warm', 0]
				]);
				let raised_at: number | null = null;
				let most = 0;
				const done: Promise<unknown>[] = [];
				const add = (job: string, o: object) =>
					done.push(
						q.add(job, o).then((st: Started | typeof STALE) => {
							expect(st).not.toBe(STALE);
							order.push(job);
							most = Math.max(most, q.holding);
							clock++;
							// each holder is done when the scheduler says so
							void s.schedule(Promise.resolve(), `${job} is done`).then(() => {
								(st as Started).release();
							});
						})
					);
				add('a', { priority: 1 });
				add('b', { priority: 1 });
				add('warm', { priority: 0, flight });
				add('c', { priority: 1 });
				void s.schedule(Promise.resolve(), 'a visitor joins the warm').then(() => {
					if (!order.includes('warm')) raised_waiting++;
					raised_at = order.length;
					return warm.get('chunk', { priority: 3 });
				});
				await s.waitFor(Promise.all(done));
				await s.waitAll();

				expect(most).toBeLessThanOrEqual(1);
				expect([...order].sort()).toEqual(['a', 'b', 'c', 'warm']);
				const w = order.indexOf('warm');
				if (raised_at !== null && raised_at <= w) {
					// raised while it waited: the very next start was the warm
					expect(w, `order ${order.join(' ')} (raised after ${raised_at})`).toBe(
						Math.max(raised_at, 1)
					);
				}
				for (const j of order.slice(0, w)) expect(priority_of.get(j)).toBe(1);
			}),
			{ seed: 460, numRuns: 200 }
		);
		expect(raised_waiting).toBeGreaterThan(0);
	});
});
