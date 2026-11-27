// A tab behind another, as a browser keeps it: its document says `hidden` and paints no frame (an
// animation frame waits until the tab is shown), and it hears `visibilitychange` each time that
// changes. Every tab was shown before, so code that waits for a frame in a hidden document (the
// paint gate's `hidden` branch, schedule.ts) ran in no run. Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';
import { act } from '../src/workload.ts';
import { islands_wake, mpa_equivalent } from '../src/oracles.ts';

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
		// (seed 97's network stalled the runtime chunk's body ~39 s after its first piece: the
		// action's quiesce gave up before it came, and islands_wake judged a page whose runtime had
		// not run; at rest every island woke. Seed 5 stalls it since a request's fate stopped reading
		// its file's hash, #2110)
		const world = await World.make({
			seed: 5,
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

	it('is judged against a fresh load behind another tab, so a visible island asleep in both is no difference', async () => {
		const world = await World.make({ seed: 274517864, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const v = world.visitor('v');
			await world.go(world.tab(v), 'goto', '/');
			await act(world, v, { kind: 'background', path: '/wake-gate' }, 'https://app.test');
			const back = v.tabs[1];
			await world.rest();
			const doc = back.page.mainFrame.document as unknown as Document;
			const visible = doc.querySelector('[data-gate-visible] > ogygia-region[wake="visible"]');
			expect(visible, 'the case it is for: an on-screen visible island').not.toBeNull();
			expect(visible!.hasAttribute('data-hydrated'), 'no frame behind, so no wake').toBe(false);
			expect(await mpa_equivalent(world, v, back)).toBeNull();
		} finally {
			await world.end();
		}
	});

	it('is judged against a fresh load behind another tab when it went behind before its islands had a frame, though it was shown as its document came (#2091, #2092)', async () => {
		const world = await World.make({ seed: 274517864, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const v = world.visitor('v');
			const front = world.tab(v);
			await world.go(front, 'goto', '/');
			const tab = world.tab(v);
			world.browsers.focus(v, tab);
			await world.start(tab, 'goto', '/wake-gate', 0);
			expect(tab.seen.has(tab.realm), 'the case it is for: shown as its document came').toBe(true);
			world.browsers.focus(v, front);
			await world.rest();
			const doc = tab.page.mainFrame.document as unknown as Document;
			const visible = doc.querySelector('[data-gate-visible] > ogygia-region[wake="visible"]');
			expect(visible, 'an on-screen visible island').not.toBeNull();
			expect(visible!.hasAttribute('data-hydrated'), 'its first frame waits behind').toBe(false);
			expect(await mpa_equivalent(world, v, tab)).toBeNull();
		} finally {
			await world.end();
		}
	});

	it('is not judged while behind with a frame owed: a visible island its hole brought after it went behind wakes when the visitor looks (#2176)', async () => {
		// (its region requests are held until it is behind: seed 6's delays brought them after its
		// first frame on one build and before it on another of the same commit, since a request's
		// delays are drawn by its address and the address holds the build's region ids; CI run
		// 45967491968)
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			secret: 'sim-secret'
		});
		try {
			const v = world.visitor('v');
			const front = world.tab(v);
			await world.go(front, 'goto', '/');
			const tab = world.tab(v);
			const top_hole = (url: URL) => {
				const props = url.searchParams.get('props');
				if (url.pathname !== '/__ogygia__' || props === null) return false;
				const [, start] = JSON.parse(Buffer.from(props, 'base64url').toString()) as unknown[];
				return start === 710 || start === 720;
			};
			const let_go = world.network.hold(
				(url, realm) => realm.split('#')[0] === tab.name && top_hole(url)
			);
			world.browsers.focus(v, tab);
			await world.start(tab, 'goto', '/nest-matrix/kit', 0);
			const doc = tab.page.mainFrame.document as unknown as Document;
			const inner = () =>
				doc.querySelector(
					'[data-case="snippet-root-hole"] [data-mx-hole] ogygia-region[wake="visible"]'
				);
			while (!tab.framed.has(tab.realm) && (await world.loop.step()));
			expect(tab.framed.has(tab.realm), 'the case it is for: its islands had a frame').toBe(true);
			expect(inner(), 'and its top holes had not answered yet').toBeNull();
			const holes = world.network.exchanges.filter(
				(e) => e.from === tab.realm && top_hole(new URL(e.url))
			);
			expect(
				holes.map((e) => e.status),
				'they are asked, and on the wire'
			).toEqual(['pending', 'pending']);
			world.browsers.focus(v, front);
			let_go();
			await world.rest();
			expect(inner(), 'the hole answered behind').not.toBeNull();
			expect(inner()!.hasAttribute('data-hydrated'), 'its island waits for a frame').toBe(false);
			expect(await mpa_equivalent(world, v, tab)).toBeNull();
			world.browsers.focus(v, tab);
			await world.rest();
			expect(inner()!.hasAttribute('data-hydrated'), 'it wakes once looked at').toBe(true);
			expect(await mpa_equivalent(world, v, tab)).toBeNull();
		} finally {
			await world.end();
		}
	});

	it('is judged against a shown fresh load when its islands had a frame before it went behind', async () => {
		const world = await World.make({ seed: 274517864, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const v = world.visitor('v');
			const front = world.tab(v);
			await world.go(front, 'goto', '/');
			const tab = world.tab(v);
			world.browsers.focus(v, tab);
			await world.go(tab, 'goto', '/wake-gate');
			world.browsers.focus(v, front);
			await world.rest();
			const doc = tab.page.mainFrame.document as unknown as Document;
			const visible = doc.querySelector('[data-gate-visible] > ogygia-region[wake="visible"]');
			expect(visible!.hasAttribute('data-hydrated'), 'it woke while shown').toBe(true);
			expect(await mpa_equivalent(world, v, tab)).toBeNull();
		} finally {
			await world.end();
		}
	});
});
