// FOUND BY THE SIMULATOR (palaestra with `pnpm sim:builds`, seed 920000075), shrunk to 2 actions:
// a rolling deploy whose old files are gone, then a load of a page an old server rendered. Its
// region's file is gone (404), so the runtime asks the current build's map, again after 1 s, then
// after 3 s, while the rollover settles (policies.ts `rollover`). The action's rest (nothing due
// within 2 s) came during the 3 s wait, and the stuck oracle called `wake#1 waking` a hang. A
// document a deploy failed a download of owes its waits only once its backoffs ran, as a faulted
// one does. (Skipped without the app built; without its two builds there is no deploy.)
//
//   1. deploy the next build
//   2. tab 0: go to /remote-seed-gate/page-script-reader
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signature } from '../../src/ci.ts';
import type { Plan } from '../../src/cli.ts';

const APP = fileURLToPath(new URL('../../../../apps/palaestra', import.meta.url));
const ready = ['/.svelte-kit/sim-builds/v1', '/.svelte-kit/output'].some((b) =>
	existsSync(`${APP}${b}/server/index.js`)
);

const SEED = 920000075;
const PLAN: Plan = {
	actions: [
		{ kind: 'deploy' },
		{ kind: 'goto', tab: 0, path: '/remote-seed-gate/page-script-reader' }
	],
	idle: true
};

describe.skipIf(!ready)('found: a region file a deploy took, while its recovery waits', () => {
	it('is not a hang during the rollover backoff (b31837416b)', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../../src/cli.ts');
		const res = await run(SEED, PLAN.actions.length, Infinity, undefined, PLAN);
		expect(res.broken.filter((b) => signature(b) === 'b31837416b')).toEqual([]);
		expect(res.broken).toEqual([]);
	}, 300_000);
});
