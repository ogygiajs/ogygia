// A history traversal loads a document unless the entry is the shown document's own (src/happy.ts,
// `history_by_document`). Needs the palaestra build; skipped without it.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(OUTPUT + '/server/index.js');

describe.skipIf(!built)('history traversal, by document', () => {
	it('going back to an entry an earlier document pushed loads it; to its own, moves the URL', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('alice'));
			const win = () => tab.page.mainFrame.window as unknown as Window;
			await world.go(tab, 'goto', '/');
			win().history.pushState(null, '', '/?pushed');
			await world.go(tab, 'goto', '/');
			expect(tab.documents).toBe(2);

			await world.go(tab, 'back');
			expect(win().location.href).toBe('https://app.test/?pushed');
			expect(tab.documents).toBe(3);

			win().history.pushState(null, '', '/?again');
			await world.go(tab, 'back');
			expect(win().location.href).toBe('https://app.test/?pushed');
			expect(tab.documents).toBe(3);

			// (the entries the first document shared are the third's now: same-document, and the
			// forward ones are kept; the router reloads the page, since its state names the first
			// document's entry: #259)
			expect(win().history.length).toBe(4);
			await world.go(tab, 'back');
			expect(win().location.href).toBe('https://app.test/');
			expect(win().history.length).toBe(4);
			expect(tab.documents).toBe(4);
		} finally {
			await world.end();
		}
	});

	it('a reload keeps the document state: a step back to an entry it pushed fires popstate in the new document', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('alice'));
			const win = () => tab.page.mainFrame.window as unknown as Window;
			await world.go(tab, 'goto', '/');
			win().history.pushState({ mine: 1 }, '', '/#one');
			win().history.pushState({ mine: 2 }, '', '/#two');
			await world.go(tab, 'reload');
			expect(tab.documents).toBe(2);
			const states: unknown[] = [];
			win().addEventListener('popstate', (e) => states.push((e as PopStateEvent).state));
			await world.go(tab, 'back');
			expect(win().location.href).toBe('https://app.test/#one');
			expect(tab.documents).toBe(2);
			expect(states).toEqual([{ mine: 1 }]);
		} finally {
			await world.end();
		}
	});

	it('another document’s entry loads whole even when only its fragment differs', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const tab = world.tab(world.visitor('alice'));
			const win = () => tab.page.mainFrame.window as unknown as Window;
			await world.go(tab, 'goto', '/#a');
			await world.go(tab, 'goto', '/about');
			await world.go(tab, 'goto', '/#b');
			expect(tab.documents).toBe(3);
			await world.go(tab, 'back');
			await world.go(tab, 'back');
			expect(win().location.href).toBe('https://app.test/#a');
			expect(tab.documents).toBe(5);
		} finally {
			await world.end();
		}
	});
});
