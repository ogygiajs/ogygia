/**
 * ORACLES: what must hold, checked at every step or once the world is at rest. Each says what it
 * found broken, or null. Each is precise about what it normalizes away, and why.
 */
import { writeFileSync } from 'node:fs';
import type { Tab, Visitor } from './browser.ts';
import { FOREIGN_MARK, is_page_path, type World } from './world.ts';

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
 * - a page store's mark (`<meta name="ogygia-stored">`): the copy came from the store, where the
 *   render that filled it did not say so; the page itself is compared (delivery, as a CDN's
 *   header is).
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
		const tag = el.tagName.toLowerCase();
		if (tag === 'script') return;
		if (tag === 'link' && /\b(modulepreload|preload|prefetch)\b/.test(el.getAttribute('rel') ?? ''))
			return;
		if (el.hasAttribute('data-ogygia-announcer')) return;
		if (el.matches(STORE_MARK)) return;
		const attrs = [...el.attributes]
			.filter(
				(a) =>
					a.name !== 'nonce' &&
					!(tag === 'ogygia-region' && (a.name === 'data-key' || a.name === 'data-revalidated'))
			)
			.map((a) =>
				(tag === 'link' && a.name === 'href') || /^\.\.?\//.test(a.value)
					? `${a.name}="${new URL(a.value, root.baseURI ?? 'https://app.test/').pathname}"`
					: `${a.name}="${a.value}"`
			)
			.sort()
			.join(' ');
		out.push(`${'  '.repeat(depth)}<${tag}${attrs ? ' ' + attrs : ''}>`);
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
		issue: 937,
		what: 'a deferred peer region whose peer failed is answered as an empty success',
		// (a peer widget the fresh load shows is missing whole from the tab, and a server's hop to a
		// peer failed in the run: cut, dropped, tampered, or a 5xx; each widget set aside whole)
		applies: (shown, fresh) => widgets(shown) < widgets(fresh),
		forgive: (s) => {
			const out: string[] = [];
			let inside: string | null = null;
			for (const line of s.split('\n')) {
				const indent = /^ */.exec(line)![0];
				if (inside !== null && indent.length > inside.length) continue;
				inside = null;
				if (line.trim().startsWith('<section data-gen="widget"')) {
					inside = indent;
					continue;
				}
				out.push(line);
			}
			return out.join('\n');
		},
		seen: (world) => world.network.exchanges.some(peer_hop_failed)
	},
	{
		issue: 914,
		what: 'every deferred peer widget shares one answer',
		// (the generated peer's widgets say whose they are, `w<k> for r<slot>`: another slot's
		// widget in one; each widget's subtree set aside)
		applies: (shown, fresh) => widget_labels(shown) !== widget_labels(fresh),
		forgive: (s) => {
			const out: string[] = [];
			let inside: string | null = null;
			for (const line of s.split('\n')) {
				const indent = /^ */.exec(line)![0];
				if (inside !== null && indent.length > inside.length) continue;
				inside = null;
				out.push(line);
				if (line.trim().startsWith('<section data-gen="widget"')) inside = indent;
			}
			return out.join('\n');
		}
	},
	{
		issue: 954,
		what: "a remote call from a stored page is answered with the stored page's HTML",
		// (a held or live region's query failed on one side only: the generated host's error line;
		// each host's subtree set aside)
		applies: (shown, fresh) => host_errors(shown) !== host_errors(fresh),
		forgive: (s) => {
			const out: string[] = [];
			let inside: string | null = null;
			for (const line of s.split('\n')) {
				const indent = /^ */.exec(line)![0];
				if (inside !== null && indent.length > inside.length) continue;
				inside = null;
				out.push(line);
				if (/^<div data-gen="(held|live)-host"/.test(line.trim())) inside = indent;
			}
			return out.join('\n');
		}
	}
];

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

/** How many generated peer widgets a normalized DOM shows. */
function widgets(s: string): number {
	return s.split('\n').filter((l) => l.trim().startsWith('<section data-gen="widget"')).length;
}

/** A server's hop to a peer's fragment that failed (#937: the shell answers its hole empty). */
function peer_hop_failed(e: World['network']['exchanges'][number]): boolean {
	return (
		e.from.startsWith('server') &&
		e.url.includes('/og/fragment/') &&
		(e.cut ||
			e.tampered ||
			(typeof e.status === 'number' ? e.status >= 500 : e.status !== 'pending'))
	);
}

/** A normalized DOM's generated peer widgets, by what each says it is (`w<k> for r<slot>`). */
function widget_labels(s: string): string {
	return [...s.matchAll(/"(w\d+ for r\d+)"/g)].map((m) => m[1]).join(',');
}

/** The generated held and live hosts that show their query's error (#954). */
function host_errors(s: string): number {
	return s.split('\n').filter((l) => l.trim().startsWith('<span data-gen-error')).length;
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
 *  (a fault there is no finding about the tab), at rest. */
async function load_fresh(
	world: World,
	v: Visitor,
	url: string,
	name: string
): Promise<{ visitor: Visitor; tab: Tab }> {
	const visitor = world.visitor(`${v.name}-${name}`);
	const jar = (b: Visitor) =>
		(
			b.browser.defaultContext as unknown as {
				cookieContainer: {
					getCookies(u: URL | null, http: boolean): unknown[];
					addCookies(c: unknown[]): void;
				};
			}
		).cookieContainer;
	jar(visitor).addCookies(jar(v).getCookies(null, true));
	const tab = world.tab(visitor);
	world.network.calm(tab.name);
	const path = new URL(url);
	await world.go(tab, 'goto', path.pathname + path.search + path.hash);
	return { visitor, tab };
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
	let shown = view(tab.page.mainFrame.document as unknown as Document);
	// (a page a build a deploy replaced answered is compared with a fresh load from that build: an
	// old page is the old release's, whole)
	const build = world.build_of(tab.realm);
	const fresh_load = (w: World, visitor: Visitor, at: string, name: string) =>
		w.as_of(build, () => load_fresh(w, visitor, at, name), world.answers_of(tab.realm));
	const fresh = await fresh_load(world, v, url, 'fresh');
	// (no reference: the build the page is of could not give it again, its stored copies dropped and
	// a newer build's handed out instead, gen 131, seed 131003)
	if (world.astray(fresh.tab.realm)) return null;
	const loaded = view(fresh.tab.page.mainFrame.document as unknown as Document);
	// (a text that changes on its own at rest is time, not state: a ticking clock in an island the
	// navigation kept has run longer than the fresh load's. Each side is looked at once more a
	// moment later, and a text line that moved by itself is masked on both: seed 289)
	await world.loop.run(LIVE_LOOK_MS);
	const live = new Set([
		...live_lines(shown, view(tab.page.mainFrame.document as unknown as Document)),
		...live_lines(loaded, view(fresh.tab.page.mainFrame.document as unknown as Document))
	]);
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
	const looks = [loaded];
	let diff = '';
	for (const n of [2, 3]) {
		const more = await fresh_load(world, v, url, `fresh-${n}`);
		looks.push(view(more.tab.page.mainFrame.document as unknown as Document));
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
		detail: `${url}\n${left}${first_difference(a, b)}${said.length ? `\nthe fresh load said:\n${said.join('\n')}` : ''}`
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
	const known = KNOWN_EMPTY.filter((k) => empty.some(k.is));
	const left = empty.filter((r) => !KNOWN_EMPTY.some((k) => k.is(r)));
	if (left.length === 0)
		return {
			oracle: 'known',
			detail: `${url}: ${known.map((k) => `#${k.issue} (${k.what})`).join(', ')}`
		};
	return { oracle: 'empty-region', detail: `${url}: ${left.map(open).join('\n')}` };
}

/** An empty region a filed bug explains, by its shape (as KNOWN is for an MPA difference). */
const KNOWN_EMPTY: ReadonlyArray<{ issue: number; what: string; is: (r: Element) => boolean }> = [
	{
		issue: 937,
		what: 'a deferred peer region whose peer failed is answered as an empty success',
		// (its hole fetched and answered, with nothing: the shell's hop to the peer failed)
		is: (r) =>
			r.getAttribute('render') === 'defer' &&
			r.hasAttribute('data-hydrated') &&
			(r.getAttribute('endpoint') ?? '').startsWith('/og/frag?')
	},
	{
		issue: 910,
		what: "a server island inside a peer's widget never shows",
		// (its hole asks the app's endpoint, which refuses it: the generated peer's widget root,
		// `<section data-gen="widget">`, or a mounted page of it, `<main data-gen="peer-page">`)
		is: (r) =>
			r.getAttribute('render') === 'defer' &&
			r.closest('[data-gen="widget"], [data-gen="peer-page"]') != null &&
			(r.getAttribute('endpoint') ?? '').startsWith('/__ogygia__?')
	},
	{
		issue: 948,
		what: 'a server island inside a server island inside an island stays empty',
		// (a hole in a lake, its answer shown and then dropped: gen 73, /p3)
		is: (r) =>
			r.hasAttribute('data-og-hole') &&
			!r.hasAttribute('data-hydrated') &&
			r.getAttribute('when') === 'load' &&
			r.parentElement?.closest('ogygia-region[wake="none"]') != null
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

/** ogygia's own rules, in the page (`__ogygia_rules()`, built in with OGYGIA_RULES=1). */
export function page_rules(tab: Tab): Broken | null {
	const w = tab.page.mainFrame.window as unknown as {
		__ogygia_rules?: () => Array<{ code: string; detail: string }>;
	};
	const broken = w.__ogygia_rules?.() ?? [];
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

/**
 * Was the document `tab` shows touched only by an outage (its tab offline for a while: requests
 * that failed to fetch, bodies that broke off), and nothing else the network does? Such a page is
 * back on the network now, and owes what a fresh load shows once it is at rest: an answer it gave
 * up on during the outage is asked for again. Not a page a script or stylesheet of which failed
 * (a browser never loads one again), nor one whose own load failed (the browser's error page).
 */
export function outage_only(world: World, tab: Tab): boolean {
	if (world.browsers.lacks_a_file(tab.realm) || error_page(tab)) return false;
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
	return world.network.exchanges.slice(since ?? 0).some(
		(e) =>
			(mine(e.from) &&
				(e.cut ||
					e.tampered ||
					e.redirected ||
					e.status === 'dropped' ||
					e.status === 'offline' ||
					e.lost === true ||
					(typeof e.status === 'number' && e.status >= 500))) ||
			// (a server's hop for it changed on the way: what the page was made from. A cut one is
			// a failure the app must answer well, #937)
			(e.for !== undefined && mine(e.for) && e.tampered) ||
			kept_changed(e, tab)
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
 *  it fails to compile: generated-app seed 88). An uncaught TypeError is never excused. */
const EXPLAINED =
	/ogygiajs\.dev\/e\/|Unable to preload CSS|Failed to fetch|network error|stream was cut|Failed to perform request|SyntaxError|Invalid or unexpected token|Unexpected token|Status [45]\d\d|offline|connection lost|Invalid [\w.]+ response|Failed to read the 'on\w+' property/;

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
			return !(excused && EXPLAINED.test(l)) && !deploy_took(world, by, l);
		}
	);
	if (errors.length === 0) return null;
	const known = KNOWN_SAID.filter((k) => errors.some((l) => k.said.test(l)));
	if (errors.every((l) => known.some((k) => k.said.test(l))))
		return {
			oracle: 'known',
			detail: `${tab.page.mainFrame.url}: ${known.map((k) => `#${k.issue} (${k.what})`).join(', ')}`
		};
	return { oracle: 'page-errors', detail: errors.join('\n') };
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
		issue: 915,
		what: "Svelte 5.56.8's error walk meets a destroyed boundary",
		said: /^unhandled: TypeError: Cannot read properties of null \(reading 'error'\)/
	},
	{
		issue: 954,
		what: "a remote call from a stored page is answered with the stored page's HTML",
		// (Kit's remote client reads the HTML as JSON: a live query's rejection nobody handles, gen 112)
		said: /^unhandled: SyntaxError: Unexpected token '<', "<!doctype "\.\.\. is not valid JSON/
	}
];

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
	const known = KNOWN_SAID.filter((k) => left.some((l) => k.said.test(l)));
	if (left.every((l) => known.some((k) => k.said.test(l))))
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
 * something after it ends looks like. For listeners, the same code must be what grows: a visit that
 * leaks one adds the same closure again each time.
 */
export class Leaks {
	readonly #samples = new Map<string, Array<Record<string, number>>>();
	/** Each sample's listeners, by label (to name the ones that grew). */
	readonly #listening = new Map<string, string[][]>();
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
		if (this.#at.get(tab.name) === key && list.length > 0) {
			list[list.length - 1] = now;
			labels[labels.length - 1] = tab.listening();
		} else {
			list.push(now);
			labels.push(tab.listening());
		}
		this.#at.set(tab.name, key);
		this.#samples.set(key, list);
		this.#listening.set(key, labels);
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
