// The world boots a real built app: the palaestra's home page loads in a simulated tab, its scripts
// run, and the same seed loads it the same way. (Needs `OGYGIA_RULES=1 vite build` in apps/palaestra;
// skipped without the build.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(OUTPUT + '/server/index.js');

async function load(seed: number, path: string) {
	const world = await World.make({ seed, builds: [{ id: 'v1', output: OUTPUT }] });
	try {
		const v = world.visitor('alice');
		const tab = world.tab(v);
		await world.go(tab, 'goto', path);
		const doc = tab.page.mainFrame.document;
		return {
			title: doc.title,
			html: doc.body?.innerHTML.length ?? 0,
			errors: [...tab.errors],
			console: tab.console.slice(0, 5),
			ran: world.loop.ran,
			now: world.loop.now,
			log: world.loop.log.join('\n'),
			exchanges: world.network.exchanges.map((e) => `${e.method} ${e.url} ${e.status}`)
		};
	} finally {
		await world.end();
	}
}

describe.skipIf(!built)('the world, on the palaestra build', () => {
	it('loads a page in a simulated tab, the same way for the same seed', async () => {
		const a = await load(1, '/');
		console.log(JSON.stringify({ ...a, log: a.log.split('\n').slice(0, 30) }, null, 1));
		expect(a.html).toBeGreaterThan(0);
		const b = await load(1, '/');
		expect(b.log).toBe(a.log);
	}, 120_000);
});
