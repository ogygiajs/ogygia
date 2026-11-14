// A tab that loses the network tells its document, as a browser does: `navigator.onLine` reads false
// and `offline` fires on its window, then `online` and true once the network is back. The document
// never heard, so a page waiting for the network to come back (#891's fix) waited forever (gen 88,
// seed 88012: an island whose code failed to download in an outage). Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';
import { islands_wake } from '../src/oracles.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('a tab offline', () => {
	it('its document reads navigator.onLine and hears offline, then online', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/');
			const window = tab.page.mainFrame.window as unknown as Window;
			const heard: string[] = [];
			for (const type of ['offline', 'online'])
				window.addEventListener(type, () => heard.push(`${type} ${window.navigator.onLine}`));
			expect(window.navigator.onLine).toBe(true);
			world.network.offline(tab.name, true);
			await world.loop.run(100);
			expect(window.navigator.onLine).toBe(false);
			world.network.offline(tab.name, false);
			await world.loop.run(100);
			expect(window.navigator.onLine).toBe(true);
			expect(heard).toEqual(['offline false', 'online true']);
		} finally {
			await world.end();
		}
	});

	it('owes no island its wake while it is still offline (seed 270754442, /cart-b)', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('v'));
			const send = world.network.send.bind(world.network);
			let dropped = false;
			world.network.send = (realm, request, handler, ended) => {
				if (!dropped && new URL(request.url).pathname.startsWith('/_app/immutable/og-region.')) {
					dropped = true;
					world.network.offline(tab.name, true);
				}
				return send(realm, request, handler, ended);
			};
			await world.go(tab, 'goto', '/cart-b');
			await world.loop.run(5_000);
			const doc = tab.page.mainFrame.document as unknown as Document;
			expect(dropped).toBe(true);
			expect(
				doc.querySelector('ogygia-region[entry][wake="load"]:not([data-hydrated])'),
				'the case it is for: a load island its outage left asleep'
			).not.toBeNull();
			expect(islands_wake(tab, world)).toBeNull();
		} finally {
			await world.end();
		}
	});
});
