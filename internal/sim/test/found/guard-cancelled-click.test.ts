// FOUND BY THE SIMULATOR (palaestra, seed 208640584, shrunk to 4 actions; #1994): on /soft-race the
// visitor clicks the link to /soft-race/blocked, whose navigation guard (lib/BlockedLinkGuard.svelte)
// cancels it and counts the cancel. The count is the visitor's own doing, as a press's is: a fresh
// load of /soft-race shows 0, and the page is not to be judged unequal for it. (Skipped without the
// app built for the simulator.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../../src/world.ts';
import { mpa_equivalent } from '../../src/oracles.ts';
import { user_click } from '../../src/workload.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);

describe.skipIf(!existsSync(`${OUTPUT}/server/index.js`))(
	'found: a click a navigation guard cancelled',
	() => {
		it('leaves the page equal to a fresh load, its guard count set aside as the visitor’s', async () => {
			const world = await World.make({ seed: 2, builds: [{ id: 'v1', output: OUTPUT }] });
			try {
				const v = world.visitor('alice');
				const tab = world.tab(v);
				await world.go(tab, 'goto', '/soft-race');
				await world.quiesce();
				const doc = tab.page.mainFrame.document as unknown as Document;
				user_click(doc.querySelector('a[href$="/soft-race/blocked"]')!);
				await world.quiesce();
				expect(tab.page.mainFrame.url).toBe('https://app.test/soft-race');
				const now = tab.page.mainFrame.document as unknown as Document;
				expect(
					now.querySelector('[data-guard-cancelled]')?.getAttribute('data-guard-cancelled')
				).toBe('1');
				expect(await mpa_equivalent(world, v, tab)).toBeNull();
			} finally {
				await world.end();
			}
		}, 300_000);
	}
);
