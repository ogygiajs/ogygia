// REST IS REST: the oracles judge a document only once nothing is on the wire. A body stalled after
// its first piece (10 to 40 s) is work in flight: one that outlasted a quiesce's 30 s budget left
// the runtime chunk still coming, and the oracles judged a page whose runtime had not run yet (gen
// 196, seed 16: a layout hole's fallback "stood"). Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('rest', () => {
	it('waits out a stalled body longer than a quiesce budget before the world is at rest', async () => {
		let long_stalls = 0;
		for (let seed = 1; seed <= 30; seed++) {
			const world = await World.make({
				seed,
				builds: [{ id: 'v1', output: OUTPUT }],
				faults: new Set(['stall'])
			});
			try {
				const tab = world.tab(world.visitor('v'));
				const started = world.loop.now;
				await world.go(tab, 'goto', '/');
				await world.rest();
				if (world.loop.now - started > 30_000) long_stalls++;
				expect(world.loop.next_of('net')).toBe(Infinity);
				expect(world.network.unanswered()).toBe(0);
			} finally {
				await world.end();
			}
		}
		// (the case it is for came up: a stall past one quiesce's budget)
		expect(long_stalls).toBeGreaterThan(0);
	}, 120_000);
});
