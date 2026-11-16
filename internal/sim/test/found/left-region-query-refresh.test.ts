// FOUND BY THE SIMULATOR (palaestra, seed 320519035, shrunk to 3 actions; #2007): on /data the
// visitor presses "bump +1" in the remote counter island, whose command stalls on the network, and
// goes back before it answers. The handler's `count.refresh()` then ran on a query its island had
// left. (Skipped without the app built for the simulator.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Plan } from '../../src/cli.ts';

const APP = fileURLToPath(new URL('../../../../apps/palaestra', import.meta.url));
const ready = ['/.svelte-kit/sim-builds/v1', '/.svelte-kit/output'].some((b) =>
	existsSync(`${APP}${b}/server/index.js`)
);

const SEED = 320519035;
const PLAN: Plan = {
	actions: [
		{ kind: 'click', tab: 0, nth: 638, names: ['link /data'] },
		{
			kind: 'press',
			tab: 0,
			nth: 190,
			names: ['button og-region "bump +1 (command → refresh)"']
		},
		{ kind: 'back', tab: 0 }
	],
	idle: false
};

describe.skipIf(!ready)('found: a query refreshed after its island left', () => {
	it('a click handler that refreshes a query after its island left the page throws nothing', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../../src/cli.ts');
		const res = await run(SEED, PLAN.actions.length, Infinity, undefined, PLAN);
		expect(res.broken.filter((b) => b.oracle === 'page-errors').map((b) => b.detail)).toEqual([]);
	}, 300_000);
});
