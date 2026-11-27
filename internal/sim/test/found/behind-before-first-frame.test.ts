// FOUND BY THE SIMULATOR (palaestra, seed 302061542; #2091, and #2092 on /load-scheduler), shrunk
// to 6 actions; re-picked as seed 13 once a request's fate stopped reading its file's hash (#2110),
// the plan the same: the visitor goes to /head-budget/via-factory in tab 1, then acts in tab 0 before the
// page's runtime ran, so tab 1 goes behind. Its document was shown as it came, but its visible
// island never had a frame, and sleeps as a browser's would; a shown fresh load wakes it. The run's
// end judges the tab as it stands against a fresh load behind another tab, then looks at it (its
// island wakes then) and judges it against a shown fresh load.
//
//   1. new tab at /nested-css
//   2. tab 1: reload
//   3. tab 1: reload
//   4. tab 1: go to /island-foreign-edit
//   5. tab 1: go to /head-budget/via-factory
//   6. tab 0: click link #806, then link #132 300 ms later
//
// (Needs the app built for the simulator; skipped otherwise.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signature } from '../../src/ci.ts';
import type { Plan } from '../../src/cli.ts';

const APP = fileURLToPath(new URL('../../../../apps/palaestra', import.meta.url));
const ready = ['/.svelte-kit/sim-builds/v1', '/.svelte-kit/output'].some((b) =>
	existsSync(`${APP}${b}/server/index.js`)
);

const SEED = 13;
const PLAN: Plan = {
	actions: [
		{ kind: 'open', path: '/nested-css' },
		{ kind: 'reload', tab: 1 },
		{ kind: 'reload', tab: 1 },
		{ kind: 'goto', tab: 1, path: '/island-foreign-edit' },
		{ kind: 'goto', tab: 1, path: '/head-budget/via-factory' },
		{ kind: 'hurry', tab: 0, nth: 806, next: 132, after: 300, names: ['link /', 'link /data'] }
	],
	idle: false
};

describe.skipIf(!ready)('found: a tab behind before its islands had a frame', () => {
	it('is equal to a fresh load behind another tab (a4fa20c57b)', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../../src/cli.ts');
		const res = await run(SEED, PLAN.actions.length, Infinity, undefined, PLAN);
		expect(res.broken.filter((b) => signature(b) === 'a4fa20c57b')).toEqual([]);
	}, 300_000);

	it('is equal to a fresh load behind another tab after a back it was shown for (#2092, found as seed 783825139, re-picked as 82: f92b8ce3c6)', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../../src/cli.ts');
		const plan: Plan = {
			actions: [
				{ kind: 'open', path: '/head-budget/via-factory' },
				{ kind: 'background', path: '/load-scheduler' },
				{ kind: 'goto', tab: 2, path: '/held-in-held' },
				{ kind: 'back', tab: 2 },
				{ kind: 'click', tab: 1, nth: 940 }
			],
			idle: true
		};
		const res = await run(82, plan.actions.length, Infinity, undefined, plan);
		expect(res.broken.filter((b) => signature(b) === 'f92b8ce3c6')).toEqual([]);
	}, 300_000);
});
