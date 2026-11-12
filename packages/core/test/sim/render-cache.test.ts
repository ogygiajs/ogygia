// SIMULATION of the region render cache (src/server/render-cache.ts): requests for cached holes
// come, leave, and see their renders land, fail or answer nothing, beside clears and time passing:
// - one render out per key: a burst of one cached hole renders it once (#244);
// - a render nobody waits on any more is stopped (a cancelled batch, #245), and a call that left
//   gives up with its own reason;
// - a call gets HTML rendered for its own visitor and props, never another's;
// - no call gets a render from before a clear it saw; no kept failure; every call settles.
import { describe, it } from 'vitest';
import { fc, simulate } from '@ogygia/config/sim';
import {
	cached_render,
	render_cache_clear,
	render_cache_key
} from '../../src/server/render-cache.ts';
import { server_rules_hold } from './_server.ts';

type Step =
	| { kind: 'call'; region: 'r1' | 'r2'; session: 'v1' | 'v2'; leaves: boolean }
	| { kind: 'clear' }
	| { kind: 'wait' };

const step: fc.Arbitrary<Step> = fc.oneof(
	{
		weight: 6,
		arbitrary: fc.record({
			kind: fc.constant('call'),
			region: fc.constantFrom('r1', 'r2'),
			session: fc.constantFrom('v1', 'v1', 'v2'),
			leaves: fc.boolean()
		})
	},
	{ weight: 1, arbitrary: fc.record({ kind: fc.constant('clear') }) },
	{ weight: 1, arbitrary: fc.record({ kind: fc.constant('wait') }) }
) as fc.Arbitrary<Step>;

describe('the region render cache, simulated', () => {
	it('renders once per key, stops renders nobody waits on, never crosses visitors', async () => {
		await simulate.check(
			[
				fc.array(fc.constantFrom('html', 'html', 'null', 'fails'), { minLength: 8, maxLength: 8 }),
				fc.array(step, { minLength: 1, maxLength: 9 })
			],
			async (sim, outcomes, steps) => {
				server_rules_hold(sim);
				render_cache_clear();
				let epoch = 0;
				type Render = {
					key: string;
					epoch: number;
					signal: AbortSignal | undefined;
					ended: boolean;
				};
				const renders: Render[] = [];
				type Call = { key: string; epoch: number; left: boolean; got: string; render: number };
				const calls: Call[] = [];
				const steps_run: Array<readonly [string, () => unknown]> = [];
				for (const s of steps) {
					if (s.kind === 'clear') steps_run.push(['clear', () => (epoch++, render_cache_clear())]);
					else if (s.kind === 'wait')
						steps_run.push(['3 s pass', () => new Promise((r) => setTimeout(r, 3000))]);
					else {
						const i = calls.length;
						const leave = new AbortController();
						const key = `${s.region}/${s.session}`;
						calls.push({ key, epoch: -1, left: false, got: '', render: -1 });
						steps_run.push([
							`call ${i}: ${key}`,
							() => {
								const c = calls[i];
								c.epoch = epoch;
								const body = (signal?: AbortSignal) => {
									const n = renders.length;
									const outcome = outcomes[n % outcomes.length];
									const r: Render = { key, epoch, signal, ended: false };
									renders.push(r);
									return sim.later(`render ${n} of ${key}: ${outcome}`, () => {
										r.ended = true;
										if (outcome === 'fails') throw new Error(`render ${n} failed`);
										return outcome === 'null' ? null : `<p data-render="${n}">${key}</p>`;
									});
								};
								return cached_render(
									body,
									{ key: render_cache_key(s.region, '{}', s.session), ttl: 2 },
									undefined,
									leave.signal
								).then(
									(html) => (c.got = html ?? 'null'),
									(e: unknown) => (c.got = `failed: ${e instanceof Error ? e.message : String(e)}`)
								);
							}
						]);
						if (s.leaves)
							steps_run.push([
								`call ${i}'s request ends`,
								() => ((calls[i].left = true), leave.abort(new Error('request ended')))
							]);
					}
				}

				sim.always('one render out per key (#244)', () => {
					for (const key of new Set(renders.map((r) => r.key))) {
						const out = renders.filter(
							(r) => r.key === key && !r.ended && !r.signal?.aborted
						).length;
						if (out > 1) return `${out} renders out for ${key}`;
					}
					return null;
				});
				sim.always('a call gets its own visitor and region', () => {
					for (const [i, c] of calls.entries()) {
						const m = /^<p data-render="(\d+)">(.*)<\/p>$/.exec(c.got);
						if (m && m[2] !== c.key) return `call ${i} for ${c.key} got ${m[2]}`;
					}
					return null;
				});
				sim.always('no render from before a clear the call saw', () => {
					for (const [i, c] of calls.entries()) {
						const m = /data-render="(\d+)"/.exec(c.got);
						if (m && renders[Number(m[1])].epoch < c.epoch)
							return `call ${i} (after clear ${c.epoch}) got render ${m[1]} of before it`;
					}
					return null;
				});
				sim.always('a call whose request ended gives up with its reason', () => {
					for (const [i, c] of calls.entries())
						if (
							c.left &&
							c.got !== '' &&
							c.got !== 'failed: request ended' &&
							!c.got.startsWith('<') &&
							c.got !== 'null' &&
							!c.got.startsWith('failed: render')
						)
							return `call ${i} left and got ${c.got}`;
					return null;
				});
				sim.always('a render nobody waits on any more is stopped (#245)', () => {
					for (const [n, r] of renders.entries()) {
						if (r.ended || r.signal?.aborted) continue;
						const holders = calls.filter((c) => c.key === r.key && c.got === '' && !c.left);
						if (holders.length === 0) return `render ${n} of ${r.key} runs on for nobody`;
					}
					return null;
				});
				await sim.play(steps_run);
				render_cache_clear();
			},
			{ runs: 1000 }
		);
	});
});
