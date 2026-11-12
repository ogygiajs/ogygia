// FOUND BY THE SIMULATOR (palaestra, seed 20004, a guided search; shrunk to 2 actions, no network
// fault, the same with buggify off): go to /props-tail/b, then follow its link to /props-tail (a
// client navigation). The kept island (`keep: 'tally-keeper'`) crosses with its props pushed from
// the next page, but its `data-og-fp` stays page B's: a fresh load of /props-tail has another
// fingerprint there. The router names the islands a page holds by that attribute
// (`x-ogygia-known`). (Skipped without the app built for the simulator.)
//
//   1. tab 0: go to /props-tail/b
//   2. tab 0: click link #964 (to /props-tail)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signature } from '../../src/ci.ts';
import type { Plan } from '../../src/cli.ts';

const APP = fileURLToPath(new URL('../../../../apps/palaestra', import.meta.url));
const ready = ['/.svelte-kit/sim-builds/v1', '/.svelte-kit/output'].some((b) =>
	existsSync(`${APP}${b}/server/index.js`)
);

const SEED = 20004;
const PLAN: Plan = {
	actions: [
		{ kind: 'goto', tab: 0, path: '/props-tail/b' },
		{ kind: 'click', tab: 0, nth: 964 }
	]
};

describe.skipIf(!ready)("found: a kept island keeps the last page's fingerprint", () => {
	it('after a navigation a kept island carries the fingerprint a fresh load gives (mpa-equivalence aa9cd228da)', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../../src/cli.ts');
		const res = await run(SEED, PLAN.actions.length, Infinity, undefined, PLAN);
		expect(res.broken.filter((b) => signature(b) === 'aa9cd228da')).toEqual([]);
	}, 300_000);
});
