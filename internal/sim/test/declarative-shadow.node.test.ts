// A document's own parse makes each `<template shadowrootmode>` its host's shadow root, as a browser's
// parser does; a fragment parse (`innerHTML`) keeps it a template. happy-dom's parser kept every one,
// and Svelte hydrated a light DOM no browser has: /dsd warned `hydration_mismatch` in the simulator
// only (#1928). Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';
import { hydrates_as_sent } from '../src/oracles.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('declarative shadow roots', () => {
	it('the document parse attaches them, a fragment parse does not, and /dsd hydrates as sent', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('v'));
			await world.go(tab, 'goto', '/dsd');
			const doc = tab.page.mainFrame.document as unknown as Document;
			const card = doc.querySelector('x-card[data-dsd-kept]')!;
			expect(card.shadowRoot?.querySelector('x-badge')?.textContent).toBe('kept A');
			expect(card.querySelector(':scope > template')).toBeNull();
			expect(hydrates_as_sent(tab, world)).toBeNull();
			const host = doc.createElement('div');
			host.innerHTML = '<x-card><template shadowrootmode="open"><b>s</b></template></x-card>';
			expect(host.querySelector('x-card')!.shadowRoot).toBeNull();
			expect(host.querySelector('x-card > template')).not.toBeNull();
		} finally {
			await world.end();
		}
	});
});
