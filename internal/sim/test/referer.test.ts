// A page's request says the page it came from (`Referer`), as a browser's does under its default
// policy (strict-origin-when-cross-origin: the whole address to its own origin). happy-dom adds it
// after the interceptor the simulator answers from, so a hole's request reached the server with no
// page, and every region rendered outside its page read empty page data (gen 149, seed 149002).
// Needs the palaestra build; skipped without it.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('a page request', () => {
	it('says the page it came from', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('alice'));
			await world.go(tab, 'goto', '/');
			const seen: Array<string | null> = [];
			const send = world.network.send.bind(world.network);
			world.network.send = (from, request, route) => {
				if (new URL(request.url).pathname === '/robots.txt')
					seen.push(request.headers.get('referer'));
				return send(from, request, route);
			};
			const w = tab.page.mainFrame.window as unknown as { fetch(u: string): Promise<Response> };
			// (its answer is a task of the loop: the world runs it)
			const got = w
				.fetch('/robots.txt')
				.then((r) => r.text())
				.catch(() => undefined);
			await world.quiesce();
			await got;
			expect(seen).toEqual(['https://app.test/']);
		} finally {
			await world.end();
		}
	});
});
