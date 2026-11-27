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
afterEach(() => {
	broken_by.layout = null;
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
		const plan: Plan = {
			actions: [
				{ kind: 'open', path: '/wake-gate' },
				{ kind: 'reload', tab: 0 }
			],
			idle: true
		};
		let looked = false;
		const res = await run(
			1,
			plan.actions.length,
			Infinity,
			async (_, v) => {
				const t = v.tabs[1];
				looked = t.hidden && t.framed.has(t.realm);
			},
			plan
		);
		expect(behind_once, 'the case it is for: it went behind').toBe(true);
		expect(looked, 'and the run end looked at it').toBe(true);
		expect(res.broken.find((b) => b.detail.includes('/wake-gate'))?.oracle).toBe('mpa-equivalence');
	}, 300_000);
});
