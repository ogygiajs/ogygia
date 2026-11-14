// FOUND BY THE SIMULATOR, shrunk to 2 actions (written by `pnpm sim --shrink`): the viewport swap
// observer keeps observing regions it let go (#1255).
// [waste] https://app.test/p2: alive after its owner: MutationObserver watching <ogygia-region>
//
//   1. tab 0: click link #351
//   2. tab 0: click link #731
//
// Replay: pnpm sim --app ../../apps/sim-gen --plan <this plan as a file> --step 2
// (Needs the app built for the simulator: `node src/gen.ts --seed 45`, then `pnpm sim:builds --app ../../apps/sim-gen`; skipped otherwise.)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signature } from '../../src/ci.ts';
import type { Plan } from '../../src/cli.ts';

const APP = fileURLToPath(new URL('../../../../apps/sim-gen', import.meta.url));
const GEN: number | null = 45;
const ready = ((): boolean => {
	const built = ['/.svelte-kit/sim-builds/v1', '/.svelte-kit/output'];
	if (!built.some((b) => existsSync(`${APP}${b}/server/index.js`))) return false;
	if (GEN === null) return true;
	const plan = `${APP}/src/lib/gen/plan.json`;
	return existsSync(plan) && JSON.parse(readFileSync(plan, 'utf8')).seed === GEN;
})();

const SEED = 100;
const PLAN: Plan = {
	actions: [
		{ kind: 'click', tab: 0, nth: 351 },
		{ kind: 'click', tab: 0, nth: 731 }
	]
};

describe.skipIf(!ready)('found: the swap observer outlives its regions', () => {
	it('a region the swap observer let go is no longer observed (waste acab387eb7)', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../../src/cli.ts');
		const res = await run(SEED, PLAN.actions.length, Infinity, undefined, PLAN);
		expect(res.broken.filter((b) => signature(b) === 'acab387eb7')).toEqual([]);
	}, 300_000);
});
