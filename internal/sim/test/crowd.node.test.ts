// A CROWD: other visitors, each with a browser, cookies and client address of their own, open a page
// over a spread of time, so their requests reach the servers among each other's and the visitor's
// (a postrender store's first render, a render cache, a per-client rate limit). Their tabs stay on
// the page, and the run judges them as it does the visitor's. Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';
import { act } from '../src/workload.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('a crowd', () => {
	it('opens the page in browsers of its own, from addresses of its own, over its spread', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const v = world.visitor('visitor');
			const tab = world.tab(v);
			await world.go(tab, 'goto', '/');
			const start = world.loop.now;
			await act(world, v, { kind: 'crowd', path: '/', n: 3, spread: 400 }, 'https://app.test');
			// (the visitor's own tabs are as they were)
			expect(v.tabs).toEqual([tab]);
			const crowd = world.crowd.flatMap((c) => c.tabs);
			expect(crowd).toHaveLength(3);
			expect(new Set(world.crowd.map((c) => c.browser)).size).toBe(3);
			for (const t of crowd) expect(t.page.mainFrame.url).toBe('https://app.test/');
			// (each one's page request, sent over the spread, from its own address)
			const pages = world.network.exchanges.filter(
				(e) => e.url === 'https://app.test/' && crowd.some((t) => e.from.startsWith(`${t.name}#`))
			);
			expect(pages).toHaveLength(3);
			const at = pages.map((e) => e.at - start);
			expect(Math.max(...at) - Math.min(...at)).toBeGreaterThanOrEqual(400);
			expect(new Set(pages.map((e) => e.address)).size).toBe(3);
			expect(pages.every((e) => e.address !== '10.0.0.1')).toBe(true);
		} finally {
			await world.end();
		}
	}, 60_000);
});
