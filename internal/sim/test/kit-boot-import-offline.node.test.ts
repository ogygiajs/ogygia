// A Kit page whose own boot import (an entry or a route node) failed during an outage is Kit's
// to recover, and Kit never does: a browser keeps a failed module failed, and Kit shows its 500
// page until a reload. The outage-recovery check sets such a document aside, as it does one whose
// script failed (palaestra seed 320517053: /ctx-setcontext-kit/plain, a 1 s outage 100 ms in, #2005).
// Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';
import { outage_only } from '../src/oracles.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);

describe.skipIf(!existsSync(`${OUTPUT}/server/index.js`))(
	'a Kit boot import an outage failed',
	() => {
		it('sets its document aside: Kit, not ogygia, owes the page, and only a reload brings it', async () => {
			// (the outage starts at each moment of Kit's start: its entry files, then its route nodes)
			const kit_failed =
				/Failed to fetch dynamically imported module: \S*\/_app\/immutable\/(entry|nodes)\//;
			let seen = 0;
			for (let ms = 0; ms <= 15; ms++) {
				const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
				try {
					const tab = world.tab(world.visitor('v'));
					await world.start(tab, 'goto', '/ctx-setcontext-kit/plain', ms);
					world.network.offline(tab.name, true);
					await world.loop.run(1_000);
					world.network.offline(tab.name, false);
					await world.rest();
					if (![...tab.errors, ...tab.console].some((l) => kit_failed.test(l))) continue;
					seen++;
					expect(outage_only(world, tab), `outage ${ms} ms in`).toBe(false);
				} finally {
					await world.end();
				}
			}
			expect(seen, 'an outage that failed a Kit boot import').toBeGreaterThan(0);
		}, 300_000);
	}
);
