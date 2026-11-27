// A tab behind another, as a browser keeps it: its document says `hidden` and paints no frame (an
// animation frame waits until the tab is shown), and it hears `visibilitychange` each time that
// changes. Every tab was shown before, so code that waits for a frame in a hidden document (the
// paint gate's `hidden` branch, schedule.ts) ran in no run. Needs the palaestra build.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { World } from '../src/world.ts';
import { act } from '../src/workload.ts';
import type { Tab, Visitor } from '../src/browser.ts';
import {
	as_it_stands,
	islands_wake,
	mpa_equivalent,
	owes_look,
	type Broken
} from '../src/oracles.ts';

const OUTPUT = fileURLToPath(
	new URL('../../../apps/palaestra/.svelte-kit/output', import.meta.url)
);
const built = existsSync(`${OUTPUT}/server/index.js`);

/**
 * The run's end for `v`, in `run()`'s order: it rests (`rest_at_end`), each of `v`'s tabs owed a
 * look then is judged as it stands (`as_it_stands`), and the visitor looks (`look_at_end`). What
 * each showed as it stood, by tab.
 */
const run_end = async (world: World, v: Visitor): Promise<Map<Tab, Broken>> => {
	const { rest_at_end, look_at_end } = await import('../src/cli.ts');
	const owed = await rest_at_end(world, v);
	const stood = new Map<Tab, Broken>();
	for (const t of v.tabs.filter((t) => owed.includes(t))) {
		const b = await as_it_stands(world, v, t);
		if (b) stood.set(t, b);
	}
	await look_at_end(world, v, owed);
	return stood;
};

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

	it('went behind before its islands had a frame, though it was shown as its document came: the run end judges it as it stands, then looks at it before it judges it again, and its visible island wakes then (#2091, #2092)', async () => {
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
			expect(tab.owes_frame(), 'its observers are owed that frame').toBe(true);
			const stood = await run_end(world, v);
			expect(await mpa_equivalent(world, v, tab, undefined, stood.get(tab))).toBeNull();
			expect(visible!.hasAttribute('data-hydrated'), 'it woke once looked at').toBe(true);
			expect(tab.framed.has(tab.realm), 'so it had its frame').toBe(true);
			expect(front.hidden, 'and the tab in front is in front again').toBe(false);
		} finally {
			await world.end();
		}
	});

	/**
	 * A tab that painted, then went behind before its top holes answered: the nested `visible`
	 * island they bring waits for a frame. Its hole requests are held until it is behind, so it is
	 * the same case on every build (a request's delays are drawn by its address, which holds the
	 * build's region ids: dst.md). With `deaf`, a runtime that watches the hole's targets and never
	 * hears them come on screen: each is watched by an observer of its own whose reports go nowhere.
	 */
	const behind_owing = async (world: World, deaf = false, who = 'v') => {
		const v = world.visitor(who);
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
		if (deaf) {
			const IO = (tab.page.mainFrame.window as unknown as typeof globalThis).IntersectionObserver;
			const observe = Object.getOwnPropertyDescriptor(IO.prototype, 'observe')!.value as (
				this: IntersectionObserver,
				target: Element
			) => void;
			IO.prototype.observe = function (this: IntersectionObserver, target: Element) {
				if (target.closest('[data-mx-hole]') === null) return observe.call(this, target);
				observe.call(new IO(() => {}), target);
			};
		}
		let_go();
		await world.rest();
		expect(inner(), 'the hole answered behind').not.toBeNull();
		expect(inner()!.hasAttribute('data-hydrated'), 'its island waits for a frame').toBe(false);
		expect(tab.owes_frame(), 'and it owes that frame').toBe(true);
		return { v, front, tab, inner };
	};

	it('behind with a frame owed, it is looked at before it is judged against a shown fresh load: a visible island its hole brought after it went behind wakes then (#2176)', async () => {
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			secret: 'sim-secret'
		});
		try {
			const { v, front, tab, inner } = await behind_owing(world);
			const stood = await run_end(world, v);
			expect(stood.get(tab), 'its observers had a frame: it is not judged as it stood').toBe(
				undefined
			);
			expect(await mpa_equivalent(world, v, tab, undefined, stood.get(tab))).toBeNull();
			expect(inner()!.hasAttribute('data-hydrated'), 'it woke once looked at').toBe(true);
			expect(front.hidden, 'and the tab in front is in front again').toBe(false);
			expect(tab.owes_frame()).toBe(false);
			expect(islands_wake(tab, world)).toBeNull();
		} finally {
			await world.end();
		}
	});

	it('behind with a frame owed, a visible island that never wakes once the visitor looks is caught at the run end, by the MPA check and by the wake check (#2176)', async () => {
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			secret: 'sim-secret'
		});
		try {
			const { v, tab, inner } = await behind_owing(world, true);
			const stood = await run_end(world, v);
			expect((await mpa_equivalent(world, v, tab, undefined, stood.get(tab)))?.oracle).toBe(
				'mpa-equivalence'
			);
			expect(inner()!.hasAttribute('data-hydrated'), 'it never woke').toBe(false);
			expect(tab.owes_frame(), 'though its frame came').toBe(false);
			expect(islands_wake(tab, world)?.oracle).toBe('islands-wake');
		} finally {
			await world.end();
		}
	});

	it.each(['the visitor', 'one of a crowd'])(
		"the run end looks at each tab behind that owes a frame before it judges it, and puts the tab in front back: %s's (#2176)",
		async (whose) => {
			const world = await World.make({
				seed: 1,
				builds: [{ id: 'v1', output: OUTPUT }],
				secret: 'sim-secret'
			});
			try {
				const crowd = whose !== 'the visitor';
				const { v, front, tab, inner } = await behind_owing(world, true, crowd ? 'crowd-1' : 'v');
				if (crowd) world.crowd.push(v);
				expect(
					islands_wake(tab, world),
					'its visible islands are not judged while it owes a frame'
				).toBeNull();
				await run_end(world, crowd ? world.visitor('v') : v);
				expect(front.hidden).toBe(false);
				expect(tab.hidden).toBe(true);
				expect(tab.owes_frame()).toBe(false);
				expect(inner()!.hasAttribute('data-hydrated')).toBe(false);
				expect(islands_wake(tab, world)?.oracle).toBe('islands-wake');
			} finally {
				await world.end();
			}
		}
	);

	/**
	 * A tab shown at `path` until its observers had their frames, then put behind another, the world
	 * at rest, and one of its `load` islands made to wake only in an animation frame its page asks for
	 * behind: `then` runs in that frame, and wakes it.
	 */
	const frame_asked_behind = async (
		world: World,
		path: string,
		then: (wake: () => void, window: Window) => void
	) => {
		const v = world.visitor('v');
		const front = world.tab(v);
		await world.go(front, 'goto', '/');
		const tab = world.tab(v);
		world.browsers.focus(v, tab);
		await world.go(tab, 'goto', path);
		world.browsers.focus(v, front);
		await world.rest();
		expect(tab.framed.has(tab.realm), 'the case it is for: its observers had frames').toBe(true);
		expect(tab.owes_frame(), 'and are owed nothing').toBe(false);
		const doc = tab.page.mainFrame.document as unknown as Document;
		const island = doc.querySelector('ogygia-region[entry][wake="load"][data-hydrated]');
		expect(island, 'a load island, awake').not.toBeNull();
		island!.removeAttribute('data-hydrated');
		let ran = false;
		const window = tab.page.mainFrame.window as unknown as Window;
		window.requestAnimationFrame(() => {
			ran = true;
			then(() => island!.setAttribute('data-hydrated', ''), window);
		});
		await world.rest();
		expect(ran, 'no frame behind').toBe(false);
		return { v, front, tab, island: island!, ran: () => ran };
	};

	it('behind with an animation frame it asked for there waiting, it owes that frame and none of its islands is judged; the run end looks, and the frame runs (#2176)', async () => {
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			secret: 'sim-secret'
		});
		try {
			const { v, front, tab, island, ran } = await frame_asked_behind(world, '/', (wake) => wake());
			expect(tab.owes_frame(), 'it owes the frame its page asked for').toBe(true);
			expect(islands_wake(tab, world), 'its islands wait on that frame').toBeNull();
			await run_end(world, v);
			expect(ran(), 'the visitor looked: the frame ran').toBe(true);
			expect(island.hasAttribute('data-hydrated')).toBe(true);
			expect(tab.owes_frame()).toBe(false);
			expect(islands_wake(tab, world)).toBeNull();
			expect(front.hidden, 'and the tab in front is in front again').toBe(false);
		} finally {
			await world.end();
		}
	});

	it('the run end waits out a backoff that what its look woke set (a retry after 3 s) before it judges the tab (#2176)', async () => {
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			secret: 'sim-secret'
		});
		try {
			const { v, tab, island } = await frame_asked_behind(world, '/', (wake, window) =>
				window.setTimeout(wake, 3000)
			);
			await run_end(world, v);
			expect(island.hasAttribute('data-hydrated'), 'its retry ran').toBe(true);
			expect(islands_wake(tab, world)).toBeNull();
		} finally {
			await world.end();
		}
	});

	/** A timer in `window` that sets itself again each `ms`: a page that always has one pending. */
	const renewing = (window: Window, ms: number): void => {
		const tick = (): void => void window.setTimeout(tick, ms);
		tick();
	};

	/**
	 * The run end's wait as main had it before #2176: the visitor's tabs back on the network, then
	 * rest, and step while a judged tab has a timer set, a minute at most, with no look. The run end
	 * judges every tab at the moment this leaves, a tab owed a look as it then stands.
	 */
	const main_rest = async (world: World, v: Visitor): Promise<void> => {
		for (const t of v.tabs) world.network.offline(t.name, false);
		const until = Math.min(world.loop.now + 60_000, world.loop.horizon);
		for (;;) {
			await world.rest();
			if (
				!(
					world.loop.now < until &&
					world.loop.next_at <= until &&
					[v, ...world.crowd]
						.flatMap((who) => who.tabs)
						.filter((t) => !world.on_release(t.realm))
						.some((t) => t.platform?.pending().includes('timeout'))
				)
			)
				return;
			await world.loop.step();
		}
	};

	/**
	 * `setup` run in two worlds of one seed: one ends as main did ({@link main_rest}), the other
	 * through the run end's first step. Each world's moment and what `judge` finds there.
	 */
	const as_main = async <T>(
		setup: (world: World) => Promise<T & { v: Visitor }>,
		judge: (world: World, made: T) => Broken | null
	) => {
		const { rest_at_end } = await import('../src/cli.ts');
		const make = () =>
			World.make({
				seed: 1,
				builds: [{ id: 'v1', output: OUTPUT }],
				secret: 'sim-secret',
				horizon: 600_000
			});
		const main = await make();
		let was: { at: number; found: string | undefined };
		try {
			const made = await setup(main);
			await main_rest(main, made.v);
			was = { at: main.loop.now, found: judge(main, made)?.oracle };
		} finally {
			await main.end();
		}
		const world = await make();
		const made = await setup(world);
		const owed = await rest_at_end(world, made.v);
		return {
			was,
			is: { at: world.loop.now, found: judge(world, made)?.oracle },
			world,
			made,
			owed
		};
	};

	it("the run end judges a page no tab of which owes a look at main's moment: a load island a page with a 100 ms tick wakes only 100 s in is asleep there, an islands-wake finding, and nothing after it waits", async () => {
		const { look_at_end } = await import('../src/cli.ts');
		const { was, is, world, made, owed } = await as_main(
			async (world) => {
				const v = world.visitor('v');
				const tab = world.tab(v);
				await world.go(tab, 'goto', '/');
				const window = tab.page.mainFrame.window as unknown as Window;
				const island = window.document.querySelector(
					'ogygia-region[entry][wake="load"][data-hydrated]'
				)!;
				island.removeAttribute('data-hydrated');
				window.setTimeout(() => island.setAttribute('data-hydrated', ''), 100_000);
				renewing(window, 100);
				return { v, tab };
			},
			(world, { tab }) => islands_wake(tab, world)
		);
		try {
			expect(was.found, 'main finds it').toBe('islands-wake');
			expect(is, "the run end judges at main's moment, and finds it").toEqual(was);
			expect(owed, 'no tab owes a look').toEqual([]);
			const at = world.loop.now;
			await look_at_end(world, made.v, owed);
			expect(world.loop.now, 'so no more time').toBe(at);
		} finally {
			await world.end();
		}
	});

	it("the run end judges every tab at main's moment though another owes a look: a load island the tab in front, with a 5 s timer, wakes only 90 s in is asleep there, an islands-wake finding (#2176)", async () => {
		const { was, is, world, made, owed } = await as_main(
			async (world) => {
				const { v, front, tab } = await behind_owing(world);
				const window = front.page.mainFrame.window as unknown as Window;
				const island = window.document.querySelector(
					'ogygia-region[entry][wake="load"][data-hydrated]'
				)!;
				island.removeAttribute('data-hydrated');
				window.setTimeout(() => island.setAttribute('data-hydrated', ''), 90_000);
				renewing(window, 5000);
				return { v, front, tab };
			},
			(world, { front }) => islands_wake(front, world)
		);
		try {
			expect(was.found, 'main finds it').toBe('islands-wake');
			expect(is, "the run end judges at main's moment, and finds it").toEqual(was);
			expect(owed, 'the case it is for: the other tab owes a look then').toEqual([made.tab]);
		} finally {
			await world.end();
		}
	});

	it('the run end looks at a tab once: one that asks for an animation frame in each frame owes a new look after it, and is judged as it then stands, though the tab in front keeps a 5 s timer (#2176)', async () => {
		const { rest_at_end, look_at_end } = await import('../src/cli.ts');
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			secret: 'sim-secret',
			horizon: 600_000
		});
		try {
			const { v, front, tab } = await frame_asked_behind(world, '/', (wake, window) => {
				wake();
				const again = (): void => void window.requestAnimationFrame(again);
				again();
			});
			renewing(front.page.mainFrame.window as unknown as Window, 5000);
			const window = tab.page.mainFrame.window as unknown as Window;
			const heard: string[] = [];
			window.document.addEventListener('visibilitychange', () =>
				heard.push(window.document.visibilityState)
			);
			const owed = await rest_at_end(world, v);
			expect(heard, 'no look before the run end judges at its first moment').toEqual([]);
			expect(owed).toEqual([tab]);
			const looked = world.loop.now;
			await look_at_end(world, v, owed);
			expect(heard, 'one look').toEqual(['visible', 'hidden']);
			expect(
				world.loop.now - looked,
				"the look waits on the looked-at tab's timers alone, not the minute the 5 s one in front would keep it"
			).toBeLessThan(60_000);
			expect(owes_look(tab), 'it owes a new look').toBe(true);
			expect(islands_wake(tab, world), 'its islands wait on that frame').toBeNull();
			expect(front.hidden).toBe(false);
		} finally {
			await world.end();
		}
	});

	it('the run end waits out the timers a minute at most when no tab owes a look, and no more after it: a load island a page wakes only 90 s in is still asleep, an islands-wake finding', async () => {
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			secret: 'sim-secret',
			horizon: 600_000
		});
		try {
			const v = world.visitor('v');
			const tab = world.tab(v);
			await world.go(tab, 'goto', '/');
			const window = tab.page.mainFrame.window as unknown as Window;
			const island = window.document.querySelector(
				'ogygia-region[entry][wake="load"][data-hydrated]'
			)!;
			island.removeAttribute('data-hydrated');
			window.setTimeout(() => island.setAttribute('data-hydrated', ''), 90_000);
			renewing(window, 5000);
			const from = world.loop.now;
			await run_end(world, v);
			expect(world.loop.now - from, 'a minute, and the rest after it').toBeLessThan(90_000);
			expect(island.hasAttribute('data-hydrated')).toBe(false);
			expect(islands_wake(tab, world)?.oracle).toBe('islands-wake');
		} finally {
			await world.end();
		}
	});

	it('the run end gives a look its own minute, and the tab stays in front through it: what a look a minute in woke, a retry 30 s later that wakes in a frame, is waited out where it has that frame (#2176)', async () => {
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT }],
			secret: 'sim-secret',
			horizon: 600_000
		});
		try {
			const { v, front, tab, island } = await frame_asked_behind(world, '/', (wake, window) =>
				window.setTimeout(() => window.requestAnimationFrame(wake), 30_000)
			);
			renewing(front.page.mainFrame.window as unknown as Window, 5000);
			const from = world.loop.now;
			await run_end(world, v);
			expect(world.loop.now - from, 'its rest took the whole minute').toBeGreaterThanOrEqual(
				60_000
			);
			expect(island.hasAttribute('data-hydrated'), 'its retry ran').toBe(true);
			expect(islands_wake(tab, world)).toBeNull();
		} finally {
			await world.end();
		}
	});

	it("the run end does not wait on a timer in a document a release served: what it does is the release's", async () => {
		const world = await World.make({
			seed: 1,
			builds: [{ id: 'v1', output: OUTPUT, released: '0.12.0' }],
			secret: 'sim-secret',
			horizon: 600_000
		});
		try {
			const v = world.visitor('v');
			const tab = world.tab(v);
			await world.go(tab, 'goto', '/');
			expect(world.on_release(tab.realm), 'the case it is for').toBe(true);
			renewing(tab.page.mainFrame.window as unknown as Window, 5000);
			const from = world.loop.now;
			await run_end(world, v);
			expect(world.loop.now - from).toBeLessThan(30_000);
		} finally {
			await world.end();
		}
	});

	/**
	 * A tab shown at `/wake-gate` as its document came, then put behind another before its observers
	 * had a frame, the world at rest: it is owed a look. With `report` (ms), each observer it makes
	 * then reports its target on screen that long after it is watched, with no frame: a runtime that
	 * wakes a `visible` island behind.
	 */
	const unframed_behind = async (world: World, report?: number) => {
		const v = world.visitor('v');
		const front = world.tab(v);
		await world.go(front, 'goto', '/');
		const tab = world.tab(v);
		world.browsers.focus(v, tab);
		await world.start(tab, 'goto', '/wake-gate', 0);
		expect(tab.seen.has(tab.realm), 'the case it is for: shown as its document came').toBe(true);
		const w = tab.page.mainFrame.window as unknown as {
			IntersectionObserver: new (cb: IntersectionObserverCallback) => IntersectionObserver;
			setTimeout(fn: () => void, ms: number): number;
		};
		const Real = w.IntersectionObserver;
		if (report !== undefined)
			w.IntersectionObserver = class extends Real {
				readonly #told: IntersectionObserverCallback;
				constructor(cb: IntersectionObserverCallback) {
					super(cb);
					this.#told = cb;
				}
				observe(target: Element): void {
					super.observe(target);
					w.setTimeout(() => {
						const rect = { x: 0, y: 0, width: 1, height: 1, top: 0, left: 0, right: 1, bottom: 1 };
						const entry = {
							target,
							isIntersecting: true,
							intersectionRatio: 1,
							boundingClientRect: rect,
							intersectionRect: rect,
							rootBounds: rect,
							time: 0
						};
						this.#told([entry as unknown as IntersectionObserverEntry], this);
					}, report);
				}
			};
		world.browsers.focus(v, front);
		await world.rest();
		const doc = tab.page.mainFrame.document as unknown as Document;
		const visible = doc.querySelector('[data-gate-visible] > ogygia-region[wake="visible"]')!;
		expect(tab.framed.has(tab.realm), 'its observers had no frame').toBe(false);
		expect(tab.owes_frame(), 'so it is owed a look').toBe(true);
		return { v, tab, doc, visible, window: w };
	};

	it('went behind before its observers had a frame, though it was shown as its document came: a visible island that woke there with no frame is an MPA difference, judged as it stood before the run end looks at it (#2091)', async () => {
		const world = await World.make({ seed: 274517864, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const { v, tab, visible } = await unframed_behind(world, 0);
			expect(visible.hasAttribute('data-hydrated'), 'it woke behind, with no frame').toBe(true);
			const stood = await run_end(world, v);
			expect(tab.framed.has(tab.realm), 'the run end looked').toBe(true);
			expect(stood.get(tab)?.oracle, 'as it stood').toBe('mpa-equivalence');
		} finally {
			await world.end();
		}
	});

	it('went behind before its observers had a frame: a visible island that wakes there with no frame only after a timer (its report 20 s late) is an MPA difference too: the run end waits out the timers before it judges the tab as it stands, and only then looks (#2091)', async () => {
		const world = await World.make({ seed: 274517864, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const { v, tab, visible } = await unframed_behind(world, 20_000);
			expect(visible.hasAttribute('data-hydrated'), 'not awake yet at the first rest').toBe(false);
			const stood = await run_end(world, v);
			expect(stood.get(tab)?.oracle, 'it woke behind, with no frame, as it stood').toBe(
				'mpa-equivalence'
			);
		} finally {
			await world.end();
		}
	});

	it('went behind before its observers had a frame: what a retry fills in 5 s later is there before the run end judges the tab as it stands, so it is no difference (#2091)', async () => {
		const world = await World.make({ seed: 274517864, builds: [{ id: 'v1', output: OUTPUT }] });
		try {
			const { v, tab, doc, window } = await unframed_behind(world);
			const missing = doc.querySelector('main h1, h1')!;
			const text = missing.textContent;
			missing.textContent = '';
			window.setTimeout(() => {
				missing.textContent = text;
			}, 5000);
			const stood = await run_end(world, v);
			expect(missing.textContent, 'its retry landed').toBe(text);
			expect(stood.get(tab), 'judged as it stood once it landed').toBe(undefined);
			expect(await mpa_equivalent(world, v, tab, undefined, stood.get(tab))).toBeNull();
		} finally {
			await world.end();
		}
	});

	it('is judged against a shown fresh load when its islands had a frame before it went behind; showing no difference there, a known finding as it stood is kept', async () => {
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
			const stood = await run_end(world, v);
			expect(stood.get(tab), 'it is owed no look: it is not judged as it stood').toBe(undefined);
			expect(await mpa_equivalent(world, v, tab, undefined, stood.get(tab))).toBeNull();
			const known = { oracle: 'known', detail: 'a filed bug, as it stood' } as const;
			expect(
				await mpa_equivalent(world, v, tab, undefined, known),
				'a known finding as it stood is kept when the tab, judged, shows no difference'
			).toBe(known);
		} finally {
			await world.end();
		}
	});
});
