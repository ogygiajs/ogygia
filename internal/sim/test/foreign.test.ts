// A region's request sent to another origin (a `redirect` fault, src/network.ts) never paints what
// that origin answered (INVARIANTS.md HOLE-TRUST; the `no_foreign_html` oracle). Needs the
// palaestra build; skipped without it.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';
import { no_foreign_html } from '../src/oracles.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('foreign HTML', () => {
	it('a deferred region whose request is sent elsewhere paints nothing from there', async () => {
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			faults: new Set(['redirect']),
			rates: { redirect: 1 }
		});
		try {
			const tab = world.tab(world.visitor('alice'));
			await world.go(tab, 'goto', '/server');
			expect(world.network.exchanges.some((e) => e.redirected)).toBe(true);
			expect(no_foreign_html(tab)).toBeNull();
			// (and the oracle sees it when it is there)
			const doc = tab.page.mainFrame.document as unknown as Document;
			doc.body.insertAdjacentHTML('beforeend', '<p data-sim-foreign="">x</p>');
			expect(no_foreign_html(tab)?.oracle).toBe('foreign-html');
		} finally {
			await world.end();
		}
	});
});
