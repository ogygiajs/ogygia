// A navigation the tab started again elsewhere is called off: a browser cancels the older one, and
// its document never comes. happy-dom let it land: the first page's body, stalled 33 s, was
// written over the page the visitor had gone to since, under the first page's URL, while that
// page's router still ran (palaestra seed 122: `rule_address_bar_drift`). Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('a navigation the tab started again elsewhere', () => {
	it('never lands: the tab shows the page it went to since, at its own URL, and says nothing', async () => {
		// (half the answers are held 10 to 40 s on the way: in some seeds the first page's is still
		// coming when the visitor goes elsewhere 1 s in, and comes after the second page is in)
		for (let seed = 1; seed <= 30; seed++) {
			const world = await World.make({
				seed,
				builds: [{ id: 'v1', output: OUTPUT }],
				faults: new Set(['stall']),
				rates: { stall: 0.5 }
			});
			try {
				const tab = world.tab(world.visitor('v'));
				void world.browsers.navigate(tab, 'goto', '/');
				await world.loop.run(1_000);
				await world.go(tab, 'goto', '/remote-seed-gate/prerender');
				await world.loop.run(60_000);
				await world.quiesce();
				const window = tab.page.mainFrame.window as unknown as Window;
				expect(window.location.pathname, `seed ${seed}`).toBe('/remote-seed-gate/prerender');
				expect(window.document.querySelector('h1')?.textContent, `seed ${seed}`).toBe(
					'prerender remote, lake only'
				);
				expect([...tab.errors], `seed ${seed}`).toEqual([]);
			} finally {
				await world.end();
			}
		}
	}, 300_000);

	// Its answer came, but the visitor went on before the first frame wrote it into the document,
	// and the next page's answer was slower than that frame: happy-dom wrote the first page into
	// the next page's window, under the next page's URL, where its relative files (`./_app/…`) were
	// asked at the wrong depth (palaestra seed 208640329, #1993).
	it('whose answer came but was not written yet never lands in the next document', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/plain');
			const shown = tab.documents;
			void world.browsers.navigate(tab, 'goto', '/router-depth/a/b/c');
			while (tab.documents === shown) await world.loop.step();
			// (/mixed's server load takes over 2 s)
			void world.browsers.navigate(tab, 'goto', '/mixed');
			await world.loop.run(500);
			const window = (): Window => tab.page.mainFrame.window as unknown as Window;
			expect(window().location.pathname).toBe('/mixed');
			expect(window().document.querySelector('h1')?.textContent).not.toBe('Deep page');
			await world.rest();
			expect(window().location.pathname).toBe('/mixed');
			const fresh = world.tab(world.visitor('fresh'));
			await world.go(fresh, 'goto', '/mixed');
			await world.rest();
			const h1 = (t: typeof tab) =>
				(t.page.mainFrame.document as unknown as Document).querySelector('h1')?.textContent;
			expect(h1(tab)).toBe(h1(fresh));
			expect([...tab.errors]).toEqual([...fresh.errors]);
		} finally {
			await world.end();
		}
	}, 300_000);

	// The page's own navigation (the router handing a click to the browser: `location.assign`) is
	// called off the same way, and it never was an entry: back goes back from the page on screen.
	// happy-dom kept its entry and let its stalled body land on the back's document, under its URL
	// (palaestra seed 20958: `rule_address_bar_drift`, the bar on /forms, the router on /server).
	it('the page started: back goes back from the page on screen, and the called-off page never lands', async () => {
		for (let seed = 1; seed <= 30; seed++) {
			const world = await World.make({
				seed,
				builds: [{ id: 'v1', output: OUTPUT }],
				faults: new Set(['stall']),
				rates: { stall: 0.5 }
			});
			try {
				const v = world.visitor('v');
				const tab = world.tab(v);
				await world.go(tab, 'goto', '/plain', 120_000);
				await world.go(tab, 'goto', '/forms', 120_000);
				const shown = tab.documents;
				const window = (): Window => tab.page.mainFrame.window as unknown as Window;
				window().location.assign('/remote-seed-gate/prerender');
				await world.loop.run(1_000);
				// (its document came within the second: an entry now, and back goes back to /forms)
				const came = tab.documents > shown;
				await world.go(tab, 'back', '/', 120_000);
				await world.loop.run(60_000);
				await world.quiesce();
				const path = came ? '/forms' : '/plain';
				expect(window().location.pathname, `seed ${seed}`).toBe(path);
				const fresh = world.tab(world.visitor('fresh'));
				await world.go(fresh, 'goto', path, 120_000);
				const h1 = (t: typeof tab) =>
					(t.page.mainFrame.document as unknown as Document).querySelector('h1')?.textContent;
				expect(h1(tab), `seed ${seed}`).toBe(h1(fresh));
				expect([...tab.errors], `seed ${seed}`).toEqual([]);
			} finally {
				await world.end();
			}
		}
	}, 600_000);
});
