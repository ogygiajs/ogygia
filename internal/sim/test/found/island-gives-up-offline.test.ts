// FOUND BY THE SIMULATOR (gen 88, seed 88012: the outage flow; #891's island half, #1900): the
// connection drops just as the page asks for an island's code, and comes back 5 s later. The
// island's file and its static dependencies (the modulepreloads, its chunks) fail while offline, and
// the document's module map keeps each failed dependency for the document's life, as Chromium and
// Firefox do. Back online, the island's file under a fresh URL comes, but still imports the failed
// dependency URLs, so no retry can load it: only a reload can (bisect on #1900: the simulator's
// module map turned this up, #1140; no package change). What the page owes is an honest end:
// it says once that it needs a reload, the island ends failed, and nothing is left waiting.
// (Skipped without `OGYGIA_RULES=1 vite build` in apps/palaestra.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('found: an island whose code an outage poisoned', () => {
	it('says once that the page needs a reload, ends the island failed, and leaves nothing waiting', async () => {
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			secret: 'sim-secret'
		});
		try {
			const tab = world.tab(world.visitor('alice'));
			// the connection drops as the first island's code is asked for, for 5 s
			const send = world.network.send.bind(world.network);
			let dropped: string | null = null;
			world.network.send = (realm, request, handler, ended) => {
				const path = new URL(request.url).pathname;
				if (dropped === null && path.startsWith('/_app/immutable/og-region.')) {
					dropped = path;
					world.network.offline(tab.name, true);
				}
				return send(realm, request, handler, ended);
			};
			await world.go(tab, 'goto', '/');
			await world.loop.run(5_000);
			world.network.offline(tab.name, false);
			// a minute online, then at rest
			await world.loop.run(60_000);
			expect(await world.quiesce()).toBe(true);
			expect(dropped).not.toBeNull();
			const doc = tab.page.mainFrame.document as unknown as Document;
			const island = [...doc.querySelectorAll('ogygia-region[src]')].find(
				(el) => new URL(el.getAttribute('src')!, 'https://x/').pathname === dropped
			);
			expect(island).toBeDefined();
			expect(island!.hasAttribute('data-hydrated')).toBe(false);
			const said = tab.console.map((line) => line.split('\n')[0]);
			expect(said.filter((l) => l.includes('/e/chunk_reload_needed'))).toHaveLength(1);
			const entry = encodeURIComponent(island!.getAttribute('entry')!);
			expect(said.some((l) => l.includes(`/e/island_load_failed?entry=${entry}`))).toBe(true);
		} finally {
			await world.end();
		}
	}, 120_000);
});
