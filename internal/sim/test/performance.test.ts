// Each document of a simulated tab has its own `performance`, as in a browser: its own clock from
// its navigation's start, and its navigation timing entry (src/platform.ts). Needs the palaestra
// build; skipped without it.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

type Perf = Performance & { getEntriesByType(t: 'navigation'): PerformanceNavigationTiming[] };

describe.skipIf(!built)("a document's performance", () => {
	// DST agent 29: happy-dom hands every window Node's one `performance`, and the simulator set its
	// `now` per document, so every tab (and the server) read the newest document's clock
	it('is its own per document, its clock from its own navigation', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const v = world.visitor('alice');
			const a = world.tab(v);
			await world.go(a, 'goto', '/');
			const b = world.tab(v);
			await world.go(b, 'goto', '/');
			const perf = (t: typeof a) =>
				(t.page.mainFrame.window as unknown as { performance: Perf }).performance;
			expect(perf(a)).not.toBe(perf(b));
			expect(perf(a)).not.toBe(globalThis.performance);
			// (a's document began first: its clock reads more, and its origin is earlier)
			expect(perf(a).now()).toBeGreaterThan(perf(b).now());
			expect(perf(a).timeOrigin).toBeLessThan(perf(b).timeOrigin);
			expect(perf(a).timeOrigin + perf(a).now()).toBe(perf(b).timeOrigin + perf(b).now());
		} finally {
			await world.end();
		}
	});

	// DST agent 29: `getEntriesByType('navigation')` was empty, so schedule.ts never read when
	// DOMContentLoaded ended (mutant schedule 281 could not be reached)
	it('has a navigation entry: the document, its kind, and when its events ended', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('alice'));
			const nav = () =>
				(tab.page.mainFrame.window as unknown as { performance: Perf }).performance
					.getEntriesByType('navigation')
					.slice();
			await world.go(tab, 'goto', '/');
			const [first] = nav();
			expect(nav()).toHaveLength(1);
			expect(first.entryType).toBe('navigation');
			expect(first.name).toBe('https://app.test/');
			expect(first.type).toBe('navigate');
			expect(first.startTime).toBe(0);
			expect(first.domInteractive).toBeGreaterThan(0);
			expect(first.domContentLoadedEventStart).toBeGreaterThanOrEqual(first.domInteractive);
			expect(first.domContentLoadedEventEnd).toBeGreaterThanOrEqual(
				first.domContentLoadedEventStart
			);
			expect(first.domComplete).toBeGreaterThanOrEqual(first.domContentLoadedEventEnd);
			expect(first.loadEventEnd).toBeGreaterThanOrEqual(first.loadEventStart);
			expect(first.loadEventStart).toBeGreaterThanOrEqual(first.domComplete);
			expect(first.duration).toBe(first.loadEventEnd);
			await world.go(tab, 'reload');
			expect(nav()[0].type).toBe('reload');
		} finally {
			await world.end();
		}
	});
});
