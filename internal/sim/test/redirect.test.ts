// A tab follows a server's redirect as a browser does (src/browser.ts): happy-dom handed the sim's
// answer back as it was, so a load of a page that redirects showed an empty page at the old URL.
// Needs the palaestra build; skipped without it.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('redirects', () => {
	it('a load of a page whose load function redirects lands on the page it names', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('alice'));
			await world.go(tab, 'goto', '/dashboard');
			const doc = tab.page.mainFrame.document as unknown as Document;
			expect(tab.page.mainFrame.url).toBe('https://app.test/dashboard/orders');
			expect(doc.querySelector('h1')?.textContent).toMatch(/^Orders/);
		} finally {
			await world.end();
		}
	});
});
