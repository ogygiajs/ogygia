// AN OBSERVER ENDS WITH ITS OWNER: an observer still observing once every element it watches has left
// the document (the region that set it up ended, and nothing disconnected it) is the document's
// waste: `tab.orphans()` names it and the waste oracle reports it. One that is disconnected, or that
// still watches an element on the page, is fine. Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';
import { waste } from '../src/waste.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(OUTPUT + '/server/index.js');

describe.skipIf(!built)('an orphaned observer', () => {
	it('is named once every element it watches has left the document', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/');
			await world.quiesce();
			const before = tab.orphans();
			const w = tab.page.mainFrame.window as unknown as Window & typeof globalThis;
			const doc = w.document;
			const make = (id: string) => {
				const el = doc.createElement('div');
				el.id = id;
				doc.body.appendChild(el);
				return el;
			};
			const gone = make('gone');
			const kept = make('kept');
			const done = make('done');
			new w.ResizeObserver(() => {}).observe(gone);
			new w.ResizeObserver(() => {}).observe(kept);
			const off = new w.ResizeObserver(() => {});
			off.observe(done);
			gone.remove();
			done.remove();
			off.disconnect();
			expect(tab.orphans().filter((o) => !before.includes(o))).toEqual([
				'ResizeObserver watching <div id="gone">'
			]);
			expect(waste(world, tab)?.detail).toContain(
				'alive after its owner: ResizeObserver watching <div id="gone">'
			);
		} finally {
			await world.end();
		}
	});
});
