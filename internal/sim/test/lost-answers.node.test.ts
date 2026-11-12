// A hole whose answer buggify lost on the way (`hole.fetch-lost`) tries again, and gives up once its
// tries run out, as it does when the network drops each: the document is faulted, as a dropped
// request's is, and the MPA check sets it aside (palaestra seed 85: an idle hole on /defer-timing
// left on its fallback after three lost answers). Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { faulted } from '../src/oracles.ts';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('a lost answer', () => {
	it('faults the document whose hole gave up after every answer was lost', async () => {
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			buggify: { on: 1, fires: 1 }
		});
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/defer-timing');
			await world.quiesce();
			await world.loop.run(60_000);
			await world.quiesce();
			expect(world.buggified.get('hole.fetch-lost')?.fired ?? 0).toBeGreaterThan(0);
			const doc = tab.page.mainFrame.document as unknown as Document;
			expect(doc.querySelector('[data-fallback-idle]')).not.toBe(null);
			expect(faulted(world, tab)).toBe(true);
		} finally {
			await world.end();
		}
	});

	it('leaves alone a document whose holes all answered', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/defer-timing');
			await world.quiesce();
			expect(faulted(world, tab)).toBe(false);
		} finally {
			await world.end();
		}
	});
});
