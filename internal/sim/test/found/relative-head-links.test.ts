// FOUND BY THE SIMULATOR (palaestra, seed 20004, a guided search; shrunk to 2 actions; the same
// with no fault and buggify off): go to /lab/a, then follow its link to /lab/deep/x (a client
// navigation one level deeper). Kit writes relative asset URLs (`paths.relative`, its default):
// /lab/a's head has `../_app/immutable/assets/og-region.<hash>.css` and `../_app/.../14.<hash>.css`.
// The router keeps those two links across the navigation as they are, and under /lab/deep/x they
// resolve to /lab/_app/..., a file no build has; the links it adds for the next page are written
// absolute. A fresh load of /lab/deep/x links /_app/.... (Skipped without the app built for the
// simulator.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../../src/world.ts';
import { mpa_equivalent } from '../../src/oracles.ts';
import { user_click } from '../../src/workload.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);

describe.skipIf(!existsSync(OUTPUT + '/server/index.js'))(
	'found: a kept head link with a relative URL',
	() => {
		it('still names its file after a client navigation to a deeper path', async () => {
			const world = await World.make({ seed: 2, builds: [{ id: 'v1', output: OUTPUT }] });
			try {
				const v = world.visitor('alice');
				const tab = world.tab(v);
				await world.go(tab, 'goto', '/lab/a');
				await world.quiesce();
				const doc = tab.page.mainFrame.document as unknown as Document;
				user_click(doc.querySelector('a[href$="deep/x"]')!);
				await world.quiesce();
				expect(tab.page.mainFrame.url).toBe('https://app.test/lab/deep/x');
				const now = tab.page.mainFrame.document as unknown as Document;
				const sheets = [...now.head.querySelectorAll('link[rel=stylesheet]')].map(
					(l) => new URL(l.getAttribute('href')!, tab.page.mainFrame.url).pathname
				);
				expect(sheets.filter((p) => !p.startsWith('/_app/'))).toEqual([]);
				expect(await mpa_equivalent(world, v, tab)).toBeNull();
			} finally {
				await world.end();
			}
		}, 300_000);
	}
);
