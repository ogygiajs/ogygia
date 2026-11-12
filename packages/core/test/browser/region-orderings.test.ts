// THE ORDERINGS THE SIMULATOR FOUND (sim-region.test.ts, #322), each as a seeded case on the real
// runtime in a real browser: the steps are fixed, and the scheduler tries many orders of what they
// start (a schedule's task, a fetch's answer, time passing), the same orders on every run.
// - a schedule that fires after its region left the page starts nothing: no fetch of a hole's
//   answer, no wake of its island (#335);
// - a hole put back on the page after its answer left the frame store still shows its answer, and
//   its island wakes again (#336);
// - a live region put back on the page goes on in its last tick's mode: a static one follows the
//   writes at its address, an interactive one hydrates its island again (#337).
import { beforeAll, beforeEach, describe, it } from 'vitest';
import { simulate, type Sim, type SimStep } from '@ogygia/config/sim';
import { observe } from '@ogygia/machine';
import { _reset, ticket, write } from '../../src/runtime/frame-store.ts';
import { frameAddress } from '../../src/frame.ts';
import {
	COUNTER,
	LABEL,
	counter_html,
	label_html,
	warm_up,
	type LiveRegion
} from './sim-region-warm.ts';

const ENDPOINT = '/__ogygia__?id=simorder0001&props=W3t9XQ&exp=9999999999&sig=so';
const LIVE_URL = '/__ogygia__?id=simorder0002&props=W3t9XQ&exp=9999999999&sig=so';

/** The one element's machines, by name, as they last moved (there is one region element per run). */
let now: Record<string, string> = {};
beforeAll(async () => {
	await warm_up();
	observe((name, _from, to) => {
		now[name] = to?.kind ?? 'stopped';
	});
});
beforeEach(() => {
	document.body.innerHTML = '';
	_reset();
	now = {};
});

const hole = (wake = 'load') => {
	const box = document.createElement('div');
	box.innerHTML = `<ogygia-region render="defer" when="load" wake="${wake}" entry="${COUNTER}" endpoint="${ENDPOINT}"><p data-fallback>loading</p></ogygia-region>`;
	return box.firstElementChild as HTMLElement;
};

/** A run's start: a clean page, and the hole's fetch answered with its island when the scheduler says. */
function start(sim: Sim): void {
	document.body.innerHTML = '';
	_reset();
	now = {};
	sim.fetch((request) =>
		request.method === 'POST'
			? new Response('', { status: 404 })
			: new Response(counter_html(), { headers: { 'content-type': 'text/html' } })
	);
}

const passes = (ms: number) => () => new Promise<void>((r) => setTimeout(r, ms));
const RUNS = { runs: 100, horizon: 300_000 } as const;

describe('a schedule that fires after its region left starts nothing (#335)', () => {
	it('no fetch of a hole’s answer off the page', async () => {
		await simulate.check(
			[],
			async (sim) => {
				start(sim);
				const el = hole();
				const stub = window.fetch;
				window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
					if (!el.isConnected) sim.broke('no fetch off the page', `fetched ${String(input)}`);
					return stub(input, init);
				}) as typeof fetch;
				sim.finally('off the page, its hole is at rest', () =>
					(now.hole ?? 'idle') === 'idle' ? null : `hole ${now.hole}`
				);
				await sim.play([
					['it comes onto the page', () => document.body.append(el)],
					['it leaves', () => el.remove()]
				]);
			},
			RUNS
		);
	});

	it('no wake of its island off the page', async () => {
		await simulate.check(
			[],
			async (sim) => {
				start(sim);
				const el = hole();
				const off = observe((name, _from, to) => {
					if (name === 'wake' && to?.kind === 'waking' && !el.isConnected)
						sim.broke('no wake off the page', 'its wake started after it left');
				});
				try {
					await sim.play([
						['it comes onto the page', () => document.body.append(el)],
						[
							'its answer is written',
							() =>
								write({
									a: frameAddress(ENDPOINT),
									v: ticket(frameAddress(ENDPOINT)),
									html: counter_html()
								})
						],
						['it leaves', () => el.remove()]
					]);
				} finally {
					off();
				}
			},
			RUNS
		);
	});
});

/** Once `ready()` holds, as the element's DOM or its machines move: on what it waits for, never a
 *  timer (a step that keeps time passing starves what the run waits for between its turns). */
const until = (el: HTMLElement, ready: () => boolean) => () =>
	new Promise<void>((resolve) => {
		if (ready()) return resolve();
		const dom = new MutationObserver(() => ready() && done());
		const off = observe(() => queueMicrotask(() => ready() && done()));
		const done = () => {
			dom.disconnect();
			off();
			resolve();
		};
		dom.observe(el, { childList: true, subtree: true });
	});

describe('a hole put back after its answer left the frame store (#336)', () => {
	const steps = (el: HTMLElement, wait_awake: boolean): SimStep[] => [
		['it comes onto the page', () => document.body.append(el)],
		[
			wait_awake ? 'its island wakes' : 'its answer is in',
			until(el, () => (wait_awake ? now.wake === 'awake' : el.querySelector('button') !== null)),
			'then'
		],
		['it leaves', () => el.remove(), 'then'],
		['a minute passes', passes(61_000), 'then'],
		['it is put back', () => document.body.append(el)]
	];
	const rules = (sim: Sim, el: HTMLElement) => {
		sim.finally('it shows its answer', () =>
			el.querySelector('button') !== null ? null : `it shows "${el.innerHTML}"`
		);
		sim.finally('its island is awake', () =>
			now.wake === 'awake' ? null : `its wake is ${now.wake}`
		);
	};

	it('its island had not woken yet', async () => {
		await simulate.check(
			[],
			async (sim) => {
				start(sim);
				const el = hole('interaction');
				rules(sim, el);
				await sim.play([
					...steps(el, false),
					// (a visitor's click is a task of its own: it comes once the island catches input again)
					['its island waits for a visitor', until(el, () => now.wake === 'armed'), 'then'],
					[
						'a visitor clicks it',
						() => {
							const b = el.querySelector('button');
							b?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
							b?.click();
						}
					]
				]);
			},
			RUNS
		);
	});

	it('its island was awake', async () => {
		await simulate.check(
			[],
			async (sim) => {
				start(sim);
				const el = hole();
				rules(sim, el);
				await sim.play(steps(el, true));
			},
			RUNS
		);
	});
});

describe('a hole’s island that wakes on a visitor, its answer on another schedule (#338)', () => {
	it('wakes on the visitor’s click', async () => {
		await simulate.check(
			[],
			async (sim) => {
				start(sim);
				const el = hole('interaction');
				sim.finally('its island is awake', () =>
					now.wake === 'awake' ? null : `its wake is ${now.wake}`
				);
				// (its props start it at 0: the one click, replayed once onto the live island)
				sim.finally('the click reached it', () =>
					el.querySelector('[data-testid="count"]')?.textContent === '1'
						? null
						: `its count is ${el.querySelector('[data-testid="count"]')?.textContent}`
				);
				await sim.play([
					['it comes onto the page', () => document.body.append(el)],
					['its island waits for a visitor', until(el, () => now.wake === 'armed'), 'then'],
					[
						'a visitor clicks it',
						() => {
							const b = el.querySelector('button')!;
							b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
							b.click();
						}
					]
				]);
			},
			RUNS
		);
	});
});

describe('a live region put back goes on in its last tick’s mode (#337)', () => {
	const live = (): LiveRegion => {
		const el = document.createElement('ogygia-region') as LiveRegion;
		el.setAttribute('live', '');
		return el;
	};

	it('a static one follows the writes at its address', async () => {
		await simulate.check(
			[],
			async (sim) => {
				start(sim);
				const el = live();
				const a = frameAddress(LIVE_URL);
				sim.finally('it shows the last write at its address', () =>
					el.querySelector('[data-n="2"]') !== null ? null : `it shows "${el.innerHTML}"`
				);
				await sim.play([
					['it comes onto the page', () => document.body.append(el), 'then'],
					[
						'a static tick',
						() => {
							const html = '<p data-n="1">one</p>';
							const written = ticket(a);
							write({ a, v: written, html });
							return el.applyLive({
								id: 'order-live',
								module: '',
								props: {},
								html,
								url: LIVE_URL,
								written: { v: written }
							});
						},
						'then'
					],
					['it leaves', () => el.remove(), 'then'],
					['a moment passes', passes(100), 'then'],
					['it is put back', () => document.body.append(el), 'then'],
					[
						'a write at its address',
						() => write({ a, v: ticket(a), html: '<p data-n="2">two</p>' })
					]
				]);
			},
			RUNS
		);
	});

	it('an interactive one hydrates its island again', async () => {
		await simulate.check(
			[],
			async (sim) => {
				start(sim);
				const el = live();
				sim.finally('its island is live', () =>
					now['live-region'] === 'live' ? null : `its mode is ${now['live-region']}`
				);
				sim.finally('it shows its tick', () =>
					el.querySelector('[data-testid="label"]') !== null ? null : `it shows "${el.innerHTML}"`
				);
				await sim.play([
					['it comes onto the page', () => document.body.append(el), 'then'],
					[
						'an interactive tick',
						() =>
							el.applyLive({
								id: 'order-live',
								module: LABEL,
								props: { text: 'one' },
								html: label_html(),
								hydrate: 'load'
							}),
						'then'
					],
					['it leaves', () => el.remove(), 'then'],
					['a moment passes', passes(100), 'then'],
					['it is put back', () => document.body.append(el)]
				]);
			},
			RUNS
		);
	});
});

describe('a static live tick reaches its region after a write at its address', () => {
	it('the newer write stays on screen, not the tick decoded before it', async () => {
		await simulate.check(
			[],
			async (sim) => {
				start(sim);
				const el = document.createElement('ogygia-region') as LiveRegion;
				el.setAttribute('live', '');
				const a = frameAddress(LIVE_URL);
				sim.finally('it shows the write', () =>
					el.querySelector('[data-n="2"]') !== null ? null : `it shows "${el.innerHTML}"`
				);
				const html = '<p data-n="1">one</p>';
				let written = 0;
				await sim.play([
					['it comes onto the page', () => document.body.append(el), 'then'],
					// (the app's transport decodes the tick: its HTML is written at its address)
					[
						'a static tick is decoded',
						() => void write({ a, v: (written = ticket(a)), html }),
						'then'
					],
					[
						// (in one step: the store lets an address nobody is bound to go after a minute, and
						// a tick reaches its region well before that)
						'a write at its address, then the tick reaches its region',
						() => {
							write({ a, v: ticket(a), html: '<p data-n="2">two</p>' });
							return el.applyLive({
								id: 'order-live',
								module: '',
								props: {},
								html,
								url: LIVE_URL,
								written: { v: written }
							});
						}
					]
				]);
			},
			RUNS
		);
	});

	it('a later tick that wrote nothing at its address still paints', async () => {
		await simulate.check(
			[],
			async (sim) => {
				start(sim);
				const el = document.createElement('ogygia-region') as LiveRegion;
				el.setAttribute('live', '');
				const a = frameAddress(LIVE_URL);
				sim.finally('it shows the second tick', () =>
					el.querySelector('[data-n="2"]') !== null ? null : `it shows "${el.innerHTML}"`
				);
				const tick = (n: number) => ({
					id: 'order-live',
					module: '',
					props: {},
					html: `<p data-n="${n}">${n}</p>`,
					url: LIVE_URL
				});
				await sim.play([
					['it comes onto the page', () => document.body.append(el), 'then'],
					[
						'the first tick, written at its address as it is decoded',
						() => {
							write({ a, v: ticket(a), html: tick(1).html });
							return el.applyLive(tick(1));
						},
						'then'
					],
					// (its HTML never went through the store: the frame there is still the first tick's)
					['a second tick that wrote nothing', () => el.applyLive(tick(2)), 'then'],
					// (bound again, the store hands over the first tick's frame: older than what is shown)
					['it leaves', () => el.remove(), 'then'],
					['it is put back', () => document.body.append(el)]
				]);
			},
			RUNS
		);
	});

	it('a later tick with older data than the answer at its address leaves the newer data on screen', async () => {
		await simulate.check(
			[],
			async (sim) => {
				start(sim);
				const el = document.createElement('ogygia-region') as LiveRegion;
				el.setAttribute('live', '');
				const a = frameAddress(LIVE_URL);
				sim.finally('it shows the newer data', () =>
					el.querySelector('[data-n="3"]') !== null ? null : `it shows "${el.innerHTML}"`
				);
				const tick = (n: number) => ({
					id: 'order-live',
					module: '',
					props: {},
					html: `<p data-n="${n}">${n}</p>`,
					url: LIVE_URL
				});
				// (as the app's transport decodes each: written at its address with its data version,
				// and an answer with older data than the one there is dropped)
				const decode = (n: number, d: number) => {
					const t = tick(n);
					const v = ticket(a);
					write({ a, v, d, html: t.html });
					return el.applyLive({ ...t, written: { v, d } });
				};
				await sim.play([
					['it comes onto the page', () => document.body.append(el), 'then'],
					['a tick at data version 3', () => decode(3, 3), 'then'],
					['a later tick at data version 2', () => decode(2, 2)]
				]);
			},
			RUNS
		);
	});
});

describe('a static live region put back after the store let its address go (#774)', () => {
	it('shows what it showed when it left, not its last tick', async () => {
		await simulate.check(
			[],
			async (sim) => {
				start(sim);
				const el = document.createElement('ogygia-region') as LiveRegion;
				el.setAttribute('live', '');
				const a = frameAddress(LIVE_URL);
				sim.finally('it shows the newer answer', () =>
					el.querySelector('[data-n="2"]') !== null ? null : `it shows "${el.innerHTML}"`
				);
				await sim.play([
					['it comes onto the page', () => document.body.append(el), 'then'],
					[
						'a tick, written at its address as it is decoded',
						() => {
							const html = '<p data-n="1">one</p>';
							const v = ticket(a);
							write({ a, v, html });
							return el.applyLive({
								id: 'order-live',
								module: '',
								props: {},
								html,
								url: LIVE_URL,
								written: { v }
							});
						},
						'then'
					],
					// (a command's answer for the same region: newer, and painted by the subscription)
					[
						'a newer answer at its address',
						() => void write({ a, v: ticket(a), html: '<p data-n="2">two</p>' }),
						'then'
					],
					['a moment passes', passes(100), 'then'],
					['it leaves', () => el.remove(), 'then'],
					// (nothing bound there: the store lets the address go)
					['a minute passes', passes(61_000), 'then'],
					['it is put back', () => document.body.append(el)]
				]);
			},
			RUNS
		);
	});
});
