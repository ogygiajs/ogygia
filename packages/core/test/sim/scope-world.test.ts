// SIMULATION of scopes and worlds (@ogygia/machine src/scope.ts, src/world.ts): the owners every
// request, visit and flight holds its work by, and the stamps data is judged by.
// Scopes: a tree is built, given timers, intervals, listeners, tasks and cleanups, and closed piece
// by piece while time passes and events fire, in every order:
// - nothing of a closed scope runs: no timer, no interval, no listener, and its tasks are STALE;
// - each cleanup runs once, children close before their parent's cleanups;
// - once the root is closed, nothing is left: no timer, no listener.
// Worlds: random moves against a plain model of "what moved since this stamp".
import { describe, expect, it } from 'vitest';
import { fc, simulate } from '@ogygia/config/sim';
import { scope, STALE, world, type Scope } from '@ogygia/machine';
import { PRIMITIVE_RUNS, server_rules_hold } from './_server.ts';

type Op =
	| { kind: 'child'; of: number }
	| { kind: 'timeout'; of: number; ms: number }
	| { kind: 'every'; of: number }
	| { kind: 'listen'; of: number }
	| { kind: 'task'; of: number }
	| { kind: 'defer'; of: number }
	| { kind: 'close'; of: number }
	| { kind: 'event' }
	| { kind: 'wait' };

const at = fc.nat({ max: 5 });
const op: fc.Arbitrary<Op> = fc.oneof(
	fc.record({ kind: fc.constant('child'), of: at }),
	fc.record({ kind: fc.constant('timeout'), of: at, ms: fc.constantFrom(0, 30, 200) }),
	fc.record({ kind: fc.constant('every'), of: at }),
	fc.record({ kind: fc.constant('listen'), of: at }),
	fc.record({ kind: fc.constant('task'), of: at }),
	fc.record({ kind: fc.constant('defer'), of: at }),
	fc.record({ kind: fc.constant('close'), of: at }),
	fc.record({ kind: fc.constant('event') }),
	fc.record({ kind: fc.constant('wait') })
) as fc.Arbitrary<Op>;

describe('scopes, simulated', () => {
	it('let go of everything once, and nothing of a closed scope runs', async () => {
		await simulate.check(
			[fc.array(op, { minLength: 1, maxLength: 14 })],
			async (sim, ops) => {
				server_rules_hold(sim);
				const root = scope();
				const scopes: Scope[] = [root];
				const parent: number[] = [-1];
				/** what ran, by the scope it ran for: `timer`, `tick`, `event`, `cleanup`, `task` */
				const ran: Array<{ what: string; of: number; closed: boolean }> = [];
				const cleanups: number[] = [];
				const closed_at: number[] = [];
				const target = new EventTarget();
				let listeners = 0;
				const tasks: Array<{ of: number; got: unknown; got_before_close: boolean }> = [];
				const pick = (i: number) => i % scopes.length;
				const note = (what: string, of: number) =>
					ran.push({ what, of, closed: scopes[of].closed });

				sim.always('nothing of a closed scope runs', () => {
					const late = ran.find((r) => r.closed && r.what !== 'cleanup');
					return late ? `a ${late.what} of closed scope ${late.of} ran` : null;
				});
				sim.always('a closed scope’s tasks are STALE', () => {
					for (const t of tasks)
						if (
							scopes[t.of].closed &&
							t.got !== STALE &&
							t.got !== undefined &&
							!t.got_before_close
						)
							return `scope ${t.of} closed, its task answered ${String(t.got)}`;
					return null;
				});
				sim.always('each cleanup runs once, children before their parent', () => {
					if (new Set(cleanups).size !== cleanups.length)
						return `a cleanup ran twice: ${cleanups.join(', ')}`;
					for (const [c, p] of parent.entries())
						if (p >= 0 && closed_at.includes(p) && !scopes[c].closed)
							return `scope ${p} closed, child ${c} open`;
					return null;
				});
				sim.finally('once the root is closed, nothing is left', () => {
					root.close();
					if (sim.timers() !== 0) return `${sim.timers()} timers left`;
					if (listeners !== 0) return `${listeners} listeners left`;
					return null;
				});

				const real_add = target.addEventListener.bind(target);
				const real_remove = target.removeEventListener.bind(target);
				target.addEventListener = ((...a: Parameters<EventTarget['addEventListener']>) => {
					listeners++;
					real_add(...a);
				}) as EventTarget['addEventListener'];
				target.removeEventListener = ((...a: Parameters<EventTarget['removeEventListener']>) => {
					listeners--;
					real_remove(...a);
				}) as EventTarget['removeEventListener'];

				let cleanup_n = 0;
				await sim.play(
					ops.map((o): readonly [string, () => unknown] => {
						switch (o.kind) {
							case 'child':
								return [
									`a child of scope ${o.of}`,
									() => {
										const p = pick(o.of);
										scopes.push(scopes[p].child());
										parent.push(p);
									}
								];
							case 'timeout':
								return [
									`a ${o.ms} ms timer on scope ${o.of}`,
									() => {
										const i = pick(o.of);
										scopes[i].timeout(() => note('timer', i), o.ms);
									}
								];
							case 'every':
								return [
									`an interval on scope ${o.of}`,
									() => {
										const i = pick(o.of);
										scopes[i].every(() => note('tick', i), 70);
									}
								];
							case 'listen':
								return [
									`a listener on scope ${o.of}`,
									() => {
										const i = pick(o.of);
										scopes[i].on(target, 'ping', () => note('event', i));
									}
								];
							case 'task':
								return [
									`a task on scope ${o.of}`,
									() => {
										const i = pick(o.of);
										const t = { of: i, got: undefined as unknown, got_before_close: false };
										tasks.push(t);
										return scopes[i]
											.task(() => sim.later(`scope ${i}'s task answers`, () => 'answer'))
											.then((v) => {
												t.got = v;
												t.got_before_close = v !== STALE && !scopes[i].closed;
											});
									}
								];
							case 'defer':
								return [
									`a cleanup on scope ${o.of}`,
									() => {
										const i = pick(o.of);
										const n = cleanup_n++;
										scopes[i].defer(() => {
											cleanups.push(n);
											for (const [c, p] of parent.entries())
												if (p === i && !scopes[c].closed)
													sim.broke(
														'children close first',
														`scope ${i}'s cleanup ran before child ${c} closed`
													);
										});
									}
								];
							case 'close':
								return [
									`close scope ${o.of}`,
									() => {
										const i = pick(o.of);
										scopes[i].close();
										scopes[i].close(); // (twice is safe)
										closed_at.push(i);
									}
								];
							case 'event':
								return ['an event fires', () => target.dispatchEvent(new Event('ping'))];
							case 'wait':
								return ['100 ms pass', () => new Promise((r) => setTimeout(r, 100))];
						}
					})
				);
			},
			{ runs: PRIMITIVE_RUNS, horizon: 2000 }
		);
	});
});

describe('worlds, against a model', () => {
	it('fresh() says exactly whether what it names moved since the stamp', () => {
		type Move = { at: number; keys: string[] | null };
		fc.assert(
			fc.property(
				fc.array(
					fc.oneof(
						fc.record({ kind: fc.constant('stamp' as const) }),
						fc.record({
							kind: fc.constant('bump' as const),
							keys: fc.option(fc.subarray(['a', 'b', 'c']))
						}),
						fc.record({
							kind: fc.constant('fresh' as const),
							stamp: fc.nat({ max: 9 }),
							keys: fc.option(fc.subarray(['a', 'b', 'c']))
						})
					),
					{ maxLength: 30 }
				),
				(ops) => {
					const w = world.keyed<string>();
					const stamps: number[] = [];
					const moves: Move[] = [];
					let now = 0;
					for (const o of ops) {
						if (o.kind === 'stamp') stamps.push(w.stamp());
						else if (o.kind === 'bump') {
							const keys = o.keys ?? undefined;
							w.bump(keys);
							if (keys === undefined) moves.push({ at: ++now, keys: null });
							else if (keys.length > 0) moves.push({ at: ++now, keys });
						} else if (stamps.length > 0) {
							const stamp = stamps[o.stamp % stamps.length];
							const keys = o.keys ?? undefined;
							const since = moves.filter((m) => m.at > stamp);
							const model =
								keys === undefined
									? since.length === 0
									: since.every((m) => m.keys !== null && !m.keys.some((k) => keys.includes(k)));
							expect(
								w.fresh(stamp, keys),
								`fresh(${stamp}, ${JSON.stringify(keys)}) after ${JSON.stringify(moves)}`
							).toBe(model);
						}
					}
				}
			),
			{ numRuns: 2000, seed: 314 }
		);
	});
});
