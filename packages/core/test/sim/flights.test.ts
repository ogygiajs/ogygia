// SIMULATION of flights (@ogygia/machine src/flights.ts), the shared async work under the federation
// peer, the postrender renders, the outbox and the runtime's downloads. Callers come and leave,
// answers land or fail, keys are dropped and the world moves, in every order the scheduler tries:
// - no doubled side effect: never two runs out for one key (a fresh one ends the one before);
// - no kept failure (the server's rule);
// - newest answer wins: no caller gets an answer from a flight started before a drop or a move it
//   saw, and what is kept at the end is from after the last one;
// - a caller that left gets STALE, and every caller settles;
// - a disposed flights runs nothing more.
import { describe, it } from 'vitest';
import { fc, simulate } from '@ogygia/config/sim';
import { flights, policy, STALE, world } from '@ogygia/machine';
import { PRIMITIVE_RUNS, server_rules_hold } from './_server.ts';

type Key = 'a' | 'b';
type Step =
	| { kind: 'get'; key: Key; signal: boolean; fresh: boolean }
	| { kind: 'leave' }
	| { kind: 'drop'; key: Key | 'all' }
	| { kind: 'move'; key: Key | 'all' }
	| { kind: 'wait' }
	| { kind: 'dispose' };

const key = fc.constantFrom<Key>('a', 'b');
const step: fc.Arbitrary<Step> = fc.oneof(
	{
		weight: 25,
		arbitrary: fc.record({
			kind: fc.constant('get'),
			key,
			signal: fc.boolean(),
			fresh: fc.boolean()
		})
	},
	{ weight: 5, arbitrary: fc.record({ kind: fc.constant('leave') }) },
	{
		weight: 5,
		arbitrary: fc.record({
			kind: fc.constant('drop'),
			key: fc.constantFrom<Key | 'all'>('a', 'b', 'all')
		})
	},
	{
		weight: 5,
		arbitrary: fc.record({
			kind: fc.constant('move'),
			key: fc.constantFrom<Key | 'all'>('a', 'b', 'all')
		})
	},
	{ weight: 5, arbitrary: fc.record({ kind: fc.constant('wait') }) },
	{ weight: 1, arbitrary: fc.record({ kind: fc.constant('dispose') }) }
) as fc.Arbitrary<Step>;

const setup = fc.record({
	keep: fc.constantFrom(Infinity, 0, 100),
	retry: fc.constantFrom('one try', 'again at once', 'again after 50 ms'),
	/** whether each run (in the order they start) fails */
	fails: fc.array(fc.boolean(), { minLength: 12, maxLength: 12 })
});

type Answer = { key: Key; run: number };

describe('flights, simulated', () => {
	it('keep their promise in every order', async () => {
		await simulate.check(
			[setup, fc.array(step, { minLength: 1, maxLength: 10 })],
			async (sim, o, steps) => {
				server_rules_hold(sim);
				const sources = world.keyed<Key>();
				/** each key's epoch: a drop or a move of it (or of all) starts a new one */
				const epoch: Record<Key, number> = { a: 0, b: 0 };
				type Run = { key: Key; epoch: number; signal: AbortSignal; ended: boolean };
				const runs: Run[] = [];
				let disposed = false;
				let runs_at_dispose = 0;
				const f = flights<Key, Promise<Answer>, Key>({
					name: 'simulated flights',
					keep: o.keep,
					retry:
						o.retry === 'one try'
							? undefined
							: policy({
									attempts: 2,
									backoff: o.retry === 'again at once' ? 0 : 50,
									jitter: 0,
									deadline: Infinity
								}),
					world: sources,
					touches: (answer) => [answer.key],
					run: (k, signal) => {
						const n = runs.length;
						const run: Run = { key: k, epoch: epoch[k], signal, ended: false };
						runs.push(run);
						return sim.later(`run ${n} (${k}) ${o.fails[n % 12] ? 'fails' : 'answers'}`, () => {
							run.ended = true;
							if (o.fails[n % 12]) throw new Error(`run ${n} failed`);
							return { key: k, run: n };
						});
					}
				});
				type Caller = {
					key: Key;
					epoch: number;
					leave: AbortController | null;
					left: boolean;
					got: string;
				};
				const callers: Caller[] = [];
				const next_epoch = (k: Key | 'all') => {
					for (const each of ['a', 'b'] as const) if (k === 'all' || k === each) epoch[each]++;
				};

				sim.always('no doubled side effect: one run out per key', () => {
					for (const k of ['a', 'b'] as const) {
						const out = runs.filter((r) => r.key === k && !r.ended && !r.signal.aborted).length;
						if (out > 1) return `${out} runs out for ${k}`;
					}
					return null;
				});
				sim.always(
					'newest answer wins: no answer from before a drop or move the caller saw',
					() => {
						for (const [i, c] of callers.entries()) {
							const n = /^run (\d+)$/.exec(c.got)?.[1];
							if (n !== undefined && runs[Number(n)].epoch < c.epoch)
								return `caller ${i} got run ${n} (epoch ${runs[Number(n)].epoch}), asked in epoch ${c.epoch}`;
						}
						return null;
					}
				);
				sim.always('a caller that left gets STALE', () => {
					for (const [i, c] of callers.entries())
						if (c.left && c.got.startsWith('run ')) return `caller ${i} left and got ${c.got}`;
					return null;
				});
				sim.always('a disposed flights runs nothing more', () =>
					disposed && runs.length > runs_at_dispose
						? `${runs.length - runs_at_dispose} runs after dispose`
						: null
				);
				sim.finally('what is kept is from after the last drop or move', () => {
					for (const k of ['a', 'b'] as const) {
						const seen = f.peek(k);
						if (seen?.kind !== 'kept') continue;
						const run = runs[seen.answer.run];
						if (run.epoch !== epoch[k])
							return `${k} keeps run ${seen.answer.run} of epoch ${run.epoch}, now ${epoch[k]}`;
					}
					return null;
				});

				await sim.play(
					steps.map((s, i): readonly [string, () => unknown] => {
						switch (s.kind) {
							case 'get':
								return [
									`get ${s.key}${s.signal ? ' with a signal' : ''}${s.fresh ? ', fresh' : ''}`,
									() => {
										const leave = s.signal ? new AbortController() : null;
										const c: Caller = {
											key: s.key,
											epoch: epoch[s.key],
											leave,
											left: false,
											got: ''
										};
										callers.push(c);
										return f.get(s.key, { signal: leave?.signal, fresh: s.fresh }).then(
											(v) => (c.got = v === STALE ? 'STALE' : `run ${v.run}`),
											(e: unknown) => (c.got = `failed: ${String(e)}`)
										);
									}
								];
							case 'leave':
								return [
									`the newest caller with a signal leaves`,
									() => {
										const c = callers.findLast((c) => c.leave !== null && !c.left && c.got === '');
										if (c === undefined) return;
										c.left = true;
										c.leave!.abort();
									}
								];
							case 'drop':
								return [
									`drop ${s.key}`,
									() => {
										next_epoch(s.key);
										f.drop(s.key === 'all' ? () => true : s.key);
									}
								];
							case 'move':
								return [
									`the world moves ${s.key}`,
									() => {
										next_epoch(s.key);
										sources.bump(s.key === 'all' ? undefined : [s.key]);
									}
								];
							case 'wait':
								return [`150 ms pass (${i})`, () => new Promise((r) => setTimeout(r, 150))];
							case 'dispose':
								return [
									'dispose',
									() => {
										disposed = true;
										runs_at_dispose = runs.length;
										// (the registered symbol where the engine has none: WebKit, as the package does)
										f[Symbol.dispose ?? (Symbol.for('Symbol.dispose') as typeof Symbol.dispose)]();
									}
								];
						}
					})
				);
			},
			{ runs: PRIMITIVE_RUNS }
		);
	});
});
