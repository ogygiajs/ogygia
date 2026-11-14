/**
 * ORACLES: what must hold, checked at every step or once the world is at rest. Each says what it
 * found broken, or null. Each is precise about what it normalizes away, and why.
 */
import { writeFileSync } from 'node:fs';
import { gate_open_early, own_text, type Tab, type Visitor } from './browser.ts';
import { boxes, on_screen, type Box } from './layout.ts';
import { answer_key, FOREIGN_MARK, is_page_path, LOSSY_POINTS, type World } from './world.ts';
import { EDGE_BAD, EDGE_GONE, EDGE_MOVED, MOUNT } from './gen.ts';
import { written_page } from './happy.ts';

/** `SIM_DUMP=<dir>`: an MPA difference writes both sides whole there (`<tab>-<path>-shown.txt`,
 *  `-fresh.txt`), to read past its first hunk. */
const DUMP = process.env.SIM_DUMP;

/** What an oracle found broken. */
export interface Broken {
	readonly oracle: string;
	readonly detail: string;
}

/**
 * The DOM as a visitor sees it, with what legitimately differs between two loads taken out:
 *
 * - `<script>` elements (the boot data and module scripts are delivery, not content; a client
 *   navigation has none) and `<link rel=modulepreload|preload|prefetch>` (also delivery);
 * - comments (Svelte's hydration markers `[`, `]` and empty ones, which SSR writes and a client
 *   render does not);
 * - `nonce` attributes (a fresh one per response);
 * - whitespace-only text between elements (SSR keeps the template's, a client render does not);
 * - a clock's reading in text (`5:34:35 AM`, `05:34:35`, `2026-01-01T00:00:04.410Z`): the fresh
 *   load happens later, so a page that shows the time shows another one, rightly; and a
 *   `Math.random()` reading (`0.80249150…`, eight digits or more), a stamp a page shows to prove
 *   which load it is;
 * - the order of `<head>`'s children, except among stylesheets (`<style>`, `<link
 *   rel=stylesheet>`), whose order is the cascade's: a `<meta>` or `<title>` means the same
 *   wherever it sits;
 * - a URL as written (`./a.css` and `/a.css` load the same file; Kit writes relative paths into a
 *   prerendered page): a `<link>`'s `href`, and any attribute starting `./` or `../`, as the path
 *   it resolves to;
 * - what a client navigation adds by design: the router's live-region announcer
 *   (`[data-ogygia-announcer]`, as Kit's own router adds one), and the reconciler's morph key on a
 *   region (`data-key`);
 * - a hole's `data-revalidated` mark: its answer was fetched again once its cached copy went
 *   stale, which a tab that stayed long enough sees and a fresh load does not (the answer itself
 *   is compared);
 * - a region's repair mark (`data-og-healed`): a third party edited its server markup before it
 *   woke, which a script waiting for DOMContentLoaded does on a document load and never on a router
 *   visit; what the repaired region shows is compared (gen 192, seed 19);
 * - a page store's mark (`<meta name="ogygia-stored">`): the copy came from the store, where the
 *   render that filled it did not say so; the page itself is compared (delivery, as a CDN's
 *   header is);
 * - a reshape pass's first-load mark (`<meta name="ogygia-first-load">`): a document loaded as one
 *   carries it, the router's answer of the same page never does (delivery too).
 *
 * Kept on purpose: every element, attribute and text a visitor can see or a script can read,
 * including ogygia's region attributes, because a region that differs after a navigation from a
 * fresh load of the same URL is exactly the bug this oracle exists to find.
 */
export function normalize(root: {
	documentElement: Element | null;
	title: string;
	baseURI?: string;
}): string {
	// (read once: happy-dom's `baseURI` looks for a `<base>` through the whole document, and a miss
	// grows every element's cache list; per attribute it ran palaestra seed 216 out of memory)
	const base = root.baseURI ?? 'https://app.test/';
	const walk = (node: Node, depth: number, out: string[]): void => {
		if (node.nodeType === 8) return;
		if (node.nodeType === 3) {
			const t = (node.textContent ?? '')
				.replace(/\s+/g, ' ')
				.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/g, '<time>')
				// (`12:00:04 AM.334`: a page may add the milliseconds after the locale's time)
				.replace(/\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?(?: ?[AP]M)?(?:\.\d+)?/g, '<time>')
				.replace(/\b0\.\d{8,}\b/g, '<random>');
			if (t.trim() !== '') out.push(`${'  '.repeat(depth)}"${t.trim()}"`);
			return;
		}
		if (node.nodeType !== 1) return;
		const el = node as Element;
		// (the random app's web components, by their host alone: a server-owned one is the render's
		// on a fresh load and restored in the router's answer, which its own runtime adopts alike;
		// the simulator has no such runtime. What hydrates in one is judged by ssr-hydrate and the
		// reshape check; gen 262, seed 3)
		if (el.localName === 'x-gen-box' || el.localName === 'x-gen-link') {
			const n = el.getAttribute('data-n');
			out.push(`${'  '.repeat(depth)}<${el.localName}${n === null ? '' : ` data-n="${n}"`}>`);
			return;
		}
		const tag = el.tagName.toLowerCase();
		if (tag === 'script') return;
		if (tag === 'link' && /\b(modulepreload|preload|prefetch)\b/.test(el.getAttribute('rel') ?? ''))
			return;
		if (el.hasAttribute('data-ogygia-announcer')) return;
		// (a third party's own head element, which a client navigation keeps, as it keeps what any
		// script put in the head, and a fresh load of a page without that script never has: gen 262,
		// seed 6, the `gen head` drift)
		if (tag === 'meta' && el.hasAttribute('data-gen-third-party')) return;
		// (a third party's mark in a lake, which the island's wake rightly leaves there, and a client
		// navigation to the page never runs the script that makes it: `lakeEdit`)
		if (el.hasAttribute('data-gen-lake-mark')) return;
		if (el.matches(STORE_MARK)) return;
		// (a reshape pass's mark on a document loaded as one, which the router's answer of the same
		// page never carries: delivery, not the page; gen 10, seed 10)
		if (el.matches('meta[name="ogygia-first-load"]')) return;
		// (and its stand-ins sheet, which a page the pass failed on goes out without: gen 24, seed 5)
		if (el.matches('style[data-og-stand-ins]')) return;
		const attrs = [...el.attributes]
			.filter(
				(a) =>
					a.name !== 'nonce' &&
					!(
						tag === 'ogygia-region' &&
						(a.name === 'data-key' || a.name === 'data-revalidated' || a.name === 'data-og-healed')
					)
			)
			.map((a) => {
				// (a kept head node's URL means the file of the page that wrote it, as the router reads
				// it: #1741, palaestra seed 20004)
				const from = written_page(el) ?? base;
				// (one no URL can be made of, a tampered byte in its host, stays as it is: gen 45, seed 32)
				const address =
					((tag === 'link' && a.name === 'href') || /^\.\.?\//.test(a.value)) &&
					URL.canParse(a.value, from);
				return address
					? `${a.name}="${new URL(a.value, from).pathname}"`
					: `${a.name}="${a.value}"`;
			})
			.sort()
			.join(' ');
		out.push(`${'  '.repeat(depth)}<${tag}${attrs ? ` ${attrs}` : ''}>`);
		if (tag !== 'head') {
			for (const child of el.childNodes) walk(child, depth + 1, out);
			return;
		}
		// stylesheets in their order, then the region sheets answers lifted, sorted (each went in as
		// its answer landed: which came first is the network's, and a region's scoped rules never
		// meet another's), then the rest of the head, sorted
		const sheets: string[] = [];
		const lifted: string[] = [];
		const rest: string[] = [];
		for (const child of el.children) {
			const one: string[] = [];
			walk(child, depth + 1, one);
			if (one.length === 0) continue;
			const sheet =
				child.tagName === 'STYLE' ||
				(child.tagName === 'LINK' && /\bstylesheet\b/.test(child.getAttribute('rel') ?? ''));
			(!sheet ? rest : child.hasAttribute('data-ogygia-region-css') ? lifted : sheets).push(
				one.join('\n')
			);
		}
		out.push(...sheets, ...lifted.sort(), ...rest.sort());
	};
	const out: string[] = [`title: ${root.title}`];
	if (root.documentElement) walk(root.documentElement, 0, out);
	return out.join('\n');
}

/**
 * Differences a filed bug explains: `applies` says the two normalized DOMs show it, `forgive`
 * takes it out of one (given the other, for a shape that is told by what the other side lacks). A
 * seed whose only difference is known is counted apart, not failed, so a run's failures are new
 * findings. Each entry goes when its fix lands.
 */
export const KNOWN: ReadonlyArray<{
	issue: number;
	what: string;
	applies(shown: string, fresh: string): boolean;
	forgive(normalized: string, other: string): string;
	/** The bug's mark on the document itself, when the DOM alone does not show it. */
	seen?(world: World, tab: Tab): boolean;
}> = [
	{
		issue: 1107,
		what: "islands' <svelte:head> styles stand in <head> in the order the islands woke",
		// (the same island head styles on both sides, in another order: gen 262, seed 25; each set
		// aside, with its text line)
		applies: (shown, fresh) => {
			const a = island_head_styles(shown);
			const b = island_head_styles(fresh);
			return a.join() !== b.join() && [...a].sort().join() === [...b].sort().join();
		},
		forgive: (s) => {
			const out = s.split('\n');
			for (let i = out.length - 1; i >= 0; i--)
				if (ISLAND_HEAD_STYLE.test(out[i])) out.splice(i, 2);
			return out.join('\n');
		}
	}
];

/** A generated island's own `<svelte:head>` style, as a normalized line (src/gen.ts `head`). */
const ISLAND_HEAD_STYLE = /^ *<style data-gen-head="(n\d+)">$/;

/** The island head styles a normalized DOM holds, in its order. */
function island_head_styles(s: string): string[] {
	return s.split('\n').flatMap((l) => ISLAND_HEAD_STYLE.exec(l)?.[1] ?? []);
}

/**
 * Islands of the test app that keep their own client state across a navigation by design, as a
 * component Kit keeps across a same-route navigation does: a fresh load starts them over, so what
 * they show is set aside (their subtree's attributes and text; the element itself stays). Each says
 * why. A new entry needs the same: state the island owns, not state ogygia should have carried.
 */
const OWN_STATE = [
	// palaestra lib/FilterBar.svelte reads `location` once, at hydration, then only its own clicks
	// (seed 286: kept across /dashboard/orders?status=… navigations, it shows the first status)
	'data-filterbar'
];

/** `s` with each OWN_STATE element's subtree reduced to its opening line. */
function own_state_out(s: string): string {
	const lines = s.split('\n');
	const out: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		out.push(lines[i]);
		const m = /^( *)<\S+/.exec(lines[i]);
		if (m === null || !OWN_STATE.some((a) => lines[i].includes(` ${a}=`))) continue;
		while (i + 1 < lines.length && /^ */.exec(lines[i + 1])![0].length > m[1].length) i++;
	}
	return out.join('\n');
}

/** How long the MPA check looks again for what moves by itself: longer than the slowest tick the
 *  apps make (a generated app's live query ticks every 3 s; generated app 3, seed 60). */
const LIVE_LOOK_MS = 4_000;

/** An element line's tag, or null for a text line. */
const tag_of = (line: string): string | null => /^ *<([^\s>]+)/.exec(line)?.[1] ?? null;

/** The lines of a normalized DOM that changed between two looks at the same page, as they read
 *  before and after: a text, or an element's attributes (a live region's tick carries its props in
 *  its endpoint). By content, not place: a place in one side is another line in the other (seed
 *  26). None when its shape changed: then nothing is masked, and the difference stands. */
function live_lines(before: string, after: string): string[] {
	const [a, b] = [before.split('\n'), after.split('\n')];
	if (a.length !== b.length) return [];
	const out: string[] = [];
	for (let i = 0; i < a.length; i++) {
		if (a[i] === b[i]) continue;
		const [x, y] = [tag_of(a[i]), tag_of(b[i])];
		if ((x === null && /^ *"/.test(a[i]) && /^ *"/.test(b[i])) || (x !== null && x === y))
			out.push(a[i], b[i]);
	}
	return out;
}

/** Each live region's lines in a normalized DOM (its own line and everything inside it), in
 *  document order. */
function live_regions(s: string): Array<{ from: number; to: number }> {
	const lines = s.split('\n');
	const out: Array<{ from: number; to: number }> = [];
	for (let i = 0; i < lines.length; i++) {
		if (tag_of(lines[i]) !== 'ogygia-region' || !lines[i].includes(' live="true"')) continue;
		const indent = /^ */.exec(lines[i])![0].length;
		let to = i + 1;
		while (to < lines.length && /^ */.exec(lines[to])![0].length > indent) to++;
		out.push({ from: i, to });
	}
	return out;
}

/**
 * The live regions (by their place among the page's live regions) whose content changed its shape
 * between two looks at the same page: a tick that brings another component (a switching live
 * region cycles three; gen 194, seed 25). What moved in place is `live_lines`'.
 */
export function reshaped_live(before: string, after: string): Set<number> {
	const [a, b] = [before.split('\n'), after.split('\n')];
	const [x, y] = [live_regions(before), live_regions(after)];
	const out = new Set<number>();
	if (x.length !== y.length) return out;
	const shape = (lines: string[], r: { from: number; to: number }) =>
		lines
			.slice(r.from + 1, r.to)
			.map((l) => (/^ *"/.test(l) ? `${/^ */.exec(l)![0]}"` : `${/^ */.exec(l)![0]}${tag_of(l)}`))
			.join('\n');
	for (let i = 0; i < x.length; i++) if (shape(a, x[i]) !== shape(b, y[i])) out.add(i);
	return out;
}

/** `s` with each live region of `which` (by its place) one line: what moves by itself, whole. */
export function live_regions_out(s: string, which: ReadonlySet<number>): string {
	if (which.size === 0) return s;
	const lines = s.split('\n');
	const regions = live_regions(s);
	for (let i = regions.length - 1; i >= 0; i--) {
		if (!which.has(i)) continue;
		const { from, to } = regions[i];
		// (one inside another set aside goes with it: spliced first, it would have shortened the
		// lines the outer one's end counts, which then took lines after it; gen 235, seed 15)
		if (regions.some((r, j) => j < i && which.has(j) && r.from < from && from < r.to)) continue;
		lines.splice(from, to - from, `${/^ */.exec(lines[from])![0]}<ogygia-region <live>>`);
	}
	return lines.join('\n');
}

/** `a` and `b` with a line that moved on one side taken as the other side's same line: the moving
 *  thing, masked where it moved, may not have moved in the other's look (a live region's tick every
 *  3 s caught on one side only; generated app 6, seed 76). Text for text, an element for an element
 *  of its tag, at the same place. */
function live_aligned(a: string, b: string): [string, string] {
	const [x, y] = [a.split('\n'), b.split('\n')];
	if (x.length !== y.length) return [a, b];
	const moved = (l: string) => / <live>>$|^ *"<live>"$/.test(l);
	const kin = (l: string, m: string) =>
		/^ *"/.test(l) ? /^ *"/.test(m) : tag_of(l) !== null && tag_of(l) === tag_of(m);
	for (let i = 0; i < x.length; i++) {
		if (moved(x[i]) && !moved(y[i]) && kin(x[i], y[i])) y[i] = x[i];
		else if (moved(y[i]) && !moved(x[i]) && kin(y[i], x[i])) x[i] = y[i];
	}
	return [x.join('\n'), y.join('\n')];
}

/** `s` with each line that reads as one of `lines` replaced by a mark (indent kept; an element
 *  keeps its tag). */
function mask(s: string, lines: ReadonlySet<string>): string {
	if (lines.size === 0) return s;
	return s
		.split('\n')
		.map((l) => {
			if (!lines.has(l)) return l;
			const indent = /^ */.exec(l)![0];
			if (/^ *"/.test(l)) return `${indent}"<live>"`;
			const tag = tag_of(l);
			return tag === null ? l : `${indent}<${tag} <live>>`;
		})
		.join('\n');
}

/**
 * What the server makes anew on each render (a time stamp, a render counter, a fresh id in a
 * prop), from two fresh loads of one URL: a mask that marks it on any side. A text line that
 * differs is matched by what the two share around the part that moved (or by its place, when
 * they share too little to tell it apart); an attribute that differs is marked wherever it is.
 */
function per_render(a: string, b: string): (s: string) => string {
	const [x, y] = [a.split('\n'), b.split('\n')];
	if (x.length !== y.length) return (s) => s;
	const texts: Array<{ at: number; head: string; tail: string }> = [];
	const names = new Set<string>();
	const attrs = (l: string) =>
		new Map([...l.matchAll(/ ([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
	for (let i = 0; i < x.length; i++) {
		if (x[i] === y[i]) continue;
		if (/^ *"/.test(x[i]) && /^ *"/.test(y[i])) {
			let h = 0;
			while (h < x[i].length && x[i][h] === y[i][h]) h++;
			let t = 0;
			while (t < x[i].length - h && t < y[i].length - h && x[i].at(-1 - t) === y[i].at(-1 - t)) t++;
			// (the part that moved is whole words: 1767226040373 and 1767226042373 share digits that
			// another render's stamp does not)
			while (h > 0 && /\w/.test(x[i][h - 1])) h--;
			while (t > 0 && /\w/.test(x[i][x[i].length - t])) t--;
			texts.push({ at: i, head: x[i].slice(0, h), tail: x[i].slice(x[i].length - t) });
		} else {
			const [p, q] = [attrs(x[i]), attrs(y[i])];
			for (const [k, v] of p) if (q.get(k) !== v) names.add(k);
		}
	}
	const marked = (l: string) => `${/^ */.exec(l)![0]}"<render>"`;
	return (s) =>
		s
			.split('\n')
			.map((l, i) => {
				if (/^ *"/.test(l)) {
					for (const t of texts) {
						// (the shared part, less its indent and quotes, must say something: 3 characters)
						const said = t.head.trimStart().slice(1).length + t.tail.slice(0, -1).length;
						const fits =
							l.startsWith(t.head) &&
							l.endsWith(t.tail) &&
							l.length >= t.head.length + t.tail.length;
						if (said >= 3 ? fits : i === t.at) return marked(l);
					}
					return l;
				}
				return names.size === 0
					? l
					: l.replace(/ ([\w:-]+)="[^"]*"/g, (m, k: string) =>
							names.has(k) ? ` ${k}="<render>"` : m
						);
			})
			.join('\n');
}

/**
 * A region endpoint's bookkeeping, set aside: its capability's expiry and signature (`exp`, `sig`:
 * the time of the render, in 30-minute steps). The region, its build, its props and the page facts
 * it renders from (`id`, `r`, `props`, `k`, `pv`) are compared. Seeds 241, 315, 457 (/context,
 * /nested-hole: a `pv` that came and went was two instances sharing one symbol registry).
 */
function bookkeeping_out(s: string): string {
	return s.replace(/ endpoint="([^"]*)"/g, (_, url: string) => {
		const kept = url.replace(/&(exp|sig)=[^&]*/g, '&$1=<t>');
		return ` endpoint="${kept}"`;
	});
}

/** The first lines where two normalized DOMs differ, for a report. */
export function first_difference(a: string, b: string, context = 3): string {
	const x = a.split('\n');
	const y = b.split('\n');
	let i = 0;
	while (i < x.length && i < y.length && x[i] === y[i]) i++;
	if (i === x.length && i === y.length) return '';
	const from = Math.max(0, i - context);
	return [
		`at line ${i + 1}:`,
		...x.slice(from, i + context).map((l, k) => `${from + k === i ? '-' : ' '} ${l}`),
		'  ---',
		...y.slice(from, i + context).map((l, k) => `${from + k === i ? '+' : ' '} ${l}`)
	].join('\n');
}

/** A hard load of `url` in a new browser with `v`'s cookies, on a network that does not fail it
 *  (a fault there is no finding about the tab), at rest, each leg `pace` ms slower. */
async function load_fresh(
	world: World,
	v: Visitor,
	url: string,
	name: string,
	pace = 0
): Promise<{ visitor: Visitor; tab: Tab }> {
	const visitor = world.visitor(`${v.name}-${name}`);
	const jar = (b: Visitor) =>
		(
			b.browser.defaultContext as unknown as {
				cookieContainer: {
					getCookies(u: URL | null, client_side: boolean): unknown[];
					addCookies(c: unknown[]): void;
				};
			}
		).cookieContainer;
	// (every cookie, httpOnly ones too: a request carries them all; `true` would be a script's view)
	jar(visitor).addCookies(jar(v).getCookies(null, false));
	const tab = world.tab(visitor);
	world.network.calm(tab.name, pace);
	const path = new URL(url);
	await world.go(tab, 'goto', path.pathname + path.search + path.hash);
	return { visitor, tab };
}

/**
 * `seen`, the view of `doc`, with a peer's replicas read as one origin (`replicas`: each replica's
 * origin to its first origin's; one build answers at both). A page the replica answered while the
 * first origin was down names the replica's files (gen 23, seed 22), and a region's sheet its
 * answer lifted into the head stands beside the same file linked at the first origin: ogygia keeps
 * one sheet per address, and two origins are two addresses (gen 121, seed 11). Each such lifted
 * sheet is left out once. test/oracles.test.ts.
 */
export function replicas_as_one(
	doc: Document,
	seen: string,
	replicas: ReadonlyMap<string, string>
): string {
	if (replicas.size === 0) return seen;
	const one = (s: string): string => {
		for (const [replica, origin] of replicas) s = s.replaceAll(replica, origin);
		return s;
	};
	let out = one(seen);
	const sheets = [...doc.querySelectorAll('link[rel~="stylesheet"]')];
	const lifted = (l: Element): boolean =>
		l.hasAttribute('data-ogygia-region-css') && l.parentElement === doc.head;
	const first = new Map<string, string>();
	for (const l of [...sheets.filter((l) => !lifted(l)), ...sheets.filter(lifted)]) {
		const href = l.getAttribute('href') ?? '';
		const at = first.get(one(href));
		if (at === undefined) {
			first.set(one(href), href);
			continue;
		}
		if (at === href || !lifted(l)) continue;
		const line = one(normalize({ documentElement: l, title: '', baseURI: doc.baseURI }))
			.split('\n')
			.at(-1)!;
		const lines = out.split('\n');
		const i = lines.findIndex((x) => x.trim() === line.trim());
		if (i !== -1) lines.splice(i, 1);
		out = lines.join('\n');
	}
	return out;
}

/**
 * MPA EQUIVALENCE, the core promise: after any sequence of actions, what a tab shows equals a fresh
 * hard load of its URL by a visitor with the same cookies, once both are at rest. Checked in a new
 * browser (its own module instances and caches) with the tab's cookies copied in. `view` is what
 * is compared (all of `normalize` by default; a found bug's test may compare one part).
 */
export async function mpa_equivalent(
	world: World,
	v: Visitor,
	tab: Tab,
	view: (doc: Document) => string = normalize
): Promise<Broken | null> {
	const url = tab.page.mainFrame.url;
	if (!url.startsWith('http')) return null;
	const raw = view;
	view = (doc) => replicas_as_one(doc, raw(doc), world.replicas);
	let shown = view(tab.page.mainFrame.document as unknown as Document);
	// (a page a build a deploy replaced answered is compared with a fresh load from that build: an
	// old page is the old release's, whole)
	const build = world.build_of(tab.realm);
	const fresh_load = (w: World, visitor: Visitor, at: string, name: string, pace = 0) =>
		w.as_of(build, () => load_fresh(w, visitor, at, name, pace), world.answers_of(tab.realm));
	const fresh = await fresh_load(world, v, url, 'fresh');
	// (no reference: the build the page is of could not give it again, its stored copies dropped and
	// a newer build's handed out instead, gen 131, seed 131003)
	if (world.astray(fresh.tab.realm)) return null;
	let loaded = view(fresh.tab.page.mainFrame.document as unknown as Document);
	// (a text that changes on its own at rest is time, not state: a ticking clock in an island the
	// navigation kept has run longer than the fresh load's. Each side is looked at once more a
	// moment later, and a text line that moved by itself is masked on both: seed 289)
	await world.loop.run(LIVE_LOOK_MS);
	let shown_later = view(tab.page.mainFrame.document as unknown as Document);
	let loaded_later = view(fresh.tab.page.mainFrame.document as unknown as Document);
	// (and a live region whose tick brought another shape on either side is set aside whole on
	// every side: gen 194, seed 25)
	const moving = new Set([
		...reshaped_live(shown, shown_later),
		...reshaped_live(loaded, loaded_later)
	]);
	const whole = (s: string) => live_regions_out(s, moving);
	[shown, shown_later, loaded, loaded_later] = [shown, shown_later, loaded, loaded_later].map(
		whole
	);
	const live = new Set([...live_lines(shown, shown_later), ...live_lines(loaded, loaded_later)]);
	let again = bookkeeping_out(mask(loaded, live));
	shown = bookkeeping_out(mask(shown, live));
	const said = [...fresh.tab.errors, ...fresh.tab.console];
	await world.browsers.close(fresh.visitor, fresh.tab);
	if (first_difference(...live_aligned(own_state_out(shown), own_state_out(again))) === '')
		return null;
	// (what the server makes anew each render, a stamp, a counter, a fresh id, differs between two
	// fresh loads as well: it is the render's, not the tab's state. A second fresh load, and what
	// differs between the two is marked on every side: seeds 107, 188, 268, 280, 326, 340, 477)
	// (and a third, when two servers each count their own renders: two loads can meet the same
	// count on two instances, but of three, two come from one instance; seed 221, a cart's stamp)
	// (each at its own speed: with no delay fault two loads take the same time to the ms, and a
	// stamp of the render's moment agreed on both; palaestra seed 20004, /delta/b)
	const looks = [loaded];
	let diff = '';
	for (const n of [2, 3]) {
		const more = await fresh_load(world, v, url, `fresh-${n}`, (n - 1) * 7);
		looks.push(whole(view(more.tab.page.mainFrame.document as unknown as Document)));
		await world.browsers.close(more.visitor, more.tab);
		for (const other of looks.slice(0, -1)) {
			const render = per_render(other, looks.at(-1)!);
			again = render(again);
			shown = render(shown);
		}
		diff = first_difference(...live_aligned(own_state_out(shown), own_state_out(again)));
		if (diff === '' || world.servers.get(world.live)!.length < 2) break;
	}
	[shown, again] = live_aligned(own_state_out(shown), own_state_out(again));
	if (diff === '') return null;
	// a difference a filed bug explains is that bug, counted apart until its fix lands
	// (in order: each judged on what the ones before it left)
	const known: Array<(typeof KNOWN)[number]> = [];
	let a = shown;
	let b = again;
	for (const k of KNOWN) {
		if ((k.seen && !k.seen(world, tab)) || !k.applies(a, b)) continue;
		known.push(k);
		[a, b] = [k.forgive(a, b), k.forgive(b, a)];
	}
	// (what moved, lined up once more: a filed bug's lines set aside may have put them in place)
	[a, b] = live_aligned(a, b);
	if (a === b && known.length === 0) return null;
	if (known.length > 0 && a === b)
		return {
			oracle: 'known',
			detail: `${url}: ${known.map((k) => `#${k.issue} (${k.what})`).join(', ')}`
		};
	// (what is left once the filed bugs are set aside: the difference to triage)
	if (DUMP) {
		const name = `${DUMP}/${tab.name}-${new URL(url).pathname.replace(/\W+/g, '_')}`;
		writeFileSync(`${name}-shown.txt`, a);
		writeFileSync(`${name}-fresh.txt`, b);
	}
	const left =
		known.length > 0 ? `with ${known.map((k) => `#${k.issue}`).join(', ')} set aside, ` : '';
	return {
		oracle: 'mpa-equivalence',
		detail: `${url}\n${left}${first_difference(a, b)}${said.length ? ['', 'the fresh load said:', ...said].join('\n') : ''}`
	};
}

/**
 * EVERY REGION SHOWS SOMETHING: at rest, no `<ogygia-region>` of the page is empty (no element, no
 * text): a region is a piece of the page, and one left with nothing in it never showed (its answer,
 * its fallback or its server render). Set aside where the document was faulted (a fault may leave
 * a region without its answer; the MPA check judges those) and inside an element the visitor's own
 * press changed. A filed bug's shape is `known`.
 */
export function regions_show(tab: Tab, world: World): Broken | null {
	const url = tab.page.mainFrame.url;
	// (nor where a deploy or a missing secret failed an answer: a hole refused for another build's
	// key keeps its fallback, as `secret_missing` warns; generated app 3, seed 53)
	if (!url.startsWith('http') || faulted(world, tab) || world.skewed_for(tab.realm)) return null;
	const doc = tab.page.mainFrame.document as unknown as Document;
	const empty = [...doc.querySelectorAll('ogygia-region')].filter(
		(r) =>
			r.children.length === 0 &&
			(r.textContent ?? '').trim() === '' &&
			// (the app's own empty component, in the element the random app marks: src/gen.ts `empty`)
			!r.parentElement?.hasAttribute('data-gen-empty') &&
			// (a hole with no fallback still waiting for its moment: seen, or the visitor's intent)
			!(
				r.getAttribute('render') === 'defer' &&
				!r.hasAttribute('data-hydrated') &&
				/^(visible|interaction)$/.test(r.getAttribute('when') ?? '')
			)
	);
	if (empty.length === 0) return null;
	const open = (r: Element) =>
		`<${r.localName}${[...r.attributes]
			.filter((a) => a.name !== 'endpoint')
			.map((a) => ` ${a.name}="${a.value}"`)
			.join('')}>`;
	const is = (k: (typeof KNOWN_EMPTY)[number], r: Element) => k.is(r, world, tab.realm);
	const known = KNOWN_EMPTY.filter((k) => empty.some((r) => is(k, r)));
	const left = empty.filter((r) => !KNOWN_EMPTY.some((k) => is(k, r)));
	if (left.length === 0)
		return {
			oracle: 'known',
			detail: `${url}: ${known.map((k) => `#${k.issue} (${k.what})`).join(', ')}`
		};
	return { oracle: 'empty-region', detail: `${url}: ${left.map(open).join('\n')}` };
}

/** Whether a region's schedule is owed by now: see {@link schedules}. */
type Due = (el: Element, when: string | null, margin: string | null) => boolean;

/**
 * WHAT A SCHEDULE OWES AT REST, in `tab`'s document as it stands: whether a region's schedule (core's
 * trigger vocabulary: `load`, `idle`, `visible`, `interaction` or a media query) has fired once the
 * world is at rest. `load` and `idle` always, and so does none named or a value core does not hold
 * (it runs on load). `visible` when the region is on screen in the simulator's layout, the viewport
 * grown by its `margin` (src/layout.ts, the layout its observer reported), in a shown document: a
 * browser renders no frame for a tab behind another, so its observer reports nothing there. A media
 * query when it matches. `interaction` never: only the visitor fires it. A mutant that dropped a
 * region's margin survived every other oracle (core.ts `#on_visible`, the hole's `prefetch`).
 */
function schedules(tab: Tab, doc: Document): Due {
	let at: Map<Element, Box> | null = null;
	const view = doc.defaultView as unknown as {
		matchMedia?(q: string): { matches: boolean };
	} | null;
	return (el, when, margin) => {
		if (when === 'interaction') return false;
		if (when === 'visible')
			return !tab.hidden && on_screen((at ??= boxes(doc)), el, margin || undefined);
		// (a media query: a `(` with a `)` after it, as core reads one)
		const open = when?.indexOf('(') ?? -1;
		if (when && open !== -1 && when.indexOf(')', open) !== -1)
			return view?.matchMedia?.(when).matches === true;
		return true;
	};
}

/**
 * A HOLE'S FALLBACK DOES NOT STAND: at rest, no deferred region whose `when` is owed by now (see
 * {@link schedules}: `load`, `idle`, `visible` on screen with its margin, a matching media query)
 * still shows the generated app's fallback (`data-gen-fallback`) in a document no fault or deploy
 * touched: its answer was owed. The MPA check cannot see it (the fresh load runs the same code and
 * stands there too: a mutant whose holes never fetched survived it). Its `prefetch` is owed the
 * same way: a hole whose warm schedule is owed and that never answered asked its endpoint. Set
 * aside: a fallback the app keeps on purpose (`keepFallback()`, marked `data-gen-kept`), and holes
 * that wait for the visitor or the screen.
 */
export function fallback_stands(tab: Tab, world: World): Broken | null {
	const url = tab.page.mainFrame.url;
	if (!url.startsWith('http') || world.skewed_for(tab.realm)) return null;
	// (in a document a fault touched, only a hole never asked for at all: its own request may have
	// failed, but none to fail is no fault's. A batch that came whole asked for the holes it names; one
	// the network failed asked for none: each hole it did not deliver is released to ask on its own)
	const touched = faulted(world, tab);
	const mine = world.network.exchanges.filter((e) => e.from === tab.realm);
	// (nor one whose runtime, or another script, failed to load: the runtime may never have run, and
	// the page stays its server HTML, as runtime_load_failed says; gen 12, seed 22)
	if (touched && world.browsers.lacks_a_file(tab.realm)) return null;
	// (nor one whose answers buggify lost: a lost answer goes before its request, so a hole it took
	// every try of looks never asked; gen 208, seed 120)
	if (touched && lost_answers(world, tab.realm)) return null;
	const asked = new Set(
		mine.filter((e) => e.method === 'GET').map((e) => answer_key(new URL(e.url)))
	);
	for (const e of mine)
		if (e.holes && batch_came_whole(e)) for (const key of e.holes) asked.add(key);
	const doc = tab.page.mainFrame.document as unknown as Document;
	const due = schedules(tab, doc);
	const never_asked = (r: Element) => {
		const endpoint = r.getAttribute('endpoint');
		return endpoint !== null && !asked.has(answer_key(new URL(endpoint, url)));
	};
	const holes = [...doc.querySelectorAll('ogygia-region[render="defer"]')];
	const standing = holes.filter((r) => {
		if (!due(r, r.getAttribute('when'), r.getAttribute('margin'))) return false;
		const fallback = r.querySelector(':scope > [data-gen-fallback]');
		if (fallback === null || fallback.hasAttribute('data-gen-kept')) return false;
		return !touched || never_asked(r);
	});
	// (a warm owed and never sent: its hole still waits for its own schedule, on its fallback, and
	// nothing asked its endpoint; a batch's body is not seen, so a document that sent one is let be)
	const cold = mine.some((e) => e.method === 'POST')
		? []
		: holes.filter((r) => {
				const prefetch = r.getAttribute('prefetch');
				if (!prefetch || !due(r, prefetch, r.getAttribute('margin'))) return false;
				const fallback = r.querySelector(':scope > [data-gen-fallback]');
				return fallback !== null && !standing.includes(r) && never_asked(r);
			});
	if (cold.length > 0)
		return {
			oracle: 'fallback-stands',
			detail: `${url}: never warmed: ${cold.map((r) => `${r.querySelector('[data-gen-fallback]')!.textContent} (prefetch "${r.getAttribute('prefetch')}"${r.hasAttribute('margin') ? `, margin "${r.getAttribute('margin')}"` : ''})`).join(', ')}`
		};
	if (standing.length === 0) return null;
	// (a region a filed bug leaves empty stands on its fallback for the same reason: #910's hole asks
	// the app's endpoint, which refuses it)
	const is = (k: (typeof KNOWN_EMPTY)[number], r: Element) => k.is(r, world, tab.realm);
	const left = standing.filter((r) => !KNOWN_EMPTY.some((k) => is(k, r)));
	if (left.length === 0) {
		const known = KNOWN_EMPTY.filter((k) => standing.some((r) => is(k, r)));
		return {
			oracle: 'known',
			detail: `${url}: ${known.map((k) => `#${k.issue} (${k.what})`).join(', ')}`
		};
	}
	return {
		oracle: 'fallback-stands',
		detail: `${url}: ${left.map((r) => r.querySelector('[data-gen-fallback]')!.textContent).join(', ')}`
	};
}

/**
 * AN ISLAND THAT WAKES ON ITS OWN IS AWAKE: at rest, no island region (it names its `entry`) whose
 * `wake` is owed by now is still asleep (no `data-hydrated`): `load`, `idle`, `visible` on screen
 * with its margin, a matching media query ({@link schedules}; a hole's once its `when` is owed too).
 * Its twin for
 * holes is {@link fallback_stands}; the MPA check cannot see it (the fresh load runs the same code
 * and sleeps there too). Set aside: a document a fault touched (its code may have failed to
 * download) unless only an outage did (the network came back, and it wakes again), and one a
 * deploy failed a download of.
 */
export function islands_wake(tab: Tab, world: World): Broken | null {
	const url = tab.page.mainFrame.url;
	if (!url.startsWith('http') || world.skewed_for(tab.realm)) return null;
	if (faulted(world, tab) && !outage_only(world, tab)) return null;
	// (its document's files still coming is work in flight, not an island asleep: a stalled runtime
	// chunk outlasted the action's quiesce; seed 97, test/hidden-tab.node.test.ts)
	if (world.network.busy_for(tab.realm)) return null;
	const doc = tab.page.mainFrame.document as unknown as Document;
	const due = schedules(tab, doc);
	// (a hole's island is owed its wake once its own answer was: its `when`, then its `wake`, with
	// the hydrate margin core reads first)
	const owed = (r: Element): boolean => {
		const wake = r.getAttribute('wake');
		if (wake === null || wake === 'none') return false;
		if (r.getAttribute('render') !== 'defer') return due(r, wake, r.getAttribute('margin'));
		const margin = r.getAttribute('hydrate-margin') || r.getAttribute('margin');
		return due(r, r.getAttribute('when'), r.getAttribute('margin')) && due(r, wake, margin);
	};
	// (an island inside one still waiting for the visitor or the screen waits with it, and one in a
	// lake waits for the island around the lake, which a held region's baked markup never is: gen
	// 262, an island in a lake in a page-hosted held region, e2e/hole-in-lake.spec.ts)
	const waits = (r: Element): boolean => {
		let in_lake = false;
		for (
			let a = r.parentElement?.closest('ogygia-region');
			a;
			a = a.parentElement?.closest('ogygia-region')
		) {
			if (a.hasAttribute('data-hydrated')) {
				in_lake = false;
				continue;
			}
			const wake = a.getAttribute('wake');
			if (wake === 'none') in_lake = true;
			else if (wake !== null && !owed(a)) return true;
		}
		return in_lake;
	};
	const asleep = [...doc.querySelectorAll('ogygia-region[entry]')].filter(
		(r) => owed(r) && !r.hasAttribute('data-hydrated') && !waits(r)
	);
	if (asleep.length === 0) return null;
	const open = (r: Element) =>
		`<${r.localName}${[...r.attributes]
			.filter((a) => a.name !== 'endpoint' && a.name !== 'data-ogygia-props')
			.map((a) => ` ${a.name}="${a.value}"`)
			.join('')}>`;
	// (each with the regions around it, innermost first, and what it shows)
	const around = (r: Element): string => {
		const out: string[] = [];
		for (
			let a = r.parentElement?.closest('ogygia-region');
			a;
			a = a.parentElement?.closest('ogygia-region')
		)
			out.push(open(a));
		return out.length ? `\n  in ${out.join('\n  in ')}` : '';
	};
	const shows = (r: Element) => ` showing "${(r.textContent ?? '').trim().slice(0, 60)}"`;
	return {
		oracle: 'islands-wake',
		detail: `${url}: ${asleep.map((r) => `${open(r)}${shows(r)}${around(r)}`).join('\n')}`
	};
}

/**
 * A LIVE REGION ANNOUNCES WHAT IT SHOWS: at rest, each live region (the random app's, inside its
 * `[data-gen="live-host"]`; palaestra's live partials) was last heard, by a listener on the document,
 * saying `ogygia:live` about the tick it shows now: every paint of a tick says it (a morph, a swap's
 * mount, a kept-alive island's new props). And one showing an island (it has a `wake`) said
 * `ogygia:hydrated` when that island mounted, followed by `ogygia:live`, the one mount of its module
 * since another module's tick. Mutation testing: a keep-alive tick, or a mount, sent without
 * `bubbles` reached no listener and survived every other oracle (core.ts, gen 196). The tick is
 * {@link own_text}: what the region shows of its own (a press changes a button's own count, never a
 * tick: a pressed document is judged too). Judged after every action, not only at rest, once no
 * region's tick is on its way to the screen (no `live-region` hydrating, no `region-paint`
 * painting: between a swap and its island's mount the tick shows unannounced, rightly). Set aside: a
 * document a deploy failed a download of, and an island in a document a fault touched (its file may
 * have failed: the tick's HTML stands with nothing to announce, #942). A static tick is judged there
 * too: its morph always announces.
 */
/** Is a region's tick or answer on its way to the screen in the document `tab` shows (a
 *  `live-region` hydrating, a `region-paint` painting: their last moves, `__ogygia_moves()`)? */
function painting(tab: Tab): boolean {
	const w = tab.page.mainFrame.window as unknown as { __ogygia_moves?: () => string } | undefined;
	const last = new Map<string, string>();
	for (const line of (w?.__ogygia_moves?.() ?? '').split('\n')) {
		const m = /^((?:live-region|region-paint)\S*) \S+ -> (\S+)$/.exec(line);
		if (m) last.set(m[1], m[2]);
	}
	return [...last.values()].some((s) => s === 'hydrating' || s === 'painting');
}

export function live_events(tab: Tab, world: World): Broken | null {
	const url = tab.page.mainFrame.url;
	if (!url.startsWith('http') || world.skewed_for(tab.realm)) return null;
	if (painting(tab)) return null;
	const touched = faulted(world, tab);
	const doc = tab.page.mainFrame.document as unknown as Document;
	const wrong: string[] = [];
	for (const r of doc.querySelectorAll(
		'[data-gen="live-host"] > ogygia-region, [data-live-interactive] > ogygia-region, [data-live-static] > ogygia-region'
	)) {
		const now = own_text(r);
		if (now === '') continue;
		const island = r.hasAttribute('wake');
		if (island && touched) continue;
		const entry = r.getAttribute('entry') ?? '';
		const said = tab.heard.get(r) ?? [];
		const live = said.filter((h) => h.type === 'ogygia:live').at(-1);
		const what = `<ogygia-region entry="${entry}"> showing "${now}"`;
		if (live === undefined) {
			wrong.push(`${what}: never said ogygia:live`);
			continue;
		}
		if (live.entry !== entry || live.shown !== now) {
			wrong.push(`${what}: last said ogygia:live showing "${live.shown}" (${live.entry})`);
			continue;
		}
		if (!island) continue;
		// (its mount: back past this module's ticks, a hydrated and then a live)
		let i = said.length - 1;
		while (i >= 0 && said[i].type === 'ogygia:live' && said[i].entry === entry) i--;
		const mount = said[i];
		if (mount?.type !== 'ogygia:hydrated' || mount.entry !== entry)
			wrong.push(`${what}: its island mounted and never said ogygia:hydrated`);
		else if (said[i + 1]?.type !== 'ogygia:live')
			wrong.push(`${what}: its island mounted and said ogygia:hydrated, no ogygia:live`);
	}
	return wrong.length === 0
		? null
		: { oracle: 'live-events', detail: `${url}: ${wrong.join('\n')}` };
}

/**
 * A REGION ON SCREEN KEEPS ITS STYLES: at rest, every element inside a region that carries a
 * component's scoped class (`svelte-<hash>`: Svelte puts it only on elements its `<style>` can
 * match) has that component's rules somewhere in the document (a `<style>`, or a stylesheet link
 * that loaded). A navigation or a soft refresh takes a region sheet out once no region on the page
 * says it uses it: an answer that never said so lost its sheet while it stayed on screen. Judged in a
 * document the visitor pressed in too (a soft refresh is a press: the MPA check sets that document
 * aside, and the mutants that dropped what a region uses survived it). Set aside: a document a fault
 * or a deploy touched (a sheet's download may have failed).
 */
export function styled_regions(tab: Tab, world: World): Broken | null {
	const url = tab.page.mainFrame.url;
	if (!url.startsWith('http') || world.skewed_for(tab.realm) || faulted(world, tab)) return null;
	const doc = tab.page.mainFrame.document as unknown as Document;
	const scoped = new Set<string>();
	for (const el of doc.querySelectorAll('ogygia-region [class*="svelte-"]'))
		for (const c of el.classList) if (/^svelte-[a-z0-9]+$/.test(c)) scoped.add(c);
	if (scoped.size === 0) return null;
	const css: string[] = [];
	for (const s of doc.querySelectorAll('style')) css.push(s.textContent ?? '');
	for (const l of doc.querySelectorAll('link[rel~="stylesheet"]')) {
		const rules = (l as HTMLLinkElement).sheet?.cssRules;
		if (rules) for (const r of rules) css.push(r.cssText);
	}
	const text = css.join('\n');
	const missing = [...scoped].filter((c) => !text.includes(`.${c}`));
	return missing.length === 0
		? null
		: { oracle: 'unstyled-region', detail: `${url}: no rules for ${missing.join(', ')}` };
}

/** An empty region a filed bug explains, by its shape and what its document was answered (as
 *  KNOWN is for an MPA difference). */
const KNOWN_EMPTY: ReadonlyArray<{
	issue: number;
	what: string;
	is: (r: Element, world: World, realm: string) => boolean;
}> = [
	{
		issue: 910,
		what: "a server island inside a peer's widget never shows",
		// (its hole asks the app's endpoint, which refuses it: the generated peer's widget root,
		// `<section data-gen="widget">`, or a mounted page of it, `<main data-gen="peer-page">`)
		is: (r) =>
			r.getAttribute('render') === 'defer' &&
			r.closest('[data-gen="widget"], [data-gen="peer-page"]') != null &&
			(r.getAttribute('endpoint') ?? '').startsWith('/__ogygia__?')
	}
];

/**
 * EVERY WAIT SETTLES: once the world is at rest (nothing on the wire, nothing due within 2 s), no
 * machine of the page is still in a state of work under way (`loading`, `fetching`, `waking`,
 * `refreshing`, ...: every ogygia state whose name ends in `ing` is one, and each has its way out
 * on an answer, a failure or a timeout). One left there waits on something that will never come.
 * Read from the page's machine moves (`__ogygia_moves()`, rules on): each machine's last move is
 * its state now (the trace lets the oldest lines go first, so a machine it still lists is current).
 */
export function stuck(tab: Tab): Broken | null {
	const w = tab.page.mainFrame.window as unknown as { __ogygia_moves?: () => string };
	const last = new Map<string, string>();
	for (const line of (w.__ogygia_moves?.() ?? '').split('\n')) {
		const m = /^(\S+) \S+ -> (\S+)$/.exec(line);
		if (m) last.set(m[1], m[2]);
	}
	const held = [...last].filter(([, state]) => state.endsWith('ing'));
	if (held.length === 0) return null;
	const detail = `${tab.page.mainFrame.url}: at rest, still ${held.map(([id, s]) => `${id} ${s}`).join(', ')}`;
	return { oracle: 'stuck', detail };
}

/**
 * A HIDDEN DOCUMENT WAKES WITHOUT A VIEWPORT: one nobody has looked at (its tab hidden since it
 * came) has no viewport to prefer, so its hydration drain never waits for the viewport snapshot or
 * holds a turn for an on-screen island (schedule.ts `drain`: the drain machine never goes
 * `waiting`). Read from the page's machine moves, as {@link stuck} is.
 */
export function no_viewport_wait(tab: Tab): Broken | null {
	if (!tab.hidden || tab.seen.has(tab.realm)) return null;
	const w = tab.page.mainFrame.window as unknown as { __ogygia_moves?: () => string };
	const waited = (w.__ogygia_moves?.() ?? '')
		.split('\n')
		.some((l) => /^hydrate-drain\S* \S+ -> waiting$/.test(l));
	return waited
		? {
				oracle: 'viewport-wait',
				detail: `${tab.page.mainFrame.url}: never shown, its islands waited for a viewport`
			}
		: null;
}

export { gate_open_early };

/**
 * ISLAND CODE WAITS FOR THE PARSE: the island load gate opens only after DOMContentLoaded and a
 * painted frame (schedule.ts `after_document_painted`): the page's other deferred scripts and its
 * first paint go first. Read when the document fires DOMContentLoaded (browser.ts: `early_gate`
 * names a document whose gate had already opened then). Reading it takes what it read.
 */
export function parsed_first(tab: Tab): Broken | null {
	const url = tab.early_gate;
	if (url === null) return null;
	tab.early_gate = null;
	return {
		oracle: 'paint-gate',
		detail: `${url}: the island load gate opened before DOMContentLoaded`
	};
}

/** ogygia's own rules, in the page (`__ogygia_rules()`, built in with OGYGIA_RULES=1). */
export function page_rules(tab: Tab, world?: World): Broken | null {
	const w = tab.page.mainFrame.window as unknown as {
		__ogygia_rules?: () => Array<{ code: string; detail: string }>;
	};
	// (a marker no code wrote: a changed byte in what the document was sent made it; gen 195, seed
	// 97, `data-ogygia-regiontcss`)
	const changed =
		world !== undefined &&
		(document_faulted(world, tab) ||
			world.network.exchanges.some(
				(e) => e.tampered && (e.from === tab.realm || e.for === tab.realm)
			));
	const broken = (w.__ogygia_rules?.() ?? []).filter(
		(b) => !(changed && b.code === 'rule_markup_known')
	);
	return broken.length === 0
		? null
		: { oracle: 'rules', detail: broken.map((b) => `${b.code}: ${b.detail}`).join('\n') };
}

/**
 * Did the network fail one of the requests of the document `tab` shows (dropped, cut, changed,
 * offline, or a server error)? Such a page may report it, and may differ from a fresh load until
 * it loads again: the oracles excuse what the fault explains, and nothing else.
 */
/** Does `tab` show the browser's own page for a navigation that failed (nothing of the app: an
 *  empty document where the page would be)? A back or a link followed while offline. */
export function error_page(tab: Tab): boolean {
	const doc = tab.page.mainFrame.document as unknown as Document;
	return (
		doc.documentElement.attributes.length === 0 &&
		(doc.head?.childNodes.length ?? 0) === 0 &&
		(doc.body?.childNodes.length ?? 0) === 0
	);
}

/** Did buggify lose an answer of `realm`'s on the way? */
function lost_answers(world: World, realm: string): boolean {
	const fired = world.fired_in.get(realm);
	return fired !== undefined && LOSSY_POINTS.some((p) => fired.has(p));
}

/**
 * Was the document `tab` shows touched only by an outage (its tab offline for a while: requests
 * that failed to fetch, bodies that broke off), and nothing else the network does? Such a page is
 * back on the network now, and owes what a fresh load shows once it is at rest: an answer it gave
 * up on during the outage is asked for again. Not a page a script or stylesheet of which failed
 * (a browser never loads one again), nor one whose own load failed (the browser's error page).
 */
export function outage_only(world: World, tab: Tab): boolean {
	if (world.browsers.lacks_a_file(tab.realm) || error_page(tab) || lost_answers(world, tab.realm))
		return false;
	let outage = false;
	let first = true;
	for (const e of world.network.exchanges) {
		if (e.from !== tab.realm) continue;
		// (its own load failed: what it shows is the browser's error page, not the app's)
		if (first && (e.status === 'offline' || e.lost)) return false;
		first = false;
		if (
			e.cut ||
			e.tampered ||
			e.redirected ||
			e.status === 'dropped' ||
			(typeof e.status === 'number' && e.status >= 500)
		)
			return false;
		if (e.status === 'offline' || e.lost) {
			// (a remote function's call the outage failed: Kit's query keeps its error, and asking
			// again is the app's to do, not ogygia's; generated app 3, seed 48, a held region's host)
			if (new URL(e.url).pathname.startsWith('/_app/remote/')) return false;
			outage = true;
		}
	}
	return outage;
}

export function faulted(world: World, tab: Tab, since?: number): boolean {
	// (the document it shows, and the one it is loading, whose request may be what failed; or,
	// `since` an exchange, any document of the tab: what it said since then may be an earlier one's)
	const next = `${tab.name}#${tab.documents + 1}`;
	const mine = (from: string): boolean =>
		since === undefined ? from === tab.realm || from === next : from.startsWith(`${tab.name}#`);
	// (an answer buggify lost on the way is a dropped request's: the hole may give up, as it would;
	// palaestra seed 85, test/lost-answers.node.test.ts)
	if ([...world.fired_in.keys()].some((realm) => mine(realm) && lost_answers(world, realm)))
		return true;
	return world.network.exchanges.slice(since ?? 0).some(
		(e) =>
			(mine(e.from) &&
				(failed_on_wire(e) || e.tampered || e.redirected) &&
				!failed_over(world, e)) ||
			// (a server's hop for it changed on the way: what the page was made from. A cut one is
			// a failure the app must answer well, #937)
			(e.for !== undefined && mine(e.for) && e.tampered) ||
			kept_changed(e, tab)
	);
}

/** Whether batch `e` reached its page whole: answered 200, and nothing on the way failed, held,
 *  changed or redirected it. Its page then had every part the server gave, and owes none of its
 *  holes a fetch of their own. */
function batch_came_whole(e: World['network']['exchanges'][number]): boolean {
	return e.status === 200 && !failed_on_wire(e) && !e.stalled && !e.tampered && !e.redirected;
}

/**
 * Whether `e`, a document's own page answered 500 or more (a mounted peer page, a page with a
 * peer's widget), failed only because a peer's first origin was `down`: every hop its server made
 * for it that failed was a GET that fault answered. The app owes the next origin's answer (federation's
 * failover), so it is no excuse (a mutant that never asked the next origin survived).
 */
function failed_over(world: World, e: World['network']['exchanges'][number]): boolean {
	if (typeof e.status !== 'number' || e.status < 500 || e.cut || e.tampered || e.redirected)
		return false;
	// (the document's own page: a hole's or a widget's answer of its is judged by its own hops)
	if (world.network.exchanges.find((x) => x.from === e.from) !== e) return false;
	const hops = world.network.exchanges.filter((h) => h.for === e.from);
	// (a stalled hop is held past the peer's timeout: the app's 504 for it is its own, gen 23, seed 80)
	const failed = hops.filter(
		(h) => h.down === true || failed_on_wire(h) || h.tampered || h.stalled === true
	);
	return failed.length > 0 && failed.every((h) => h.down === true && h.method === 'GET');
}

/** Whether the network failed exchange `e`: dropped, offline, cut or broken off, or a server error. */
function failed_on_wire(e: World['network']['exchanges'][number]): boolean {
	// (a GET a peer's first origin answered `down`: the app owes the visitor its next origin's answer)
	if (e.down === true && e.method === 'GET') return false;
	return (
		e.cut ||
		e.status === 'dropped' ||
		e.status === 'offline' ||
		e.lost === true ||
		(typeof e.status === 'number' && e.status >= 500)
	);
}

/** The browser's line for an element whose file did not load (`error: <img> /hero.png failed`). */
const ELEMENT_FAILED = /^error: <\w+> (\S+) failed/;

/**
 * Whether `line` is an element's failed file whose own download, by its document, the network
 * failed. The DOM library says why an image failed only after its `error` event, and on the
 * window's console, so its line carries no reason for EXPLAINED to read (gen 192, seed 19:
 * test/oracles.test.ts).
 */
function element_download_failed(world: World, tab: Tab, line: string): boolean {
	const src = ELEMENT_FAILED.exec(line)?.[1];
	if (src === undefined) return false;
	let url: string;
	try {
		url = new URL(src, tab.page.mainFrame.url).href;
	} catch {
		return false; // ok: no URL, no download of it
	}
	return world.network.exchanges.some(
		(e) => e.from === tab.realm && e.url === url && failed_on_wire(e)
	);
}

/** A peer's page a server's hop got changed on the way, for any document: the app keeps a peer's
 *  page documents (`cache: { ttl }`), so a later document of that page, and the MPA check's fresh
 *  load, may be shown the changed copy (gen 125, seed 125013). By the hop's `path` and the page's. */
function kept_changed(e: World['network']['exchanges'][number], tab: Tab): boolean {
	if (!e.tampered || e.for === undefined) return false;
	const hop = new URL(e.url);
	if (!hop.pathname.endsWith('/og/fragment/page')) return false;
	const path = hop.searchParams.get('path');
	return path !== null && new URL(tab.page.mainFrame.url).pathname.endsWith(path);
}

/** Was the HTML of the document `tab` shows changed or cut on its way? (Its own load is the first
 *  request of its realm, whatever URL the router has moved it to since: seed 471, a changed byte
 *  in `/` and a click to /static.) */
export function document_faulted(world: World, tab: Tab): boolean {
	const own = world.network.exchanges.find((e) => e.from === tab.realm);
	if (own !== undefined && (own.tampered || own.cut)) return true;
	// (or a page the router brought in: any page answer this document had, as the router keeps
	// what it fetched and swaps it in again on a back, and an error there may leave the address
	// where it was; seed 53, a changed byte in the /dashboard/orders HTML a client navigation
	// swapped in; seed 837, a back to / whose changed HTML the router had kept)
	// (and a back to a page an earlier document of the tab loaded: history shows its HTML again)
	const here = new URL(tab.page.mainFrame.url).pathname;
	return world.network.exchanges.some((e) => {
		if (!(e.tampered || e.cut)) return false;
		// (or what a server fetched to make this document's answers: a changed byte in a peer's page
		// is in the page, as one in the page's own HTML would be; gen 32, seed 32008, `pe�r-page` in
		// a mounted peer page)
		if ((e.for === tab.realm && e.tampered) || kept_changed(e, tab)) return true;
		const path = new URL(e.url).pathname;
		if (e.from === tab.realm) return is_page_path(path);
		return e.from.startsWith(`${tab.name}#`) && path === here;
	});
}

/** What a page may say when the network failed it: ogygia's coded reports, the network's own
 *  failures (a script cut midway fails to parse), Vite's preload helper on a sheet whose
 *  download failed (seeds 65, 425), and Kit's remote functions on an answer they cannot read
 *  ("Invalid query.live response": seed 193, a changed byte in a live query's stream), and an
 *  inline handler a changed byte broke (the runtime script's `onerror`, as the DOM library says
 *  it fails to compile: generated-app seed 88), and the JSON parser's bare message for a changed
 *  byte in a JSON answer (a live query's client logs it without `SyntaxError`: palaestra seed 204).
 *  An uncaught TypeError is never excused. */
const EXPLAINED =
	/ogygiajs\.dev\/e\/|Unable to preload CSS|Failed to fetch|network error|stream was cut|Failed to perform request|SyntaxError|Invalid or unexpected token|Unexpected token|Status [45]\d\d|offline|connection lost|Invalid [\w.]+ response|Failed to read the 'on\w+' property| in JSON at position \d+/;

/** Whether `line` is a buggify point's own throw (a point's error says its name), reported by the
 *  document `realm` it fired in: what the runtime reports of a failure it recovers from. */
function points_own(world: World, realm: string, line: string): boolean {
	const fired = world.fired_in.get(realm);
	return fired !== undefined && [...fired].some((p) => line.includes(`Error: ${p}`));
}

/** How the browser, or ogygia with its code, says a module or file did not download. */
const NOT_DOWNLOADED =
	/ogygiajs\.dev\/e\/|Failed to fetch dynamically imported module|^error: <(script|link)> \S+ failed|Failed to perform request/;

/**
 * A failure a deploy explains: the tab asked a build for a content-hashed file only another build
 * has (an old page's file after its build is gone, or one build's file asked of the other's
 * servers in a rolling deploy), said as the browser says a download failed, or by ogygia with its
 * code. ogygia's own words without a code are never excused.
 */
function deploy_took(world: World, tab: Tab, line: string): boolean {
	return NOT_DOWNLOADED.test(line) && world.skewed_for(tab.realm);
}

/** No uncaught error, unhandled rejection or console error in the page (beyond what a network
 *  fault on this document explains, or a deploy, when `world` is given). */
export function page_errors(tab: Tab, world?: World, since?: number): Broken | null {
	// (each line judged by the document that said it: an action can show several; seed 78)
	const said_in = (l: string): Tab => {
		const realm = tab.said_by?.get(l) ?? tab.realm;
		return realm === tab.realm ? tab : { ...tab, realm };
	};
	const errors = [...tab.errors, ...tab.console.filter((l) => l.startsWith('error:'))].filter(
		(l) => {
			if (world === undefined) return true;
			const by = said_in(l);
			// (a document whose own HTML was changed or cut on the way is not the page the server
			// sent: what its scripts then do is the network's, a TypeError too. Seed 150: a flipped
			// byte in `type="application/ogygia-page"` hid the page data, and the island read a
			// missing field)
			if (document_faulted(world, by)) return false;
			// (a fault on the document stays its fact: a module whose download was cut fails every
			// later import of it in that document, as the module map keeps the failure)
			const excused = faulted(world, by) || faulted(world, by, since);
			return (
				!(excused && EXPLAINED.test(l)) &&
				!points_own(world, by.realm, l) &&
				!element_download_failed(world, by, l) &&
				!deploy_took(world, by, l)
			);
		}
	);
	if (errors.length === 0) return null;
	const { left, known } = known_said(errors);
	if (left.length === 0)
		return {
			oracle: 'known',
			detail: `${tab.page.mainFrame.url}: ${known.map((k) => `#${k.issue} (${k.what})`).join(', ')}`
		};
	return { oracle: 'page-errors', detail: errors.join('\n') };
}

/** What the app owes each of a peer's edge pages (gen.ts `edges`): the peer's own answer. */
const EDGE_OWED: ReadonlyArray<[(path: string) => boolean, string, (status: number) => boolean]> = [
	[(p) => p === EDGE_GONE, 'its not-found page, a 404', (s) => s === 404],
	[(p) => p === EDGE_MOVED, 'its redirect', (s) => s >= 300 && s < 400],
	[(p) => p === EDGE_BAD, 'its refusal, a 400', (s) => s === 400],
	[(p) => PEER_PAGE.test(p), 'its page, a 200', (s) => s === 200]
];
/** One of the peer's own pages, as the app mounts it (gen.ts `GenPeer.pages`: `/q<i>`). */
const PEER_PAGE = new RegExp(`^${MOUNT}/q\\d+$`);
/** What a Kit mount's error page says for a page the peer lacks: the peer's title for it, or, with
 *  none, federation's own word (`mount.kit`). Never nothing. */
const PEER_GONE_SAID: readonly string[] = ['not found', 'This section is unavailable.'];

/**
 * A MOUNTED PEER'S PAGE ANSWERS AS THE PEER DID: a page the peer lacks is a 404 in the app that
 * says so (a Kit mount's error message), one it moved is a redirect there, one it refuses is a 400, one
 * of its own pages is a 200 that shows that page, and a page that shows the visitor shows the one
 * the app vouched for (`sub: 'visitor'`, both mounts' `user`). Read from the tab's requests `since`
 * an exchange and its document. An answer the network failed, or one whose hop to the peer failed or changed on the
 * way, is the app's own (a 502 or 504) and is not judged.
 */
export function peer_answers(
	tab: Tab,
	world: World,
	since: number,
	mount: 'router' | 'kit' = 'router'
): Broken | null {
	const exchanges = world.network.exchanges;
	const hop_failed = (realm: string): boolean =>
		exchanges.some((e) => e.for === realm && (failed_on_wire(e) || e.tampered));
	const origin = new URL(tab.page.mainFrame.url).origin;
	const wrong: string[] = [];
	// (the peer gave the page whole, well inside the deadline counted from the visitor's own ask: the
	// app had its page to answer with; a mutant that made every exposed page a redirect, which the
	// mount then failed on, answered 5xx and survived)
	const peer_gave = (e: (typeof exchanges)[number], path: string): boolean => {
		const hops = exchanges.filter(
			(h) =>
				h.for === e.from &&
				h.at >= e.at &&
				new URL(h.url).pathname.endsWith('/og/fragment/page') &&
				new URL(h.url).searchParams.get('path') === path.slice(MOUNT.length)
		);
		return (
			hops.length > 0 &&
			hops.every(
				(h) =>
					typeof h.status === 'number' &&
					h.status < 500 &&
					!failed_on_wire(h) &&
					!h.tampered &&
					h.stalled !== true &&
					h.ended_at !== undefined &&
					h.ended_at - e.at < PEER_TIMEOUT_MS
			)
		);
	};
	for (const e of exchanges.slice(since)) {
		if (e.for !== undefined || !e.from.startsWith(`${tab.name}#`) || e.method !== 'GET') continue;
		if (
			typeof e.status === 'number' &&
			e.status >= 500 &&
			!e.cut &&
			!e.tampered &&
			!e.redirected &&
			new URL(e.url).origin === origin &&
			peer_gave(e, new URL(e.url).pathname)
		) {
			const owed = EDGE_OWED.find(([is]) => is(new URL(e.url).pathname));
			if (owed)
				wrong.push(`${new URL(e.url).pathname} answered ${e.status}, the peer answered ${owed[1]}`);
		}
		if (typeof e.status !== 'number' || e.status >= 500 || e.cut || e.tampered || e.redirected)
			continue;
		const url = new URL(e.url);
		if (url.origin !== origin) continue;
		const owed = EDGE_OWED.find(([is]) => is(url.pathname));
		if (owed && !owed[2](e.status) && !hop_failed(e.from))
			wrong.push(`${url.pathname} answered ${e.status}, the peer answered ${owed[1]}`);
	}
	const doc = tab.page.mainFrame.document as unknown as Document;
	if (!document_faulted(world, tab)) {
		for (const el of doc.querySelectorAll('[data-gen-who]'))
			if (el.textContent !== 'visitor')
				wrong.push(`the peer's page shows the visitor "${el.textContent}", the app's is "visitor"`);
		// (what the document shows: a page whose hop to the peer failed shows the app's own words)
		const path = new URL(tab.page.mainFrame.url).pathname;
		// (a document loaded whole at the page: one a client navigation reached may be mid-way)
		const own = exchanges.find((e) => e.from === tab.realm);
		const loaded =
			own !== undefined &&
			own.method === 'GET' &&
			new URL(own.url).pathname === path &&
			doc.readyState === 'complete';
		if (loaded && !hop_failed(tab.realm) && !error_page(tab)) {
			// (a page the app answered 200: its own 504, the peer's body past its timeout, shows the
			// app's words, not the peer's; gen 23, seed 38)
			if (
				PEER_PAGE.test(path) &&
				own.status === 200 &&
				doc.querySelector('[data-gen="peer-page"]') === null
			)
				wrong.push(`${path} shows none of the peer's page`);
			const text = doc.documentElement?.textContent ?? '';
			if (mount === 'kit' && path === EDGE_GONE && !PEER_GONE_SAID.some((s) => text.includes(s)))
				wrong.push(`${path} says neither the peer's title nor the app's word for a missing page`);
		}
	}
	return wrong.length === 0
		? null
		: { oracle: 'peer-answers', detail: `${tab.page.mainFrame.url}: ${wrong.join('\n')}` };
}

/**
 * NO FOREIGN HTML: a page never paints HTML another origin answered. Region HTML is trusted
 * because the app's own server made it (INVARIANTS.md HOLE-TRUST); a `redirect` fault sends a
 * region's request elsewhere, and what comes back is marked. Read from the tab's document.
 */
export function no_foreign_html(tab: Tab): Broken | null {
	const doc = tab.page.mainFrame.document as unknown as Document;
	const painted = [...doc.querySelectorAll(`[${FOREIGN_MARK}]`)];
	if (painted.length === 0) return null;
	return {
		oracle: 'foreign-html',
		detail: `${tab.page.mainFrame.url}: ${painted.map((e) => e.outerHTML.slice(0, 200)).join('\n')}`
	};
}

/**
 * AN OPAQUE REGION IS NEVER REPAIRED: a third party's edit inside a lake (gen `lakeEdit`), made while
 * the island holding it slept, is still there once the island hydrated. The island's wake puts the
 * island's own markup back to the server's, and never walks into a region Svelte's walk never enters.
 */
export function opaque_untouched(tab: Tab): Broken | null {
	const w = tab.page.mainFrame.window as unknown as { __sim_gen_lake_edits?: Element[] };
	const lost = (w.__sim_gen_lake_edits ?? []).filter(
		(r) =>
			r.isConnected &&
			r.hasAttribute('data-hydrated') &&
			r.querySelector('[data-gen-lake-mark]') === null
	);
	if (lost.length === 0) return null;
	return {
		oracle: 'opaque-untouched',
		detail: `${tab.page.mainFrame.url}: the edit in a lake of ${lost.map((r) => r.querySelector('[data-gen]')?.className ?? r.localName).join(', ')} was undone`
	};
}

/** Svelte's and ogygia's words for a region whose server HTML did not hydrate as it was. */
const UNHYDRATED = /svelte\.dev\/e\/hydration_mismatch|ogygiajs\.dev\/e\/hydration_discarded/;

/** Pages of the test app that serve HTML their islands do not hydrate as it is, on purpose, each
 *  with its reason. Never add one for HTML ogygia itself got wrong. */
const UNHYDRATED_BY_DESIGN: ReadonlyArray<{ path: RegExp; why: string }> = [
	{
		path: /^\/detector$/,
		why: "its hooks strip one region's hydration anchors, for the foreign-mutation detector's e2e"
	}
];

/** Whether `line`, said by the page at `url`, is a region not hydrating as sent on a page that
 *  serves such HTML on purpose (`UNHYDRATED_BY_DESIGN`). */
export function unhydrated_by_design(url: string, line: string): boolean {
	return (
		UNHYDRATED.test(line) &&
		URL.canParse(url) &&
		UNHYDRATED_BY_DESIGN.some((d) => d.path.test(new URL(url).pathname))
	);
}

/**
 * THE SERVER'S HTML IS THE LIVE PAGE: a region hydrates the HTML the server sent as it is. Svelte
 * says `hydration_mismatch` when the DOM is not what its code expects, and ogygia then discards
 * the server's HTML and renders anew (`hydration_discarded`): what the visitor saw first was not
 * what the page is. Excused when the document's own HTML was changed or cut on the way.
 */
export function hydrates_as_sent(tab: Tab, world?: World): Broken | null {
	const said = tab.console.filter((l) => UNHYDRATED.test(l));
	if (said.length === 0) return null;
	if (world !== undefined && document_faulted(world, tab)) return null;
	// (nor when a changed or cut byte reached what a region renders from: a remote function's
	// answer or a hole's, a peer's deferred widget's too, its props then not what the server
	// rendered; generated app 8, seed 61, a changed byte in a live query's tick; gen 87, seed 34,
	// in a widget's `/og/frag`)
	if (
		world !== undefined &&
		world.network.exchanges.some(
			(e) =>
				e.from === tab.realm &&
				(e.tampered || e.cut) &&
				/^\/(_app\/remote\/|__ogygia__|og\/frag)/.test(new URL(e.url).pathname)
		)
	)
		return null;
	const url = tab.page.mainFrame.url;
	if (UNHYDRATED_BY_DESIGN.some((d) => d.path.test(new URL(url).pathname))) return null;
	const detail = `${url}: ${said.map((l) => l.split('\n')[0]).join('\n')}`;
	return { oracle: 'ssr-hydrate', detail };
}

/** What a page says because of a filed bug, as KNOWN is for a DOM difference: a seed that says
 *  only these is counted `known`, not failed. Each entry goes when its fix lands. */
export const KNOWN_SAID: ReadonlyArray<{ issue: number; what: string; said: RegExp }> = [
	{
		issue: 1046,
		what: "Svelte's async mode sends a guarded query with the value its {#if} rules out",
		said: /^unhandled: \{"message":"Bad Request"\}$/
	},
	{
		issue: 1079,
		what: "Svelte's async mode reads a remote query's derived after its effect ended",
		// (a plain Kit app warns it too; the stale read it warns of gave palaestra's PendingGreeting
		// `undefined`, seeds 20257 and a plain Kit app's 124)
		said: /svelte\.dev\/e\/derived_inert|^unhandled: TypeError: Cannot read properties of undefined \(reading 'greeting'\)/
	},
	{
		issue: 1158,
		what: 'a hole batch called off while its body comes rejects with nobody listening',
		// (the reason the network gives a request its page called off: browser.ts `call_off`)
		said: /^unhandled: AbortError: The operation was aborted\.$/
	}
];

/** `lines` less what a filed bug explains (`KNOWN_SAID`), and which bugs did. */
export function known_said(lines: readonly string[]): {
	left: string[];
	known: { issue: number; what: string }[];
} {
	const known = KNOWN_SAID.filter((k) => lines.some((l) => k.said.test(l)));
	return { left: lines.filter((l) => !known.some((k) => k.said.test(l))), known };
}

/**
 * No error escaped every page and server to the host process (beyond a network failure's own
 * error while the network failed someone: a page's unhandled rejection reaches the host, not the
 * page, and cannot be told apart by tab). Reading it takes what it read.
 */
export function uncaught(world: World): Broken | null {
	const any_fault = world.browsers.visitors.some((v) => v.tabs.some((t) => faulted(world, t)));
	const left = world.uncaught.filter((l) => !(any_fault && EXPLAINED.test(l.split('\n')[0])));
	world.uncaught.length = 0;
	if (left.length === 0) return null;
	// (a filed bug's words reach the host too: seed 265, #817's from a press)
	const { left: unknown, known } = known_said(left);
	if (unknown.length === 0)
		return { oracle: 'known', detail: known.map((k) => `#${k.issue} (${k.what})`).join(', ') };
	return { oracle: 'uncaught', detail: left.join('\n') };
}

/** A server rule a filed bug breaks, as KNOWN_SAID is for what a page says. */
const KNOWN_SERVER_RULES: ReadonlyArray<{ issue: number; what: string; said: RegExp }> = [];

/** No server said one of ogygia's server rules broken (core server/rules.ts: a scope left open, a
 *  kept failure, a region answer a shared cache may keep, a capability minted as more than a path).
 *  Reading it takes what it read. */
export function server_rules(world: World): Broken | null {
	const said = [...new Set(world.server_rules)];
	world.server_rules.length = 0;
	if (said.length === 0) return null;
	const known = KNOWN_SERVER_RULES.filter((k) => said.some((l) => k.said.test(l)));
	if (said.every((l) => known.some((k) => k.said.test(l))))
		return { oracle: 'known', detail: known.map((k) => `#${k.issue} (${k.what})`).join(', ') };
	return { oracle: 'server-rules', detail: said.join('\n') };
}

/**
 * A RESHAPED PAGE'S TEXT COMES BACK AS IT WAS: each text a reshape pass's render trimmed (its HTML's
 * `og-t` marks, `Exchange.restore_owes`) stands in the document at rest with its whitespace, where
 * the same words stand at all. The MPA check cannot see it: it reads text with its whitespace
 * collapsed, and its fresh load is reshaped and restored alike (a restore that left the trimmed
 * text survived). A document the network changed is not judged.
 */
export function text_restored(tab: Tab, world: World): Broken | null {
	const own = world.network.exchanges.find((e) => e.from === tab.realm);
	if (own?.restore_owes === undefined || document_faulted(world, tab)) return null;
	if (new URL(own.url).pathname !== new URL(tab.page.mainFrame.url).pathname) return null;
	const doc = tab.page.mainFrame.document as unknown as Document;
	const texts: string[] = [];
	const walk = doc.createTreeWalker(doc.documentElement, 4 /* SHOW_TEXT */);
	for (let n = walk.nextNode(); n; n = walk.nextNode()) texts.push((n as Text).data);
	const wrong: string[] = [];
	for (const was of new Set(own.restore_owes)) {
		if (was.trim() === '') continue;
		const same_words = texts.filter((t) => t.trim() === was.trim());
		if (same_words.length > 0 && !same_words.includes(was))
			wrong.push(`${JSON.stringify(was)} stands as ${JSON.stringify(same_words[0])}`);
	}
	return wrong.length === 0
		? null
		: { oracle: 'text-restored', detail: `${tab.page.mainFrame.url}: ${wrong.join('\n')}` };
}

/** The points that leave a rewrite's element unrendered on purpose: the packages' and the random
 *  app's own. */
const UNRENDERED_BY: readonly string[] = ['rewrite.', 'gen.reshape-'];

/**
 * A REWRITE RENDERS EVERY ELEMENT IT MATCHES, AND ONLY THE OUTERMOST: the page's HTML as it came
 * (`Exchange.rewrite_misses`) holds no outermost matched element the render never reached, unless
 * a rewrite point fired while the server answered it (a render that threw, a cancel, a split
 * chunk), and never an element rendered inside one left unrendered, whatever fired. An unrendered
 * element is still a correct page, so no other oracle tells a rewrite that rendered nothing from
 * one that worked. A document the network changed is not judged.
 */
export function rewrite_rendered(tab: Tab, world: World): Broken | null {
	const own = world.network.exchanges.find((e) => e.from === tab.realm);
	const misses = own?.rewrite_misses;
	if (misses === undefined || document_faulted(world, tab)) return null;
	if (new URL(own!.url).pathname !== new URL(tab.page.mainFrame.url).pathname) return null;
	const explained =
		misses.stored || (own!.fired ?? []).some((p) => UNRENDERED_BY.some((u) => p.startsWith(u)));
	const wrong = [
		...(explained ? [] : misses.unrendered.map((n) => `<${n}> went out unrendered`)),
		...misses.inner.map((n) => `<${n}> was rendered inside a matched element left unrendered`)
	];
	return wrong.length === 0
		? null
		: { oracle: 'rewrite-rendered', detail: `${own!.url}: ${wrong.join('\n')}` };
}

/** A peer hop's deadline (federation's `timeout` default, which the generated apps keep): an answer
 *  the delay fault brought later is no answer, and the replica is asked (gen 121, seed 6). */
const PEER_TIMEOUT_MS = 5000;

/**
 * A PEER FAILS OVER, AND ONLY THEN: a server's GET to a peer's first origin that the `down` fault
 * answered is asked again of its replica (federation's failover: a 500 kept as the answer
 * survived), and the replica is asked only after the first origin gave nothing (asking every
 * origin survived): down, failed on the wire, stalled, or past the peer's timeout. Read from the
 * hops (`for` a document) `since` an exchange. A hop whose document's own request ended is not
 * judged: an ended request asks nothing more.
 */
export function peer_fails_over(world: World, since: number): Broken | null {
	const replicas = world.replicas;
	if (replicas.size === 0) return null;
	const first_of = new Map([...replicas].map(([r, o]) => [o, r]));
	const all = world.network.exchanges;
	const hops = all.slice(since).filter((e) => e.for !== undefined && e.method === 'GET');
	const ended = (realm: string): boolean =>
		all.some(
			(e) =>
				e.from === realm &&
				(e.cut || e.lost === true || e.status === 'aborted' || e.status === 'dropped')
		);
	// (a first origin's answer that gave the app nothing it could use: the replica is owed)
	const gave_nothing = (p: (typeof all)[number], asked_at: number): boolean =>
		p.down === true ||
		failed_on_wire(p) ||
		p.stalled === true ||
		typeof p.status !== 'number' ||
		asked_at - p.at >= PEER_TIMEOUT_MS;
	const wrong: string[] = [];
	for (const h of hops) {
		const u = new URL(h.url);
		if (ended(h.for!)) continue;
		const replica = first_of.get(u.origin);
		if (replica !== undefined) {
			const there = `${replica}${u.pathname}${u.search}`;
			if (h.down === true && !hops.some((n) => n.for === h.for && n.url === there && n.at >= h.at))
				wrong.push(`${h.url}: its first origin was down, and its replica was not asked`);
			continue;
		}
		const first = replicas.get(u.origin);
		if (first === undefined) continue;
		// (each ask of the replica follows an ask of the first origin that gave nothing; with two
		// reads of one address at once, any of them: gen 121, seed 103)
		const here = `${first}${u.pathname}${u.search}`;
		const before = all.filter((p) => p.for === h.for && p.url === here && p.at <= h.at);
		if (before.length > 0 && !before.some((p) => gave_nothing(p, h.at)))
			wrong.push(
				`${h.url}: asked though its first origin answered (${before.map((p) => `#${p.id} ${p.status} at ${p.at}`).join(', ')}; this at ${h.at})`
			);
	}
	return wrong.length === 0 ? null : { oracle: 'peer-failover', detail: wrong.join('\n') };
}

/** A shared cache never hands one visitor's personal bytes to another (cdn.ts records each hit
 *  served across cookies; any is a finding until the oracle can compare against the origin). */
export function no_cross_visitor_cache(world: World): Broken | null {
	// (a file whose name carries its content's hash is the same bytes for everyone: seed 8, the
	// runtime's chunk, made for a visitor with no cookies and served to one with a locale cookie)
	const crossed = world.cdn.crossed.filter(
		(c) =>
			(c.made_for !== '' || c.served_to !== '') &&
			!new URL(c.url).pathname.startsWith('/_app/immutable/')
	);
	return crossed.length === 0
		? null
		: {
				oracle: 'cache-isolation',
				detail: crossed
					.map((c) => `${c.url}: made for [${c.made_for}] served to [${c.served_to}]`)
					.join('\n')
			};
}

/** Visits of one URL in one document that grow, before it is called a leak. */
const LEAK_VISITS = 3;

/**
 * LEAKS: a page visit lets go of what it held when it ends. Sampled at rest after each action
 * (`Tab.held()`: the document's window and document listeners, intervals, observers), per document
 * and URL: what a document holds on its Nth visit of a URL may differ from its first (a page
 * visited since may install what lives as long as the document), but it must not GROW visit after
 * visit. Growth over {@link LEAK_VISITS} visits in a row, in one count, is what a visit that keeps
 * something after it ends looks like. For listeners and observers, the same code must be what grows:
 * a visit that leaks one adds the same closure again each time.
 */
export class Leaks {
	readonly #samples = new Map<string, Array<Record<string, number>>>();
	/** Each sample's listeners, by label (to name the ones that grew). */
	readonly #listening = new Map<string, string[][]>();
	/** Each sample's observers, by kind and callback code. */
	readonly #watching = new Map<string, string[][]>();
	/** Each document met, numbered. */
	readonly #docs = new WeakMap<object, number>();
	#docs_made = 0;
	/** Each tab's last sample's key: the same key twice running is one visit. */
	readonly #at = new Map<string, string>();
	/** Notes `tab`'s sample now; what grew, if it has grown visit after visit. `pressed`: the
	 *  visitor pressed in this document, so an island may hold more of their own (a list they
	 *  added to): its elements are theirs, and only what is held (listeners, timers) is judged. */
	check(tab: Tab, pressed = false): Broken | null {
		const url = tab.page.mainFrame.url;
		if (!url.startsWith('http')) return null;
		// (by the document itself too: a navigation that failed swaps the document in the DOM
		// library's same window, where a browser would make a new one; generated-app seed 71)
		const doc = tab.page.mainFrame.document as unknown as object;
		let n = this.#docs.get(doc);
		if (n === undefined) this.#docs.set(doc, (n = this.#docs_made++));
		const key = `${tab.realm}.${n} ${url.split('#')[0]}`;
		const list = this.#samples.get(key) ?? [];
		const held = tab.held();
		// (a module preload stays in the head once added, as Vite's own do: one per chunk the app
		// has, so bounded by the app, not by the visits; and a page store's mark is delivery: set
		// aside)
		const delivery = delivery_in_head(tab);
		const now: Record<string, number> = {
			...held,
			head: held.head - delivery,
			elements: held.elements - delivery
		};
		// (one sample per visit, its latest: the visit may still have been settling)
		const labels = this.#listening.get(key) ?? [];
		const watches = this.#watching.get(key) ?? [];
		if (this.#at.get(tab.name) === key && list.length > 0) {
			list[list.length - 1] = now;
			labels[labels.length - 1] = tab.listening();
			watches[watches.length - 1] = tab.watching();
		} else {
			list.push(now);
			labels.push(tab.listening());
			watches.push(tab.watching());
		}
		this.#at.set(tab.name, key);
		this.#samples.set(key, list);
		this.#listening.set(key, labels);
		this.#watching.set(key, watches);
		if (list.length < LEAK_VISITS) return null;
		const run = list.slice(-LEAK_VISITS);
		// (BOUNDED MEMORY: the head and the element count too; a page visited again is the same page)
		const grew = (field: string) => run.every((s, i) => i === 0 || s[field] > run[i - 1][field]);
		const fields = ['listeners', 'intervals', 'observers', 'head', 'elements'];
		for (const field of pressed ? fields.slice(0, -1) : fields) {
			if (!grew(field)) continue;
			// (listeners: one code added again on every visit, not new code on each: a page's first
			// visit of a kind installs a delegation once for the document, as ogygia's wake and
			// Svelte's event delegation do, and visits of new kinds of region add new code each;
			// generated-app 6, seed 12)
			if (field === 'listeners' && growing(labels.slice(-LEAK_VISITS)).length === 0) continue;
			// (observers too: the timing observer, the viewport tracker's and its children's are each
			// made once for the document, the first time a visit needs one; gen 195, seed 195005)
			if (field === 'observers' && growing(watches.slice(-LEAK_VISITS)).length === 0) continue;
			return {
				oracle: 'leak',
				detail: `${url}: ${field} grew visit after visit in one document: ${run.map((s) => s[field]).join(' → ')}${field === 'intervals' ? `\nrunning: ${tab.platform?.pending().join(', ')}` : ''}${
					field === 'listeners'
						? labels
								.slice(-LEAK_VISITS + 1)
								.map(
									(l, i) =>
										`\nvisit ${i + 2} added: ${added(labels[labels.length - LEAK_VISITS + i], l).join(', ')}`
								)
								.join('')
						: ''
				}`
			};
		}
		return null;
	}
}

/** The listeners (by target, type and code; the line that added one set aside) held more times in
 *  each sample than in the one before. */
function growing(samples: string[][]): string[] {
	const counts = samples.map((labels) => {
		const c = new Map<string, number>();
		for (const l of labels) {
			const base = l.split(' @ ')[0];
			c.set(base, (c.get(base) ?? 0) + 1);
		}
		return c;
	});
	return [...counts[counts.length - 1].keys()].filter((l) =>
		counts.every((c, i) => i === 0 || (c.get(l) ?? 0) > (counts[i - 1].get(l) ?? 0))
	);
}

/** What `after` holds that `before` did not, each label as many times as it is in excess. */
function added(before: string[], after: string[]): string[] {
	const left = new Map<string, number>();
	for (const l of before) left.set(l, (left.get(l) ?? 0) + 1);
	const more: string[] = [];
	for (const l of after) {
		const n = left.get(l) ?? 0;
		if (n > 0) left.set(l, n - 1);
		else more.push(l);
	}
	return more;
}

/** A page store's mark on a copy it served (`<meta name="ogygia-stored">`): delivery, not the
 *  page. The MPA check drops it (gen 63, seed 26), and the leak check does not count it: a stored
 *  visit brings it in once (gen 61, seed 36). */
const STORE_MARK = 'meta[name="ogygia-stored"]';

/** What the head holds that a visit does not leak: the module preloads (one per chunk the app
 *  has, kept once added, as Vite's own are) and a page store's mark. */
function delivery_in_head(tab: Tab): number {
	const head = (tab.page.mainFrame.document as unknown as Document).head;
	return head ? head.querySelectorAll(`link[rel="modulepreload"], ${STORE_MARK}`).length : 0;
}
