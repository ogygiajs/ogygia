// FOUND BY THE SIMULATOR (palaestra, seed 783827205; #2093), shrunk to 3 actions: /hole-kit-rebuild
// throws once while Kit hydrates it, on purpose (Boom.svelte), so Svelte says "Failed to hydrate"
// and Kit mounts the page anew; the page is for that rebuild (e2e/hole-kit-rebuild.spec.ts). Its
// warning is the page's design, as /lake-twins-kit's mismatch is, not waste.
//
//   1. new tab at /hole-kit-rebuild
//   2. tab 1: go to /remote-seed-gate/island-in-lake
//   3. tab 1: back
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

const SEED = 783827205;
const PLAN: Plan = {
	actions: [
		{ kind: 'open', path: '/hole-kit-rebuild' },
		{ kind: 'goto', tab: 1, path: '/remote-seed-gate/island-in-lake' },
		{ kind: 'back', tab: 1 }
	],
	idle: true
};

describe.skipIf(!ready)('found: a page whose hydration fails on purpose', () => {
	it('is no waste for saying so (ebdaa71b07)', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../../src/cli.ts');
		const res = await run(SEED, PLAN.actions.length, Infinity, undefined, PLAN);
		expect(res.broken.filter((b) => signature(b) === 'ebdaa71b07')).toEqual([]);
	}, 300_000);
});
