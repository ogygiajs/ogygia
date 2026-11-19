// A hard navigation whose document never fully comes fails in the browser, not in a page: the
// browser shows its own error in place of the page, and the page that started it is gone by then.
// happy-dom's `location` rethrows the failure once the page that set it was unloaded, so a
// router's hand-off to the browser (`location.replace`) whose answer was cut reached the host as
// the run's uncaught error (palaestra seed 610518297, #2108). Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('a hard navigation whose document is cut on the way', () => {
	for (const how of ['replace', 'assign'] as const)
		it(`started by the page (location.${how}) is the tab's failed navigation, never an error that escapes`, async () => {
			const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
			try {
				const tab = world.tab(world.visitor('v'));
				await world.go(tab, 'goto', '/');
				await world.rest();
				const send = world.network.send.bind(world.network);
				world.network.send = async (realm, request, handler, ended) => {
					const answer = await send(realm, request, handler, ended);
					if (new URL(request.url).pathname !== '/plain') return answer;
					const head = new TextEncoder().encode('<!doctype html><html><body>');
					const body = new ReadableStream<Uint8Array>({
						start(c) {
							c.enqueue(head);
							c.error(new TypeError('network error: the stream was cut'));
						}
					});
					return new Response(body, { status: 200, headers: answer.headers });
				};
				const window = tab.page.mainFrame.window as unknown as Window;
				window.location[how]('/plain');
				await world.loop.run(5_000);
				await world.rest();
				expect(world.uncaught).toEqual([]);
				expect(tab.errors.filter((l) => l.startsWith('navigation: '))).toEqual([
					'navigation: Failed to read response body. Error: network error: the stream was cut.'
				]);
			} finally {
				await world.end();
			}
		});
});
