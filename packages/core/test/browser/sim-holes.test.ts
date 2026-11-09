// SIMULATION of deferred regions (holes) on the real runtime, in a real browser: copies of two holes
// come onto the page and leave it, and every fetch of theirs (a hole's own, a batch's) is answered
// with its HTML, an error, a keep-fallback 204 or a refusal when the scheduler says. Timers, frames
// and idle callbacks run on the run's clock, so the runtime's waits and retries are in the order too.
// - the runtime's rules (#313) hold after every step;
// - no doubled side effect: never two fetches of one hole's address out at once (#205);
// - a copy that leaves never cancels its twin's fetch, and nothing hangs: once all is quiet no
//   fetch is out (#205, #214);
// - twins agree: once quiet, every copy of one address on the page shows the same thing (#213),
//   and a copy that was on the page when its address got an answer is no longer on its fallback.
// Module loading and layout stay with e2e: these holes carry no island (no chunk to load), and
// their `when` is `load` (no viewport to watch).
import { afterEach, describe, it } from 'vitest';
import { fc, simulate } from '@ogygia/config/sim';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';
import { done_parcel } from '../../src/server/stream-regions.ts';

type Broken = Array<{ code: string; detail: string }>;
const rules = (): Broken =>
	(globalThis as unknown as { __ogygia_rules?: () => Broken }).__ogygia_rules?.() ?? [];

const ADDRESS = {
	A: '/__ogygia__?id=simhole0000a&props=W3t9XQ&exp=9999999999&sig=sa',
	B: '/__ogygia__?id=simhole0000b&props=W3t9XQ&exp=9999999999&sig=sb'
} as const;
type Hole = keyof typeof ADDRESS;
const hole_of = (url: string): Hole | null =>
	url.includes('simhole0000a') ? 'A' : url.includes('simhole0000b') ? 'B' : null;

type Step = { kind: 'insert' | 'remove'; hole: Hole } | { kind: 'wait' };
type Answer = 'html' | '500' | '204' | '403';

afterEach(() => {
	document.body.innerHTML = '';
	_reset();
});

describe('holes on the real runtime, simulated', () => {
	it('fetch one address once at a time, never strand a twin, and agree once quiet', async () => {
		bootDev();
		await simulate.check(
			[
				fc.array(fc.constantFrom<Answer>('html', 'html', '500', '204', '403'), {
					minLength: 6,
					maxLength: 6
				}),
				fc.array(
					fc.oneof(
						{
							weight: 4,
							arbitrary: fc.record({
								kind: fc.constantFrom('insert', 'insert', 'remove'),
								hole: fc.constantFrom<Hole>('A', 'B')
							})
						},
						{ weight: 1, arbitrary: fc.record({ kind: fc.constant('wait') }) }
					) as fc.Arbitrary<Step>,
					{ minLength: 1, maxLength: 7 }
				)
			],
			async (sim, answers, steps) => {
				document.body.innerHTML = '';
				_reset();
				type Fetch = {
					hole: Hole;
					signal: AbortSignal | null;
					settled: boolean;
					answer: Answer | 'batch';
				};
				const fetches: Fetch[] = [];
				/** each address's newest HTML answer, by when it landed */
				const answered: Record<Hole, { html: string; at: number } | null> = { A: null, B: null };
				let n = 0;
				let step_n = 0;
				sim.fetch((request) => {
					if (request.method === 'POST')
						return new Response(done_parcel(), { headers: { 'content-type': 'text/html' } });
					const hole = hole_of(request.url)!;
					const answer = answers[n++ % answers.length];
					if (answer === '500') return new Response('', { status: 500 });
					if (answer === '204') return new Response(null, { status: 204 });
					if (answer === '403') return new Response('', { status: 403 });
					const html = `<p data-answer="${hole}${n}">${hole} ${n}</p>`;
					answered[hole] = { html, at: step_n };
					return new Response(html, { headers: { 'content-type': 'text/html' } });
				});
				const stub = window.fetch;
				window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
					const hole = hole_of(String(input instanceof Request ? input.url : input));
					const f: Fetch | null =
						hole === null
							? null
							: { hole, signal: init?.signal ?? null, settled: false, answer: 'batch' };
					if (f) fetches.push(f);
					return stub(input, init).finally(() => f && (f.settled = true));
				}) as typeof fetch;
				type Copy = { hole: Hole; el: HTMLElement; since: number };
				const copies: Copy[] = [];

				sim.always('the runtime rules hold', () => {
					const broken = rules();
					return broken.length === 0
						? null
						: broken.map((b) => `${b.code}: ${b.detail}`).join('; ');
				});
				sim.always('no doubled side effect: one fetch of an address out at once (#205)', () => {
					for (const hole of ['A', 'B'] as const) {
						const out = fetches.filter(
							(f) => f.hole === hole && !f.settled && !f.signal?.aborted
						).length;
						if (out > 1) return `${out} fetches of ${hole} out`;
					}
					return null;
				});
				sim.finally('nothing hangs: no fetch out once quiet (#214)', () => {
					const out = fetches.filter((f) => !f.settled && !f.signal?.aborted);
					return out.length === 0 ? null : `${out.length} fetches still out`;
				});
				sim.finally('twins agree once quiet (#213)', () => {
					for (const hole of ['A', 'B'] as const) {
						const shown = new Set(
							copies.filter((c) => c.hole === hole && c.el.isConnected).map((c) => c.el.innerHTML)
						);
						if (shown.size > 1) return `copies of ${hole} show ${[...shown].join(' | ')}`;
					}
					return null;
				});
				sim.finally(
					'a copy on the page when its address was answered is no longer on its fallback',
					() => {
						for (const c of copies) {
							const a = answered[c.hole];
							if (!c.el.isConnected || a === null || a.at < c.since) continue;
							if (
								c.el.querySelector('[data-fallback]') !== null &&
								c.el.querySelector('[data-answer]') === null
							)
								return `a copy of ${c.hole} stayed on its fallback after ${a.html}`;
						}
						return null;
					}
				);

				await sim.play(
					steps.map((s): readonly [string, () => unknown] => {
						if (s.kind === 'wait')
							return ['2 s pass', () => new Promise((r) => setTimeout(r, 2000))];
						if (s.kind === 'insert')
							return [
								`a copy of ${s.hole} comes onto the page`,
								() => {
									step_n++;
									const box = document.createElement('div');
									box.innerHTML = `<ogygia-region render="defer" when="load" endpoint="${ADDRESS[s.hole]}"><p data-fallback>${s.hole}</p></ogygia-region>`;
									const el = box.firstElementChild as HTMLElement;
									copies.push({ hole: s.hole, el, since: step_n });
									document.body.append(el);
								}
							];
						return [
							`a copy of ${s.hole} leaves the page`,
							() => {
								step_n++;
								copies.findLast((c) => c.hole === s.hole && c.el.isConnected)?.el.remove();
							}
						];
					})
				);
			},
			{ runs: 200, horizon: 30_000 }
		);
	});
});
