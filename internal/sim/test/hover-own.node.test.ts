// A VISITOR'S POINTER IS THEIRS: pointing at a region that waits for the visitor's interaction wakes
// it, and what it shows from then on is the visitor's doing, as a press's is: a fresh load, which
// nobody pointed at, shows its fallback (gen 56, seed 74: the MPA check judged a hole the visitor
// woke, and the stylesheet its answer brought, against a fresh load's fallback). Pointing at a link
// is intent only (a warm-up): its document stays judged. Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';
import { act, links } from '../src/workload.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);
const ORIGIN = 'https://app.test';

describe.skipIf(!built)('pointing at a region', () => {
	it("makes the document the visitor's own when the region waits for their interaction, not when it is a link", async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const v = world.visitor('v');
			const tab = world.tab(v);
			await world.go(tab, 'goto', '/defer-timing');
			const doc = tab.page.mainFrame.document as unknown as Document;
			const found = [...links(tab, ORIGIN), ...doc.querySelectorAll('ogygia-region')];
			const waits = found.findIndex((e) =>
				/^interaction$/.test(e.getAttribute('when') ?? e.getAttribute('wake') ?? '')
			);
			const link = found.findIndex((e) => e.localName === 'a');
			expect(waits, 'the page has a region that waits for the visitor').toBeGreaterThanOrEqual(0);
			expect(link).toBeGreaterThanOrEqual(0);
			const own: string[] = [];
			const mark = (t: { name: string }) => own.push(t.name);
			await act(world, v, { kind: 'hover', tab: 0, nth: link }, ORIGIN, undefined, mark);
			expect(own).toEqual([]);
			await act(world, v, { kind: 'hover', tab: 0, nth: waits }, ORIGIN, undefined, mark);
			expect(own).toEqual([tab.name]);
		} finally {
			await world.end();
		}
	});
});
