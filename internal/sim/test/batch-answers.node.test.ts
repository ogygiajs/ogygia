// The build that answered a document's hole, for the MPA check's fresh load (`World.answers_of`):
// a hole a page fetched again inside a batch (`POST /__ogygia__`, a JSON list of hole addresses)
// was answered by the batch's build. answers_of once read only each hole's own GET, so the fresh
// load asked the build of an older answer (gen 77, seed 77025: a hole the old build answered in a
// rolling deploy's window, answered again by the new build in a batch after a client navigation).
// (Needs the app built for the simulator: `node src/gen.ts --seed 77`, then
// `pnpm sim:builds --app ../../apps/sim-gen`; skipped otherwise.)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Plan } from '../src/cli.ts';

const APP = fileURLToPath(new URL('../../../apps/sim-gen', import.meta.url));
const ready = ((): boolean => {
	if (!existsSync(`${APP}/.svelte-kit/sim-builds/v2/server/index.js`)) return false;
	const plan = `${APP}/src/lib/gen/plan.json`;
	return existsSync(plan) && JSON.parse(readFileSync(plan, 'utf8')).seed === 77;
})();

const PLAN: Plan = {
	actions: [
		{ kind: 'back', tab: 0 },
		{ kind: 'deploy' },
		{ kind: 'goto', tab: 0, path: '/p1' },
		{ kind: 'click', tab: 0, nth: 926 },
		{ kind: 'click', tab: 0, nth: 556 },
		{ kind: 'goto', tab: 0, path: '/p2' },
		{ kind: 'click', tab: 0, nth: 222 },
		{ kind: 'click', tab: 0, nth: 493 },
		{ kind: 'open', path: '/p0' },
		{ kind: 'click', tab: 0, nth: 304 },
		{ kind: 'click', tab: 0, nth: 703 },
		{ kind: 'back', tab: 0 },
		{ kind: 'click', tab: 0, nth: 412 },
		{ kind: 'click', tab: 1, nth: 974 }
	]
};

describe.skipIf(!ready)("a hole a batch answered is the batch's build's", () => {
	it('the fresh load asks the build that answered the hole last, in a batch too', async () => {
		process.env.SIM_APP = APP;
		const { run } = await import('../src/cli.ts');
		const res = await run(77025, PLAN.actions.length, Infinity, undefined, PLAN);
		expect(res.broken.filter((b) => b.oracle === 'mpa-equivalence').map((b) => b.detail)).toEqual(
			[]
		);
	}, 300_000);
});
