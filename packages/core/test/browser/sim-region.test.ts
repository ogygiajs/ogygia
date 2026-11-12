// SIMULATION of ONE region element's events across its machines (runtime/region-machines.ts: hole,
// answer, wake, live, paint), on the real runtime in a real browser (#322). A deferred client island
// comes onto the page and leaves it, is moved, gets answers (its own fetch's, and writes at its
// address: a twin's, a batch's, a refresh), its visitor clicks it, and time passes, each when the
// scheduler says. A live region gets static and interactive ticks, and writes at its address, the
// same way.
// - the runtime's rules (#313) hold after every step (one mount per region);
// - once quiet, a region off the page holds nothing: every machine is back at rest (#335);
// - once quiet, a hole on the page that was answered shows its answer, and an island answer on
//   screen has its island awake: a wake is never lost between the hole's machines and the
//   island's (#336);
// - once quiet, a live region on the page shows its last tick, in that tick's mode (#337).
// EXPLORE (flip it on by hand) writes down every cross-machine ORDERING the runs saw, an event or a
// move of one machine that came while another machine of the element was in the middle of an async
// visit (a fetch, a wake, a paint, a live hydrate), and every rule an ordering broke, with the run
// that broke it, instead of stopping at the first. That list is how the mailbox's cases were found.
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { fc, simulate, type Sim } from '@ogygia/config/sim';
import { observe } from '@ogygia/machine';
import { _reset, ticket, write } from '../_frames.ts';
import { frameAddress } from '../../src/frame.ts';
import { KEEP_FALLBACK_HTML } from '../../src/keep-fallback-marker.ts';
import { dedent } from '../../src/contract/dedent.ts';
import {
	COUNTER,
	LABEL,
	PROBE,
	counter_html,
	label_html,
	warm_up,
	type LiveRegion
} from './sim-region-warm.ts';

type Broken = Array<{ code: string; detail: string }>;
const runtime_rules = (): Broken =>
	(globalThis as unknown as { __ogygia_rules?: () => Broken }).__ogygia_rules?.() ?? [];

const ENDPOINT = '/__ogygia__?id=simregion0001&props=W3t9XQ&exp=9999999999&sig=sr';
const LIVE_URL = '/__ogygia__?id=simlive00001&props=W3t9XQ&exp=9999999999&sig=sl';

/** The async visits: a machine in one of these is in the middle of its work. */
const BUSY: Record<string, readonly string[]> = {
	hole: ['fetching', 'retrying'],
	wake: ['waking'],
	'region-paint': ['painting'],
	'live-region': ['hydrating']
};
/** Each machine at rest. */
const REST: Record<string, string> = {
	hole: 'idle',
	wake: 'cold',
	'region-paint': 'idle',
	'live-region': 'idle'
};

const EXPLORE = false;
/** Every ordering seen over the runs, and how often. */
const seen = new Map<string, number>();
/** Every rule an ordering broke, and the first run that broke it. */
const broke = new Map<string, string>();
/** This run's events and machine moves, in order. */
let trail: string[] = [];

/** The one element's machines, as they last moved (one region element per run). */
let now: Record<string, string> = {};
/** Its hole's answer machine, as it last moved. */
let answer_now = 'none';

/** An event, or a machine's move, while another machine is in the middle of its visit. */
function note(what: string): void {
	if (!EXPLORE) return;
	trail.push(what);
	for (const [name, kind] of Object.entries(now))
		if (BUSY[name]?.includes(kind) && !what.startsWith(`${name} `)) {
			const key = `${what} | while ${name} ${kind}`;
			seen.set(key, (seen.get(key) ?? 0) + 1);
		}
}

/** The run's rules. EXPLORE writes a broken one down and goes on. */
function ruled(sim: Sim, kind: string) {
	trail = [kind];
	const rule =
		(name: string, check: () => string | null): (() => string | null) =>
		() => {
			const detail = check();
			if (detail === null || !EXPLORE) return detail;
			const key = `${name}: ${detail}`;
			if (!broke.has(key)) broke.set(key, trail.join(' → '));
			return null;
		};
	return {
		/** After each step, once the teardown it queued ran (a region's waits a microtask: a move is
		 *  no removal), and at the end. */
		always(name: string, check: () => string | null) {
			const after = rule(name, check);
			sim.always(name, () => {
				queueMicrotask(() => {
					const detail = after();
					if (detail !== null) sim.broke(name, detail);
				});
				return null;
			});
			sim.finally(name, after);
		},
		finally(name: string, check: () => string | null) {
			sim.finally(name, rule(name, check));
		},
		/** Off the page, every machine is back at rest. */
		at_rest(el: Element) {
			this.finally('off the page, every machine is at rest', () => {
				if (el.isConnected) return null;
				const busy = Object.entries(now).filter(([name, kind]) => REST[name] !== kind);
				return busy.length === 0 ? null : busy.map(([name, k]) => `${name} ${k}`).join(', ');
			});
		},
		runtime() {
			this.always('the runtime rules hold', () => {
				const broken = runtime_rules();
				return broken.length === 0 ? null : broken.map((b) => `${b.code}: ${b.detail}`).join('; ');
			});
		}
	};
}

let off_observe: (() => void) | null = null;
beforeAll(async () => {
	await warm_up();
	off_observe = observe((name, _from, to) => {
		const kind = to?.kind ?? 'stopped';
		if (name === 'hole-answer') {
			note(`${name} → ${kind}`);
			answer_now = kind;
		}
		if (!(name in BUSY)) return;
		note(`${name} → ${kind}`);
		now[name] = kind;
	});
});
afterAll(() => {
	off_observe?.();
	if (!EXPLORE) return;
	const list = [...seen].sort((a, b) => b[1] - a[1]);
	const orderings = list.map(([k, n]) => `${n}\t${k}`).join('\n');
	const broken = [...broke].map(([k, run]) => `${k}\n    ${run}`).join('\n');
	throw new Error(dedent`
		EXPLORED
		ORDERINGS
		${orderings}
		BROKEN
		${broken}
	`);
});
afterEach(() => {
	document.body.innerHTML = '';
	_reset();
});

type HoleStep =
	| { kind: 'connect' | 'leave' | 'move' | 'click' | 'wait' | 'a minute' }
	| { kind: 'write'; keep: boolean };
type Answer = 'html' | '500' | '204';
const hole_step = (s: HoleStep) =>
	s.kind === 'write' ? `write ${s.keep ? 'keep' : 'answer'}` : s.kind;

type LiveStep = { kind: 'static' | 'label' | 'probe' | 'write' | 'leave' | 'connect' | 'move' };

describe('one region element, simulated', () => {
	it('a hole and its island: at rest off the page, its answer and its island on it', async () => {
		await simulate.check(
			[
				fc.constantFrom('load', 'interaction'),
				fc.array(fc.constantFrom<Answer>('html', 'html', '500', '204'), {
					minLength: 4,
					maxLength: 4
				}),
				fc.array(
					fc.oneof(
						{ weight: 2, arbitrary: fc.record({ kind: fc.constant('connect' as const) }) },
						{ weight: 2, arbitrary: fc.record({ kind: fc.constant('leave' as const) }) },
						{ weight: 2, arbitrary: fc.record({ kind: fc.constant('move' as const) }) },
						{ weight: 2, arbitrary: fc.record({ kind: fc.constant('click' as const) }) },
						{ weight: 1, arbitrary: fc.record({ kind: fc.constant('wait' as const) }) },
						{ weight: 1, arbitrary: fc.record({ kind: fc.constant('a minute' as const) }) },
						{
							weight: 2,
							arbitrary: fc.record({ kind: fc.constant('write' as const), keep: fc.boolean() })
						}
					) as fc.Arbitrary<HoleStep>,
					{ minLength: 1, maxLength: 8 }
				)
			],
			async (sim, wake, answers, steps) => {
				document.body.innerHTML = '';
				_reset();
				now = {};
				answer_now = 'none';
				const r = ruled(sim, `wake ${wake}`);
				let n = 0;
				sim.fetch((request) => {
					if (request.method === 'POST') return new Response('', { status: 404 });
					const answer = answers[n++ % answers.length];
					note(`its fetch answers ${answer}`);
					if (answer === '500') return new Response('', { status: 500 });
					if (answer === '204') return new Response(null, { status: 204 });
					return new Response(counter_html(), { headers: { 'content-type': 'text/html' } });
				});
				const box = document.createElement('div');
				box.innerHTML = `<ogygia-region render="defer" when="load" wake="${wake}" entry="${COUNTER}" endpoint="${ENDPOINT}"><p data-fallback>loading</p></ogygia-region>`;
				const el = box.firstElementChild as HTMLElement;
				const a = frameAddress(ENDPOINT);

				r.runtime();
				r.at_rest(el);
				r.finally('on the page, a hole that was answered shows its answer', () => {
					if (!el.isConnected || answer_now !== 'answered') return null;
					return el.querySelector('button') !== null ? null : `it shows "${el.innerHTML}"`;
				});
				r.finally('on the page with its island answer on screen, the island is awake', () => {
					if (!el.isConnected || el.querySelector('button') === null) return null;
					// (an `interaction` island wakes on a visitor's click: one that never came leaves it asleep)
					if (wake === 'interaction' && now.wake !== 'waking' && now.wake !== 'awake') return null;
					return now.wake === 'awake' ? null : `its wake is ${now.wake ?? 'cold'}`;
				});

				await sim.play(
					steps.map((s): readonly [string, () => unknown] => [
						hole_step(s),
						() => {
							note(`event ${hole_step(s)}`);
							if (s.kind === 'connect') {
								if (!el.isConnected) document.body.append(el);
							} else if (s.kind === 'leave') el.remove();
							else if (s.kind === 'move') {
								if (!el.isConnected) return;
								el.remove();
								document.body.append(el);
							} else if (s.kind === 'click') {
								const target = el.querySelector('button') ?? el.querySelector('p');
								target?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
								target?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
							} else if (s.kind === 'write')
								write({ a, v: ticket(a), html: s.keep ? KEEP_FALLBACK_HTML : counter_html() });
							else return new Promise((r) => setTimeout(r, s.kind === 'wait' ? 2000 : 61_000));
						}
					])
				);
			},
			{ runs: 300, horizon: 300_000 }
		);
	});

	it('a live region: at rest off the page, its last tick on it', async () => {
		await simulate.check(
			[
				fc.array(
					fc.record({
						kind: fc.constantFrom<LiveStep['kind']>(
							'static',
							'label',
							'probe',
							'write',
							'leave',
							'connect',
							'move'
						)
					}),
					{ minLength: 1, maxLength: 8 }
				)
			],
			async (sim, steps) => {
				document.body.innerHTML = '';
				_reset();
				now = {};
				const r = ruled(sim, 'live');
				const el = document.createElement('ogygia-region') as LiveRegion;
				el.setAttribute('live', '');
				document.body.append(el);
				const a = frameAddress(LIVE_URL);
				/** the last tick, and the newest HTML a static one put (or a write at its address) */
				let last: 'static' | 'interactive' | null = null;
				let newest = 0;
				let tick_n = 0;
				/** Ticks reach their region in order (Svelte runs the effects in order), each some time
				 *  after it was decoded: a write at the address may land in between. */
				let ticks: Promise<unknown> = Promise.resolve();
				const reach = (apply: () => Promise<void>) =>
					(ticks = ticks.then(() => sim.later('the tick reaches its region')).then(apply));

				r.runtime();
				r.at_rest(el);
				r.finally('on the page, its last tick is on screen in its mode', () => {
					if (!el.isConnected || last === null) return null;
					const mode = now['live-region'];
					if (last === 'interactive')
						return mode === 'live' ? null : `an interactive tick last, mode ${mode}`;
					if (mode !== 'static') return `a static tick last, mode ${mode}`;
					return el.querySelector(`[data-tick="${newest}"]`) !== null
						? null
						: `it shows "${el.innerHTML}", not static ${newest}`;
				});

				await sim.play(
					steps.map((s): readonly [string, () => unknown] => [
						s.kind,
						() => {
							note(`event ${s.kind}`);
							if (s.kind === 'connect') {
								if (!el.isConnected) document.body.append(el);
								return;
							}
							if (s.kind === 'leave') return el.remove();
							if (s.kind === 'move') {
								if (!el.isConnected) return;
								el.remove();
								document.body.append(el);
								return;
							}
							if (s.kind === 'write') {
								// (an out-of-band write: a static region shows it, an interactive one does not)
								const n = ++tick_n;
								newest = n;
								write({ a, v: ticket(a), html: `<p data-tick="${n}">static ${n}</p>` });
								return;
							}
							if (!el.isConnected) return;
							const n = ++tick_n;
							if (s.kind === 'static') {
								newest = n;
								const html = `<p data-tick="${n}">static ${n}</p>`;
								// as the app's transport does: the tick's value is decoded (its HTML written
								// at its address), and its region applies it later
								const written = ticket(a);
								write({ a, v: written, html });
								return reach(() => {
									last = 'static';
									return el.applyLive({
										id: 'sim-live',
										module: '',
										props: {},
										html,
										url: LIVE_URL,
										written: { v: written }
									});
								});
							}
							return reach(() => {
								last = 'interactive';
								return el.applyLive({
									id: 'sim-live',
									module: s.kind === 'label' ? LABEL : PROBE,
									props: { text: 'one' },
									html: label_html(),
									hydrate: 'load'
								});
							});
						}
					])
				);
			},
			{ runs: 200, horizon: 30_000 }
		);
	});
});
