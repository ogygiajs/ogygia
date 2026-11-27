// REST IS REST: the oracles judge a document only once nothing is on the wire. A body stalled after
// its first piece (10 to 40 s) is work in flight: one that outlasted a quiesce's 30 s budget left
// the runtime chunk still coming, and the oracles judged a page whose runtime had not run yet (gen
// 196, seed 16: a layout hole's fallback "stood"). Needs the palaestra build.
import { existsSync, readFileSync } from 'node:fs';
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

	it('does not wait on a live answer that keeps coming: one quiesce budget, then rest', async () => {
		// (a live query's body never ends, and a piece of it is on the wire most of the time: rest
		// waited budget after budget, once to the run's horizon, and the MPA check's fresh load was
		// cut off there; palaestra seed 20003, /data's LiveClock)
		const took: number[] = [];
		for (const seed of [1, 2, 4, 8]) {
			const world = await World.make({
				seed,
				builds: [{ id: 'v1', output: OUTPUT }],
				faults: new Set(['delay']),
				horizon: 600_000
			});
			try {
				const tab = world.tab(world.visitor('v'));
				await world.go(tab, 'goto', '/data');
				const from = world.loop.now;
				await world.rest();
				took.push(world.loop.now - from);
			} finally {
				await world.end();
			}
		}
		for (const ms of took) expect(ms).toBeLessThanOrEqual(31_000);
	}, 120_000);

	it('names a request a hold still keeps when it gives up at the horizon: a test that never let one go fails at that rest, not at World.end', async () => {
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			horizon: 60_000
		});
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/');
			world.network.hold((url) => url.pathname === '/never-let-go');
			const w = tab.page.mainFrame.window as unknown as Window;
			void w.fetch('/never-let-go').catch(() => {});
			await expect(world.rest()).rejects.toThrow(
				/a hold still keeps https:\/\/app\.test\/never-let-go/
			);
		} finally {
			await world.end();
		}
	}, 120_000);

	it('names a request a hold still keeps when it gives up at the horizon while ticks keep the pages from rest: the request asked after its quiesce gave up', async () => {
		const horizon = 60_000;
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }], horizon });
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/');
			await world.loop.run(horizon - 31_500 - world.loop.now);
			world.network.hold((url) => url.pathname === '/never-let-go');
			const w = tab.page.mainFrame.window as unknown as Window;
			// (a tick every 100 ms: no quiesce rests, nor are the pages quiet between ticks)
			w.setInterval(() => {}, 100);
			// (asked once the quiesce's 30 s budget ended, before the horizon)
			w.setTimeout(() => void w.fetch('/never-let-go').catch(() => {}), 30_800);
			await expect(world.rest()).rejects.toThrow(
				/a hold still keeps https:\/\/app\.test\/never-let-go/
			);
		} finally {
			await world.end();
		}
	}, 120_000);

	it('the world ending fails a request a hold still keeps', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		const tab = world.tab(world.visitor('v'));
		await world.go(tab, 'goto', '/');
		world.network.hold((url) => url.pathname === '/never-let-go');
		const w = tab.page.mainFrame.window as unknown as Window;
		const heard = w.fetch('/never-let-go').then(
			() => 'answered',
			(e: unknown) => (e instanceof Error ? e.message : String(e))
		);
		await world.loop.run(1_000);
		await world.end();
		const never = new Promise((done) => setTimeout(() => done('never settled'), 1_000));
		expect(await Promise.race([heard, never])).toMatch(/Failed to fetch/);
	}, 120_000);
});

// (the generated app of seed 8: /p3's live regions tick for good, and their ticks put islands in)
const GEN_APP = fileURLToPath(new URL('../../../apps/sim-gen', import.meta.url));
const GEN_OUTPUT = `${GEN_APP}/.svelte-kit/sim-builds/v1`;
const gen_8 =
	existsSync(`${GEN_OUTPUT}/server/index.js`) &&
	existsSync(`${GEN_APP}/src/lib/gen/plan.json`) &&
	JSON.parse(readFileSync(`${GEN_APP}/src/lib/gen/plan.json`, 'utf8')).seed === 8;

describe.skipIf(!gen_8)('rest, between live ticks', () => {
	it('judges a page whose live regions tick between their ticks, not while one is still taken in', async () => {
		// (a quiesce a live answer keeps busy ends at its budget, wherever that falls: once a few ms
		// after a tick put an island in, still waiting for its hydrate turn, and the stuck oracle
		// saw it `waking`; gen 8, seed 72 with a crowd. Each rest here starts 37 ms later in the
		// ticks' cycle than the one before.)
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: GEN_OUTPUT }],
			secret: 'sim-secret',
			horizon: 10_000_000
		});
		const busy: string[] = [];
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/p3');
			for (let i = 0; i < 40; i++) {
				await world.loop.run(37);
				await world.rest();
				const soon = world.loop
					.queued()
					.filter((t) => t.realm === tab.realm && t.at <= world.loop.now + 200);
				if (soon.length) busy.push(`rest ${i}: ${soon.map((t) => t.label).join(', ')}`);
			}
		} finally {
			await world.end();
		}
		expect(busy).toEqual([]);
	}, 300_000);
});
