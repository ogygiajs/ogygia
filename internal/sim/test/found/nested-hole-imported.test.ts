// FOUND BY THE SIMULATOR (palaestra, seed 20004, a guided search; shrunk to 2 actions, no network
// fault, the same with buggify off): go to /prefetch, then follow its link to /nested (a client
// navigation). /nested's island (Outer) holds a hole nested in it (Greeting, `render: 'deferred'`),
// which renders as a lake whose `entry` is the hole's id (`ef6cf1a12aa0`), not a module URL. After
// the navigation the browser imports that id as a module: `GET /ef6cf1a12aa0` (404), again with
// `?og-retry=1`, then `chunk_reload_needed`. (Skipped without the app built for the simulator.)
//
//   1. tab 0: go to /prefetch
//   2. tab 0: click link #526 (to /nested)
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
		{ kind: 'goto', tab: 0, path: '/prefetch' },
		{ kind: 'click', tab: 0, nth: 526 }
	]
};

describe.skipIf(!ready)('found: a hole nested in an island is imported as a module', () => {
	it('a client navigation to /nested never imports the nested hole id (page-errors 12a16ab7f3)', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../../src/cli.ts');
		const res = await run(SEED, PLAN.actions.length, Infinity, undefined, PLAN);
		expect(res.broken.filter((b) => signature(b) === '12a16ab7f3')).toEqual([]);
	}, 300_000);
});
