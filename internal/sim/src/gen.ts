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
import { rng, type Rng } from './rng.ts';

type Wake = 'load' | 'idle' | 'visible' | 'interaction';

/** One region (or plain markup) of a generated page. */
export interface GenNode {
	readonly id: number;
	/** island: a woken region; hole: a deferred one (`wake`: woken once it lands); lake: frozen
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
	 *  kept: the repair's tag check sees it, which a prepended element never reaches). */
	readonly thirdParty?: 'prepend' | 'retag';
	readonly children: readonly GenNode[];
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
	/** The page's server load reads the app's flag (`gate(event)`): each read is an exposure, which the
	 *  sink takes in batches (`flags exposures`). */
	readonly flagged?: boolean;
}

const WAKES: readonly Wake[] = ['load', 'idle', 'visible', 'interaction'];

/** A region tree drawn from `r`, depth first (a child's id before its parent's, ids from `first`);
 *  `wrap` may turn a drawn region into another kind (held, live). */
function trees(
	r: Rng,
	wrap: (n: GenNode) => GenNode = (n) => n,
	first = 0
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
		if (kind === 'island') return wrap({ id, kind, wake: r.pick(WAKES), children });
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
	const switching = switcher(seed);
	const node = trees(r, held);
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
		.map((page) => ({ ...page, roots: page.roots.map(switching) }))
		.map(flagging(seed))
		.map(third_party(seed));
}

/** Some islands a third party's script changes while they sleep (their own stream, `gen third
 *  party`): an island that wakes on its own, in the page's own HTML (under islands and plain markup
 *  only: an answer's or a lake's HTML is inserted, not parsed with the page). */
function third_party(seed: number): (page: GenPage) => GenPage {
	const t = rng(seed).fork('gen third party');
	// (which edit, from a stream of its own: the islands it touches stay as they were drawn)
	const k = rng(seed).fork('gen third party kind');
	const walk = (n: GenNode, page: boolean): GenNode => {
		const children = n.children.map((c) =>
			walk(c, page && (n.kind === 'island' || n.kind === 'plain'))
		);
		const on =
			page &&
			n.kind === 'island' &&
			(n.wake === 'load' || n.wake === 'idle') &&
			!n.empty &&
			t.chance(0.3);
		return on
			? { ...n, children, thirdParty: k.chance(0.5) ? 'retag' : 'prepend' }
			: { ...n, children };
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
	)
};

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

/** Whether a seed's app runs the router (stream `gen router`): most do; one without it navigates
 *  page to page, and its `invalidateAll()` is the document's own soft refresh (loaded on first use). */
export function router_plan(seed: number): boolean {
	return !rng(seed).fork('gen router').chance(0.25);
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
	return {
		mount,
		widgets: widgets.map((w) => ({ ...w, children: w.children.map(styled) })),
		pages: own
			.map((p) => ({ ...p, roots: p.roots.map(styled) }))
			.map((p) => (pd.chance(0.5) ? { ...p, data: true } : p)),
		slots,
		ttl
	};
}

/** How a parent imports `n`: its import attributes. */
function attributes(n: GenNode): string {
	switch (n.kind) {
		case 'island':
			return ` with { wake: '${n.wake}' }`;
		case 'lake':
			return ` with { wake: 'none' }`;
		case 'hole':
			// (a kept render is a preset's: apps/sim-gen/vite.config.ts)
			if (n.maxAge) return ` with { preset: 'hole-${n.maxAge}${n.wake ? `-${n.wake}` : ''}' }`;
			return n.wake
				? ` with { render: 'deferred', wake: '${n.wake}' }`
				: ` with { render: 'deferred' }`;
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
	return `${indent}<N${n.id} label="n${n.id}"${since}${blob} />${third}`;
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
	const interactive =
		n.kind === 'island' ||
		((n.kind === 'hole' || n.kind === 'held' || n.kind === 'live') && n.wake !== undefined);
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
		`<div data-gen="${n.kind}"${n.style ? ` class="g${n.id}"` : ''} data-build={import.meta.env.VITE_SIM_BUILD}>`,
		...(n.changes
			? ["\t{#if import.meta.env.VITE_SIM_BUILD === 'v2'}<em data-gen-new>new in v2</em>{/if}"]
			: []),
		'\t<span>{label}</span>',
		...(n.dated ? ['\t<time>{since?.toISOString()}</time>'] : []),
		...(n.reads ? ['\t<i data-gen-page>{page.data.who}</i>'] : []),
		...(n.odd ? ['\t<b title={note} data-note={note}>{note}</b>'] : []),
		...(n.big ? ['\t<small>{blob.length}</small>'] : []),
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
	return `import { federate } from '@ogygia/federation';
import { env } from '$env/dynamic/private';

// (the simulator gives each app its keys and every app's origin: internal/sim/src/cli.ts)
export const { peer } = federate({
\tname: 'app',
\tkey: env.APP_SIGNING_KEY,
\tvisitor: () => ({ sub: 'visitor' }),
\tpeers: { peer: { origin: env.PEER_ORIGIN ?? 'https://peer.test', key: env.PEER_PUBLIC_KEY${cache} } }
});
`;
}

/** The app's server hook beside ogygia's (`src/lib/gen/mount.server.ts`): the peer's pages
 *  mounted under `/peer` by a server router, or nothing. */
function app_mount(peer: GenPeer | null): string {
	if (peer?.mount !== 'router')
		return `import type { Handle } from '@sveltejs/kit';

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
	router = true
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
	writeFileSync(join(lib, 'mount.server.ts'), app_mount(peer));
	writeFileSync(join(lib, 'flags.server.ts'), app_flags(pages));
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
				...page.roots.map((n) => usage(n, '')),
				...slots.map(slot_usage),
				''
			].join('\n')
		);
		components(lib, page.roots, page.path);
	}
	writeFileSync(
		join(lib, 'plan.json'),
		`${JSON.stringify({ seed, pages, peer, layout, router }, null, '\t')}\n`
	);
}

/** Writes `peer` into the peer app `dir` (apps/sim-gen-peer): its widgets and pages, the router
 *  that exposes the pages, and its federation (`src/lib/gen/federation.server.ts`). */
export function write_peer(dir: string, peer: GenPeer, seed: number): void {
	const lib = join(dir, 'src', 'lib', 'gen');
	rmSync(lib, { recursive: true, force: true });
	mkdirSync(lib, { recursive: true });
	const nav = ['/', ...peer.pages.map((p) => MOUNT + p.path)]
		.map((p) => `<a href="${p}">${p}</a>`)
		.join(' ');
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
			`import { routes, page } from '@ogygia/router';`,
			...peer.pages.map((_, i) => `import Q${i} from './Q${i}.svelte';`),
			'',
			`export const router = routes(`,
			`\t{`,
			...peer.pages.map((p, i) =>
				p.data
					? `\t\t'${p.path}': page(Q${i}, { load: () => ({ who: '${p.path.slice(1)} data' }) }),`
					: `\t\t'${p.path}': page(Q${i}),`
			),
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
	const pages = plan(seed);
	const peer = peer_plan(seed, pages);
	const layout = layout_plan(seed);
	const router = router_plan(seed);
	write(app, pages, seed, peer, layout, router);
	const count = (ns: readonly GenNode[]): number =>
		ns.reduce((s, n) => s + 1 + count(n.children), 0);
	console.log(
		`[sim] generated ${pages.length} pages, ${count(pages.flatMap((p) => p.roots))} regions (seed ${seed})${layout ? `, ${count([layout])} in the layout` : ''}${router ? '' : ', no router'} in ${app}`
	);
	if (peer) {
		write_peer(`${app}-peer`, peer, seed);
		console.log(
			`[sim] and its peer: ${peer.widgets.length} widgets in ${peer.slots.length} slots (${peer.slots.filter((s) => s.render === 'deferred').length} deferred), ${peer.pages.length} pages mounted by ${peer.mount === 'router' ? 'a server router' : 'a Kit catchall'} in ${app}-peer`
		);
	}
}

if (import.meta.main) main();
