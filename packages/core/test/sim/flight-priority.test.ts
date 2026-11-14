// SIMULATION of a flight's priority (@ogygia/machine src/flights.ts): the runtime's shared downloads
// (island code, a hole's HTML, a page prefetch) are flights, and the one who needs one most decides
// how fast it goes. A low-priority warm starts a flight; a caller who needs it more joins it while it
// is out. In every order the scheduler tries:
// - the run out is at least as high as every caller that joined it (priority inheritance);
// - its priority never goes down, and the run hears each raise once, in order;
// - a caller that left does not take its raise back.
import { describe, expect, it } from 'vitest';
import { fc, simulate } from '@ogygia/config/sim';
import { flights, STALE } from '@ogygia/machine';
import { server_rules_hold } from './_server.ts';

type Step =
	| { kind: 'get'; priority: number; signal: boolean }
	| { kind: 'leave' }
	| { kind: 'drop' }
	| { kind: 'wait' };

const step: fc.Arbitrary<Step> = fc.oneof(
	{
		weight: 20,
		arbitrary: fc.record({
			kind: fc.constant('get'),
			priority: fc.integer({ min: 0, max: 3 }),
			signal: fc.boolean()
		})
	},
	{ weight: 4, arbitrary: fc.record({ kind: fc.constant('leave') }) },
	{ weight: 2, arbitrary: fc.record({ kind: fc.constant('drop') }) },
	{ weight: 3, arbitrary: fc.record({ kind: fc.constant('wait') }) }
) as fc.Arbitrary<Step>;

type Run = {
	flight: { readonly priority: number };
	signal: AbortSignal;
	ended: boolean;
	/** the priorities of the callers that joined it while it was out */
	asked: number[];
	/** what it heard, in order */
	heard: number[];
	/** the highest priority it was seen at */
	seen: number;
};

describe('a flight priority, simulated', () => {
	it('a low-priority warm joined by a higher caller is raised, in every order', async () => {
		await simulate.check(
			[fc.array(step, { minLength: 1, maxLength: 10 })],
			async (sim, steps) => {
				server_rules_hold(sim);
				const runs: Run[] = [];
				const f = flights({
					name: 'simulated priority',
					keep: 0,
					run: (_key: 'warm', signal, flight) => {
						const run: Run = {
							flight,
							signal,
							ended: false,
							asked: [flight.priority],
							heard: [],
							seen: flight.priority
						};
						runs.push(run);
						flight.onRaise((p) => run.heard.push(p));
						return sim.later(`run ${runs.length - 1} answers`, () => {
							run.ended = true;
							return runs.length;
						});
					}
				});
				/** the run out now (a flight in the air), if any */
				const out = () => runs.findLast((r) => !r.ended && !r.signal.aborted);
				const leaving: AbortController[] = [];

				sim.finally('a get ran the work', () =>
					steps.some((s) => s.kind === 'get') && runs.length === 0 ? 'no run started' : null
				);
				sim.always('the run out is as high as every caller that joined it', () => {
					for (const [i, r] of runs.entries()) {
						const want = Math.max(...r.asked);
						if (r.flight.priority < want)
							return `run ${i} is at ${r.flight.priority}, a caller asked ${want}`;
					}
					return null;
				});
				sim.always('a priority never goes down, and each raise is heard once, in order', () => {
					for (const [i, r] of runs.entries()) {
						if (r.flight.priority < r.seen)
							return `run ${i} went down from ${r.seen} to ${r.flight.priority}`;
						r.seen = r.flight.priority;
						for (let j = 1; j < r.heard.length; j++)
							if (r.heard[j] <= r.heard[j - 1]) return `run ${i} heard ${r.heard.join(', ')}`;
						const last = r.heard.at(-1);
						if (last !== undefined && last !== r.flight.priority)
							return `run ${i} last heard ${last}, it is at ${r.flight.priority}`;
					}
					return null;
				});

				await sim.play(
					steps.map((s, i): readonly [string, () => unknown] => {
						switch (s.kind) {
							case 'get':
								return [
									`get at ${s.priority}${s.signal ? ' with a signal' : ''} (${i})`,
									() => {
										const ctl = s.signal ? new AbortController() : null;
										if (ctl) leaving.push(ctl);
										const got = f.get('warm', { priority: s.priority, signal: ctl?.signal });
										// it joined the run out (or started it): its ask is that run's
										out()?.asked.push(s.priority);
										return got;
									}
								];
							case 'leave':
								return ['the newest caller with a signal leaves', () => leaving.pop()?.abort()];
							case 'drop':
								return ['drop', () => f.drop(() => true)];
							case 'wait':
								return [`100 ms pass (${i})`, () => new Promise((r) => setTimeout(r, 100))];
						}
					})
				);
			},
			{ runs: 500 }
		);
	});

	it('seeded: a speculative warm, then a visitor join before it lands, raises the run it joins', async () => {
		/** runs whose order put the join before the landing */
		let joined_out = 0;
		await fc.assert(
			fc.asyncProperty(fc.scheduler(), async (s) => {
				const heard: number[] = [];
				let flight!: { readonly priority: number };
				const f = flights({
					name: 'warm then join',
					keep: 0,
					run: (_key: 'chunk', _signal, at) => {
						flight = at;
						at.onRaise((p) => heard.push(p));
						return s.schedule(Promise.resolve('module'), 'the download lands');
					}
				});
				const warm = f.get('chunk', { priority: 0 }); // the speculative warm
				// the visitor's join comes when the scheduler picks it: before or after the landing
				const joined = s
					.schedule(Promise.resolve(), 'the visitor joins')
					.then(() => f.get('chunk', { priority: 3 }));
				await s.waitIdle();
				expect(await warm).toBe('module');
				const join = await joined;
				expect(join).not.toBe(STALE);
				if (heard.length) {
					// it joined while the download was out: the run was raised to the visitor
					joined_out++;
					expect(heard).toEqual([3]);
					expect(flight.priority).toBe(3);
				} else expect(flight.priority).toBe(3); // landed first: the join started its own run
			}),
			{ seed: 314, numRuns: 100 }
		);
		expect(joined_out).toBeGreaterThan(0);
	});
});
