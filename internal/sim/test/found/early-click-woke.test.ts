// FOUND BY THE SIMULATOR (palaestra, seed 824072722; #2088): on /portable-snippet the visitor
// clicks the link inside the portable bar's island while its code is still on its way. The wake's
// early-input capture takes the click, wakes the island at once and marks how it woke
// (`data-og-woke="interaction"`). How a region woke is the visit's own record, as a guard's count of
// cancelled clicks is: a fresh load at rest wakes it on its schedule, with no mark, and the page is
// not to be judged unequal for it. (Skipped without the app built for the simulator.)
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
	'found: a click that woke an island before its schedule did',
	() => {
		it('leaves the page equal to a fresh load, its wake mark set aside as the visit’s', async () => {
			const world = await World.make({ seed: 2, builds: [{ id: 'v1', output: OUTPUT }] });
			try {
				const v = world.visitor('alice');
				const tab = world.tab(v);
				// the visitor clicks the bar's link as the bar's island code is asked for
				const send = world.network.send.bind(world.network);
				let clicked = false;
				world.network.send = (realm, request, handler, ended) => {
					const doc = tab.page.mainFrame.document as unknown as Document;
					const bar = doc.querySelector('ogygia-region:has(> [data-portable-bar])');
					const src = bar?.getAttribute('src');
					if (
						!clicked &&
						src &&
						new URL(request.url).pathname === new URL(src, 'https://app.test/').pathname
					) {
						clicked = true;
						user_click(bar!.querySelector('a[data-gh]')!);
					}
					return send(realm, request, handler, ended);
				};
				await world.go(tab, 'goto', '/portable-snippet');
				await world.quiesce();
				expect(clicked).toBe(true);
				const doc = tab.page.mainFrame.document as unknown as Document;
				const bar = doc.querySelector('ogygia-region:has(> [data-portable-bar])')!;
				expect(bar.getAttribute('data-og-woke')).toBe('interaction');
				expect(bar.hasAttribute('data-hydrated')).toBe(true);
				expect(await mpa_equivalent(world, v, tab)).toBeNull();
			} finally {
				await world.end();
			}
		}, 300_000);
	}
);
