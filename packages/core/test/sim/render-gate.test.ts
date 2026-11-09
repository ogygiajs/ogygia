// SIMULATION of the render gate (src/runtime/concurrency.ts): calls arrive, bodies end, deadlines
// pass and callers leave in every order the scheduler tries. The gate's promise, as rules:
// - never more than `limit` bodies running that someone still waits on (#195);
// - a call with a deadline answers within it, and one that timed out waiting never runs;
// - a call whose caller left before its turn never runs;
// - bodies start in the order their calls came (a freed slot is handed on, never taken, #195);
// - at the end every slot is back, nobody waits, and only the bodies that never end are abandoned.
import { describe, it } from 'vitest';
import { fc, simulate } from '@ogygia/config/sim';
import { ConcurrencyGate } from '../../src/runtime/concurrency.ts';
import { server_rules_hold } from './_server.ts';

type Body = 'answers' | 'takes 300 ms' | 'fails' | 'throws' | 'hangs';
type Call = { body: Body; deadline: number | undefined; leaves: boolean };

const call: fc.Arbitrary<Call> = fc
	.record({
		body: fc.constantFrom<Body>('answers', 'answers', 'takes 300 ms', 'fails', 'throws', 'hangs'),
		deadline: fc.constantFrom(undefined, 0, 50, 200, 1000),
		leaves: fc.boolean()
	})
	// a body that never ends with no deadline would hang its caller by design
	.map((c) => (c.body === 'hangs' && c.deadline === undefined ? { ...c, deadline: 200 } : c));

describe('the render gate, simulated', () => {
	it('keeps its promise in every order (limit, deadlines, leaving, turn order)', async () => {
		await simulate.check(
			[fc.integer({ min: 1, max: 3 }), fc.array(call, { minLength: 1, maxLength: 7 })],
			async (sim, limit, calls) => {
				server_rules_hold(sim);
				const gate = new ConcurrencyGate(limit);
				type Seen = {
					came: number;
					started: boolean;
					ended: boolean;
					settled: boolean;
					outcome: string;
					at_start: number;
				};
				const seen: Seen[] = [];
				const starts: number[] = [];
				const hung: number[] = [];
				let came = 0;
				const steps: Array<readonly [string, () => unknown]> = [];
				calls.forEach((c, i) => {
					const leave = new AbortController();
					const body = (): Promise<string> => {
						const me = seen[i];
						me.started = true;
						starts.push(i);
						const end = <T>(v: T) => ((me.ended = true), v);
						switch (c.body) {
							case 'answers':
								return sim.later(`body ${i} answers`, () => end('ok'));
							case 'takes 300 ms':
								return new Promise((r) => setTimeout(() => r(end('ok')), 300));
							case 'fails':
								return sim.later(`body ${i} fails`, () => {
									end(0);
									throw new Error('render failed');
								});
							case 'throws':
								end(0);
								throw new Error('render threw');
							case 'hangs':
								hung.push(i);
								return new Promise<string>(() => {});
						}
					};
					steps.push([
						`call ${i}: ${c.body}, deadline ${c.deadline ?? 'none'}`,
						() => {
							const me: Seen = {
								came: came++,
								started: false,
								ended: false,
								settled: false,
								outcome: '',
								at_start: sim.elapsed()
							};
							seen[i] = me;
							return gate.run(body, { deadline_ms: c.deadline, signal: leave.signal }).then(
								(v) => {
									me.settled = true;
									me.outcome = String(v);
								},
								(e: unknown) => {
									me.settled = true;
									me.outcome = e instanceof Error ? e.message : String(e);
								}
							);
						}
					]);
					if (c.leaves)
						steps.push([`call ${i}'s caller leaves`, () => leave.abort(new Error('left'))]);
				});

				sim.always('at most limit bodies run that someone waits on (#195)', () => {
					const running = seen.filter((m) => m?.started && !m.ended && !m.settled).length;
					return running > limit
						? `${running} bodies run for waiting callers, limit ${limit}`
						: null;
				});
				sim.always('the gate counts within its limit', () =>
					gate.active > limit ? `active ${gate.active} > limit ${limit}` : null
				);
				sim.always('a call answers within its deadline', () => {
					for (const [i, m] of seen.entries()) {
						const d = calls[i].deadline;
						if (m === undefined || d === undefined || m.settled) continue;
						if (sim.elapsed() - m.at_start > d) return `call ${i} still out past its ${d} ms`;
					}
					return null;
				});
				sim.always('a call that timed out waiting never runs', () => {
					for (const [i, m] of seen.entries())
						if (m?.outcome === 'region render queue timeout' && m.started)
							return `call ${i} ran after its wait timed out`;
					return null;
				});
				sim.always('a call whose caller left before its turn never runs', () => {
					for (const [i, m] of seen.entries())
						if (m?.outcome === 'left' && m.started) return `call ${i} ran after its caller left`;
					return null;
				});
				sim.finally('bodies start in the order their calls came', () => {
					const order = starts.map((i) => seen[i].came);
					for (let k = 1; k < order.length; k++)
						if (order[k] < order[k - 1]) return `start order ${order.join(', ')}`;
					return null;
				});
				sim.finally(
					'every slot is back, nobody waits, only bodies that never end are abandoned',
					() => {
						const abandoned = hung.filter((i) => seen[i].started).length;
						if (gate.active !== 0) return `${gate.active} slots still held`;
						if (gate.waiting !== 0) return `${gate.waiting} calls still waiting`;
						if (gate.abandoned !== abandoned)
							return `${gate.abandoned} abandoned, ${abandoned} bodies never end`;
						return null;
					}
				);
				await sim.play(steps);
			},
			{ runs: 1000 }
		);
	});
});
