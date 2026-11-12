// A load pinned to an old build (the MPA check's fresh load of an old release's page) that the page
// store answered with a newer build's copy did not get the old build's page: the store dropped the
// old build's pages at the deploy (#949), and the old build's server hands out what the store holds.
// The world says so (`astray`), and the MPA check sets such a reference aside: it once compared an
// old page with the new release's (gen 131, seed 131003).
// (Needs the app built for the simulator: `node src/gen.ts --seed 131`, then
// `pnpm sim:builds --app ../../apps/sim-gen`; skipped otherwise.)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { builds_of } from '../src/builds.ts';
import { World } from '../src/world.ts';

const APP = fileURLToPath(new URL('../../../apps/sim-gen', import.meta.url));
const builds = builds_of(APP);
const ready = ((): boolean => {
	if (builds.length === 0) return false;
	const plan = `${APP}/src/lib/gen/plan.json`;
	return existsSync(plan) && JSON.parse(readFileSync(plan, 'utf8')).seed === 131;
})();

describe.skipIf(!ready)('a load pinned to an old build', () => {
	it("is astray when the store answers it with the new build's page, and not before", async () => {
		const world = await World.make({
			seed: 1,
			builds,
			secret: 'sim-secret',
			rollover: { window: 0, old_files: true, purge: true }
		});
		try {
			// (`/p0` opts in to postrender: the first visit stores v1's render)
			await world.go(world.tab(world.visitor('a')), 'goto', '/p0');
			await world.quiesce();
			const before = world.tab(world.visitor('b'));
			await world.as_of('v1', () => world.go(before, 'goto', '/p0'));
			expect(world.astray(before.realm)).toBe(false);
			await world.deploy_next();
			await world.go(world.tab(world.visitor('c')), 'goto', '/p0');
			await world.quiesce();
			const after = world.tab(world.visitor('d'));
			await world.as_of('v1', () => world.go(after, 'goto', '/p0'));
			expect(world.astray(after.realm)).toBe(true);
		} finally {
			await world.end();
		}
	}, 300_000);
});
