// A seeded run's own judging of a tab behind another, through `run()`: after each action, at each
// rest, and at the run's end. Each case breaks one tab's page on purpose (its layout's install is
// wrapped, for that tab alone), so a guard put back in `run()` that leaves it unjudged fails the
// test. Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Plan } from '../src/cli.ts';

const APP = fileURLToPath(new URL('../../../apps/palaestra', import.meta.url));
const ready = ['/.svelte-kit/sim-builds/v1', '/.svelte-kit/output'].some((b) =>
	existsSync(`${APP}${b}/server/index.js`)
);

type Install = Parameters<typeof import('../src/layout.ts').install_layout>;

/** What each new document's layout is installed with: a case's own wrapping of it. */
const broken_by = vi.hoisted(() => ({ layout: null as null | ((args: Install) => Install) }));
vi.mock('../src/layout.ts', async (original) => {
	const real = await original<typeof import('../src/layout.ts')>();
	return {
		...real,
		install_layout: (...args: Install) => real.install_layout(...(broken_by.layout?.(args) ?? args))
	};
});
/** A case's switch, `as_main`: the run end judges a tab owed a look as main did, against a fresh
 *  load (`mpa_equivalent`), and finds nothing as it stood. And when it judged what: each tab's
 *  comparison `run()` asks for, and the servers' HTML. */
const end = vi.hoisted(() => ({ as_main: false, judged: [] as string[], stands: [] as string[] }));
vi.mock('../src/oracles.ts', async (original) => {
	const real = await original<typeof import('../src/oracles.ts')>();
	return {
		...real,
		as_it_stands: async (...args: Parameters<typeof real.as_it_stands>) => {
			end.stands.push(`${args[2].name} ${real.owes_look(args[2]) ? 'owed' : 'not owed'} a look`);
			if (!end.as_main) return real.as_it_stands(...args);
			await real.mpa_equivalent(...args);
			return null;
		},
		mpa_equivalent: (...args: Parameters<typeof real.mpa_equivalent>) => {
			end.judged.push(`${args[2].name} at ${args[0].loop.now}`);
			return real.mpa_equivalent(...args);
		}
	};
});
vi.mock('../src/html.ts', async (original) => {
	const real = await original<typeof import('../src/html.ts')>();
	return {
		...real,
		html_sent: (...args: Parameters<typeof real.html_sent>) => {
			end.judged.push(`html sent at ${args[0].loop.now}`);
			return real.html_sent(...args);
		}
	};
});
afterEach(() => {
	broken_by.layout = null;
	end.as_main = false;
	end.judged = [];
	end.stands = [];
});

/** Calls `then` each time `window`'s document changes its visibility (its page's own listeners
 *  go with the empty document it starts as: the ear is put on once its body is in). */
const on_visibility = (window: object, then: (hidden: boolean) => void): void => {
	const w = window as unknown as typeof globalThis;
	let ear = false;
	new w.MutationObserver(() => {
		if (ear || w.document.body === null) return;
		ear = true;
		w.document.addEventListener('visibilitychange', () => then(w.document.hidden));
	}).observe(w.document, { childList: true, subtree: true });
};

/** The visitor's second tab, the one `open` makes (tab names count up from the first). */
const second = (realm: string): boolean => realm.split('#')[0] === 'tab-2';
const VISIBLE = '[data-gate-visible] > ogygia-region[wake="visible"]';

describe.skipIf(!ready)('a seeded run judges a tab behind another', () => {
	it('after each action and at its rest, a tab behind that had its frames and owes none, though it was shown: a visible island asleep there is an islands-wake finding both times', async () => {
		// (the tab's on-screen visible island goes back to sleep the moment the tab goes behind)
		broken_by.layout = (args) => {
			const window = args[0] as unknown as Window;
			if (second(args[2]))
				on_visibility(window, (hidden) => {
					if (hidden) window.document.querySelector(VISIBLE)?.removeAttribute('data-hydrated');
				});
			return args;
		};
		process.env.SIM_APP = APP;
		const { run } = await import('../src/cli.ts');
		const plan: Plan = {
			actions: [
				{ kind: 'open', path: '/wake-gate' },
				{ kind: 'reload', tab: 0 }
			],
			idle: true
		};
		const res = await run(1, plan.actions.length, Infinity, undefined, plan);
		const wake = res.broken.filter((b) => b.oracle === 'islands-wake');
		expect(
			wake.some(
				(b) => b.detail.startsWith('after tab 0: reload: ') && !b.detail.includes('at rest:')
			),
			'after the action'
		).toBe(true);
		expect(
			wake.some((b) => b.detail.startsWith('after tab 0: reload: at rest: ')),
			'at its rest'
		).toBe(true);
	}, 300_000);

	it('at the end, a tab behind owed a look whose observers had no frame before it went behind is judged as it stood before the run end looks: a visible island awake there, which a fresh load behind another tab sleeps, is an MPA difference, though the look gives it its frame (#2091)', async () => {
		// (the frames the tab's observers had before it first went behind are not counted, so as far
		// as the run knows it went behind before its first; once behind it is owed a frame: a target
		// its page never had reported)
		let behind_once = false;
		broken_by.layout = (args) => {
			if (!second(args[2])) return args;
			const window = args[0] as unknown as typeof globalThis;
			const framed = args[4];
			on_visibility(window, (hidden) => {
				if (!hidden || behind_once) return;
				behind_once = true;
				new window.IntersectionObserver(() => {}).observe(window.document.body);
			});
			return [args[0], args[1], args[2], args[3], () => behind_once && framed?.()];
		};
		process.env.SIM_APP = APP;
		const { run } = await import('../src/cli.ts');
		const { owes_look } = await import('../src/oracles.ts');
		const plan: Plan = {
			actions: [
				{ kind: 'open', path: '/wake-gate' },
				{ kind: 'reload', tab: 0 }
			],
			idle: true
		};
		let owed = false;
		const res = await run(
			1,
			plan.actions.length,
			Infinity,
			async (_, v) => {
				const t = v.tabs[1];
				owed = owes_look(t) && !t.framed.has(t.realm);
			},
			plan
		);
		expect(behind_once, 'the case it is for: it went behind').toBe(true);
		expect(owed, 'and the run end judged it owed a look, before it looked').toBe(true);
		const end = res.log.findIndex((l) => l.includes('# run end judged at'));
		expect(res.log[end], 'it was owed a look at the run end').toMatch(/tab-2 owed a look$/);
		expect(
			res.log.slice(end).some((l) => l.endsWith('# tab-2 shown')),
			'then the visitor looked'
		).toBe(true);
		expect(res.broken.find((b) => b.detail.includes('/wake-gate'))?.oracle).toBe('mpa-equivalence');
		expect(
			res.log.some((l) => l.includes('/wake-gate looked at, judged against a fresh load')),
			'the difference as it stood is the finding: it is not loaded fresh again'
		).toBe(false);
	}, 300_000);

	it('at the end, a tab owed a look is judged again once looked at, and only then: a visible island that sleeps again each time the tab goes behind, set aside while it is owed the look, is an islands-wake finding after it (#2176)', async () => {
		// (as above, it is owed a look once behind; and its on-screen visible island goes back to
		// sleep each time the tab goes behind, so as it stands it matches a fresh load behind)
		let behind_once = false;
		broken_by.layout = (args) => {
			if (!second(args[2])) return args;
			const window = args[0] as unknown as typeof globalThis;
			const framed = args[4];
			on_visibility(window, (hidden) => {
				if (!hidden) return;
				window.document.querySelector(VISIBLE)?.removeAttribute('data-hydrated');
				if (behind_once) return;
				behind_once = true;
				new window.IntersectionObserver(() => {}).observe(window.document.body);
			});
			return [args[0], args[1], args[2], args[3], () => behind_once && framed?.()];
		};
		process.env.SIM_APP = APP;
		const { run } = await import('../src/cli.ts');
		const plan: Plan = {
			actions: [
				{ kind: 'open', path: '/wake-gate' },
				{ kind: 'reload', tab: 0 }
			],
			idle: true
		};
		const res = await run(1, plan.actions.length, Infinity, undefined, plan);
		expect(behind_once, 'the case it is for: it went behind').toBe(true);
		const wake = res.broken.filter((b) => b.oracle === 'islands-wake');
		expect(
			res.broken.some((b) => b.oracle === 'mpa-equivalence' && b.detail.includes('/wake-gate')),
			'and an MPA difference, once looked at'
		).toBe(true);
		expect(
			wake.map((b) => b.detail.split(':')[0]),
			'once, after the look'
		).toEqual(['looked at']);
	}, 300_000);

	it('at the end, a tab owed a look whose observers had their frames is judged at its rest with what it waits for set aside, not against a shown fresh load: a visible island asleep there that wakes once looked at is no difference (#2176)', async () => {
		// (the first time it goes behind its on-screen visible island goes back to sleep and its page
		// watches a target it never had reported, so it is owed a look; it wakes when shown)
		let behind_once = false;
		broken_by.layout = (args) => {
			if (!second(args[2])) return args;
			const window = args[0] as unknown as typeof globalThis;
			on_visibility(window, (hidden) => {
				const island = window.document.querySelector(VISIBLE);
				if (!hidden) return island?.setAttribute('data-hydrated', '');
				if (behind_once) return;
				behind_once = true;
				island?.removeAttribute('data-hydrated');
				new window.IntersectionObserver(() => {}).observe(window.document.body);
			});
			return args;
		};
		process.env.SIM_APP = APP;
		const { run } = await import('../src/cli.ts');
		const plan: Plan = {
			actions: [
				{ kind: 'open', path: '/wake-gate' },
				{ kind: 'reload', tab: 0 }
			],
			idle: true
		};
		const res = await run(1, plan.actions.length, Infinity, undefined, plan);
		expect(behind_once, 'the case it is for: it went behind').toBe(true);
		const end = res.log.find((l) => l.includes('# run end judged at'));
		expect(end, 'it was owed a look at the run end').toMatch(/tab-2 owed a look$/);
		expect(res.broken.filter((b) => b.detail.includes('/wake-gate'))).toEqual([]);
	}, 300_000);

	it("at the end, a tab owed a look whose observers had their frames spends main's comparison on the shared world, so every tab after it and every check after them judge at main's moment (#2176)", async () => {
		// (as above: it is owed a look the first time it goes behind; a third tab comes after it)
		const plan: Plan = {
			actions: [
				{ kind: 'open', path: '/wake-gate' },
				{ kind: 'open', path: '/' },
				{ kind: 'reload', tab: 0 }
			],
			idle: true
		};
		const once = async () => {
			let behind_once = false;
			broken_by.layout = (args) => {
				if (!second(args[2])) return args;
				const window = args[0] as unknown as typeof globalThis;
				on_visibility(window, (hidden) => {
					const island = window.document.querySelector(VISIBLE);
					if (!hidden) return island?.setAttribute('data-hydrated', '');
					if (behind_once) return;
					behind_once = true;
					island?.removeAttribute('data-hydrated');
					new window.IntersectionObserver(() => {}).observe(window.document.body);
				});
				return args;
			};
			end.judged = [];
			const res = await run(1, plan.actions.length, Infinity, undefined, plan);
			const at_end = res.log.find((l) => l.includes('# run end judged at'));
			return { at_end, judged: end.judged.filter((j) => !j.startsWith('tab-2 ')) };
		};
		process.env.SIM_APP = APP;
		const { run } = await import('../src/cli.ts');
		end.as_main = true;
		const was = await once();
		end.as_main = false;
		const is = await once();
		expect(is.at_end, 'the case it is for: tab-2 owed a look').toMatch(/tab-2 owed a look$/);
		expect(
			was.judged.some((j) => j.startsWith('tab-3 ')),
			'and tab-3 judged after it'
		).toBe(true);
		expect(is, "every tab not owed a look, and every check after them, at main's moment").toEqual(
			was
		);
	}, 300_000);

	it("at the end, a tab owed a look at its rest that owes none by the time it is compared still spends main's comparison, so every tab after it and every check after them judge at main's moment (#2176)", async () => {
		// (as above, and once the run end has rested its page stops watching, on a 1 s interval
		// that runs while the tab before it is compared)
		const plan: Plan = {
			actions: [
				{ kind: 'open', path: '/wake-gate' },
				{ kind: 'open', path: '/' },
				{ kind: 'reload', tab: 0 }
			],
			idle: true
		};
		const once = async () => {
			let behind_once = false;
			let rested = false;
			broken_by.layout = (args) => {
				if (!second(args[2])) return args;
				const window = args[0] as unknown as typeof globalThis;
				on_visibility(window, (hidden) => {
					const island = window.document.querySelector(VISIBLE);
					if (!hidden) return island?.setAttribute('data-hydrated', '');
					if (behind_once) return;
					behind_once = true;
					island?.removeAttribute('data-hydrated');
					const watch = new window.IntersectionObserver(() => {});
					watch.observe(window.document.body);
					window.setInterval(() => rested && watch.disconnect(), 1000);
				});
				return args;
			};
			end.judged = [];
			end.stands = [];
			const res = await run(
				1,
				plan.actions.length,
				Infinity,
				async () => {
					rested = true;
				},
				plan
			);
			const at_end = res.log.find((l) => l.includes('# run end judged at'));
			return {
				at_end,
				stands: end.stands,
				judged: end.judged.filter((j) => !j.startsWith('tab-2 '))
			};
		};
		process.env.SIM_APP = APP;
		const { run } = await import('../src/cli.ts');
		end.as_main = true;
		const was = await once();
		end.as_main = false;
		const is = await once();
		expect(is.at_end, 'the case it is for: tab-2 owed a look at its rest').toMatch(
			/tab-2 owed a look$/
		);
		expect(is.stands, 'and owed none by the time it is compared').toEqual([
			'tab-2 not owed a look'
		]);
		expect(
			was.judged.some((j) => j.startsWith('tab-3 ')),
			'and tab-3 judged after it'
		).toBe(true);
		expect(is, "every tab after it, and every check after them, at main's moment").toEqual(was);
	}, 300_000);

	it('at the end, a tab owed a look at its rest whose observers had no frame is judged as it stood, though it owes none by the time it is compared: a visible island awake there, which a fresh load behind another tab sleeps, is an MPA difference (#2091)', async () => {
		// (as the #2091 case above, and once the run end has rested its page stops watching, on a
		// 1 s interval that runs while the tab before it is compared)
		let behind_once = false;
		let rested = false;
		broken_by.layout = (args) => {
			if (!second(args[2])) return args;
			const window = args[0] as unknown as typeof globalThis;
			const framed = args[4];
			on_visibility(window, (hidden) => {
				if (!hidden || behind_once) return;
				behind_once = true;
				const watch = new window.IntersectionObserver(() => {});
				watch.observe(window.document.body);
				window.setInterval(() => rested && watch.disconnect(), 1000);
			});
			return [args[0], args[1], args[2], args[3], () => behind_once && framed?.()];
		};
		process.env.SIM_APP = APP;
		const { run } = await import('../src/cli.ts');
		const plan: Plan = {
			actions: [
				{ kind: 'open', path: '/wake-gate' },
				{ kind: 'reload', tab: 0 }
			],
			idle: true
		};
		const res = await run(
			1,
			plan.actions.length,
			Infinity,
			async () => {
				rested = true;
			},
			plan
		);
		expect(behind_once, 'the case it is for: it went behind').toBe(true);
		const at_end = res.log.find((l) => l.includes('# run end judged at'));
		expect(at_end, 'it was owed a look at its rest').toMatch(/tab-2 owed a look$/);
		expect(end.stands, 'and owed none by the time it is compared').toEqual([
			'tab-2 not owed a look'
		]);
		expect(res.broken.find((b) => b.detail.includes('/wake-gate'))?.oracle).toBe('mpa-equivalence');
	}, 300_000);

	it('at the end, a tab loaded behind and never shown is owed no look and not judged as it stands (#2091)', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../src/cli.ts');
		const plan: Plan = {
			actions: [
				{ kind: 'goto', tab: 0, path: '/' },
				{ kind: 'background', path: '/wake-gate' }
			],
			idle: true
		};
		const res = await run(1, plan.actions.length, Infinity, undefined, plan);
		const at_end = res.log.find((l) => l.includes('# run end judged at'));
		expect(at_end, 'it is owed no look').toMatch(/no tab owed a look$/);
		expect(end.stands, 'it is not judged as it stands').toEqual([]);
		expect(
			res.log.some((l) => l.includes('/wake-gate judged against a fresh load')),
			'it is judged against a fresh load'
		).toBe(true);
	}, 300_000);
});
