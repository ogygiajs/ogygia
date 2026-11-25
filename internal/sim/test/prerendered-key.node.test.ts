// A prerendered page's hole carries the key its BUILD signed with: the simulator's builds are made
// without OGYGIA_SECRET, so a world that runs its servers with one refuses that hole
// (`x-ogygia-deny: foreign-key`), as a real app refuses it when it sets the secret where it runs
// but not where it builds (the build says so: `build_key_prerender`). The world's configuration
// did that, not the app: the document is set aside like one a deploy skewed (#2160, palaestra
// seed 351367808: /static's greeting refused, said `region_answer_denied`).
// Skipped without the app built for the simulator.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);

describe.skipIf(!existsSync(`${OUTPUT}/server/index.js`))('a prerendered hole', () => {
	it("refused under a secret its build never had is the world's skew, not the app's", async () => {
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			secret: 'sim-secret'
		});
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/static');
			await world.quiesce();
			const holes = world.network.exchanges.filter(
				(e) => e.from === tab.realm && new URL(e.url).pathname === '/__ogygia__'
			);
			expect(holes.map((e) => e.status)).toContain(403);
			expect(world.skewed_for(tab.realm)).toBe(true);
		} finally {
			await world.end();
		}
	});

	it('answered when the world runs the key its build signed with', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/static');
			await world.quiesce();
			const holes = world.network.exchanges.filter(
				(e) => e.from === tab.realm && new URL(e.url).pathname === '/__ogygia__'
			);
			expect(holes.map((e) => e.status)).toContain(200);
			expect(world.skewed_for(tab.realm)).toBe(false);
		} finally {
			await world.end();
		}
	});
});
