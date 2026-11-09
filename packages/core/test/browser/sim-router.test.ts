// SIMULATION of the router's navigation decisions and its history model (src/runtime/router.ts,
// router-nav.ts), on the real router in a real browser: links are followed, `goto` replaces, the
// page is soft-refreshed (`invalidateAll`), and every page fetch is answered with the page, an
// error or a dropped connection when the scheduler says. Timers and the browser's task scheduler
// run on the run's clock.
// - newest navigation wins: once quiet, the page on screen is the last navigation's, unless it went
//   to the browser (#202, #203, #268);
// - the address bar is the page on screen: once no navigation is out, it names the history
//   model's current entry and its address (#310), and the page shown is that address's;
// - nothing is left in flight: once quiet the navigation is idle (#276), and every navigation and
//   refresh settles.
// Back and forward stay with e2e: the browser's own history traversal (`popstate`) is not ours to
// order, and the chunk's first load is a real module load (it is loaded once, before the runs).
import { afterAll, beforeAll, describe, vi } from 'vitest';
import { fc, simulate } from '@ogygia/config/sim';
import { it_with_history_unthrottled } from './_browsers.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';

const home = location.href;
const real_report = window.reportError;
const PATHS = ['/sim-nav/a', '/sim-nav/b', '/sim-nav/c'] as const;
type Path = (typeof PATHS)[number];
type Step = { kind: 'link' | 'goto replace'; to: Path } | { kind: 'refresh' };
type Answer = 'page' | '500' | 'dropped';

const page_html = (path: string, n: number) =>
	`<!doctype html><html><head><meta name="ogygia-router" content="plain"><title>${path}</title></head><body><main data-page="${path}" data-n="${n}">${path}</main></body></html>`;

beforeAll(() => {
	link_boot();
	install_morph();
	window.reportError = () => {};
});
afterAll(() => {
	window.reportError = real_report;
	history.replaceState(null, '', home);
});

describe('the router, simulated', () => {
	it_with_history_unthrottled(
		'shows the newest navigation, keeps the address bar on the page shown, and ends every one',
		async () => {
			// the navigation chunk's first load is a real module load: once, before the runs
			const warm = new SpaRouter();
			vi.spyOn(warm, 'hand_off').mockImplementation(() => {});
			await warm.fetch_page(new URL('/sim-nav/warm', location.href).href).catch(() => null);
			await simulate.check(
				[
					fc.array(fc.constantFrom<Answer>('page', 'page', 'page', '500', 'dropped'), {
						minLength: 6,
						maxLength: 6
					}),
					fc.array(
						fc.oneof(
							{
								weight: 4,
								arbitrary: fc.record({ kind: fc.constant('link'), to: fc.constantFrom(...PATHS) })
							},
							{
								weight: 1,
								arbitrary: fc.record({
									kind: fc.constant('goto replace'),
									to: fc.constantFrom(...PATHS)
								})
							},
							{ weight: 1, arbitrary: fc.record({ kind: fc.constant('refresh') }) }
						) as fc.Arbitrary<Step>,
						{ minLength: 1, maxLength: 5 }
					)
				],
				async (sim, answers, steps) => {
					history.replaceState(null, '', home);
					document.body.innerHTML = '<main data-page="home" data-n="0">home</main>';
					prepare_spa_document();
					let n = 0;
					sim.fetch((request) => {
						const path = new URL(request.url).pathname;
						const answer = answers[n++ % answers.length];
						if (answer === 'dropped') throw new TypeError('Failed to fetch');
						if (answer === '500')
							return new Response('down', {
								status: 500,
								headers: { 'content-type': 'text/html' }
							});
						return new Response(page_html(path, n), {
							status: 200,
							headers: { 'content-type': 'text/html' }
						});
					});
					const r = new SpaRouter();
					r.bust_page_cache();
					/** where the browser was sent (a page load the router gave it), by navigation */
					const handed: string[] = [];
					vi.spyOn(r, 'hand_off').mockImplementation((url, visit) => {
						handed.push(new URL(url).pathname);
						if (r.nav.now === visit) r.nav.go('idle');
					});
					/** the navigations, in the order they started */
					const navs: Path[] = [];

					// (the test's own first page is the app's, not a server body the router swaps: a swap
					// leaves it be, and the page it brings goes in beside it)
					const on_screen = () =>
						document.querySelector('main[data-page^="/sim-nav"]')?.getAttribute('data-page') ?? '/';
					sim.always('the address bar is the page on screen once no navigation is out', () => {
						if (r.nav.now.kind !== 'idle' || handed.length > 0) return null;
						const id = (history.state as { ogygia?: unknown } | null)?.ogygia;
						if (typeof id !== 'string') return null; // (no navigation yet)
						const entry = r.history.current;
						if (id !== entry.id)
							return `the address bar is on entry ${id}, the model on ${entry.id}`;
						if (location.pathname !== entry.url.pathname)
							return `the address bar is ${location.pathname}, the model's page ${entry.url.pathname}`;
						if (on_screen() !== location.pathname)
							return `the page shown is ${on_screen()}, the address ${location.pathname}`;
						return null;
					});
					sim.finally('nothing is left in flight (#276)', () =>
						r.nav.now.kind === 'idle' ? null : `the navigation is still ${r.nav.now.kind}`
					);
					sim.finally('newest navigation wins (#202, #203, #268)', () => {
						const last = navs.at(-1);
						if (last === undefined || handed.includes(last)) return null;
						return on_screen() === last && location.pathname === last
							? null
							: `the last navigation went to ${last}; on screen ${on_screen()}, address bar ${location.pathname}`;
					});

					await sim.play(
						steps.map((s): readonly [string, () => unknown] => {
							if (s.kind === 'refresh') return ['invalidateAll', () => r.invalidateAll()];
							return [
								`${s.kind} ${s.to}`,
								() => {
									navs.push(s.to);
									const to = new URL(s.to, location.href);
									return s.kind === 'link' ? r.navigate(to) : r.goto(to, { replaceState: true });
								}
							];
						})
					);
				},
				{ runs: 200, horizon: 30_000 }
			);
		}
	);
});

describe('the history model, against a plain one', () => {
	it_with_history_unthrottled(
		'names the entry the browser is on, and the address bar is its address, after every move',
		() => {
			type Op =
				| { kind: 'push' | 'replace'; to: string }
				| { kind: 'app pushState'; to: string }
				| { kind: 'foreign state' };
			const to = fc.constantFrom('/h/a', '/h/b', '/h/c#x', '/h/a?q=1');
			fc.assert(
				fc.property(
					fc.array(
						fc.oneof(
							{ weight: 4, arbitrary: fc.record({ kind: fc.constantFrom('push', 'replace'), to }) },
							{ weight: 1, arbitrary: fc.record({ kind: fc.constant('app pushState'), to }) },
							{ weight: 1, arbitrary: fc.record({ kind: fc.constant('foreign state') }) }
						) as fc.Arbitrary<Op>,
						{ maxLength: 12 }
					),
					(ops) => {
						history.replaceState(null, '', home);
						const r = new SpaRouter();
						const model = r.history;
						model.start();
						/** the plain model: the entries' addresses, by id, and the one on screen */
						const plain = new Map<string, string>([[model.current.id, location.href]]);
						let on = model.current.id;
						const check = (after: string) => {
							const bar = (history.state as { ogygia?: unknown } | null)?.ogygia;
							if (bar !== on)
								throw new Error(
									`${after}: the address bar is on ${String(bar)}, the plain model on ${on}`
								);
							if (model.current.id !== on)
								throw new Error(
									`${after}: the model is on ${model.current.id}, the plain one on ${on}`
								);
							if (location.href !== plain.get(on))
								throw new Error(
									`${after}: the address bar is ${location.href}, its entry's ${plain.get(on)}`
								);
							if (model.current.url.href !== location.href)
								throw new Error(`${after}: the model's page is ${model.current.url.href}`);
							if (model.find(history.state) !== model.current)
								throw new Error(`${after}: find() does not name the entry on screen`);
						};
						check('start');
						for (const o of ops) {
							if (o.kind === 'app pushState') {
								// an app's own entry (no id): the router takes it over when it meets it
								history.pushState(null, '', new URL(o.to, location.href).href);
								if (model.find(history.state) !== null)
									throw new Error('an entry with no id is named');
								// (as the router's popstate does: adopt it, then the step commits onto it)
								const entry = model.adopt(new URL(location.href));
								model.commit(new URL(location.href), 'pop', entry);
								plain.set(entry.id, location.href);
								on = entry.id;
							} else if (o.kind === 'foreign state') {
								// another document's entry (a reload's): never this model's to show
								if (model.find({ ogygia: 'other-doc.1' }) !== 'foreign')
									throw new Error('a foreign id is not foreign');
								continue;
							} else {
								const url = new URL(o.to, location.href);
								const entry = model.commit(url, o.kind);
								if (o.kind === 'push' && plain.has(entry.id))
									throw new Error('a push reused an entry');
								plain.set(entry.id, url.href);
								on = entry.id;
							}
							check(o.kind);
						}
					}
				),
				{ numRuns: 300, seed: 314 }
			);
			history.replaceState(null, '', home);
		}
	);
});
