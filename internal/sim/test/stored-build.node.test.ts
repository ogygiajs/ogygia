// A page the store gave is of the build that rendered it, not of the server that handed it out: after
// a deploy, a stored copy of the old release's page (#947) is the old release's, and the MPA check's
// fresh load asks that release for it. It once asked the new one, and the islands' files of the
// two sides differed (gen 90, seed 3).
// (Needs the app built for the simulator: `node src/gen.ts --seed 90`, then
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
	const plan = APP + '/src/lib/gen/plan.json';
	return existsSync(plan) && JSON.parse(readFileSync(plan, 'utf8')).seed === 90;
})();

describe.skipIf(!ready)('a stored page', () => {
	it('is of the build whose files it names', async () => {
		const world = await World.make({
			seed: 1,
			builds,
			secret: 'sim-secret',
			rollover: { window: 0, old_files: true, purge: true }
		});
		try {
			// (`/p0` opts in to postrender: the first visit stores v1's render)
			const before = world.tab(world.visitor('a'));
			await world.go(before, 'goto', '/p0');
			await world.quiesce();
			await world.deploy_next();
			const after = world.tab(world.visitor('b'));
			await world.go(after, 'goto', '/p0');
			await world.quiesce();
			const doc = after.page.mainFrame.document as unknown as Document;
			const files = [...doc.querySelectorAll('ogygia-region[src]')].map((el) =>
				el.getAttribute('src')!
			);
			expect(files.length).toBeGreaterThan(0);
			const build = world.build_of(after.realm);
			const server = world.servers.get(build)![0];
			expect(files.filter((f) => !server.serves(f))).toEqual([]);
		} finally {
			await world.end();
		}
	}, 300_000);
});
