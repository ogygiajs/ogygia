// FOUND BY THE SIMULATOR (palaestra, seed 346200287; #2117), shrunk to 10 actions: the visitor
// goes to /hole-kept/b, whose answer is slow, and presses forward while it is on its way. There is
// no entry ahead, so a browser does nothing and the page comes. The simulator called the
// navigation off first, and the tab kept a blank document at /hole-kept/b, judged against a fresh
// load (mpa-equivalence: `<html>` against `<html lang="en">`). (Skipped without the app built.)
//
//   1. tab 0: back            6. tab 0: reload
//   2. tab 0: forward         7. tab 0: go to /seed-shape, press button #95 300 ms in
//   3. tab 0: online          8. tab 0: reload
//   4. tab 0: back            9. tab 0: go to /hole-kept/b
//   5. tab 0: go to /prefetch 10. tab 0: forward
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signature } from '../../src/ci.ts';
import type { Plan } from '../../src/cli.ts';

const APP = fileURLToPath(new URL('../../../../apps/palaestra', import.meta.url));
const ready = ['/.svelte-kit/sim-builds/v1', '/.svelte-kit/output'].some((b) =>
	existsSync(`${APP}${b}/server/index.js`)
);

const SEED = 346200287;
const PLAN: Plan = {
	actions: [
		{ kind: 'back', tab: 0 },
		{ kind: 'forward', tab: 0 },
		{ kind: 'online', tab: 0 },
		{ kind: 'back', tab: 0 },
		{ kind: 'goto', tab: 0, path: '/prefetch' },
		{ kind: 'reload', tab: 0 },
		{
			kind: 'eager',
			tab: 0,
			path: '/seed-shape',
			nth: 95,
			after: 300,
			names: ['button og-region "n:0"']
		},
		{ kind: 'reload', tab: 0 },
		{ kind: 'goto', tab: 0, path: '/hole-kept/b' },
		{ kind: 'forward', tab: 0 }
	],
	idle: true
};

describe.skipIf(!ready)('found: a forward with nowhere to go while a page is on its way', () => {
	it('leaves the page to come (dddc0896e5)', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../../src/cli.ts');
		const res = await run(SEED, PLAN.actions.length, Infinity, undefined, PLAN);
		expect(res.broken.filter((b) => signature(b) === 'dddc0896e5')).toEqual([]);
	}, 300_000);
});
