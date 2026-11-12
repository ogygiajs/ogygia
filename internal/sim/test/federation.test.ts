// Federation in the world: examples/mfe's shell at app.test, its cms and dash teams as peers at
// their own origins (`WorldOptions.peers`), signed hops server to server over the simulated
// network, and a peer's island loaded by the shell's page from the peer's origin. (Skipped
// without the three apps built: `pnpm turbo run build --filter=mfe-shell...` and the cms, dash.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { key_pair } from '../src/keys.ts';
import { rng } from '../src/rng.ts';
import { ORIGIN, World } from '../src/world.ts';

const MFE = fileURLToPath(new URL('../../../examples/mfe', import.meta.url));
const output = (app: string) => `${MFE}/${app}/.svelte-kit/output`;
const built = ['shell', 'cms', 'dash'].every((a) => existsSync(`${output(a)}/server/index.js`));

async function mfe(): Promise<World> {
	const r = rng(1).fork('keys');
	const [shell, cms, dash] = [key_pair(r), key_pair(r), key_pair(r)];
	const common = {
		SHELL_PUBLIC_KEY: shell.pub,
		CMS_PUBLIC_KEY: cms.pub,
		DASH_PUBLIC_KEY: dash.pub,
		SHELL_ORIGIN: ORIGIN,
		CMS_ORIGIN: 'https://cms.test',
		DASH_ORIGIN: 'https://dash.test'
	};
	const peer = (name: string, priv: string) => ({
		origin: `https://${name}.test`,
		build: {
			id: name,
			output: output(name),
			env: {
				...common,
				ORIGIN: `https://${name}.test`,
				[`${name.toUpperCase()}_SIGNING_KEY`]: priv
			}
		}
	});
	return World.make({
		seed: 1,
		secret: 'sim-secret',
		builds: [
			{
				id: 'v1',
				output: output('shell'),
				env: { ...common, ORIGIN, SHELL_SIGNING_KEY: shell.priv }
			}
		],
		peers: [peer('cms', cms.priv), peer('dash', dash.priv)]
	});
}

describe.skipIf(!built)('federation in the world', () => {
	it('the shell bakes a peer widget, and the peer island wakes from its own origin', async () => {
		const world = await mfe();
		try {
			const tab = world.tab(world.visitor('alice'));
			await world.go(tab, 'goto', '/');
			await world.loop.run(5_000);
			await world.quiesce();
			const doc = tab.page.mainFrame.document as unknown as Document;
			expect(doc.querySelector('[data-testid="dash-fragment"]')).not.toBeNull();
			const island = doc.querySelector('ogygia-region[src^="https://dash.test/"]');
			expect(island?.hasAttribute('data-hydrated')).toBe(true);
			// (the hop went server to server, signed: the dash's own server answered it)
			expect(
				world.network.exchanges.some(
					(e) => e.from.startsWith('server') && e.url.startsWith('https://dash.test/og/fragment/')
				)
			).toBe(true);
		} finally {
			await world.end();
		}
	}, 60_000);

	it('a mounted peer page renders under the shell chrome', async () => {
		const world = await mfe();
		try {
			const tab = world.tab(world.visitor('alice'));
			await world.go(tab, 'goto', '/cms/posts/1');
			const doc = tab.page.mainFrame.document as unknown as Document;
			expect(doc.querySelector('[data-testid="cms-shell"]')).not.toBeNull();
			expect(doc.querySelector('[data-testid="cms-greeting"]')?.textContent).toBe('salut puru');
		} finally {
			await world.end();
		}
	}, 60_000);
});
