// FOUND BY THE SIMULATOR (palaestra, seed 20004, a guided search; shrunk to 2 actions, no network
// fault, the same with buggify off): go to /props-tail/b, then follow its link to /props-tail (a
// client navigation). The kept island (`keep: 'tally-keeper'`) crosses with its props pushed from
// the next page, but its `data-og-fp` stays page B's: a fresh load of /props-tail has another
// fingerprint there. The router names the islands a page holds by that attribute
// (`x-ogygia-known`). (Skipped without the app built for the simulator.)
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
	"found: a kept island keeps the last page's fingerprint",
	() => {
		it('after a navigation a kept island carries the fingerprint a fresh load gives', async () => {
			const world = await World.make({ seed: 2, builds: [{ id: 'v1', output: OUTPUT }] });
			try {
				const v = world.visitor('alice');
				const tab = world.tab(v);
				await world.go(tab, 'goto', '/props-tail/b');
				await world.quiesce();
				const doc = tab.page.mainFrame.document as unknown as Document;
				user_click(doc.querySelector('a[data-to-a]')!);
				await world.quiesce();
				expect(tab.page.mainFrame.url).toBe('https://app.test/props-tail');
				expect(tab.documents).toBe(1); // (a client navigation)
				expect(await mpa_equivalent(world, v, tab)).toBeNull();
			} finally {
				await world.end();
			}
		}, 300_000);
	}
);
