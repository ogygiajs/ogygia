// Client hydration, run in Node against the unit tests' DOM shim (bench/hydration-page.ts; the
// shim's own work counts too): a CMS page of a header, a list of block islands with mixed
// wakes (load / visible / idle / interaction) and a footer, each with its props sidecar in the keyed
// body tail. One block in five is edited while it sleeps (a page script strips its
// whitespace), so its wake compares it with its server copy and repairs it.
//
// - the region element, through its public path: the runtime boots, `customElements.define`
//   upgrades every region, each connects and arms its wake, and `#fire_hydrate` wakes it (from its
//   schedule, or from a tap that lands first): the module and the hydrate core load, the scheduler
//   hands out turns, and each turn runs `hydrate_island`.
// - `hydrate_island` itself, for one island and for every island of a page.
// - the drift check and repair, and the head's `<svelte:head>` markers, each as its input grows.
// - the hydration scheduler and the background drain, without the element around them.
//
// What is a stand-in: Svelte's `hydrate` (test/_stubs/svelte-hydrate.ts: the anchor check, then the
// component runs once; nothing of Svelte's walk is counted), the island module
// (test/_stubs/island-module.ts), `scheduler.yield` / `postTask` (timer-loop tasks),
// `IntersectionObserver` (one report a task after observing), the custom element registry, and
// `requestIdleCallback` (absent: the element's timer fallback). `MutationObserver` is the shim's,
// which records every change of the page as a browser does.
import {
	cms_page,
	edit_while_asleep,
	grid_page,
	ISLAND_ENTRIES,
	in_view,
	page_head,
	server_copy,
	src_of,
	strip_whitespace,
	type PageRegion
} from './hydration-page.ts';
import { frag, type DomNode } from '../test/_stubs/dom.ts';
import { bench } from '@bench/heisenbench/bench';
import { RuntimeSession } from '../src/runtime/session.ts';
import island_module from '../test/_stubs/island-module.ts';
import { link_boot } from '../src/runtime/boot-link.ts';
import { __heisenbench as core_private, boot } from '../src/runtime/core.ts';
import { import_entry, note_entry_location } from '../src/runtime/entry-locations.ts';
import {
	__heisenbench as hydrate_core,
	hydrate_island,
	neutralize_head_hydration_markers,
	sequence_differs,
	type IslandModule
} from '../src/runtime/hydrate-core.ts';
import {
	__heisenbench as interaction_private,
	install as install_interaction
} from '../src/runtime/interaction.ts';
import { once_on_screen } from '../src/runtime/viewport.ts';
import { flights, scope } from '@ogygia/machine';
import { LoadSlot, reset_load_scheduler } from '../src/runtime/load-scheduler.ts';
import { class_at, PRIORITY } from '../src/runtime/load-class.ts';
import {
	is_warmed_module,
	reset_island_warms,
	warm_island_module
} from '../src/runtime/region-endpoint-url.ts';
import {
	background_start,
	hydrate_settled,
	hydrate_started,
	hydrate_turn,
	register_region
} from '../src/runtime/schedule.ts';

const MOD = { default: island_module } as unknown as IslandModule;
/** The page the scheduler's regions are on: their viewport snapshots are its. */
const PAGE = scope();

// ── the region element, booted ─────────────────────────────────────────────────────────────────

/** Every island that wakes without a visitor: `load`, `idle`, and `visible` ones on the first screen. */
function wakes_alone(regions: PageRegion[]): number {
	let n = 0;
	for (const r of regions)
		if (r.wake === 'load' || r.wake === 'idle' || (r.wake === 'visible' && in_view.has(r.el))) n++;
	return n;
}

/**
 * The page as the browser runs it: the runtime boots (the interaction feature with it), every region
 * upgrades and connects, a page script then edits one block in five while they sleep, and
 * a visitor taps the header before it is live. Ends when every island that wakes alone is hydrated.
 */
function boot_page({ page }: Booted): Promise<number> {
	const regions = page();
	const expected = wakes_alone(regions);
	let hydrated = 0;
	const all = new Promise<number>((resolve, reject) => {
		document.addEventListener('ogygia:hydrated', () => {
			if (++hydrated === expected) resolve(hydrated);
		});
		// (a wake that never comes fails the case instead of ending it early)
		setTimeout(() => reject(new Error(`${hydrated} of ${expected} islands hydrated`)), 60_000);
	});
	boot([install_interaction]);
	for (const r of regions) if (r.touched) edit_while_asleep(r.el);
	const tap = regions[0].el.querySelector('button')!;
	tap.dispatchEvent(new Event('pointerdown', { bubbles: true }));
	return all;
}

/** The page behind a function: it is the document's, and a generic scaler must not repeat it. */
type Booted = { page: () => PageRegion[] };

function page_of(blocks: number): Booted {
	const regions = cms_page(blocks, 6, false);
	return { page: () => regions };
}

/**
 * The page, and the lazy chunks a wake imports loaded ahead of the window: the hydrate core, the
 * interaction replay, and every island module the page names. Node resolves an `import()`
 * with a filesystem call Heisenbench does not allow inside the window; in a browser each is a
 * fetch, not ogygia's work. Each island's location is noted first, as its element's connect notes
 * it: an identity with no known location would ask the network for the build's map.
 */
async function booted_page(blocks: number): Promise<Booted> {
	await core_private.hydrate_core.get();
	await interaction_private.replay();
	for (const entry of ISLAND_ENTRIES) note_entry_location(entry, src_of(entry));
	await Promise.all(ISLAND_ENTRIES.map((entry) => import_entry(entry)));
	return page_of(blocks);
}

bench('region element: a 250-block page boots and its islands wake', boot_page, {
	setup: () => booted_page(250)
});

// Growth from a small page (5 blocks: at 100 times it is a 500-block page): linear. It was quadratic
// while the scheduler's turns walked every pending island (see its own case below) and every wake
// asked the whole document whether a devalue-lane script is in it (devalue-lane.ts `needs_devalue`):
// islands × the page's elements. The document is asked once now, and again only when markup comes in.
// And every download that ended sorted the whole load queue again, comparing two classes per step
// (load-scheduler.ts `drain_queue`: drains × queue × log queue, cubic in the page); a drain reads
// each class once now, so it is linear in the queue (its `@heisenbench` contract).
bench('region element: a page boots and wakes as it grows', boot_page, {
	setup: () => booted_page(5),
	scale: (_ctx, k) => page_of(5 * k)
});

// ── hydrate_island ─────────────────────────────────────────────────────────────────────────────

/** Every island of the page, each hydrated against the server copy it connected with. */
function hydrate_all(regions: PageRegion[]): number {
	link_boot();
	let n = 0;
	for (const r of regions)
		if (hydrate_island(r.el as HTMLElement, r.entry, MOD, r.ssr_html, r.touched)) n++;
	return n;
}

bench(
	'hydrate_island: the header island (a large props config, edited while it slept)',
	({ regions }) => {
		link_boot();
		const r = regions[0];
		return hydrate_island(r.el as HTMLElement, r.entry, MOD, r.ssr_html, true) !== null;
	},
	{
		setup: () => {
			const regions = cms_page(4);
			// (the header is the island a page script edits while it sleeps)
			strip_whitespace(regions[0].el as unknown as DomNode);
			return { regions };
		}
	}
);

bench('hydrate_island: every island of a 250-block page', ({ regions }) => hydrate_all(regions), {
	setup: () => ({ regions: cms_page(250) })
});

// Growth from a small page: linear. Each island's sidecar is one id lookup, its drift check walks its
// own markup only, and its head ownership record reads what its step put in `<head>`. It was
// islands × head while each island copied and walked the whole `<head>`, which grows with the
// islands that render a `<svelte:head>`.
bench('hydrate_island: every island as the page grows', ({ regions }) => hydrate_all(regions), {
	setup: () => ({ regions: cms_page(25) }),
	scale: (_ctx, k) => ({ regions: cms_page(25 * k) })
});

/** A product grid island Svelte will not match (its stand-in re-renders it, see svelte-hydrate.ts). */
function mismatched_grid(cards: number): { r: PageRegion } {
	const r = grid_page(cards);
	r.el.setAttribute('data-mismatch', '');
	return { r };
}

// Growth: linear in the island's root cards. The strict attempt throws, Svelte's recovery renders
// the island fresh, and the discard check looks for any of the server's root elements still there.
bench(
	'hydrate_island: a grid island Svelte re-renders, as its root cards grow',
	({ r }) => {
		link_boot();
		return hydrate_island(r.el as HTMLElement, r.entry, MOD, r.ssr_html, false) !== null;
	},
	{ setup: () => mismatched_grid(12), scale: (_ctx, k) => mismatched_grid(12 * k) }
);

// ── the drift check and repair, the head markers ───────────────────────────────────────────────

/** A block island an A/B tool left a comment in, in its last row: the drift check walks every row. */
function ab_edited(rows: number): { region: Element; want: Element } {
	const [, r] = cms_page(1, rows);
	const want = server_copy(r);
	const items = r.el.querySelectorAll('li');
	items[items.length - 1].appendChild(document.createComment('ab: variant b'));
	return { region: r.el, want };
}

// Growth: linear in the island's markup (the drift check and the repair walk it once).
bench(
	'drift check and repair: an edited block island as its rows grow',
	({ region, want }) => {
		link_boot();
		if (!sequence_differs(region, want)) return false;
		hydrate_core.repair_markup(region as HTMLElement, want);
		return sequence_differs(region, want);
	},
	{ setup: () => ab_edited(6), scale: (_ctx, k) => ab_edited(6 * k) }
);

/** A csr=false page's head with `blocks` islands' `<svelte:head>` blocks in it. */
function head_of(blocks: number): { blocks: number } {
	page_head(blocks * 10);
	return { blocks };
}

// Growth: linear in the head's nodes (one walk, then each confirmed marker removed).
bench(
	'head markers: a page head as its islands’ head blocks grow',
	() => {
		neutralize_head_hydration_markers();
		return document.head.childNodes.length;
	},
	{ setup: () => head_of(10), scale: (_ctx, k) => head_of(10 * k) }
);

// ── the head ownership record: what one island's step put in `<head>` ───────────────────────────

/** A page head of `blocks` islands' head blocks, and a session that owns it. */
function owned_head(blocks: number): { session: RuntimeSession } {
	page_head(blocks * 10);
	const session = new RuntimeSession();
	session.adopt_document_head();
	return { session };
}

/** An island's step: its `<svelte:head>` renders three tags, the last one inserted first. */
function island_head_step(): void {
	const head = document.head as unknown as DomNode;
	const [a, b, c] = frag('<meta name="i1"><meta name="i2"><meta name="i3">');
	head.appendChild(c);
	head.insertBefore(b, c);
	head.insertBefore(a, b);
}

// Growth: constant in the head (the mark reads only the step's records). The records reach the
// observer's callback first here (a task boundary inside the step), and come back in head order.
bench(
	'head mark: an island’s head block, from the observer’s records',
	async ({ session }) => {
		const mark = session.mark_head();
		island_head_step();
		await Promise.resolve();
		const added = mark.added();
		mark.stop();
		return added.length;
	},
	{ setup: () => owned_head(10), scale: (_ctx, k) => owned_head(10 * k) }
);

// Growth: linear in the head (the page's copy is found by a scan of its elements, then retired).
bench(
	'head record: an island’s head block takes the place of the page’s copy (#1107)',
	({ session }) => {
		const mark = session.mark_head();
		island_head_step();
		session.record_island_head(mark);
		return document.head.childNodes.length;
	},
	{
		setup: () => {
			const owned = owned_head(10);
			// (the server's copy of the island's block, in the middle of the page's head)
			const middle = document.head.childNodes[Math.floor(document.head.childNodes.length / 2)];
			for (const n of frag('<meta name="i1"><meta name="i2"><meta name="i3">'))
				(document.head as unknown as DomNode).insertBefore(n, middle as unknown as DomNode);
			owned.session.adopt_document_head();
			return owned;
		}
	}
);

const saved_observer = (globalThis as { MutationObserver?: unknown }).MutationObserver;

// Growth: linear in the head (without MutationObserver the head is copied, then scanned).
bench(
	'head mark: an island’s head block, without MutationObserver',
	({ session }) => {
		const mark = session.mark_head();
		island_head_step();
		const added = mark.added();
		mark.stop();
		return added.length;
	},
	{
		setup: () => {
			delete (globalThis as { MutationObserver?: unknown }).MutationObserver;
			return owned_head(10);
		},
		teardown: () => {
			(globalThis as { MutationObserver?: unknown }).MutationObserver = saved_observer;
		}
	}
);

// ── the scheduler and the background drain, alone ──────────────────────────────────────────────

/**
 * The page wakes through the scheduler: every region registers at connect; `load` wakes start at
 * background priority, `visible` ones when the observer reports them in view, `idle` ones on an idle
 * timer, `interaction` ones never. Each started island's module arrives a few ms later (network
 * order), then it asks for its turn; the case ends when every started island had its turn.
 */
function wake_page(regions: PageRegion[]): Promise<number> {
	let turns = 0;
	let resolve_all: (n: number) => void = () => {};
	const all = new Promise<number>((r) => (resolve_all = r));
	const expected = wakes_alone(regions);
	const start = (r: PageRegion, i: number) => async () => {
		hydrate_started(r.el);
		await new Promise<void>((arrive) => setTimeout(arrive, 2 + (i % 7)));
		await hydrate_turn(r.el);
		// (the turn: the hydrate step would run here)
		hydrate_settled(r.el);
		if (++turns === expected) resolve_all(turns);
	};
	regions.forEach((r, i) => {
		register_region(r.el, PAGE);
		const fire = start(r, i);
		if (r.wake === 'load') background_start(fire);
		else if (r.wake === 'visible') once_on_screen(r.el, '0px', () => background_start(fire));
		else if (r.wake === 'idle') setTimeout(fire, 200);
	});
	return expected === 0 ? Promise.resolve(0) : all;
}

bench('scheduler: a 250-block page takes its hydrate turns', ({ regions }) => wake_page(regions), {
	setup: () => ({ regions: cms_page(250) })
});

// Growth from a small page: linear in the islands (a turn per island, each a heap pick). It was
// quadratic while each turn's drain walked every pending island (the snapshot check, then the
// best pick), and a page's `load` wakes are all pending at once.
bench('scheduler: hydrate turns as the page grows', ({ regions }) => wake_page(regions), {
	setup: () => ({ regions: cms_page(25) }),
	scale: (_ctx, k) => ({ regions: cms_page(25 * k) })
});

/** Every `load` wake of the page starts in one task (the element's connect); one drain runs them. */
function drain_starts(regions: PageRegion[]): Promise<number> {
	let ran = 0;
	for (const r of regions) {
		background_start(() => {
			hydrate_started(r.el);
			ran++;
		});
	}
	return new Promise<number>((done) => setTimeout(() => done(ran), 10_000));
}

bench(
	'background drain: 250 wake starts queued in one task',
	({ regions }) => drain_starts(regions),
	{ setup: () => ({ regions: cms_page(250) }) }
);

/**
 * Shared downloads raised by their joins (load-scheduler.ts `LoadSlot` on a flight): a page prefetch
 * warms `n` downloads as guesses, queued behind the background window; a visitor then needs every
 * third one (it joins as `user`) and every third is scrolled into view (`visible`). A raised slot
 * drains at its new class. Ends when every download had its turn.
 */
function raised_downloads(n: number): Promise<number> {
	const downloads = flights({
		name: 'downloads',
		keep: 0,
		run: async (i: number, _signal, flight) => {
			const slot = new LoadSlot({
				kind: 'content',
				cls: class_at(flight.priority),
				label: `d${i}`,
				flight
			});
			const release = await slot.ready;
			await Promise.resolve();
			release();
			return slot.cls();
		}
	});
	const out: Promise<unknown>[] = [];
	for (let i = 0; i < n; i++) out.push(downloads.get(i, { priority: PRIORITY.speculative }));
	for (let i = 0; i < n; i += 3) out.push(downloads.get(i, { priority: PRIORITY.user }));
	for (let i = 1; i < n; i += 3) out.push(downloads.get(i, { priority: PRIORITY.visible }));
	return Promise.all(out).then((all) => all.length);
}

bench(
	'load scheduler: guesses raised by the visitor joins, as the page grows',
	({ n }) => raised_downloads(n),
	{
		setup: () => {
			reset_load_scheduler();
			return { n: 30 };
		},
		scale: (_ctx, k) => {
			reset_load_scheduler();
			return { n: 30 * k };
		}
	}
);

/**
 * The module warmer (region-endpoint-url.ts, one warm per module on the flights' priority): a page
 * prefetch warms every island of the next page as a guess, and the visitor then reaches for every
 * fourth one (a `user` warm joins and raises it). The modules are loaded ahead of the window, as the
 * booted page's are. Ends when the warms had their turns.
 */
async function warm_page(srcs: string[]): Promise<number> {
	reset_island_warms();
	reset_load_scheduler();
	for (const src of srcs) warm_island_module(src);
	for (let i = 0; i < srcs.length; i += 4) warm_island_module(srcs[i], undefined, 'user');
	await new Promise((r) => setTimeout(r, 10_000));
	return srcs.filter((src) => is_warmed_module(src)).length;
}

bench(
	'island warm: a prefetch warms a page of islands, the visitor reaches for some',
	() => warm_page(ISLAND_ENTRIES),
	{
		setup: () => {
			for (const entry of ISLAND_ENTRIES) note_entry_location(entry, src_of(entry));
			return Promise.all(ISLAND_ENTRIES.map((entry) => import_entry(entry))).then(() => ({}));
		}
	}
);

bench('background drain: wake starts as the page grows', ({ regions }) => drain_starts(regions), {
	setup: () => ({ regions: cms_page(25) }),
	scale: (_ctx, k) => ({ regions: cms_page(25 * k) })
});
