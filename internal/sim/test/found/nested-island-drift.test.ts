// FOUND BY THE SIMULATOR (gen 422, seed 11: ssr-hydrate on /p3), here with no fault: /p3 holds an
// idle island (n32) with an idle island nested in it (n24), and a third party's script after n24
// that adds a text node inside n24 once the document is parsed. The same drift on a top-level
// island is put back at its wake; here n32's hydration fails and is discarded (#1425).
// (Needs the app built for the simulator: `node src/gen.ts --seed 422`, then
// `pnpm sim:builds --app ../../apps/sim-gen`; skipped otherwise.)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../../src/world.ts';

const APP = fileURLToPath(new URL('../../../../apps/sim-gen', import.meta.url));
const OUTPUT = `${APP}/.svelte-kit/sim-builds/v1`;
const GEN = 422;
const ready = ((): boolean => {
	if (!existsSync(`${OUTPUT}/server/index.js`)) return false;
	const plan = `${APP}/src/lib/gen/plan.json`;
	return existsSync(plan) && JSON.parse(readFileSync(plan, 'utf8')).seed === GEN;
})();

describe.skipIf(!ready)(
	'found: an island discards its hydration when a third party adds text inside an island nested in it',
	() => {
		it('a fresh load of /p3 wakes both islands with no hydration said to fail', async () => {
			const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
			try {
				const tab = world.tab(world.visitor('v'));
				await world.go(tab, 'goto', '/p3');
				await world.rest();
				const doc = tab.page.mainFrame.document as unknown as Document;
				// (the drift happened: the third party's text is in n24)
				expect(doc.body.textContent).toContain('third party');
				expect(tab.console.filter((l) => /hydration_(mismatch|discarded)/.test(l))).toEqual([]);
			} finally {
				await world.end();
			}
		});
	}
);
