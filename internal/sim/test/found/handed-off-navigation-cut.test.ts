// FOUND BY THE SIMULATOR (palaestra, seed 610518297; #2108), 3 actions: the visitor clicks a link,
// the router's build throws (buggify) and it hands the visit to the browser (`location.replace`);
// that document's answer is cut on the way. The browser shows its own error, and nothing escapes:
// happy-dom's `location` rethrew the failure once the page that set it was unloaded, and the run
// counted it as an uncaught error. Once a request's fate stopped reading its file's hash (#2110) no
// seed among 600 met both again, so the scene is set by hand: the point aimed, the answer cut.
// (Skipped without the app built for the simulator.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../../src/world.ts';
import { user_click } from '../../src/workload.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);

describe.skipIf(!existsSync(`${OUTPUT}/server/index.js`))(
	'found: a navigation handed to the browser whose answer is cut',
	() => {
		it('escapes as no uncaught error, and is the tab’s failed navigation', async () => {
			const world = await World.make({
				seed: 1,
				builds: [{ id: 'v1', output: OUTPUT }],
				buggify: { on: 1, fires: 1, aim: ['router.build-throws'] }
			});
			try {
				const tab = world.tab(world.visitor('v'));
				await world.go(tab, 'goto', '/dashboard');
				await world.rest();
				const send = world.network.send.bind(world.network);
				let cut = 0;
				world.network.send = async (realm, request, handler, ended) => {
					const answer = await send(realm, request, handler, ended);
					const u = new URL(request.url);
					if (u.pathname !== '/dashboard/orders' || u.search !== '') return answer;
					cut++;
					const body = new ReadableStream<Uint8Array>({
						start(c) {
							c.enqueue(new TextEncoder().encode('<!doctype html><html><body>'));
							c.error(new TypeError('network error: the stream was cut'));
						}
					});
					return new Response(body, { status: 200, headers: answer.headers });
				};
				const doc = tab.page.mainFrame.document as unknown as Document;
				const link = doc.querySelector('a[href="/dashboard/orders"]');
				expect(link, 'the case it is for: a link the router takes').not.toBeNull();
				user_click(link!);
				await world.loop.run(5_000);
				await world.rest();
				expect(world.fired_in.get(`${tab.name}#1`)?.has('router.build-throws')).toBe(true);
				expect(cut, 'the browser asked for the document itself').toBeGreaterThan(0);
				expect(world.uncaught).toEqual([]);
				expect(tab.errors.some((l) => l.startsWith('navigation: '))).toBe(true);
			} finally {
				await world.end();
			}
		}, 300_000);
	}
);
