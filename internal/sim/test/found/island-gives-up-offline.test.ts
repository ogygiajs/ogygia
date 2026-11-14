// FOUND BY THE SIMULATOR (gen 88, seed 88012: the outage flow): an island whose code fails to
// download while the visitor is offline never wakes once the network is back. Its retry under a
// fresh URL fails offline too, the build map's recovery (runtime/entry-locations.ts
// `recover_location`) finds the same file there (HEAD 200), so the error stands and the island ends
// `failed` with `island_load_failed`, its server markup never hydrated. A fresh load hydrates it.
// (#891's island half, still open as #1900: this test is `it.fails` until it is fixed, then a plain
// `it`. Skipped without `OGYGIA_RULES=1 vite build` in apps/palaestra.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('found: an island whose code failed while offline never wakes', () => {
	it.fails('an island whose code failed to download in a short outage wakes once the network is back (#1900)', async () => {
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
			await world.quiesce();
			expect(dropped).not.toBeNull();
			const doc = tab.page.mainFrame.document as unknown as Document;
			const island = [...doc.querySelectorAll('ogygia-region[src]')].find(
				(el) => new URL(el.getAttribute('src')!, 'https://x/').pathname === dropped
			);
			expect(island).toBeDefined();
			expect(island!.hasAttribute('data-hydrated')).toBe(true);
		} finally {
			await world.end();
		}
	}, 120_000);
});
