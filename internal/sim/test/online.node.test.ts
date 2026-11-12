// A tab that loses the network tells its document, as a browser does: `navigator.onLine` reads false
// and `offline` fires on its window, then `online` and true once the network is back. The document
// never heard, so a page waiting for the network to come back (#891's fix) waited forever (gen 88,
// seed 88012: an island whose code failed to download in an outage). Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

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
});
