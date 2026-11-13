// A hole the endpoint answers "later" (`hole.answer-later`, a 429) tries again after its wait, and its
// answer stands: the point fires at most twice in a document, so no hole's three tries all come back
// later, and a hole on its fallback at rest is a retry that broke, never a give-up the point caused
// (gen 191, seeds 2-8: three 429s in a row gave up on n37, and fallback_stands could not tell that
// from a hole that never asks again). Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fallback_stands } from '../src/oracles.ts';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('a hole answered later', () => {
	it('fires at most twice in a document, so every hole that asks again answers', async () => {
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			buggify: { on: 1, fires: 1, aim: ['hole.answer-later'] }
		});
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/defer-timing');
			await world.quiesce();
			await world.loop.run(60_000);
			await world.quiesce();
			expect(world.buggified.get('hole.answer-later')?.fired).toBe(2);
			const doc = tab.page.mainFrame.document as unknown as Document;
			expect(doc.querySelector('[data-fallback-idle]')).toBe(null);
			expect(fallback_stands(tab, world)).toBe(null);
		} finally {
			await world.end();
		}
	});
});
