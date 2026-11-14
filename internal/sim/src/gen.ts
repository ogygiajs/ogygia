/**
 * THE RANDOM APP: `pnpm sim:gen --seed N` writes apps/sim-gen's pages and regions from a seed, so
 * the simulator runs apps nobody wrote by hand: islands on every schedule, holes (deferred
 * regions, some woken after they land, some slow on the server), lakes, nested in each other a few
 * levels deep, on pages a router moves between. Then `pnpm sim:builds --app apps/sim-gen` builds
 * it (twice, for deploys) and `pnpm sim --app apps/sim-gen` runs it.
 *
 *   node src/gen.ts --seed 7 [--app <dir>]
 *
 * Each region is a component of its own (`src/lib/gen/N<k>.svelte`) that imports its children
 * with their import attributes, as an app's components do. What a seed wrote is in
 * `src/lib/gen/plan.json` (the tree, for a finding's issue).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import { rng, type Rng } from './rng.ts';

/** A schedule: one of ogygia's, or a media query (an island wakes while it matches; the sim's and the
 *  player's viewport is 1280 wide, so one of the two never does). */
type Wake = 'load' | 'idle' | 'visible' | 'interaction' | MediaWake;
type MediaWake = '(max-width: 600px)' | '(min-width: 601px)';

/** One region (or plain markup) of a generated page. */
export interface GenNode {
	readonly id: number;
	/** island: a woken region; hole: a deferred one (`wake`: when its HTML is fetched); lake: frozen
	 *  server HTML (`wake: 'none'`); plain: a component with no region of its own; held: a region
	 *  a remote query returns (`region(N, props)`), rendered by a host with `<Region of>` (`wake`:
	 *  its baked schedule, none for `region: 'raw'`); live: one a `query.live` yields anew on each
	 *  tick, rendered by an island host. */
	readonly kind: 'island' | 'hole' | 'lake' | 'plain' | 'held' | 'live';
	readonly wake?: Wake;
	/** A hole whose server render waits this many ms. */
	readonly slow?: number;
	/** A hole the page gives a fallback. */
	readonly fallback?: boolean;
	/** A hole with a fallback that keeps it (`keepFallback()`: the endpoint answers 204). Only a
	 *  page's own root hole: nested in an island, a hole renders inline, where it may not. */
	readonly keep?: boolean;
	/** A held region's host: plain server markup awaiting the query in the page's render
	 *  (`'page'`), or an island reading the query's `.current` (`'island'`). */
	readonly host?: 'page' | 'island';
	/** A held region's island host has a button: a command that changes the server's count and
	 *  answers with the region rendered again (single flight). */
	readonly command?: boolean;
	/** Its command publishes too: it invalidates its page's stored copy (`postrender.invalidate`),
	 *  which a federated app announces to its peers (a thaw notice, through an outbox). */
	readonly publish?: boolean;
	/** A held region on a page host shows a placeholder while it waits. */
	readonly placeholder?: boolean;
	/** A live region's ticks, this many ms apart. */
	readonly every?: number;
	/** A live region whose ticks cycle through three regions: its own, another interactive module
	 *  (`A<id>`) and a static one (`S<id>`): its island is swapped, hydrated anew or dropped. */
	readonly switches?: boolean;
	/** An island whose markup the next release changes (an element only build v2 renders), as a
	 *  release changes a component: what hydrates one build's HTML with the other's code meets. */
	readonly changes?: boolean;
	/** The region has a stylesheet of its own (a scoped `<style>`): an answer that brings it lifts
	 *  its sheet into the head. */
	readonly style?: boolean;
	/** A hole whose render the server keeps this long (`maxAge`, a duration string): every visitor's
	 *  same call is answered from the render cache. */
	readonly maxAge?: string;
	/** The region reads its page's data (`page.data.who` from `$app/state`): a hole or a held region
	 *  rendered outside its page looks its page up. Only on a page that has data. */
	readonly reads?: boolean;
	/** An island that reads its page's data has a button that refreshes it in place
	 *  (`invalidateAll()` from `ogygia/app`: the soft refresh). */
	readonly refresh?: boolean;
	/** An island its parent gives a `Date` prop: its props cross in devalue's lane, not JSON's. */
	readonly dated?: boolean;
	/** MESSY, as apps are (stream `gen messy`): text with quotes, `<`, `>`, `&` and unicode, in an
	 *  attribute and in the text. */
	readonly odd?: boolean;
	/** An island its parent gives a very large prop (100 000 characters). */
	readonly big?: boolean;
	/** A hole whose server render throws: ogygia keeps its fallback (it always has one) and says so
	 *  with a code, never a broken page. */
	readonly throws?: boolean;
	/** A lake that writes bad HTML on purpose (`{@html}`: a block in a `<p>`), marked
	 *  `data-gen-messy`, the app's own: what ogygia does around it must stay whole. */
	readonly bad?: boolean;
	/** A region whose component renders nothing at all (stream `gen empty`): a leaf island, hole or
	 *  lake with no element and no text. Where it is used, `<div data-gen-empty>` holds it, so the
	 *  region oracle knows an empty `<ogygia-region>` there is the app's. */
	readonly empty?: boolean;
	/** An island a third party's script changes while it sleeps (stream `gen third party`): an
	 *  inline script after it, in the page's own HTML, puts an element of its own in the island once
	 *  the document is parsed, after the runtime read the island's server markup and before it wakes.
	 *  Its wake puts the server's markup back (the repair) before it hydrates. Only one that wakes on
	 *  its own (`load`, `idle`): after a router visit the script is inert, and an island still asleep
	 *  there would rightly differ from a fresh load. `prepend` puts an element of its own first;
	 *  `retag` swaps the island's first `<span>` for a `<b>` with the same content (the element count
	 *  kept: the repair's tag check sees it, which a prepended element never reaches). `text` (its own
	 *  stream, `gen third party text`, on islands the others left alone) adds a text node only, so
	 *  every element lines up and the repair walks into each; the island then holds a `<details>`, an
	 *  element whose children are partly its own, which a repair that lined up names no conflict for
	 *  (the gen app's client says any conflict named on the console: apps/sim-gen/src/sim-client.ts). */
	readonly thirdParty?: 'prepend' | 'retag' | 'text';
	/** An island with a `<svelte:head>` of its own (stream `gen head`): a `<meta>` in an `{#if}` and a
	 *  `<style>`, rendered into the document's head, whose page copy the island's live copy retires
	 *  once it wakes (one copy: the waste check sees a `<style>` held twice). `drift`: a third party's
	 *  script puts an element of its own at the start of that head block once the document is parsed,
	 *  where Svelte's head hydration would walk into it (the runtime takes every island's head off
	 *  that walk first). Only one that wakes on its own, in the page's own HTML. */
	readonly head?: 'own' | 'drift';
	/** An island a third party's script edits INSIDE a lake of its own while it sleeps (stream `gen
	 *  third party lake`): once the document is parsed, an element of its own first in the lake. A
	 *  lake is opaque, so the island's wake repairs the island's markup and never the lake's: the mark
	 *  is still there once the island hydrated (`opaque_untouched`). Only one that wakes on its own,
	 *  in the page's own HTML, with no `thirdParty` script of its own. */
	readonly lakeEdit?: boolean;
	/** SCREEN (stream `gen screen`): a page's own hole fetched on the visitor's gesture warming ahead
	 *  on another schedule (`prefetch`), and the margin (`margin`, a `rootMargin`) by which a
	 *  `visible` island, fetch or prefetch looks past the viewport. What schedules owe at rest is the
	 *  oracles' (src/oracles.ts `schedules`). */
	readonly prefetch?: 'load' | 'idle' | 'visible';
	readonly margin?: string;
	/** A block this many px tall right before it (`data-gen-lead`): it starts below the fold, within
	 *  its margin or past it. */
	readonly lead?: number;
	/** RESHAPED (a seed's reshape pass, stream `gen reshape boxes`): the region's label sits in a
	 *  custom element, `<x-gen-box>`, whose server render (the app's pass) moves its children into a
	 *  `<slot>` of its own tree; and, with the pass's `link`, an `<x-gen-link>` in a page's `<a>`,
	 *  whose render is an `<a>` the HTML parser would close the outer one for (a stand-in). ogygia
	 *  restores Svelte's markup before the region hydrates. The outer `<a>` is `data-gen-messy`: an
	 *  `<a>` in an `<a>` is the render's own markup, which the stand-in keeps as the render wrote it
	 *  (gen 24, seed 17: the good-HTML oracle took it for ogygia's). */
	readonly boxed?: 'box' | 'link';
	readonly children: readonly GenNode[];
}

/** A seed's reshape pass (stream `gen reshape`), or null: most apps have none. `trim`: its render
 *  trims and drops whitespace-only text, as a serializer does; `link`: boxed regions also hold a
 *  link host whose render is an `<a>`. */
export interface GenReshape {
	readonly trim: boolean;
	readonly link: boolean;
}

/** Whether a seed's app runs a reshape pass, and its kind (stream `gen reshape`). */
export function reshape_plan(seed: number): GenReshape | null {
	const r = rng(seed).fork('gen reshape');
	if (!r.chance(0.35)) return null;
	return { trim: r.chance(0.5), link: r.chance(0.5) };
}

/** Which regions of a reshaped app sit in a custom element (stream `gen reshape boxes`): an empty
 *  region renders nothing to hold. */
export function boxing(seed: number, pass: GenReshape): (page: GenPage) => GenPage {
	const r = rng(seed).fork('gen reshape boxes');
	const box = (n: GenNode): GenNode => {
		const children = n.children.map(box);
		if (n.empty || !r.chance(0.5)) return { ...n, children };
		return { ...n, children, boxed: pass.link && r.chance(0.5) ? 'link' : 'box' };
	};
	return (page) => ({ ...page, roots: page.roots.map(box) });
}

export interface GenPage {
	readonly path: string;
	readonly roots: readonly GenNode[];
	/** The page opts in to postrender (`config = { postrender: true }`): its HTML is stored and
	 *  served again until a publish invalidates it. */
	readonly postrender?: boolean;
	/** The page has a server load (`{ who }`), which some of its regions read. */
	readonly data?: boolean;
	/** The page opens with a hero image (`fetchpriority="high"`): its critical resource, which island
	 *  code and background downloads wait for (the load scheduler's critical gate). */
	readonly hero?: boolean;
	/** The page ends with a module script of its own (`/late.js`), after ogygia's runtime: the
	 *  document's DOMContentLoaded waits for its download, so the runtime runs while the document
	 *  is parsed and not yet loaded (the paint gate's window). */
	readonly late?: boolean;
	/** The page's server load reads the app's flag (`gate(event)`): each read is an exposure, which the
	 *  sink takes in batches (`flags exposures`). */
	readonly flagged?: boolean;
	/** A tall block before root `before` (stream `gen screen`), `height` px: what follows it starts
	 *  below the fold, or within a margin of it. */
	readonly fold?: { readonly before: number; readonly height: number };
}

const WAKES: readonly Wake[] = ['load', 'idle', 'visible', 'interaction'];

/**
 * Island wakes as real apps have them (apps/palaestra, examples/mfe, apps/docs: 351 island
 * imports, 2026-11): load 71%, visible 22%, interaction and idle 3% each, a media query 1%. The
 * media query is drawn more often here (5%), so a seed sees one.
 */
const REAL_WAKES: ReadonlyArray<readonly [Wake, number]> = [
	['load', 70],
	['visible', 20],
	['interaction', 3],
	['idle', 3],
	['(max-width: 600px)', 2.5],
	['(min-width: 601px)', 2.5]
];

/** How an app's island wakes are drawn, from its own stream (`gen shape`): `real`, as real apps
 *  have them (`REAL_WAKES`), or `drawn`, evenly from ogygia's four (every schedule as often). */
export function shape_plan(seed: number): 'real' | 'drawn' {
	return rng(seed).fork('gen shape').chance(0.5) ? 'real' : 'drawn';
}

/** A region tree drawn from `r`, depth first (a child's id before its parent's, ids from `first`);
 *  `wrap` may turn a drawn region into another kind (held, live); `wake` draws an island's
 *  schedule (one draw of `r`, either way). */
function trees(
	r: Rng,
	wrap: (n: GenNode) => GenNode = (n) => n,
	first = 0,
	wake: (r: Rng) => Wake = (r) => r.pick(WAKES)
): (depth: number) => GenNode {
	let ids = first;
	const node = (depth: number): GenNode => {
		const kind = r.weighted<GenNode['kind']>([
			['island', 4],
			['hole', 3],
			['lake', 1.5],
			['plain', 1.5]
		]);
		const n =
			depth >= 3
				? 0
				: r.weighted<number>([
						[0, 3],
						[1, 2],
						[2, 1]
					]);
		const children = Array.from({ length: n }, () => node(depth + 1));
		const id = ids++;
		if (kind === 'island') return wrap({ id, kind, wake: wake(r), children });
		if (kind === 'hole')
			return {
				id,
				kind,
				wake: r.chance(0.4) ? r.pick(WAKES) : undefined,
				slow: r.chance(0.3) ? r.pick([5, 50, 400]) : undefined,
				fallback: r.chance(0.6),
				children
			};
		return wrap({ id, kind, children });
	};
	return node;
}

/** The plan a seed draws: pages, each a forest of regions up to 3 deep. */
export function plan(seed: number): GenPage[] {
	const r = rng(seed).fork('gen');
	// (held and live regions draw from a stream of their own: a seed's tree, drawn before they
	// existed, stays the same, with some of its regions held)
	const h = rng(seed).fork('gen held');
	// (and whether a command publishes, from its own: a seed's commands stay where they were)
	const p = rng(seed).fork('gen publish');
	const held = (n: GenNode): GenNode => {
		if (n.kind === 'hole' || !h.chance(0.3)) return n;
		const wake = h.chance(0.5) ? h.pick(WAKES) : undefined;
		if (h.chance(0.3))
			return {
				id: n.id,
				kind: 'live',
				wake,
				every: h.pick([700, 3000]),
				children: n.children
			};
		const host = h.chance(0.5) ? 'island' : 'page';
		const command = host === 'island' && h.chance(0.6);
		return {
			id: n.id,
			kind: 'held',
			wake,
			host,
			command,
			publish: command && p.chance(0.5),
			placeholder: host === 'page' && h.chance(0.5),
			children: n.children
		};
	};
	// (and whether a root hole keeps its fallback, from its own)
	const k = rng(seed).fork('gen keep');
	const keep = (n: GenNode): GenNode =>
		n.kind === 'hole' && n.fallback && k.chance(0.4) ? { ...n, keep: true } : n;
	// (and whether a page is stored, from its own)
	const s = rng(seed).fork('gen postrender');
	// (and whether an island's markup changes in the next release, from its own)
	const c = rng(seed).fork('gen release');
	const release = (n: GenNode): GenNode => {
		const children = n.children.map(release);
		return n.kind === 'island' && c.chance(0.3)
			? { ...n, children, changes: true }
			: { ...n, children };
	};
	// (and a region's stylesheet, a hole's render cache and an island's dated props, each from its
	// own)
	const st = rng(seed).fork('gen style');
	const ma = rng(seed).fork('gen max age');
	const dv = rng(seed).fork('gen devalue');
	const extras = (n: GenNode): GenNode => {
		const children = n.children.map(extras);
		const style = st.chance(0.25);
		const max_age =
			n.kind === 'hole' && !n.keep && ma.chance(0.3) ? ma.pick(['2s', '30s']) : undefined;
		const dated = n.kind === 'island' && dv.chance(0.25);
		return {
			...n,
			children,
			...(style ? { style } : {}),
			...(max_age ? { maxAge: max_age } : {}),
			...(dated ? { dated } : {})
		};
	};
	// (and whether a page has data its regions read, from its own)
	const d = rng(seed).fork('gen page data');
	const reading = (n: GenNode): GenNode => {
		const children = n.children.map(reading);
		if (!d.chance(0.4)) return { ...n, children };
		const refresh = n.kind === 'island' && d.chance(0.5);
		return { ...n, children, reads: true, ...(refresh ? { refresh } : {}) };
	};
	// (and the app's messy parts, from its own)
	const m = rng(seed).fork('gen messy');
	const messy = (n: GenNode): GenNode => {
		const children = n.children.map(messy);
		const odd = m.chance(0.15);
		const big = n.kind === 'island' && m.chance(0.1);
		const throws = n.kind === 'hole' && !n.keep && m.chance(0.15);
		const bad = n.kind === 'lake' && m.chance(0.3);
		return {
			...n,
			children,
			...(odd ? { odd } : {}),
			...(big ? { big } : {}),
			...(throws ? { throws, fallback: true } : {}),
			...(bad ? { bad } : {})
		};
	};
	// (and an empty region, from its own: a leaf with nothing else to show)
	const e = rng(seed).fork('gen empty');
	const empty = (n: GenNode): GenNode => {
		const children = n.children.map(empty);
		const plain =
			children.length === 0 &&
			(n.kind === 'island' || n.kind === 'hole' || n.kind === 'lake') &&
			!(n.odd || n.big || n.bad || n.throws || n.keep || n.reads || n.refresh) &&
			!(n.dated || n.changes || n.style);
		return plain && e.chance(0.15) ? { ...n, children, empty: true } : { ...n, children };
	};
	// (and whether a page opens with a hero image, from its own)
	const hr = rng(seed).fork('gen hero');
	// (and whether it ends with a module of its own, from its own)
	const lm = rng(seed).fork('gen late module');
	const switching = switcher(seed);
	const node = trees(
		r,
		held,
		0,
		shape_plan(seed) === 'real' ? (r) => r.weighted(REAL_WAKES) : undefined
	);
	const pages = r.between(3, 6);
	return Array.from({ length: pages }, (_, i) => ({
		path: `/p${i}`,
		roots: Array.from({ length: r.between(1, 4) }, () => node(0)).map(keep)
	}))
		.map((page) => (s.chance(0.3) ? { ...page, postrender: true } : page))
		.map((page) => ({ ...page, roots: page.roots.map(release) }))
		.map((page) => ({ ...page, roots: page.roots.map(extras) }))
		.map((page) => (d.chance(0.4) ? { ...page, data: true, roots: page.roots.map(reading) } : page))
		.map((page) => ({ ...page, roots: page.roots.map(messy) }))
		.map((page) => ({ ...page, roots: page.roots.map(empty) }))
		.map((page) => (hr.chance(0.4) ? { ...page, hero: true } : page))
		.map((page) => (lm.chance(0.4) ? { ...page, late: true } : page))
		.map((page) => ({ ...page, roots: page.roots.map(switching) }))
		.map(flagging(seed))
		.map(third_party(seed))
		.map(heads(seed))
		.map(screen(seed))
		.map(lake_edits(seed));
}

/** Margins a `visible` schedule may look past the viewport by: px, % of the viewport, one side. */
const MARGINS = ['200px', '600px', '50%', '0px 0px 300px 0px'] as const;
/** Heights of the block before a region that looks past the viewport (the fold is at 720 px). */
const LEADS = [760, 900, 1100] as const;

/** A region with a margin is imported by a preset (a margin is never an inline attribute): its name
 *  and options. The app's config takes every preset its pages name from plan.json's `presets`. */
function screen_preset(n: GenNode): [string, Record<string, string>] {
	const m = `m${MARGINS.indexOf(n.margin as (typeof MARGINS)[number])}`;
	if (n.kind === 'island') return [`visible-${m}`, { wake: 'visible', margin: n.margin! }];
	const fetch = n.wake ?? 'load';
	return [
		`screen-${fetch}${n.prefetch ? `-${n.prefetch}` : ''}-${m}`,
		{
			render: 'deferred',
			...(n.wake ? { fetch: n.wake } : {}),
			...(n.prefetch ? { prefetch: n.prefetch } : {}),
			margin: n.margin!
		}
	];
}

/** Every screen preset `pages` name (see {@link screen_preset}). */
function screen_presets(pages: readonly GenPage[]): Record<string, Record<string, string>> {
	const out: Record<string, Record<string, string>> = {};
	const walk = (n: GenNode): void => {
		if (n.margin && (n.kind === 'island' || n.kind === 'hole') && !n.maxAge) {
			const [name, options] = screen_preset(n);
			out[name] = options;
		}
		n.children.forEach(walk);
	};
	for (const p of pages) p.roots.forEach(walk);
	return out;
}
/** Where the screen decides (its own stream, `gen screen`): some pages put their later regions
 *  below the fold, some `visible` islands look past it by a margin, and some of a page's own holes
 *  fetch on the visitor's gesture, warming ahead on another schedule (a hole's `wake` is its fetch).
 *  Drawn after every other stream: their draws stay as they were. */
function screen(seed: number): (page: GenPage) => GenPage {
	const s = rng(seed).fork('gen screen');
	// (a tall block right before a region that looks past the viewport, from its own stream: what
	// follows the fold by less than its margin is owed, what follows it by more is not)
	const l = rng(seed).fork('gen screen lead');
	const lead = (n: GenNode): GenNode => (l.chance(0.7) ? { ...n, lead: l.pick(LEADS) } : n);
	const walk = (n: GenNode, root: boolean): GenNode => {
		const children = n.children.map((c) => walk(c, false));
		if (n.kind === 'island' && n.wake === 'visible' && s.chance(0.5))
			return lead({ ...n, children, margin: s.pick(MARGINS) });
		// (a page's own hole: nested in an island, a hole renders inline; a kept render is a preset's)
		if (n.kind === 'hole' && root && !n.maxAge && !n.keep && n.fallback) {
			const wake = s.chance(0.25) ? 'interaction' : n.wake;
			const prefetch =
				wake === 'interaction' && s.chance(0.7)
					? s.pick(['load', 'idle', 'visible'] as const)
					: undefined;
			const looks = wake === 'visible' || prefetch === 'visible';
			const margin = looks && s.chance(0.6) ? s.pick(MARGINS) : undefined;
			const hole = {
				...n,
				children,
				...(wake ? { wake } : {}),
				...(prefetch ? { prefetch } : {}),
				...(margin ? { margin } : {})
			};
			return looks ? lead(hole) : hole;
		}
		return { ...n, children };
	};
	return (page) => {
		const roots = page.roots.map((n) => walk(n, true));
		if (roots.length < 2 || !s.chance(0.5)) return { ...page, roots };
		const fold = { before: s.between(1, roots.length - 1), height: s.pick([500, 700, 900, 1400]) };
		return { ...page, roots, fold };
	};
}

/** Some islands have a `<svelte:head>` of their own (their own stream, `gen head`), and a third
 *  party edits some of those head blocks: an island that wakes on its own, in the page's own HTML. */
function heads(seed: number): (page: GenPage) => GenPage {
	const h = rng(seed).fork('gen head');
	const walk = (n: GenNode, page: boolean): GenNode => {
		const children = n.children.map((c) =>
			walk(c, page && (n.kind === 'island' || n.kind === 'plain'))
		);
		const can = page && n.kind === 'island' && (n.wake === 'load' || n.wake === 'idle') && !n.empty;
		if (can && h.chance(0.3)) return { ...n, children, head: h.chance(0.5) ? 'drift' : 'own' };
		return { ...n, children };
	};
	return (page) => ({ ...page, roots: page.roots.map((n) => walk(n, true)) });
}

/** The third party's script after an island whose head block it edits (`head: 'drift'`): once the
 *  document is parsed, an element of its own right after the block's open marker (the comment before
 *  the island's `<style>` that is no block anchor). */
const head_drift_script = (id: number): string =>
	`{@html '<scr' + 'ipt>${[
		'document.addEventListener("DOMContentLoaded",function(){',
		`var n=document.head.querySelector("style[data-gen-head=n${id}]");`,
		'while(n&&(n=n.previousSibling))if(n.nodeType===8&&n.data&&n.data[0]!=="["&&n.data!=="]")break;',
		'if(n){var m=document.createElement("meta");m.setAttribute("data-gen-third-party","");n.after(m);}',
		'})'
	].join('')}</scr' + 'ipt>'}`;

/** Some islands a third party's script changes while they sleep (their own stream, `gen third
 *  party`): an island that wakes on its own, in the page's own HTML (under islands and plain markup
 *  only: an answer's or a lake's HTML is inserted, not parsed with the page). */
function third_party(seed: number): (page: GenPage) => GenPage {
	const t = rng(seed).fork('gen third party');
	// (which edit, from a stream of its own: the islands it touches stay as they were drawn)
	const k = rng(seed).fork('gen third party kind');
	// (a text drift, from a stream of its own, on islands the first stream left alone: the islands
	// and kinds it drew stay as they were)
	const x = rng(seed).fork('gen third party text');
	const walk = (n: GenNode, page: boolean): GenNode => {
		const children = n.children.map((c) =>
			walk(c, page && (n.kind === 'island' || n.kind === 'plain'))
		);
		const can = page && n.kind === 'island' && (n.wake === 'load' || n.wake === 'idle') && !n.empty;
		if (can && t.chance(0.3))
			return { ...n, children, thirdParty: k.chance(0.5) ? 'retag' : 'prepend' };
		return can && x.chance(0.3) ? { ...n, children, thirdParty: 'text' } : { ...n, children };
	};
	return (page) => ({ ...page, roots: page.roots.map((n) => walk(n, true)) });
}

/** The third party's script after an island (`thirdParty`): once the document is parsed it edits the
 *  island's markup (`edit`, with the island's `[data-gen]` element as `el`). In `{@html}`, spelled
 *  so the component's own parser never meets a closing script tag. */
const third_party_script = (edit: string): string =>
	`{@html '<scr' + 'ipt>${[
		'(function(){var s=document.currentScript;document.addEventListener("DOMContentLoaded",function(){',
		'var r=s&&s.previousElementSibling;var el=r&&(r.matches("[data-gen]")?r:r.querySelector("[data-gen]"));',
		`if(el){${edit}}})})()`
	].join('')}</scr' + 'ipt>'}`;
const THIRD_PARTY = {
	prepend: third_party_script(
		'var b=document.createElement("b");b.setAttribute("data-gen-third-party","");b.textContent="third party";el.prepend(b);'
	),
	retag: third_party_script(
		'var f=el.firstElementChild;if(f&&f.localName==="span"){var b=document.createElement("b");while(f.firstChild)b.appendChild(f.firstChild);f.replaceWith(b);}'
	),
	text: third_party_script('el.appendChild(document.createTextNode(" third party"));')
};

/** Some islands a third party's script edits inside a lake of theirs (`lakeEdit`, their own stream,
 *  `gen third party lake`): an island `third_party` can edit, with no edit of its own, holding a
 *  lake with markup. */
function lake_edits(seed: number): (page: GenPage) => GenPage {
	const l = rng(seed).fork('gen third party lake');
	const has_lake = (n: GenNode): boolean =>
		n.children.some((c) => (c.kind === 'lake' && !c.empty) || (c.kind === 'plain' && has_lake(c)));
	const walk = (n: GenNode, page: boolean): GenNode => {
		const children = n.children.map((c) =>
			walk(c, page && (n.kind === 'island' || n.kind === 'plain'))
		);
		const can =
			page &&
			n.kind === 'island' &&
			(n.wake === 'load' || n.wake === 'idle') &&
			!n.empty &&
			!n.thirdParty &&
			has_lake(n);
		return can && l.chance(0.5) ? { ...n, children, lakeEdit: true } : { ...n, children };
	};
	return (page) => ({ ...page, roots: page.roots.map((n) => walk(n, true)) });
}

/** The third party's script after an island whose lake it edits (`lakeEdit`): once the document is
 *  parsed it puts a `<b data-gen-lake-mark>` first in the island's first lake, and keeps the
 *  island's region on the window (`__sim_gen_lake_edits`) for `opaque_untouched` to read. */
const LAKE_EDIT = `{@html '<scr' + 'ipt>${[
	'(function(){var s=document.currentScript;document.addEventListener("DOMContentLoaded",function(){',
	'var r=s&&s.previousElementSibling;var l=r&&r.querySelector("ogygia-region[wake=none] [data-gen]");',
	'if(l){var b=document.createElement("b");b.setAttribute("data-gen-lake-mark","");b.textContent="third party";l.prepend(b);',
	'(window.__sim_gen_lake_edits||(window.__sim_gen_lake_edits=[])).push(r);}})})()'
].join('')}</scr' + 'ipt>'}`;

/** Some apps read a flag on some pages (their own stream, `gen flags`): 40% of seeds, half their
 *  pages. */
function flagging(seed: number): (page: GenPage) => GenPage {
	const f = rng(seed).fork('gen flags');
	const on = f.chance(0.4);
	return (page) => (on && f.chance(0.5) ? { ...page, flagged: true } : page);
}

/** The app's flags (`src/lib/gen/flags.server.ts`, imported by its hooks): a kill switch, off for
 *  every visitor (so a fresh load decides the same), and an exposure sink that takes batches of 3 or
 *  what came in 500 ms. Empty when no page reads it. */
function app_flags(pages: readonly GenPage[]): string {
	if (!pages.some((p) => p.flagged)) return 'export {};\n';
	return `import { decide, flag } from '@ogygia/flags';

export const gate = flag('gen-gate');

// (the sink: what an analytics pipeline would take; counted so a run can see it was reached)
const seen = globalThis as unknown as { __sim_gen_exposures?: number };
const take = (n: number) => (seen.__sim_gen_exposures = (seen.__sim_gen_exposures ?? 0) + n);
decide({ exposure: (events) => void take(events.length), batch: { max: 3, ms: 500 } });
`;
}

/** Some live regions switch (their own stream, `gen live switch`): drawn per live region in tree
 *  order, so every other draw stays where it was. */
function switcher(seed: number): (n: GenNode) => GenNode {
	const sw = rng(seed).fork('gen live switch');
	const walk = (n: GenNode): GenNode => {
		const children = n.children.map(walk);
		return n.kind === 'live' && sw.chance(0.5)
			? { ...n, children, switches: true }
			: { ...n, children };
	};
	return walk;
}

/** The hero image the app serves (`/hero.png`): a 1x1 PNG, loaded over the simulated network. */
const HERO_ROUTE = `// (a page's hero: its critical resource, loaded over the simulated network)
const PNG = Uint8Array.from(
\tatob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
\t(c) => c.charCodeAt(0)
);

export const GET = () =>
\tnew Response(PNG, {
\t\theaders: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' }
\t});
`;

/** The page's own module the app serves (`/late.js`, GenPage `late`): empty, loaded over the
 *  simulated network. */
const LATE_ROUTE = `// (a page's own deferred module, after ogygia's runtime: DOMContentLoaded waits for it)
export const GET = () =>
\tnew Response('export {};\\n', {
\t\theaders: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=31536000, immutable' }
\t});
`;

/** Whether a seed's app runs the router (stream `gen router`): most do; one without it navigates
 *  page to page, and its `invalidateAll()` is the document's own soft refresh (loaded on first use). */
export function router_plan(seed: number): boolean {
	return !rng(seed).fork('gen router').chance(0.25);
}

/** The ogygia release a generated app may be upgraded from (`released_plan`). */
export const RELEASE = '0.12.3';

/** The release a seed's app is upgraded from mid-session, or null (stream `gen released`): an app
 *  that uses only ogygia's own package (no peer, no reshape pass, no flag, no stored page, no
 *  command that publishes) has its first build on that release and its second on this tree, as an app upgrading
 *  ogygia deploys it (src/builds.ts). A rolling deploy then answers the new release's pages from the
 *  old release's servers for a while. */
export function released_plan(
	seed: number,
	pages: readonly GenPage[],
	peer: GenPeer | null,
	reshape: GenReshape | null
): string | null {
	const publishes = (ns: readonly GenNode[]): boolean =>
		ns.some((n) => n.publish === true || publishes(n.children));
	const later = (p: GenPage) => p.flagged || p.postrender || publishes(p.roots);
	if (peer !== null || reshape !== null || pages.some(later)) return null;
	return rng(seed).fork('gen released').chance(0.3) ? RELEASE : null;
}

/** The first id of the layout's regions: never one of the pages' (the peer's start at 1000). */
export const LAYOUT_FIRST = 500;

/** The region tree a seed's layout holds, or null (stream `gen layout`): a hole with a stylesheet of
 *  its own, after the nav on every page, so a router navigation keeps it on screen while the next
 *  page's head does not list its sheet (#275); some with an island inside, styled too. */
export function layout_plan(seed: number): GenNode | null {
	const r = rng(seed).fork('gen layout');
	if (!r.chance(0.4)) return null;
	const children: GenNode[] = r.chance(0.5)
		? [{ id: LAYOUT_FIRST + 1, kind: 'island', wake: r.pick(WAKES), style: true, children: [] }]
		: [];
	return {
		id: LAYOUT_FIRST,
		kind: 'hole',
		wake: r.chance(0.5) ? r.pick(WAKES) : undefined,
		fallback: r.chance(0.5),
		style: true,
		children
	};
}

/** A widget the peer app serves (`federate({ widgets })`): a root holding a region tree. */
export interface GenWidget {
	readonly name: string;
	readonly children: readonly GenNode[];
}

/** One place a page of the app renders a peer's widget, from its load. */
export interface GenSlot {
	readonly id: number;
	/** The app's page (`/p<i>`). */
	readonly page: string;
	readonly widget: string;
	/** Baked into the page in one signed hop, or a hole the page's browser fetches through the
	 *  app's own endpoint. */
	readonly render: 'static' | 'deferred';
	/** The page shows a placeholder while a deferred one comes. */
	readonly placeholder: boolean;
}

/** The peer app of a federated seed (apps/sim-gen-peer): widgets the app's pages render, and pages
 *  the app mounts under `/peer` (through its server router's `mount(peer)`, or a Kit catchall's
 *  `mount.kit(peer)`). */
export interface GenPeer {
	readonly mount: 'router' | 'kit';
	readonly widgets: readonly GenWidget[];
	/** The peer's own pages (`/q<i>`), at `/peer/q<i>` in the app. */
	readonly pages: readonly GenPage[];
	readonly slots: readonly GenSlot[];
	/** The app keeps the peer's page documents this many ms (`cache: { ttl }`, served stale while
	 *  one fetch refreshes them); 0: no cache. */
	readonly ttl: number;
	/** Edge pages its pages link to: `/gone` (no route), `/moved` (to `/q0`), `/who` (the visitor).
	 *  test/gen.test.ts, test/oracles.test.ts `peer_answers`. */
	readonly edges: {
		readonly gone: boolean;
		readonly moved: boolean;
		readonly who: boolean;
		/** `/bad`: a page the peer refuses, a 400 (its load throws the router's `error`). */
		readonly bad: boolean;
	};
	/** Origins the peer answers at: 2 is one build at `peer.test` and `peer2.test`. test/gen.test.ts. */
	readonly origins: 1 | 2;
}

/** The peer a seed draws for its app of `pages`, or null (most seeds: one app alone). Its own
 *  stream (`gen peer`): the app's tree is what it was before peers existed. */
export function peer_plan(seed: number, pages: readonly GenPage[]): GenPeer | null {
	const r = rng(seed).fork('gen peer');
	if (!r.chance(0.5)) return null;
	// (the peer's regions are numbered from 1000: its `n1003` is never the app's `n3`)
	const node = trees(r, undefined, 1000);
	const widgets = Array.from({ length: r.between(1, 3) }, (_, i) => ({
		name: `w${i}`,
		children: Array.from({ length: r.between(1, 3) }, () => node(1))
	}));
	const own = Array.from({ length: r.between(1, 3) }, (_, i) => ({
		path: `/q${i}`,
		roots: Array.from({ length: r.between(1, 3) }, () => node(0))
	}));
	let ids = 0;
	const slots: GenSlot[] = [];
	for (const page of pages)
		for (
			let k = r.weighted<number>([
				[0, 2],
				[1, 3],
				[2, 1]
			]);
			k > 0;
			k--
		) {
			const render = r.chance(0.5) ? 'static' : 'deferred';
			slots.push({
				id: ids++,
				page: page.path,
				widget: r.pick(widgets).name,
				render,
				placeholder: render === 'deferred' && r.chance(0.5)
			});
		}
	const mount = r.chance(0.7) ? 'router' : 'kit';
	// (its own stream: a seed's peer stays what it was)
	const ttl = rng(seed)
		.fork('gen peer cache')
		.weighted<number>([
			[0, 2],
			[300, 1],
			[2000, 1],
			[30_000, 1]
		]);
	// (and the peer's region stylesheets, which its server router links for a page it renders, and
	// its pages' loads, each from its own stream)
	const ps = rng(seed).fork('gen peer style');
	const styled = (n: GenNode): GenNode => {
		const children = n.children.map(styled);
		return ps.chance(0.25) ? { ...n, children, style: true } : { ...n, children };
	};
	const pd = rng(seed).fork('gen peer data');
	const pe = rng(seed).fork('gen peer edges');
	const edges = {
		gone: pe.chance(0.5),
		moved: pe.chance(0.5),
		who: pe.chance(0.5),
		// (its own stream: a seed's other edges stay what they were)
		bad: rng(seed).fork('gen peer bad').chance(0.5)
	};
	const origins = rng(seed).fork('gen peer origins').chance(0.4) ? 2 : 1;
	return {
		mount,
		widgets: widgets.map((w) => ({ ...w, children: w.children.map(styled) })),
		pages: own
			.map((p) => ({ ...p, roots: p.roots.map(styled) }))
			.map((p) => (pd.chance(0.5) ? { ...p, data: true } : p)),
		slots,
		ttl,
		edges,
		origins
	};
}

/** How a parent imports `n`: its import attributes. */
function attributes(n: GenNode): string {
	switch (n.kind) {
		case 'island':
			return n.margin
				? ` with { preset: '${screen_preset(n)[0]}' }`
				: ` with { wake: '${n.wake}' }`;
		case 'lake':
			return ` with { wake: 'none' }`;
		case 'hole': {
			// (a kept render is a preset's: apps/sim-gen/vite.config.ts)
			if (n.maxAge) return ` with { preset: 'hole-${n.maxAge}${n.wake ? `-${n.wake}` : ''}' }`;
			if (n.margin) return ` with { preset: '${screen_preset(n)[0]}' }`;
			const own = [
				...(n.wake ? [`fetch: '${n.wake}'`] : []),
				...(n.prefetch ? [`prefetch: '${n.prefetch}'`] : [])
			];
			return ` with { ${["render: 'deferred'", ...own].join(', ')} }`;
		}
		case 'plain':
			return '';
		// (the parent imports the region's host: a plain component, or an island)
		case 'held':
			return n.host === 'island' ? ` with { wake: 'load' }` : '';
		case 'live':
			return ` with { wake: 'load' }`;
	}
}

/** The component a parent imports for `n`: the region's own, or a held region's host. */
function name(n: GenNode): string {
	return n.kind === 'held' || n.kind === 'live' ? `H${n.id}` : `N${n.id}`;
}

/** Where `n` is used: its tag, with a fallback for a hole that has one. */
function usage(n: GenNode, indent: string): string {
	if (n.lead)
		return `${indent}<div data-gen-lead style="height: ${n.lead}px"></div>\n${usage({ ...n, lead: undefined }, indent)}`;
	if (n.empty)
		return [
			`${indent}<div data-gen-empty>`,
			usage({ ...n, empty: false }, `${indent}\t`),
			`${indent}</div>`
		].join('\n');
	if (n.kind === 'hole' && n.fallback)
		// (a fallback the hole keeps on purpose says so: the fallback oracle leaves it standing)
		return `${indent}<N${n.id} label="n${n.id}">
${indent}\t{#snippet ogygiaFallback()}<p data-gen-fallback${n.keep ? ' data-gen-kept' : ''}>loading n${n.id}…</p>{/snippet}
${indent}</N${n.id}>`;
	if (n.kind === 'held' || n.kind === 'live') return `${indent}<${name(n)} />`;
	// (a fixed instant: what devalue carries, the same in every render)
	const since = n.dated ? ` since={new Date(${n.id * 86_400_000})}` : '';
	const blob = n.big ? ` blob={'x'.repeat(100_000)}` : '';
	const third = n.thirdParty ? `\n${indent}${THIRD_PARTY[n.thirdParty]}` : '';
	const drift = n.head === 'drift' ? `\n${indent}${head_drift_script(n.id)}` : '';
	// (first after the island: its script finds the island as its previous element)
	const lake = n.lakeEdit ? `\n${indent}${LAKE_EDIT}` : '';
	return `${indent}<N${n.id} label="n${n.id}"${since}${blob} />${lake}${third}${drift}`;
}

/** A held or live region's remote module: the query that returns it (and the command that changes
 *  it), importing its component with the schedule it bakes. A command that publishes invalidates
 *  `page`, the page the region is on. */
function remote(n: GenNode, page: string): string {
	const mark = n.wake ? `{ wake: '${n.wake}' }` : `{ region: 'raw' }`;
	const lines = [
		`import { ${n.kind === 'live' ? 'query' : 'command, query'} } from '$app/server';`,
		`import { region } from 'ogygia';`,
		...(n.publish ? [`import { postrender } from '@ogygia/postrender';`] : []),
		`import N${n.id} from './N${n.id}.svelte' with ${mark};`,
		...(n.switches
			? [
					`import A${n.id} from './A${n.id}.svelte' with { wake: 'load' };`,
					`import S${n.id} from './S${n.id}.svelte' with { region: 'raw' };`
				]
			: []),
		''
	];
	// (a switching one cycles: its own region, another interactive module, a static one)
	const shown = n.switches ? `[N${n.id}, A${n.id}, S${n.id}][n % 3]` : `N${n.id}`;
	if (n.kind === 'live')
		lines.push(
			`export const live${n.id} = query.live(async function* () {`,
			`\tfor (let n = 0; ; n++) {`,
			`\t\tyield await region(${shown}, { label: \`n${n.id} tick \${n}\` });`,
			`\t\tawait new Promise((r) => setTimeout(r, ${n.every}));`,
			`\t}`,
			`});`
		);
	else
		lines.push(
			`// (the server's count of this region's commands: what a command changes)`,
			`const counts = globalThis as unknown as { __sim_gen_held?: Record<number, number> };`,
			`const count = () => (counts.__sim_gen_held ??= {})[${n.id}] ?? 0;`,
			`const label = () => \`n${n.id} #\${count()}\`;`,
			'',
			`export const held${n.id} = query(async () => await region(N${n.id}, { label: label() }));`,
			'',
			`export const bump${n.id} = command(async () => {`,
			`\t(counts.__sim_gen_held ??= {})[${n.id}] = count() + 1;`,
			...(n.publish
				? [
						`\t// (a publish: the page's stored copy goes, and the app's peers hear of it)`,
						`\tawait postrender.invalidate('${page}');`
					]
				: []),
			`\treturn await region(N${n.id}, { label: label() });`,
			`});`
		);
	return `${lines.join('\n')}\n`;
}

/** A held or live region's host. */
function host(n: GenNode): string {
	const call = n.kind === 'live' ? `live${n.id}` : `held${n.id}`;
	const imports = n.kind === 'held' && n.command ? `${call}, bump${n.id}` : call;
	const lines = [
		'<script lang="ts">',
		`\timport { Region } from 'ogygia';`,
		`\timport { ${imports} } from './h${n.id}.remote';`
	];
	if (n.kind === 'held' && n.host === 'page')
		return [
			...lines,
			'</script>',
			'',
			`<div data-gen="held-host">`,
			n.placeholder
				? `\t<Region of={${call}()}>\n\t\t{#snippet placeholder()}<p data-gen-placeholder>waiting for n${n.id}…</p>{/snippet}\n\t</Region>`
				: `\t<Region of={${call}()} />`,
			'</div>',
			''
		].join('\n');
	return [
		...lines,
		`\tconst value = ${call}();`,
		'</script>',
		'',
		`<div data-gen="${n.kind}-host">`,
		'\t{#if value.current}',
		'\t\t<Region of={value.current} />',
		'\t{:else if value.error}',
		`\t\t<span data-gen-error>n${n.id} failed</span>`,
		'\t{:else}',
		`\t\t<span data-gen-pending>connecting n${n.id}…</span>`,
		'\t{/if}',
		...(n.kind === 'held' && n.command
			? [`\t<button onclick={() => bump${n.id}()}>bump n${n.id}</button>`]
			: []),
		'</div>',
		''
	].join('\n');
}

/** What an odd component says: quotes, markup characters, an entity's spelling and unicode. */
const ODD_TEXT = `say "hi" & 'bye' <b>not bold</b> a > b &amp; é ü 中文 😀 ​ end`;

/** The component file of `n`. */
function component(n: GenNode): string {
	if (n.empty)
		return `<script lang="ts">
\timport type { Snippet } from 'svelte';
\tlet { label = '' }: { label?: string; ogygiaFallback?: Snippet } = $props();
\x3C/script>
`;
	// (a hole ships no JS, whatever its `fetch`: its own islands are what wake in it)
	const interactive =
		n.kind === 'island' || ((n.kind === 'held' || n.kind === 'live') && n.wake !== undefined);
	const lines = [
		'<script lang="ts">',
		"\timport type { Snippet } from 'svelte';",
		...(n.keep ? ["\timport { keepFallback } from 'ogygia';"] : []),
		...(n.reads ? ["\timport { page } from '$app/state';"] : []),
		...(n.refresh ? ["\timport { invalidateAll } from 'ogygia/app';"] : [])
	];
	for (const c of n.children)
		lines.push(`\timport ${name(c)} from './${name(c)}.svelte'${attributes(c)};`);
	lines.push(
		`\tlet { label = ''${n.dated ? ', since' : ''}${n.big ? ", blob = ''" : ''} }: { label?: string;${n.dated ? ' since?: Date;' : ''}${n.big ? ' blob?: string;' : ''} ogygiaFallback?: Snippet } = $props();`,
		...(interactive ? ['\tlet count = $state(0);'] : []),
		...(n.odd ? [`\tconst note = ${JSON.stringify(ODD_TEXT)};`] : []),
		// (a render that throws, on the server: the hole's endpoint answers what it can)
		...(n.throws ? [`\tif (label) throw new Error('n${n.id} throws');`] : []),
		...(n.keep
			? ['\tkeepFallback();']
			: n.slow
				? [`\tawait new Promise((r) => setTimeout(r, ${n.slow}));`]
				: []),
		'</script>',
		'',
		...(n.head
			? [
					'<svelte:head>',
					`\t{#if label}<meta name="gen-head-n${n.id}" content={label} />{/if}`,
					`\t<style data-gen-head="n${n.id}">.h${n.id} { color: inherit; }</style>`,
					'</svelte:head>',
					''
				]
			: []),
		`<div data-gen="${n.kind}"${n.style ? ` class="g${n.id}"` : ''} data-build={import.meta.env.VITE_SIM_BUILD}>`,
		...(n.changes
			? ["\t{#if import.meta.env.VITE_SIM_BUILD === 'v2'}<em data-gen-new>new in v2</em>{/if}"]
			: []),
		...(n.boxed
			? [
					`\t<x-gen-box data-n="${n.id}">`,
					'\t\t<span>{label}</span>',
					// (text with runs of whitespace at its edges, which a trimming pass changes and the
					// restore puts back: oracles.ts `text_restored`)
					"\t\t<b data-gen-pad>{'  pad  '}</b>",
					`\t\t<i>box n${n.id}</i>`,
					'\t</x-gen-box>',
					...(n.boxed === 'link'
						? [`\t<a data-gen-link data-gen-messy><x-gen-link> go {label} </x-gen-link></a>`]
						: [])
				]
			: ['\t<span>{label}</span>']),
		...(n.dated ? ['\t<time>{since?.toISOString()}</time>'] : []),
		...(n.reads ? ['\t<i data-gen-page>{page.data.who}</i>'] : []),
		...(n.odd ? ['\t<b title={note} data-note={note}>{note}</b>'] : []),
		...(n.big ? ['\t<small>{blob.length}</small>'] : []),
		// (its summary reads a prop, so the hydration walk enters it, and so does the repair)
		...(n.thirdParty === 'text' ? ['\t<details><summary>{label}</summary></details>'] : []),
		...(n.bad
			? [
					`\t<div data-gen-messy>{@html '<p>n${n.id} said<div>a block</div></p><a href="#x">a<a href="#y">b</a></a>'}</div>`
				]
			: []),
		...(interactive
			? ['\t<button onclick={() => (count += 1)}>{label} pressed {count}</button>']
			: []),
		...(n.refresh ? [`\t<button onclick={() => invalidateAll()}>refresh n${n.id}</button>`] : []),
		...n.children.map((c) => usage(c, '\t')),
		'</div>',
		...(n.style
			? [
					'',
					'<style>',
					`\t.g${n.id} { border-left: ${(n.id % 4) + 1}px solid; }`,
					`\t.g${n.id} > span { font-weight: ${n.id % 2 ? 'bold' : 'normal'}; }`,
					'</style>'
				]
			: []),
		''
	);
	return lines.join('\n');
}

/** A switching live region's other regions: another interactive module (a button), or a static one. */
function switched(n: GenNode, interactive: boolean): string {
	return [
		'<script lang="ts">',
		"\tlet { label = '' }: { label?: string } = $props();",
		...(interactive ? ['\tlet count = $state(0);'] : []),
		'</script>',
		'',
		`<div data-gen="${interactive ? 'live-other' : 'live-static'}" data-build={import.meta.env.VITE_SIM_BUILD}>`,
		'\t<span>{label}</span>',
		...(interactive
			? ['\t<button onclick={() => (count += 1)}>{label} other pressed {count}</button>']
			: []),
		'</div>',
		''
	].join('\n');
}

/** Where a federated app mounts its peer's pages. */
export const MOUNT = '/peer';
/** A peer's edge pages, as the app mounts them (oracles.ts `peer_answers`). */
export const EDGE_GONE = `${MOUNT}/gone`;
export const EDGE_MOVED = `${MOUNT}/moved`;
export const EDGE_BAD = `${MOUNT}/bad`;

/** A slot's tag on its page: the widget's region, with a placeholder for a deferred one that has
 *  one. */
function slot_usage(s: GenSlot): string {
	return s.placeholder
		? `<div data-gen="slot">
\t<Region of={data.r${s.id}}>
\t\t{#snippet placeholder()}<p data-gen-placeholder>waiting for r${s.id}…</p>{/snippet}
\t</Region>
</div>`
		: `<div data-gen="slot"><Region of={data.r${s.id}} /></div>`;
}

/** The app's federation (`src/lib/gen/federation.server.ts`): one identity, the peer it calls. */
function app_federation(peer: GenPeer): string {
	const cache = peer.ttl > 0 ? `, cache: { ttl: ${peer.ttl} }` : '';
	const origin =
		peer.origins === 2
			? `[env.PEER_ORIGIN ?? 'https://peer.test', env.PEER2_ORIGIN ?? 'https://peer2.test']`
			: `env.PEER_ORIGIN ?? 'https://peer.test'`;
	return `import { federate } from '@ogygia/federation';
import { env } from '$env/dynamic/private';

// (the simulator gives each app its keys and every app's origin: internal/sim/src/cli.ts)
export const { peer } = federate({
\tname: 'app',
\tkey: env.APP_SIGNING_KEY,
\tvisitor: () => ({ sub: 'visitor' }),
\tpeers: { peer: { origin: ${origin}, key: env.PEER_PUBLIC_KEY${cache} } }
});
`;
}

/** The app's server hook beside ogygia's (`src/lib/gen/mount.server.ts`): the peer's pages
 *  mounted under `/peer` by a server router, or nothing. It imports the federation either way
 *  (test/gen.test.ts: gen 220 seed 19). */
function app_mount(peer: GenPeer | null): string {
	if (peer?.mount !== 'router')
		return `import type { Handle } from '@sveltejs/kit';
${peer ? `import './federation.server.ts';\n` : ''}
export const handle: Handle = ({ event, resolve }) => resolve(event);
`;
	return `import type { Handle } from '@sveltejs/kit';
import { routes } from '@ogygia/router';
import { mount } from '@ogygia/federation';
import { peer } from './federation.server.ts';

const mounted = routes({ '${MOUNT}/[...rest]': mount(peer) }, { base: '', visitor: () => ({ sub: 'visitor' }) });

export const handle: Handle = ({ event, resolve }) => mounted.handle({ event, resolve });
`;
}

/** The app's reshape pass (`src/lib/gen/reshape.server.ts`): a handle in front of ogygia's. Without
 *  one, a handle that passes every request on. With one, a web-component server render reduced to
 *  its moves: each `<x-gen-box>` renders a tree of its own into its light DOM and moves its children
 *  into a `<slot>` in it (trimming whitespace as a serializer does, with `trim`), each
 *  `<x-gen-link>` renders an `<a>`; on a host ogygia will restore (`og-h`) it writes the plan
 *  (`og-shadow`). Innermost hosts first, matched by depth: a box may hold a box. The pass fails as
 *  an app's does, at the seed's choice (buggify points in the app's code, so the run's coverage
 *  counts them): it throws (`gen.reshape-throws`), takes 3 s (`gen.reshape-slow`), strips ogygia's
 *  marks (`gen.reshape-strips-marks`). ogygia sends a failed answer as it rendered it (#1569), so
 *  every oracle sees the page whole. (A transform that answers broken HTML of its own is the app's:
 *  no point draws it.) */
export function app_reshape(pass: GenReshape | null): string {
	if (pass === null)
		return `import type { Handle } from '@sveltejs/kit';

export const handle: Handle = ({ event, resolve }) => resolve(event);
`;
	return `import type { Handle } from '@sveltejs/kit';
import { rewrite } from '@ogygia/rewrite';
import { buggify } from '@ogygia/machine';

const TRIM = ${pass.trim};

const trim = (s: string): string =>
\tTRIM
\t\t? s
\t\t\t\t.replace(/>\\s+</g, '><')
\t\t\t\t.replace(/>\\s+([^<\\s])/g, '> $1')
\t\t\t\t.replace(/([^>\\s])\\s+</g, '$1 <')
\t\t: s;

/** Each \`<tag …>inner</tag>\` rendered by \`tree\`, innermost first. */
function render(html: string, tag: string, tree: (inner: string) => string): string {
\tconst open_of = \`<\${tag}\`;
\tconst close_of = \`</\${tag}>\`;
\tlet out = html;
\tlet before = out.length;
\tfor (;;) {
\t\tconst open = before < 0 ? -1 : out.lastIndexOf(open_of, before);
\t\tif (open === -1) return out;
\t\tbefore = open - 1;
\t\tconst gt = out.indexOf('>', open);
\t\tlet depth = 1;
\t\tlet at = gt + 1;
\t\tlet close = -1;
\t\twhile (depth > 0) {
\t\t\tconst o = out.indexOf(open_of, at);
\t\t\tconst c = out.indexOf(close_of, at);
\t\t\tif (c === -1) return out;
\t\t\tif (o !== -1 && o < c) {
\t\t\t\tdepth++;
\t\t\t\tat = o + open_of.length;
\t\t\t} else {
\t\t\t\tdepth--;
\t\t\t\tclose = c;
\t\t\t\tat = c + close_of.length;
\t\t\t}
\t\t}
\t\tconst attrs = out.slice(open + open_of.length, gt);
\t\tconst inner = out.slice(gt + 1, close);
\t\tconst planned = attrs.includes(' og-h="');
\t\tconst host = \`\${attrs}\${planned ? \` og-shadow="\${tag}.shadow"\` : ''} data-rendered="\${tag}"\`;
\t\tout = \`\${out.slice(0, open)}<\${tag}\${host}>\${tree(inner)}</\${tag}>\${out.slice(close + close_of.length)}\`;
\t}
}

function render_one(html: string): string {
\tlet out = render(
\t\thtml,
\t\t'x-gen-box',
\t\t(inner) => \`<div class="gen-box"><b>box</b><slot>\${trim(inner)}</slot></div><!--gen-box-->\`
\t);
\tout = render(out, 'x-gen-link', (inner) => \`<a class="gen-link" tabindex="-1"><slot>\${trim(inner)}</slot></a>\`);
\tif (buggify.fires('gen.reshape-strips-marks')) out = out.replace(/ og-[a-z]+="[^"]*"/g, '');
\treturn out;
}

export const handle: Handle = rewrite({
\tmatch: ['x-gen-box', 'x-gen-link'],
\tasync render(elements) {
\t\tif (buggify.fires('gen.reshape-throws')) throw new Error('the rewrite threw');
\t\tif (buggify.fires('gen.reshape-slow')) await new Promise((r) => setTimeout(r, 3000));
\t\treturn elements.map((el) => render_one(el.html));
\t}
});
`;
}

/** Writes the region components of `roots`, shown on `page`, into `lib`. */
function components(lib: string, roots: readonly GenNode[], page: string): void {
	const walk = (n: GenNode): void => {
		writeFileSync(join(lib, `N${n.id}.svelte`), component(n));
		if (n.kind === 'held' || n.kind === 'live') {
			writeFileSync(join(lib, `H${n.id}.svelte`), host(n));
			writeFileSync(join(lib, `h${n.id}.remote.ts`), remote(n, page));
		}
		if (n.switches) {
			writeFileSync(join(lib, `A${n.id}.svelte`), switched(n, true));
			writeFileSync(join(lib, `S${n.id}.svelte`), switched(n, false));
		}
		n.children.forEach(walk);
	};
	roots.forEach(walk);
}

/** Writes `pages` into `app`: its routes (a nav to every page on each) and its region components;
 *  with a `peer`, the app's federation, its pages' slots and the mount of the peer's pages. */
export function write(
	app: string,
	pages: readonly GenPage[],
	seed: number,
	peer: GenPeer | null = null,
	layout: GenNode | null = null,
	router = true,
	reshape: GenReshape | null = null,
	released: string | null = null
): void {
	const routes = join(app, 'src', 'routes');
	const lib = join(app, 'src', 'lib', 'gen');
	rmSync(routes, { recursive: true, force: true });
	rmSync(lib, { recursive: true, force: true });
	mkdirSync(routes, { recursive: true });
	mkdirSync(lib, { recursive: true });
	const mounted = (peer?.pages ?? []).map((p) => MOUNT + p.path);
	const nav = ['/', ...pages.map((p) => p.path), ...mounted]
		.map((p) => `<a href="${p}">${p}</a>`)
		.join(' ');
	// (the layout's regions, after the nav: the same element on every page)
	const held = layout
		? [`\timport ${name(layout)} from '$lib/gen/${name(layout)}.svelte'${attributes(layout)};`]
		: [];
	writeFileSync(
		join(routes, '+layout.svelte'),
		[
			'<script lang="ts">',
			...held,
			'\tlet { children } = $props();',
			'</script>',
			'',
			`<nav>${nav}</nav>`,
			...(layout ? [usage(layout, '')] : []),
			'{@render children()}',
			''
		].join('\n')
	);
	if (layout) components(lib, [layout], '/');
	// (the app's pages are server HTML with islands: no Kit client on them)
	writeFileSync(
		join(routes, '+layout.ts'),
		`export const csr = false;
export const prerender = false;
`
	);
	writeFileSync(join(routes, '+page.svelte'), `<h1>generated app, seed ${seed}</h1>\n`);
	mkdirSync(join(routes, 'hero.png'), { recursive: true });
	writeFileSync(join(routes, 'hero.png', '+server.ts'), HERO_ROUTE);
	mkdirSync(join(routes, 'late.js'), { recursive: true });
	writeFileSync(join(routes, 'late.js', '+server.ts'), LATE_ROUTE);
	writeFileSync(join(lib, 'mount.server.ts'), app_mount(peer));
	writeFileSync(join(lib, 'flags.server.ts'), app_flags(pages));
	writeFileSync(join(lib, 'reshape.server.ts'), app_reshape(reshape));
	if (peer) {
		writeFileSync(join(lib, 'federation.server.ts'), app_federation(peer));
		if (peer.mount === 'kit') {
			const dir = join(routes, MOUNT.slice(1), '[...rest]');
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, '+page.server.ts'),
				`import { mount } from '@ogygia/federation';
import { peer } from '$lib/gen/federation.server';

const m = mount.kit(peer, { user: () => ({ sub: 'visitor' }) });
export const load = m.load;
export const actions = m.actions;
`
			);
			writeFileSync(
				join(dir, '+page.svelte'),
				`<script lang="ts">
\tlet { data } = $props();
\x3C/script>

<svelte:head>
\t{#if data.doc.title}<title>{data.doc.title}</title>{/if}
\t{@html data.doc.css.join('') + (data.doc.head ?? '')}
</svelte:head>

{@html data.doc.body}
`
			);
		}
	}
	for (const page of pages) {
		const dir = join(routes, page.path.slice(1));
		mkdirSync(dir, { recursive: true });
		const slots = (peer?.slots ?? []).filter((s) => s.page === page.path);
		const imports = page.roots.map(
			(n) => `\timport ${name(n)} from '$lib/gen/${name(n)}.svelte'${attributes(n)};`
		);
		// (a stored page says so in Kit's own `config`, in the page's server load when it has one)
		const config = page.postrender ? ['export const config = { postrender: true };', ''] : [];
		const server = slots.length > 0 || page.data || page.flagged;
		if (!server && config.length > 0) writeFileSync(join(dir, '+page.ts'), config.join('\n'));
		if (slots.length > 0) imports.push(`\timport { Region } from 'ogygia';`);
		if (slots.length > 0 || page.flagged) imports.push(`\tlet { data } = $props();`);
		if (server)
			writeFileSync(
				join(dir, '+page.server.ts'),
				[
					...(slots.length > 0 ? [`import { peer } from '$lib/gen/federation.server';`] : []),
					...(page.flagged ? [`import { gate } from '$lib/gen/flags.server';`] : []),
					...(slots.length > 0 || page.flagged ? [''] : []),
					...config,
					`export const load = async (${page.flagged ? 'event' : ''}) => ({`,
					...(page.data ? [`\twho: '${page.path.slice(1)} data',`] : []),
					...(page.flagged ? [`\tgate: gate(event),`] : []),
					...slots.map(
						(s) =>
							`\tr${s.id}: await peer.widget('${s.widget}', { label: 'r${s.id}' }, { render: '${s.render}' }),`
					),
					`});`,
					''
				].join('\n')
			);
		writeFileSync(
			join(dir, '+page.svelte'),
			[
				'<script lang="ts">',
				...imports,
				'</script>',
				'',
				`<h1>${page.path}</h1>`,
				...(page.hero
					? ['<img src="/hero.png" fetchpriority="high" alt="" width="1" height="1" />']
					: []),
				...(page.flagged ? ['<p data-gen-flag>gate {data.gate}</p>'] : []),
				...page.roots.flatMap((n, i) => [
					...(page.fold?.before === i
						? [`<div data-gen-fold style="height: ${page.fold.height}px"></div>`]
						: []),
					usage(n, '')
				]),
				...slots.map(slot_usage),
				...(page.late
					? [`{@html '<scr' + 'ipt type="module" src="/late.js"></scr' + 'ipt>'}`]
					: []),
				''
			].join('\n')
		);
		components(lib, page.roots, page.path);
	}
	writeFileSync(
		join(lib, 'plan.json'),
		`${JSON.stringify({ seed, pages, peer, layout, router, reshape, released, presets: screen_presets(pages) }, null, '\t')}\n`
	);
}

/** Writes `peer` into the peer app `dir` (apps/sim-gen-peer): its widgets and pages, the router
 *  that exposes the pages, and its federation (`src/lib/gen/federation.server.ts`). */
export function write_peer(dir: string, peer: GenPeer, seed: number): void {
	const lib = join(dir, 'src', 'lib', 'gen');
	rmSync(lib, { recursive: true, force: true });
	mkdirSync(lib, { recursive: true });
	const edges = (['gone', 'moved', 'who', 'bad'] as const).filter((e) => peer.edges[e]);
	const nav = ['/', ...peer.pages.map((p) => MOUNT + p.path), ...edges.map((e) => `${MOUNT}/${e}`)]
		.map((p) => `<a href="${p}">${p}</a>`)
		.join(' ');
	if (peer.edges.who)
		writeFileSync(
			join(lib, 'Who.svelte'),
			`${dedent`
				<script lang="ts">
					let { data }: { data: { sub: string } } = $props();
				</script>

				<nav>${nav}</nav>
				<main data-gen="peer-page">
					<h1>peer /who</h1>
					<p data-gen-who>{data.sub}</p>
				</main>
			`}\n`
		);
	for (const w of peer.widgets) {
		writeFileSync(
			join(lib, `W${w.name}.svelte`),
			[
				'<script lang="ts">',
				...w.children.map((c) => `\timport ${name(c)} from './${name(c)}.svelte'${attributes(c)};`),
				"\tlet { label = '' }: { label?: string } = $props();",
				'</script>',
				'',
				`<section data-gen="widget">`,
				`\t<span>${w.name} for {label}</span>`,
				...w.children.map((c) => usage(c, '\t')),
				'</section>',
				''
			].join('\n')
		);
		// (a widget shows on the app's pages: no page of the peer's own)
		components(lib, w.children, '/');
	}
	for (const [i, p] of peer.pages.entries()) {
		writeFileSync(
			join(lib, `Q${i}.svelte`),
			[
				'<script lang="ts">',
				...p.roots.map((n) => `\timport ${name(n)} from './${name(n)}.svelte'${attributes(n)};`),
				...(p.data ? ['\tlet { data }: { data: { who: string } } = $props();'] : []),
				'</script>',
				'',
				`<nav>${nav}</nav>`,
				`<main data-gen="peer-page">`,
				`\t<h1>peer ${p.path}</h1>`,
				...(p.data ? ['\t<p data-gen-page>{data.who}</p>'] : []),
				...p.roots.map((n) => usage(n, '\t')),
				'</main>',
				''
			].join('\n')
		);
		components(lib, p.roots, MOUNT + p.path);
	}
	writeFileSync(
		join(lib, 'router.ts'),
		[
			`import { routes, page${peer.edges.moved ? ', redirect' : ''}${peer.edges.bad ? ', error' : ''} } from '@ogygia/router';`,
			...(peer.edges.who ? [`import { user } from '@ogygia/federation';`] : []),
			...peer.pages.map((_, i) => `import Q${i} from './Q${i}.svelte';`),
			...(peer.edges.who ? [`import Who from './Who.svelte';`] : []),
			'',
			`export const router = routes(`,
			`\t{`,
			...peer.pages.map((p, i) =>
				p.data
					? `\t\t'${p.path}': page(Q${i}, { load: () => ({ who: '${p.path.slice(1)} data' }) }),`
					: `\t\t'${p.path}': page(Q${i}),`
			),
			...(peer.edges.moved
				? [`\t\t'/moved': page(Q0, { load: () => redirect(307, '${MOUNT}/q0') }),`]
				: []),
			...(peer.edges.bad
				? [`\t\t'/bad': page(Q0, { load: () => error(400, 'a bad request') }),`]
				: []),
			...(peer.edges.who
				? [`\t\t'/who': page(Who, { load: (c) => ({ sub: user(c)?.sub ?? '' }) }),`]
				: []),
			`\t},`,
			`\t{ base: '${MOUNT}' }`,
			`);`,
			''
		].join('\n')
	);
	writeFileSync(
		join(lib, 'federation.server.ts'),
		[
			`import { federate } from '@ogygia/federation';`,
			`import { region } from 'ogygia';`,
			`import { env } from '$env/dynamic/private';`,
			`import { router } from './router.ts';`,
			...peer.widgets.map(
				(w) => `import W${w.name} from './W${w.name}.svelte' with { region: 'raw' };`
			),
			'',
			`federate({`,
			`\tname: 'peer',`,
			`\tkey: env.PEER_SIGNING_KEY,`,
			`\tbase: '${MOUNT}',`,
			`\texpose: router,`,
			`\tpeers: { app: { origin: env.APP_ORIGIN ?? 'https://app.test', key: env.APP_PUBLIC_KEY } },`,
			`\twidgets: {`,
			...peer.widgets.map(
				(w) => `\t\t${w.name}: (props) => region(W${w.name}, { label: String(props.label ?? '') }),`
			),
			`\t}`,
			`});`,
			''
		].join('\n')
	);
	writeFileSync(join(lib, 'plan.json'), `${JSON.stringify({ seed, peer }, null, '\t')}\n`);
}

function main(): void {
	const arg = (flag: string) => {
		const at = process.argv.indexOf(flag);
		return at === -1 ? undefined : process.argv[at + 1];
	};
	const seed = Number(arg('--seed') ?? 1);
	const app = resolve(
		arg('--app') ?? fileURLToPath(new URL('../../../apps/sim-gen', import.meta.url))
	);
	const reshape = reshape_plan(seed);
	const drawn = plan(seed);
	const pages = reshape ? drawn.map(boxing(seed, reshape)) : drawn;
	const peer = peer_plan(seed, pages);
	const layout = layout_plan(seed);
	const router = router_plan(seed);
	const released = released_plan(seed, pages, peer, reshape);
	write(app, pages, seed, peer, layout, router, reshape, released);
	const count = (ns: readonly GenNode[]): number =>
		ns.reduce((s, n) => s + 1 + count(n.children), 0);
	console.log(
		`[sim] generated ${pages.length} pages, ${count(pages.flatMap((p) => p.roots))} regions (seed ${seed})${layout ? `, ${count([layout])} in the layout` : ''}${router ? '' : ', no router'}${reshape ? `, a reshape pass (${reshape.trim ? 'trims' : 'keeps whitespace'}${reshape.link ? ', links' : ''})` : ''}${released ? `, upgraded from ${released}` : ''} in ${app}`
	);
	if (peer) {
		write_peer(`${app}-peer`, peer, seed);
		console.log(
			`[sim] and its peer: ${peer.widgets.length} widgets in ${peer.slots.length} slots (${peer.slots.filter((s) => s.render === 'deferred').length} deferred), ${peer.pages.length} pages mounted by ${peer.mount === 'router' ? 'a server router' : 'a Kit catchall'} in ${app}-peer`
		);
	}
}

if (import.meta.main) main();
