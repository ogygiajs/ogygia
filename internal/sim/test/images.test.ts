// A page's images load over the simulated network, as a browser's do: an image not yet come is not
// `complete`, and its load (or error) fires as a task of the page. happy-dom loads none by default,
// so every image read complete at once, and the critical wait (an incomplete
// `img[fetchpriority=high]`) was never seen: its `fresh -> waiting` step no run reached.
// Needs the palaestra build; skipped without it.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('a page image', () => {
	it('loads over the network, and is not complete until it comes', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('alice'));
			const asked: string[] = [];
			const send = world.network.send.bind(world.network);
			world.network.send = (from, request, route) => {
				const path = new URL(request.url).pathname;
				if (path.endsWith('.png')) asked.push(path);
				return send(from, request, route);
			};
			await world.start(tab, 'goto', '/load-scheduler', 0);
			const doc = tab.page.mainFrame.document as unknown as Document;
			const hero = doc.querySelector<HTMLImageElement>('img[data-hero]')!;
			expect(hero.complete).toBe(false);
			let loaded = false;
			hero.addEventListener('load', () => (loaded = true));
			await world.quiesce();
			expect(asked).toEqual(['/load-scheduler-hero.png']);
			expect(hero.complete).toBe(true);
			expect(loaded).toBe(true);
		} finally {
			await world.end();
		}
	});
});
