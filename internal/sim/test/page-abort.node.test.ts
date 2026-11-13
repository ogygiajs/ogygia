// A page's fetch it calls off (an AbortSignal) is called off on the wire, as a browser's is: the
// request never reaches the server, or the server hears its request called off, and the body stops
// coming. The page's signal never reached the network, so a hole's fetch its region let go as it
// left the page downloaded its answer anyway, and the waste oracle counted the hole asked twice when
// the visitor came back (palaestra seed 99 with crowds). Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)("a page's fetch it calls off", () => {
	it('is called off on the wire, and the page hears an AbortError', async () => {
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			faults: new Set(['stall']),
			rates: { stall: 1 }
		});
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/');
			await world.rest();
			const window = tab.page.mainFrame.window as unknown as Window & typeof globalThis;
			const called_off = new window.AbortController();
			const heard = window
				.fetch('/?called-off', { signal: called_off.signal })
				.then((r) => r.text())
				.then(
					() => 'answered',
					(e: Error) => e.name
				);
			// (its answer is held 10 to 40 s on the way, its head or its body: the page calls it off
			// while it waits)
			await world.loop.run(1_000);
			const ex = world.network.exchanges.find((e) => e.url.endsWith('/?called-off'));
			expect(ex).toBeDefined();
			called_off.abort();
			await world.loop.run(60_000);
			expect(await heard).toBe('AbortError');
			expect(world.network.unanswered()).toBe(0);
			expect(world.network.busy()).toBe(false);
		} finally {
			await world.end();
		}
	}, 120_000);

	it("a document's answer held over 30 s still lands: a browser has no 30 s navigation deadline", async () => {
		// (happy-dom calls a navigation off after 30 s: once its signal reached the network, a page
		// stalled 31 s never landed; palaestra's superseded-navigation test, seed 1)
		for (let seed = 1; seed <= 10; seed++) {
			const world = await World.make({
				seed,
				builds: [{ id: 'v1', output: OUTPUT }],
				faults: new Set(['stall']),
				rates: { stall: 1 }
			});
			try {
				const tab = world.tab(world.visitor('v'));
				void world.browsers.navigate(tab, 'goto', '/plain');
				await world.loop.run(60_000);
				await world.quiesce();
				const doc = tab.page.mainFrame.document as unknown as Document;
				expect(doc.querySelector('h1')?.textContent, `seed ${seed}`).toBeTruthy();
				expect([...tab.errors], `seed ${seed}`).toEqual([]);
			} finally {
				await world.end();
			}
		}
	}, 300_000);
});
