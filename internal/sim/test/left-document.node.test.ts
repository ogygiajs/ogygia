// A document the tab has left hears nothing more: a browser calls off its fetches as it unloads it,
// and its code never runs again. A left document's chunk, stalled 31 s, landed while the tab showed
// a third document; its code ran over a closed window and threw, and the simulator counted that as
// the run's uncaught error (gen 192, seed 11). Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('a document the tab has left', () => {
	it('never hears the answer to a request it made, and holds nothing in flight', async () => {
		// (every answer is held 10 to 40 s on the way: the first document's comes after it is left)
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			faults: new Set(['stall']),
			rates: { stall: 1 }
		});
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/');
			await world.quiesce();
			const first = tab.page.mainFrame.window as unknown as Window;
			const heard: string[] = [];
			void first
				.fetch('/?slow')
				.then((r) => r.text())
				.then(
					() => heard.push('answered'),
					() => heard.push('failed')
				);
			await world.go(tab, 'goto', '/');
			expect(tab.documents).toBe(2);
			await world.loop.run(60_000);
			await world.quiesce();
			expect(heard).toEqual([]);
			expect(world.network.unanswered()).toBe(0);
			expect(world.uncaught).toEqual([]);
		} finally {
			await world.end();
		}
	});
});
