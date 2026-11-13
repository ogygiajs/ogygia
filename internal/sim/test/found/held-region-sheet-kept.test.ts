// FOUND BY THE SIMULATOR (gen 194, seed 72: mpa-equivalence on /p1 after a click from /p2), here
// with no fault: /p2 holds a styled held region (n8, its sheet a `<link data-ogygia-region-css>`
// inside the baked region), /p1 an unstyled one (n3) in the same place. A router navigation from
// /p2 to /p1 keeps n8's sheet link inside n3's region; a fresh load of /p1 has none.
// (Needs the app built for the simulator: `node src/gen.ts --seed 194`, then
// `pnpm sim:builds --app ../../apps/sim-gen`; skipped otherwise.)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../../src/world.ts';

const APP = fileURLToPath(new URL('../../../../apps/sim-gen', import.meta.url));
const OUTPUT = `${APP}/.svelte-kit/sim-builds/v1`;
const GEN = 194;
const ready = ((): boolean => {
	if (!existsSync(`${OUTPUT}/server/index.js`)) return false;
	const plan = `${APP}/src/lib/gen/plan.json`;
	return existsSync(plan) && JSON.parse(readFileSync(plan, 'utf8')).seed === GEN;
})();

/** The sheet links inside each held region the page shows, by the region's text. */
function held_sheets(tab: { page: { mainFrame: { document: unknown } } }): string[] {
	const doc = tab.page.mainFrame.document as Document;
	return [...doc.querySelectorAll('[data-gen="held-host"] > ogygia-region')].map(
		(r) =>
			`${r.querySelector('span')?.textContent}: ${[
				...r.querySelectorAll(':scope > link[data-ogygia-region-css]')
			]
				.map((l) => l.getAttribute('href'))
				.join(' ')}`
	);
}

describe.skipIf(!ready)(
	"found: a held region's stylesheet stays in the next page's held region",
	() => {
		it('a router navigation shows the held regions of the next page with their own sheets, as a fresh load does', async () => {
			const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
			try {
				const tab = world.tab(world.visitor('v'));
				await world.go(tab, 'goto', '/p1');
				const fresh = held_sheets(tab);
				await world.go(tab, 'goto', '/p2');
				const link = (tab.page.mainFrame.document as unknown as Document).querySelector(
					'nav a[href="/p1"]'
				);
				(link as HTMLElement).click();
				await world.quiesce();
				expect(tab.page.mainFrame.url).toBe('https://app.test/p1');
				expect(held_sheets(tab)).toEqual(fresh);
			} finally {
				await world.end();
			}
		}, 120_000);
	}
);
