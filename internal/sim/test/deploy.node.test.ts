// A deploy's files: a host that keeps every release's content-hashed files serves an old page's
// file after the deploy, and a load pinned to the new build (the MPA check's fresh load) gets it
// too. A pinned load once asked the new build for the old one's file and got a 404 no host that
// keeps old files gives (gen 65, seed 25: a stored copy of the old release's page).
// Needs the palaestra's two builds (`pnpm sim:builds`); skipped without them.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { builds_of } from '../src/builds.ts';
import { World } from '../src/world.ts';

const APP = fileURLToPath(new URL('../../../apps/palaestra', import.meta.url));
const builds = builds_of(APP);

describe.skipIf(builds.length === 0)('a deploy that keeps old files', () => {
	it("a load pinned to the new build still gets the old release's file", async () => {
		const world = await World.make({
			seed: 1,
			builds,
			rollover: { window: 0, old_files: true, purge: true }
		});
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/');
			const doc = tab.page.mainFrame.document as unknown as Document;
			await world.deploy_next();
			const v2 = world.servers.get('v2')![0];
			const old = [...doc.querySelectorAll('script[src], link[href]')]
				.map(
					(el) => new URL(el.getAttribute('src') ?? el.getAttribute('href')!, 'https://x/').pathname
				)
				.find((p) => p.startsWith('/_app/immutable/') && !v2.serves(p));
			expect(old).toBeDefined();
			const status = (from: string) =>
				world.network.exchanges.filter((e) => e.from === from && e.url.endsWith(old!)).at(-1)
					?.status;
			const plain = world.tab(world.visitor('w'));
			await world.go(plain, 'goto', old!);
			expect(status(plain.realm)).toBe(200);
			const pinned = world.tab(world.visitor('x'));
			await world.as_of('v2', () => world.go(pinned, 'goto', old!));
			expect(status(pinned.realm)).toBe(200);
		} finally {
			await world.end();
		}
	});
});

describe.skipIf(builds.length === 0)('a deploy that drops old files', () => {
	// (gen 63: an old page's hole answered by the new build holds the new build's island; the fresh
	// load, pinned to the old build, asked it for the new loader, got a 404 and ran the old one)
	it("a load pinned to the old build still gets the live build's file", async () => {
		const world = await World.make({
			seed: 1,
			builds,
			rollover: { window: 0, old_files: false, purge: true }
		});
		try {
			await world.deploy_next();
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/');
			const doc = tab.page.mainFrame.document as unknown as Document;
			const v1 = world.servers.get('v1')![0];
			const added = [...doc.querySelectorAll('script[src], link[href]')]
				.map(
					(el) => new URL(el.getAttribute('src') ?? el.getAttribute('href')!, 'https://x/').pathname
				)
				.find((p) => p.startsWith('/_app/immutable/') && !v1.serves(p));
			expect(added).toBeDefined();
			const pinned = world.tab(world.visitor('x'));
			await world.as_of('v1', () => world.go(pinned, 'goto', added!));
			const got = world.network.exchanges
				.filter((e) => e.from === pinned.realm && e.url.endsWith(added!))
				.at(-1)?.status;
			expect(got).toBe(200);
		} finally {
			await world.end();
		}
	});
});
