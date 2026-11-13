// Safari has no `requestIdleCallback`: a page that waits for an idle moment takes its own fallback
// there (an `idle` island wakes after a short pause, core.ts `#on_idle`). Some seeds' engine is
// Safari's (stream `idle engine`), so that fallback runs too: a mutant that dropped it survived
// every run, where the engine always had idle callbacks. Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rng } from '../src/rng.ts';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)("an engine's idle callbacks", () => {
	it('a document of an engine without them has no requestIdleCallback, and one with them has it', async () => {
		for (const idle of [false, true]) {
			const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }], idle });
			try {
				const tab = world.tab(world.visitor('v'));
				await world.go(tab, 'goto', '/');
				const window = tab.page.mainFrame.window as unknown as Record<string, unknown>;
				expect('requestIdleCallback' in window).toBe(idle);
				expect('cancelIdleCallback' in window).toBe(idle);
			} finally {
				await world.end();
			}
		}
	});

	it('about a third of seeds draw an engine without them', () => {
		const without = Array.from({ length: 300 }, (_, s) =>
			rng(s).fork('idle engine').chance(0.3)
		).filter(Boolean).length;
		expect(without).toBeGreaterThan(60);
		expect(without).toBeLessThan(120);
	});
});
