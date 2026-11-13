// A tab behind another, as a browser keeps it: its document says `hidden` and paints no frame (an
// animation frame waits until the tab is shown), and it hears `visibilitychange` each time that
// changes. Every tab was shown before, so code that waits for a frame in a hidden document (the
// paint gate's `hidden` branch, schedule.ts) ran in no run. Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';
import { act } from '../src/workload.ts';
import { islands_wake } from '../src/oracles.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

describe.skipIf(!built)('a tab behind another', () => {
	it('loads hidden, paints no frame until looked at, and hears each change', async () => {
		const world = await World.make({ seed: 1, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const v = world.visitor('v');
			const front = world.tab(v);
			await world.go(front, 'goto', '/');
			await act(world, v, { kind: 'background', path: '/' }, 'https://app.test');
			const back = v.tabs[1];
			const window = back.page.mainFrame.window as unknown as Window;
			// (its page loaded all the same: the DOM library writes it in the document's first frame)
			expect(window.document.head.children.length).toBeGreaterThan(0);
			expect(window.document.querySelector('ogygia-region')).not.toBeNull();
			expect(window.document.visibilityState).toBe('hidden');
			expect(window.document.hidden).toBe(true);
			const heard: string[] = [];
			window.document.addEventListener('visibilitychange', () =>
				heard.push(window.document.visibilityState)
			);
			let painted = false;
			window.requestAnimationFrame(() => (painted = true));
			await world.loop.run(1000);
			expect(painted, 'no frame while hidden').toBe(false);
			// (the visitor looks at it: the front one goes behind)
			world.browsers.focus(v, back);
			await world.loop.run(50);
			expect(painted, 'its frame once shown').toBe(true);
			expect(heard).toEqual(['visible']);
			expect((front.page.mainFrame.window as unknown as Window).document.visibilityState).toBe(
				'hidden'
			);
		} finally {
			await world.end();
		}
	});

	it('its islands are not judged asleep while its runtime is still on the wire', async () => {
		// (seed 97's network stalls the runtime chunk's body ~39 s after its first piece: the
		// action's quiesce gave up before it came, and islands_wake judged a page whose runtime had
		// not run; at rest every island woke)
		const world = await World.make({
			seed: 97,
			builds: [{ id: 'v1', output: OUTPUT }],
			secret: 'sim-secret',
			faults: new Set(['duplicate', 'tamper', 'stall']),
			horizon: 180_000,
			buggify: { on: 0.3, fires: 0.2 },
			idle: true
		});
		try {
			const v = world.visitor('v');
			await world.go(world.tab(v), 'goto', '/');
			await act(world, v, { kind: 'background', path: '/context/lake' }, 'https://app.test');
			const back = v.tabs[1];
			const doc = back.page.mainFrame.document as unknown as Document;
			// (the case it is for: the runtime has not run yet)
			expect(doc.readyState).toBe('interactive');
			expect(world.network.busy()).toBe(true);
			expect(islands_wake(back, world)).toBeNull();
			await world.rest();
			expect(doc.readyState).toBe('complete');
			expect(islands_wake(back, world)).toBeNull();
		} finally {
			await world.end();
		}
	});
});
