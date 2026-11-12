// A document's own console (src/browser.ts) runs every method of the page's console: an island that
// logs as it is pressed says nothing to the sim but what it logged. Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';
import { buttons } from '../src/workload.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(OUTPUT + '/server/index.js');

describe.skipIf(!built)("a document's console", () => {
	it('an island that logs as it is pressed hydrates and runs (seed 286)', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('alice'));
			await world.go(tab, 'goto', '/');
			const button = buttons(tab).find((b) => (b.textContent ?? '').startsWith('clicked'))!;
			button.click();
			await world.quiesce();
			expect([...tab.errors, ...tab.console.filter((l) => l.startsWith('error:'))]).toEqual([]);
		} finally {
			await world.end();
		}
	});
});
