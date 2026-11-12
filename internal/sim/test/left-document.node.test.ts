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
			// (back to the tab's first entry, `about:blank`: no request, so the document is left at
			// once, before any stalled answer can come; a page of the app's own came after the answer
			// once the seed's draws moved, and the old page rightly heard it)
			await world.go(tab, 'back');
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

	it("says nothing of an import its unload failed, a classic script's or a module's", async () => {
		// (Kit's boot imports its entry files with no catch; the tab went back while one stalled, the
		// unload failed the import, and the left page's rejection reached the host as the run's
		// uncaught error: palaestra seed 20004, /csr-chrome/kit)
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
			const doc = tab.page.mainFrame.document as unknown as Document;
			for (const type of ['', 'module']) {
				const s = doc.createElement('script');
				if (type) s.type = type;
				s.textContent = `import('/_app/immutable/left-${type || 'classic'}.js')`;
				doc.body.append(s);
			}
			await world.loop.run(50);
			await world.go(tab, 'back');
			expect(tab.documents).toBe(2);
			await world.loop.run(60_000);
			await world.quiesce();
			expect(world.uncaught).toEqual([]);
		} finally {
			await world.end();
		}
	});
});
