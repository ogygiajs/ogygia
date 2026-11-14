// A rolling deploy from a release (src/gen.ts `released_plan`): a page the release served asks for
// its holes, and some asks reach a server of the next build. The release's runtime cannot read the
// next build's answer (it names the next build's island module, which runs against the release's
// own chunks), so the next build refuses a capability minted before its version (#1769) and the
// release's page keeps its fallback.
// Needs a generated app upgraded from a release, built (`node src/gen.ts --seed 30`, then
// `node src/builds.ts --app ../../apps/sim-gen`); skipped without one.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { builds_of, released_of } from '../src/builds.ts';
import { World } from '../src/world.ts';

const APP = fileURLToPath(new URL('../../../apps/sim-gen', import.meta.url));
const builds = builds_of(APP);

describe.skipIf(builds.length === 0 || released_of(APP) === null)(
	"a release's page, in a rolling deploy",
	() => {
		it("its holes the next build answers are refused as another build's, and none fails to hydrate", async () => {
			const crossed: Array<number | string> = [];
			for (const seed of [1, 2, 5, 7]) {
				const world = await World.make({
					seed,
					builds,
					secret: 'sim-secret',
					rollover: { window: 600_000, old_files: true, purge: true }
				});
				try {
					await world.deploy_next();
					const tab = world.tab(world.visitor('v'));
					await world.go(tab, 'goto', '/p1');
					await world.rest();
					expect(world.on_release(tab.realm)).toBe(true);
					for (const e of world.network.exchanges)
						if (
							e.from === tab.realm &&
							e.build === 'v2' &&
							new URL(e.url).pathname.startsWith('/__ogygia__')
						)
							crossed.push(e.status);
					expect(tab.console.filter((line) => line.includes('hydration failed'))).toEqual([]);
				} finally {
					await world.end();
				}
			}
			expect(crossed.length).toBeGreaterThan(0);
			expect(new Set(crossed)).toEqual(new Set([403]));
		});
	}
);
