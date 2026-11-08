// Client hydration, run in Node against the unit tests' DOM shim (bench/hydration-page.ts; the
// shim's own work counts too): a CMS page of a header, a builder list of block islands with mixed
// wakes (load / visible / idle / interaction) and a footer, each with its props sidecar in the keyed
// body tail. Three parts of the path:
//
// - the hydrate step of hydrate_island, piece by piece: the props sidecar read, the drift check and
//   repair of an island a script edited while it slept, the envelope, the head ownership record.
//   hydrate_island itself (and the element's #hydrate / #fire_hydrate around it) reads
//   `import.meta.env.DEV` unguarded, and Node has no `import.meta.env`, so their own lines wait for
//   Heisenbench to bring one. Svelte's `hydrate()` is not run: its walk is Svelte's work, not ogygia's.
// - the hydration scheduler: every region registered at connect, its viewport snapshot, the wakes
//   starting at background priority, one hydrate turn per task, viewport first.
// - the background drain: every wake start queued in one task, drained under its time budget.
//
// What is a stand-in: the island module's download (a timer per island, in network order), the
// Svelte hydrate itself (nothing runs in the turn), `scheduler.yield` / `postTask` (timer-loop
// tasks), `IntersectionObserver` (one report a task after observing) and `requestIdleCallback`
// (a timer).
import {
	cms_page,
	in_view,
	page_head,
	server_copy,
	strip_whitespace,
	type PageRegion
} from './hydration-page.ts';
import type { DomNode } from '../test/_stubs/dom.ts';
import { bench } from '@bench/heisenbench/bench';
import { link_boot } from '../src/runtime/boot-link.ts';
import {
	__heisenbench as hydrate_core,
	neutralize_head_hydration_markers,
	read_region_props,
	seed_page_once,
	seed_remote_once,
	sequence_differs
} from '../src/runtime/hydrate-core.ts';
import { once_visible } from '../src/runtime/observe.ts';
import {
	background_start,
	hydrate_settled,
	hydrate_started,
	hydrate_turn,
	register_region
} from '../src/runtime/schedule.ts';
import { runtime_session } from '../src/runtime/session.ts';
import { slots } from '../src/runtime/slots.ts';

interface StepCtx {
	regions: PageRegion[];
	/** each touched island's server copy, parsed (the parse is the browser's, not counted here) */
	copies: Map<Element, Element>;
}

function step_ctx(regions: PageRegion[]): StepCtx {
	const copies = new Map<Element, Element>();
	for (const r of regions) if (r.touched) copies.set(r.el, server_copy(r));
	return { regions, copies };
}

/** Region `i` edited while it slept (its server copy kept first), as a design-system runtime does. */
function edited(regions: PageRegion[], i: number): StepCtx {
	const ctx = step_ctx(regions);
	ctx.copies.set(regions[i].el, server_copy(regions[i]));
	strip_whitespace(regions[i].el as unknown as DomNode);
	regions[i].touched = true;
	return ctx;
}

/** hydrate_island's own work for one island, in its order, up to (not including) Svelte's hydrate. */
function hydrate_step(r: PageRegion, copies: Map<Element, Element>, first: boolean): number {
	seed_remote_once();
	seed_page_once();
	const props = read_region_props(r.el);
	// (a csr=false document: the first island makes the head's `<svelte:head>` markers safe)
	if (!slots.boot!.kit_hydrates_page() && first) neutralize_head_hydration_markers();
	const head_before: ReadonlySet<Node> = new Set(document.head.children);
	const lifted = slots.lakes.lift(r.el);
	const want = r.touched ? copies.get(r.el) : undefined;
	if (want && sequence_differs(r.el, want)) hydrate_core.repair_markup(r.el as HTMLElement, want);
	hydrate_core.ensure_envelope(r.el);
	slots.lakes.restore(r.el, lifted);
	runtime_session.record_island_head(head_before);
	return Object.keys(props).length;
}

function hydrate_page({ regions, copies }: StepCtx): number {
	link_boot();
	let n = 0;
	regions.forEach((r, i) => (n += hydrate_step(r, copies, i === 0)));
	return n;
}

bench(
	'hydrate step: the header island (a large props config, edited while it slept)',
	({ regions, copies }) => {
		link_boot();
		return hydrate_step(regions[0], copies, true);
	},
	// (the header is the island a design-system runtime strips while it upgrades the nav)
	{ setup: () => edited(cms_page(4), 0) }
);

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

bench('hydrate step: every island of a 250-block page', hydrate_page, {
	setup: () => step_ctx(cms_page(250))
});

// Growth from a small page. Each island's sidecar is one id lookup and its drift check walks its
// own markup only, but each island also copies and walks the whole `<head>` (the head ownership
// record), and the head grows with the islands that render a `<svelte:head>`: islands × head.
bench('hydrate step: every island as the page grows', hydrate_page, {
	setup: () => step_ctx(cms_page(25)),
	scale: (_ctx, k) => step_ctx(cms_page(25 * k))
});

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
	const start = (r: PageRegion, i: number) => async () => {
		hydrate_started(r.el);
		await new Promise<void>((arrive) => setTimeout(arrive, 2 + (i % 7)));
		await hydrate_turn(r.el);
		// (the turn: the hydrate step would run here)
		hydrate_settled(r.el);
		if (++turns === expected) resolve_all(turns);
	};
	let expected = 0;
	regions.forEach((r, i) => {
		register_region(r.el);
		const fire = start(r, i);
		if (r.wake === 'load') {
			expected++;
			background_start(fire);
		} else if (r.wake === 'visible') {
			if (in_view.has(r.el)) expected++;
			once_visible(r.el, '0px', () => background_start(fire));
		} else if (r.wake === 'idle') {
			expected++;
			setTimeout(fire, 200);
		}
	});
	return expected === 0 ? Promise.resolve(0) : all;
}

bench('scheduler: a 250-block page takes its hydrate turns', ({ regions }) => wake_page(regions), {
	setup: () => ({ regions: cms_page(250) })
});

// Growth from a small page. Quadratic today: one turn goes per task, and each turn's drain walks
// every pending island (the snapshot check, then the best pick), while a page's `load` wakes are
// all pending at once.
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

bench('background drain: wake starts as the page grows', ({ regions }) => drain_starts(regions), {
	setup: () => ({ regions: cms_page(25) }),
	scale: (_ctx, k) => ({ regions: cms_page(25 * k) })
});
