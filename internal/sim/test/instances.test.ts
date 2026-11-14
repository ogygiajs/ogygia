// Two server instances of one build are two machines: each has its own `Symbol.for` registry
// (src/server.ts `own_symbols`), so ogygia's slots on `globalThis` are each instance's own. They
// once shared one, and the instance loaded last answered for the other's renders: a hole's address
// lost its page facts (`pv=`) on every page the other instance served (seeds 241, 315, 457).
// Needs the palaestra build; skipped without it.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('server instances', () => {
	it('every instance mints the same hole address for the same page', async () => {
		const world = await World.make({
			seed: 1,
			instances: 2,
			builds: [{ id: 'v1', output: OUTPUT }]
		});
		try {
			const seen = new Set<string>();
			for (let i = 0; i < 6; i++) {
				const tab = world.tab(world.visitor(`v${i}`));
				await world.go(tab, 'goto', '/nested-hole');
				const doc = tab.page.mainFrame.document as unknown as Document;
				for (const el of doc.querySelectorAll('ogygia-region[endpoint]'))
					seen.add(el.getAttribute('endpoint')!.replace(/&(exp|sig)=[^&]*/g, ''));
			}
			expect([...seen]).toHaveLength(1);
			expect([...seen][0]).toMatch(/&pv=/);
		} finally {
			await world.end();
		}
	});

	it('a symbol made outside every instance stays the host one', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			expect(Symbol.for('ogygia.test')).toBe(Symbol.for('ogygia.test'));
			expect(Symbol.keyFor(Symbol.for('ogygia.test'))).toBe('ogygia.test');
		} finally {
			await world.end();
		}
	});
});
