// FOUND BY THE SIMULATOR (gen 7, 13 of 20 seeds; #1697), shrunk to 1 action:
// [islands-wake] after tab 0: go to /peer/q0: at rest: https://app.test/peer/q0: <ogygia-region entry="https://peer.test/_app/ogygia/og-region.a09445325122.js" wake="load" ...> showing "n1017 n1017 pressed 0 n1016"
//
//   1. tab 0: go to /peer/q0
//
// App 7 has no router, and mounts its peer's pages with `mount.kit` in a catchall that prints the
// peer's document with `{@html}`: the page holds the peer's island and no region of its own, and
// no runtime script ever loaded.
// (Needs the app built for the simulator: `node src/gen.ts --seed 7`, then `pnpm sim:builds --app ../../apps/sim-gen`; skipped otherwise.)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { signature } from '../../src/ci.ts';
import type { Plan } from '../../src/cli.ts';

const APP = fileURLToPath(new URL('../../../../apps/sim-gen', import.meta.url));
const GEN: number | null = 7;
const ready = ((): boolean => {
	const built = ['/.svelte-kit/sim-builds/v1', '/.svelte-kit/output'];
	if (!built.some((b) => existsSync(`${APP}${b}/server/index.js`))) return false;
	if (GEN === null) return true;
	const plan = `${APP}/src/lib/gen/plan.json`;
	return existsSync(plan) && JSON.parse(readFileSync(plan, 'utf8')).seed === GEN;
})();

const SEED = 1;
const PLAN: Plan = { actions: [{ kind: 'goto', tab: 0, path: '/peer/q0' }], idle: true };

describe.skipIf(!ready)("found: a Kit-mounted peer page's island wakes", () => {
	it('on an app with no router, a peer page mounted by a Kit catchall loads the runtime and wakes its wake-load island', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../../src/cli.ts');
		const res = await run(SEED, PLAN.actions.length, Infinity, undefined, PLAN);
		expect(res.broken.filter((b) => b.oracle === 'islands-wake')).toEqual([]);
		expect(res.broken.filter((b) => signature(b) === 'd1e83f6a7e')).toEqual([]);
	}, 300_000);
});
