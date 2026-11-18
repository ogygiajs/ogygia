// A document the tab has left hears nothing more: a browser calls off its fetches as it unloads it,
// and its code never runs again. A left document's chunk, stalled 31 s, landed while the tab showed
// a third document; its code ran over a closed window and threw, and the simulator counted that as
// the run's uncaught error (gen 192, seed 11). Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);
// (every answer is held 10 to 40 s on the way, so whether the left document's lands before or after
// its tab moves on is the seed's: under seed 41 each is still on the way, and each request draws its
// own fate, so that holds while their names do; each test checks it first)
const SEED = 41;

describe.skipIf(!built)('a document the tab has left', () => {
	it('never hears the answer to a request it made, and holds nothing in flight', async () => {
		const world = await World.make({
			seed: SEED,
			builds: [{ id: 'v1', output: OUTPUT }],
			faults: new Set(['stall']),
			rates: { stall: 1 }
		});
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/');
			await world.quiesce();
			const first = tab.page.mainFrame.window as unknown as Window;
			const heard: string[] = [];
			void first
				.fetch('/?slow')
				.then((r) => r.text())
				.then(
					() => heard.push('answered'),
					() => heard.push('failed')
				);
			// (back to the tab's first entry, `about:blank`: no request, so the document is left at
			// once, before any stalled answer can come; a page of the app's own came after the answer
			// once the seed's draws moved, and the old page rightly heard it)
			await world.go(tab, 'back');
			expect(tab.documents).toBe(2);
			// (its answer was still on the way when the tab left it)
			expect(world.network.exchanges.find((e) => e.url.endsWith('/?slow'))?.status).toBe('aborted');
			await world.loop.run(60_000);
			await world.quiesce();
			expect(heard).toEqual([]);
			expect(world.network.unanswered()).toBe(0);
			expect(world.uncaught).toEqual([]);
		} finally {
			await world.end();
		}
	});

	it('says nothing of a rejection it made while the next document is still on its way', async () => {
		const world = await World.make({
			seed: SEED,
			builds: [{ id: 'v1', output: OUTPUT }],
			faults: new Set(['stall']),
			rates: { stall: 1 }
		});
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/');
			await world.quiesce();
			const first = tab.page.mainFrame.window as unknown as typeof globalThis;
			await world.start(tab, 'reload', '/', 50);
			expect(tab.page.mainFrame.window).not.toBe(first);
			void first.Promise.reject(new first.Error('the left page rejected'));
			await world.loop.run(60_000);
			await world.quiesce();
			expect(world.uncaught).toEqual([]);
			expect(tab.errors.filter((l) => l.includes('the left page rejected'))).toEqual([]);
		} finally {
			await world.end();
		}
	});

	it('is left as the navigation replaces its window: the tab is the next document from then, the realm its download carries, though that download stalls (#2078)', async () => {
		// (seed 3: the reload's own answer is still on the way after the navigation starts)
		const world = await World.make({
			seed: 3,
			builds: [{ id: 'v1', output: OUTPUT }],
			faults: new Set(['stall']),
			rates: { stall: 1 }
		});
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/');
			await world.quiesce();
			const left = tab.realm;
			const first = tab.page.mainFrame.window;
			await world.start(tab, 'reload', '/', 0);
			expect(tab.awaiting, 'the case it is for: its download has not come').toBe(true);
			expect(tab.page.mainFrame.window).not.toBe(first);
			const download = world.network.exchanges.findLast((e) => e.url === 'https://app.test/')!;
			expect(tab.realm).not.toBe(left);
			expect(download.from).toBe(tab.realm);
			const mark = world.loop.log.length;
			await world.loop.run(60_000);
			await world.quiesce();
			expect(tab.awaiting).toBe(false);
			expect(download.from, 'the document that came is the one that asked').toBe(tab.realm);
			expect(
				world.loop.log.slice(mark).filter((l) => l.split(' ')[1] === left),
				'nothing of the left document runs once it is left'
			).toEqual([]);
		} finally {
			await world.end();
		}
	});

	it("says nothing of an import its unload failed, a classic script's or a module's", async () => {
		// (Kit's boot imports its entry files with no catch; the tab went back while one stalled, the
		// unload failed the import, and the left page's rejection reached the host as the run's
		// uncaught error: palaestra seed 20004, /csr-chrome/kit)
		const world = await World.make({
			seed: SEED,
			builds: [{ id: 'v1', output: OUTPUT }],
			faults: new Set(['stall']),
			rates: { stall: 1 }
		});
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/');
			await world.quiesce();
			const doc = tab.page.mainFrame.document as unknown as Document;
			for (const type of ['', 'module']) {
				const s = doc.createElement('script');
				if (type) s.type = type;
				s.textContent = `import('/_app/immutable/left-${type || 'classic'}.js')`;
				doc.body.append(s);
			}
			await world.loop.run(50);
			await world.go(tab, 'back');
			expect(tab.documents).toBe(2);
			// (both downloads were still on the way when the tab left)
			expect(
				world.network.exchanges.filter((e) => e.url.includes('/left-')).map((e) => e.status)
			).toEqual(['aborted', 'aborted']);
			await world.loop.run(60_000);
			await world.quiesce();
			expect(world.uncaught).toEqual([]);
		} finally {
			await world.end();
		}
	});
});
