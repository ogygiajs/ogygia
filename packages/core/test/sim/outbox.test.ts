// SIMULATION of the outbox (@ogygia/machine src/outbox.ts, #308), the work after the response
// (federation's thaw notices, postrender's self-evicts, the flags' exposures, the profiler's sink).
// Puts come, tries fail or are applied, waits and deadlines pass, in every order:
// - no doubled side effect: never two sends of one id out at once, and in order, never two at all;
// - in order: sends start in the order they were put;
// - done means done: a put answers true only once the receiver applied it, false only once it was
//   given up (heard once, never for one applied); every try ends within the deadline;
// - each put is handed to `waitUntil`; at the end nothing is left (no timer, no put unsettled).
import { describe, it } from 'vitest';
import { fc, simulate } from '@ogygia/config/sim';
import { outbox, policy } from '@ogygia/machine';
import { PRIMITIVE_RUNS, server_rules_hold } from './_server.ts';

type Item = { id: 'x' | 'y' | 'z'; n: number };

describe('the outbox, simulated', () => {
	it('sends each id once at a time, in order when asked, and done means applied', async () => {
		await simulate.check(
			[
				fc.record({
					in_order: fc.boolean(),
					with_id: fc.boolean(),
					deadline: fc.constantFrom(Infinity, 120, 1000),
					/** whether each try (in the order they start) fails */
					fails: fc.array(fc.boolean(), { minLength: 16, maxLength: 16 })
				}),
				fc.array(fc.oneof(fc.constantFrom('x', 'y', 'z'), fc.constant('wait')), {
					minLength: 1,
					maxLength: 8
				})
			],
			async (sim, o, steps) => {
				server_rules_hold(sim);
				type Try = {
					item: Item;
					started: number;
					ended: boolean;
					applied: boolean;
					signal: AbortSignal;
				};
				const tries: Try[] = [];
				const applied = new Set<number>();
				const gave_up: number[] = [];
				const kept_alive: Promise<unknown>[] = [];
				const answered = new Map<number, boolean>();
				const box = outbox<Item>({
					name: 'simulated outbox',
					inOrder: o.in_order,
					id: o.with_id ? (item) => item.id : undefined,
					retry: policy({ attempts: 3, backoff: [50, 100], jitter: 0, deadline: o.deadline }),
					send: (item, signal) => {
						const n = tries.length;
						const t: Try = { item, started: sim.elapsed(), ended: false, applied: false, signal };
						tries.push(t);
						return sim.later(
							`try ${n} of put ${item.n} (${item.id}) ${o.fails[n % 16] ? 'fails' : 'is applied'}`,
							() => {
								t.ended = true;
								if (o.fails[n % 16] || signal.aborted) throw new Error('not applied');
								t.applied = true;
								applied.add(item.n);
							}
						);
					},
					giveUp: (item) => void gave_up.push(item.n),
					waitUntil: (work) => void kept_alive.push(work)
				});
				let puts = 0;
				const ids: Item['id'][] = [];
				const firsts: number[] = [];

				const out = () => tries.filter((t) => !t.ended && !t.signal.aborted);
				sim.always('no doubled side effect: one send of an id out at once', () => {
					if (o.in_order && out().length > 1) return `${out().length} sends out in order`;
					if (!o.with_id) return null;
					for (const id of ['x', 'y', 'z'] as const) {
						const n = out().filter((t) => t.item.id === id).length;
						if (n > 1) return `${n} sends of ${id} out`;
					}
					return null;
				});
				sim.always('every try ends within the deadline', () => {
					for (const t of out())
						if (sim.elapsed() - t.started > o.deadline)
							return `put ${t.item.n}'s try out past ${o.deadline} ms`;
					return null;
				});
				sim.always('done means done: true only once applied, false only once given up', () => {
					for (const [n, ok] of answered) {
						// (with an id, a put joins the send of the first put of that id still out)
						const same = (m: number) => m === n || (o.with_id && ids[m] === ids[n]);
						if (ok && ![...applied].some(same)) return `put ${n} answered done, never applied`;
						if (!ok && !gave_up.some(same)) return `put ${n} answered false, never given up`;
					}
					return null;
				});
				sim.finally('in order: sends start in the order they were put', () => {
					if (!o.in_order) return null;
					for (const t of tries) if (!firsts.includes(t.item.n)) firsts.push(t.item.n);
					for (let k = 1; k < firsts.length; k++)
						if (firsts[k] < firsts[k - 1]) return `first tries in put order ${firsts.join(', ')}`;
					return null;
				});
				sim.finally('a give-up is heard once, never for one applied', () => {
					if (new Set(gave_up).size !== gave_up.length)
						return `given up twice: ${gave_up.join(', ')}`;
					for (const n of gave_up) if (applied.has(n)) return `put ${n} applied and given up`;
					return null;
				});
				sim.finally('each put is kept alive, and nothing is left', () => {
					if (kept_alive.length !== puts) return `${kept_alive.length} of ${puts} puts kept alive`;
					if (sim.timers() !== 0) return `${sim.timers()} timers left`;
					return null;
				});

				await sim.play(
					steps.map((s) =>
						s === 'wait'
							? (['80 ms pass', () => new Promise((r) => setTimeout(r, 80))] as const)
							: ([
									`put ${s}`,
									() => {
										const item: Item = { id: s, n: puts++ };
										ids.push(s);
										return box.put(item).then((ok) => answered.set(item.n, ok));
									}
								] as const)
					)
				);
			},
			{ runs: PRIMITIVE_RUNS }
		);
	});
});
