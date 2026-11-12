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
});
