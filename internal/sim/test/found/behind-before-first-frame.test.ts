// FOUND BY THE SIMULATOR (palaestra, seed 302061542; #2091, and #2092 on /load-scheduler), shrunk
// to 6 actions: the visitor goes to /head-budget/via-factory in tab 1, then acts in tab 0 before the
// page's runtime ran, so tab 1 goes behind. Its document was shown as it came, but its visible
// island never had a frame, and sleeps as a browser's would. A shown fresh load wakes it: the page is
// judged against a fresh load behind another tab instead.
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

const SEED = 302061542;
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
});
