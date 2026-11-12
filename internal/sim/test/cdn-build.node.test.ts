// A page the CDN answered from its copy is of the build that rendered the copy, as one its origin
// answered is: a document's build is read off the answer it got, wherever that answer came from. A
// CDN hit once left the document with no build, so after a deploy the MPA check's fresh load asked
// the new release for an old release's page (gen 131, seed 131003).
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

describe.skipIf(!ready)('a page the CDN answered', () => {
	it('is of the build that rendered its copy', async () => {
		const world = await World.make({
			seed: 1,
			builds,
			secret: 'sim-secret',
			rollover: { window: 0, old_files: true, purge: true }
		});
		try {
			// (`/p0` opts in to postrender: its answer may be kept by a shared cache)
			const first = world.tab(world.visitor('a'));
			await world.go(first, 'goto', '/p0');
			await world.quiesce();
			const second = world.tab(world.visitor('b'));
			await world.go(second, 'goto', '/p0');
			await world.quiesce();
			const page = world.network.exchanges.find(
				(e) => e.from === second.realm && new URL(e.url).pathname === '/p0'
			);
			expect(page?.build).toBe('v1');
			expect(world.cdn.hits).toBeGreaterThan(0);
			await world.deploy_next();
			expect(world.build_of(second.realm)).toBe('v1');
		} finally {
			await world.end();
		}
	}, 300_000);
});
