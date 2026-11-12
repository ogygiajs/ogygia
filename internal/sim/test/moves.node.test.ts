// A document's machine moves are heard after it is gone: a hard navigation inside one action (the
// router handing off to the browser, `location.assign`) replaced the document before its moves were
// read, so the steps it took last (a navigation called off, its stage discarded) were never
// counted. Needs the palaestra build (rules on); skipped without it.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(OUTPUT + '/server/index.js');

describe.skipIf(!built)("a document's moves", () => {
	it('are still read once the tab shows the next document', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('alice'));
			await world.go(tab, 'goto', '/');
			const first = tab.realm;
			const before = tab.moves_by.get(first)?.() ?? '';
			await world.go(tab, 'goto', '/');
			expect(tab.realm).not.toBe(first);
			expect(before).not.toBe('');
			expect(tab.moves_by.get(first)?.()).toBe(before);
		} finally {
			await world.end();
		}
	});
});
