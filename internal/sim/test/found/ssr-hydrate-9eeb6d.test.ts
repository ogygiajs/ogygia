// FOUND BY THE SIMULATOR, shrunk to 4 actions (written by `pnpm sim --shrink`):
// [ssr-hydrate] after tab 1: back: https://app.test/soft-race: warn: https://svelte.dev/e/hydration_mismatch
//
//   1. new tab at /soft-race, behind
//   2. tab 1: press button #37, then again 20 ms later
//   3. tab 1: click link #333
//   4. tab 1: back
//
// Replay: pnpm sim --app ../../apps/palaestra --plan <this plan as a file> --step 4
// (Needs the app built for the simulator; skipped otherwise.)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signature } from '../../src/ci.ts';
import type { Plan } from '../../src/cli.ts';

const APP = fileURLToPath(new URL('../../../../apps/palaestra', import.meta.url));
const GEN: number | null = null;
const ready = ((): boolean => {
	const built = ['/.svelte-kit/sim-builds/v1', '/.svelte-kit/output'];
	if (!built.some((b) => existsSync(`${APP}${b}/server/index.js`))) return false;
	if (GEN === null) return true;
	const plan = `${APP}/src/lib/gen/plan.json`;
	return existsSync(plan) && JSON.parse(readFileSync(plan, 'utf8')).seed === GEN;
})();

const SEED = 260639017;
const PLAN: Plan = {
	actions: [
		{ kind: 'background', path: '/soft-race' },
		{
			kind: 'twice',
			tab: 1,
			nth: 37,
			after: 20,
			names: ['button og-region "refresh (0)"', 'button og-region "refresh (1)"']
		},
		{ kind: 'click', tab: 1, nth: 333, names: ['link /plain'] },
		{ kind: 'back', tab: 1 }
	],
	idle: false
};

describe.skipIf(!ready)('found: ssr-hydrate-9eeb6d', () => {
	it('no ssr-hydrate (da58530875)', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../../src/cli.ts');
		const res = await run(SEED, PLAN.actions.length, Infinity, undefined, PLAN);
		expect(res.broken.filter((b) => signature(b) === 'da58530875')).toEqual([]);
	}, 300_000);
});
