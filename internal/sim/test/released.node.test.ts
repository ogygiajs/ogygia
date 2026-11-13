// An app upgraded from a release (src/gen.ts `released_plan`): its first build runs the release's
// runtime in every document it serves, which this tree cannot change, so a run judges only the
// documents this tree's runtime runs. Gen 192 drew a third party's edit the release never
// repaired: its own documents said hydration_mismatch on every seed.
// Needs a generated app upgraded from a release, built (`node src/gen.ts --seed 192`, then
// `node src/builds.ts --app ../../apps/sim-gen`); skipped without one.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { builds_of, released_of } from '../src/builds.ts';
import { World } from '../src/world.ts';

const APP = fileURLToPath(new URL('../../../apps/sim-gen', import.meta.url));
const builds = builds_of(APP);

describe.skipIf(builds.length === 0 || released_of(APP) === null)('an upgraded app', () => {
	it("a document the release served runs the release's runtime; one the next build served runs this tree's", async () => {
		const world = await World.make({
			seed: 1,
			builds,
			secret: 'sim-secret',
			rollover: { window: 0, old_files: true, purge: true }
		});
		try {
			const before = world.tab(world.visitor('v'));
			await world.go(before, 'goto', '/');
			expect(world.on_release(before.realm)).toBe(true);
			await world.deploy_next();
			const after = world.tab(world.visitor('w'));
			await world.go(after, 'goto', '/');
			expect(world.on_release(after.realm)).toBe(false);
			expect(world.on_release(before.realm)).toBe(true);
		} finally {
			await world.end();
		}
	});
});
