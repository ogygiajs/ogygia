/**
 * ORACLES: what must hold, checked at every step or once the world is at rest. Each says what it
 * found broken, or null. Each is precise about what it normalizes away, and why.
 */
import type { Tab, Visitor } from './browser.ts';
import type { World } from './world.ts';

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
 *   is compared).
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
		out.push(`${'  '.repeat(depth)}<${tag}${attrs ? ` ${attrs}` : ''}>`);
		if (tag !== 'head') {
			for (const child of el.childNodes) walk(child, depth + 1, out);
			return;
		}
		// stylesheets in their order, then the rest of the head, sorted
		const sheets: string[] = [];
		const rest: string[] = [];
		for (const child of el.children) {
			const one: string[] = [];
			walk(child, depth + 1, one);
			if (one.length === 0) continue;
			const sheet =
				child.tagName === 'STYLE' ||
				(child.tagName === 'LINK' && /\bstylesheet\b/.test(child.getAttribute('rel') ?? ''));
			(sheet ? sheets : rest).push(one.join('\n'));
		}
		out.push(...sheets, ...rest.sort());
	};
	const out: string[] = [`title: ${root.title}`];
	if (root.documentElement) walk(root.documentElement, 0, out);
	return out.join('\n');
}

/** `<head>`'s children (blocks of a normalized DOM), each with its subtree, and where they sit. */
function head_blocks(s: string): { before: string[]; blocks: string[][]; after: string[] } {
	const lines = s.split('\n');
	const at = lines.findIndex((l) => l === '  <head>');
	if (at === -1) return { before: lines, blocks: [], after: [] };
	const blocks: string[][] = [];
	let i = at + 1;
	for (; i < lines.length && lines[i].startsWith('    '); i++) {
		if (!lines[i].startsWith('     ')) blocks.push([lines[i]]);
		else blocks[blocks.length - 1]?.push(lines[i]);
	}
	return { before: lines.slice(0, at + 1), blocks, after: lines.slice(i) };
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
}> = [
	{
		issue: 786,
		what: 'an empty <title> after client navigations, or two titles on a page visited again',
		// (an empty one: no text line under it; and the empty one a page with a title fills in,
		// beside its own: seed 443, /soft-race → a page with no title → back)
		applies: (shown, fresh) => titles(shown).length > titles(fresh).length,
		forgive: (s) => {
			const h = head_blocks(s);
			const first = h.blocks.find((b) => b[0] === '    <title>' && b.length > 1);
			const blocks = h.blocks.filter((b) => b[0] !== '    <title>' || b === first);
			return [...h.before, ...blocks.flat(), ...h.after].join('\n');
		}
	},
	{
		issue: 799,
		what: "a left page's region sheet kept for one navigation",
		// (the tab holds a region sheet the fresh load does not, or one more copy of it: the left
		// page's lifted sheet beside the next page's own, its href written another way; seeds 385,
		// 415, /server → /nested, gone with #800's fix)
		applies: (shown, fresh) => {
			const there = new Map<string, number>();
			for (const s of region_sheets(fresh)) there.set(s, (there.get(s) ?? 0) + 1);
			return region_sheets(shown).some((s) => {
				const n = there.get(s) ?? 0;
				there.set(s, n - 1);
				return n <= 0;
			});
		},
		forgive: (s) => {
			const h = head_blocks(s);
			const blocks = h.blocks.filter((b) => !b[0].includes('data-ogygia-region-css='));
			return [...h.before, ...blocks.flat(), ...h.after].join('\n');
		}
	},
	{
		issue: 794,
		what: "a page's styles above the app's after client navigations",
		// (the same stylesheets, in another order)
		applies: (shown, fresh) => {
			const sheets = (s: string) =>
				head_blocks(s)
					.blocks.filter((b) => /^ {4}<style\b|rel="stylesheet"/.test(b[0]))
					.map((b) => b.join('\n'));
			const [a, b] = [sheets(shown), sheets(fresh)];
			return a.join('\n') !== b.join('\n') && a.sort().join('\n') === b.sort().join('\n');
		},
		forgive: (s) => {
			const h = head_blocks(s);
			const blocks = h.blocks.map((b) => b.join('\n')).sort();
			return [...h.before, ...blocks, ...h.after].join('\n');
		}
	},
	{
		issue: 804,
		what: 'a wire-class prop gives a region a new fingerprint every render',
		// (the regions' fingerprints differ; with them set aside, nothing else may)
		applies: (shown, fresh) => fingerprints(shown) !== fingerprints(fresh),
		forgive: (s) => s.replace(/ data-og-fp="[0-9a-f]+"/g, ' data-og-fp="<fp>"')
	},
	{
		issue: 806,
		what: 'a page brought in by the router lacks its kit-island stamp',
		// (the fresh load has a stamp the tab does not)
		applies: (shown, fresh) => kit_stamps(shown) !== kit_stamps(fresh),
		forgive: (s) => {
			const h = head_blocks(s);
			const blocks = h.blocks.filter((b) => !b[0].includes('name="ogygia-kit-island"'));
			return [...h.before, ...blocks.flat(), ...h.after].join('\n');
		}
	},
	{
		issue: 807,
		what: 'a region of the page left stays after a client navigation',
		// (the tab holds every region the fresh load has, and more; after #804, which sets
		// fingerprints aside, so regions are compared by what they show)
		applies: (shown, fresh) => {
			const [a, b] = [regions(shown), regions(fresh)];
			return a.length > b.length && b.every((r) => a.includes(r));
		},
		forgive: (s, other) => {
			const keep = new Set(regions(other));
			const lines = s.split('\n');
			const out: string[] = [];
			for (let i = 0; i < lines.length; i++) {
				const block = region_at(lines, i);
				if (block === null || keep.has(block.text)) out.push(lines[i]);
				else i = block.end - 1;
			}
			return out.join('\n');
		}
	}
];

/** The `<title>` elements in a normalized DOM's head, each whole. */
function titles(s: string): string[] {
	return head_blocks(s)
		.blocks.filter((b) => b[0] === '    <title>')
		.map((b) => b.join('\n'));
}

/** A normalized DOM's regions (`<ogygia-region>` subtrees), each as its text. */
function regions(s: string): string[] {
	const lines = s.split('\n');
	const found: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const block = region_at(lines, i);
		if (block !== null) found.push(block.text);
	}
	return found;
}

/** The region whose opening line is `lines[at]`, with the line after its subtree; null if none. */
function region_at(lines: string[], at: number): { text: string; end: number } | null {
	const m = /^( *)<ogygia-region\b/.exec(lines[at]);
	if (m === null) return null;
	let end = at + 1;
	while (end < lines.length && /^ */.exec(lines[end])![0].length > m[1].length) end++;
	return { text: lines.slice(at, end).join('\n'), end };
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

/** How long the MPA check looks again for text that moves by itself. */
const LIVE_LOOK_MS = 2_000;

/** The text lines of a normalized DOM that changed between two looks at the same page (none when
 *  its shape changed: then nothing is masked, and the difference stands). */
function live_lines(before: string, after: string): number[] {
	const [a, b] = [before.split('\n'), after.split('\n')];
	if (a.length !== b.length) return [];
	const out: number[] = [];
	for (let i = 0; i < a.length; i++)
		if (a[i] !== b[i] && /^ *"/.test(a[i]) && /^ *"/.test(b[i])) out.push(i);
	return out;
}

/** `s` with its text lines at `lines` replaced by a mark (indent kept). */
function mask(s: string, lines: ReadonlySet<number>): string {
	if (lines.size === 0) return s;
	return s
		.split('\n')
		.map((l, i) => (lines.has(i) && /^ *"/.test(l) ? `${/^ */.exec(l)![0]}"<live>"` : l))
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

/** A normalized DOM's kit-island stamps. */
function kit_stamps(s: string): string {
	return head_blocks(s)
		.blocks.filter((b) => b[0].includes('name="ogygia-kit-island"'))
		.map((b) => b[0].trim())
		.sort()
		.join('\n');
}

/** A normalized DOM's region fingerprints, in order. */
function fingerprints(s: string): string {
	return [...s.matchAll(/ data-og-fp="([0-9a-f]+)"/g)].map((m) => m[1]).join(',');
}

/** The region sheets (`data-ogygia-region-css`) in a normalized DOM's head, each whole. */
function region_sheets(s: string): string[] {
	return head_blocks(s)
		.blocks.filter((b) => b[0].includes('data-ogygia-region-css='))
		.map((b) => b.join('\n'));
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
async function fresh_load(
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
	const fresh = await fresh_load(world, v, url, 'fresh');
	const loaded = view(fresh.tab.page.mainFrame.document as unknown as Document);
	// (a text that changes on its own at rest is time, not state: a ticking clock in an island the
	// navigation kept has run longer than the fresh load's. Each side is looked at once more a
	// moment later, and a text line that moved by itself is masked on both: seed 289)
	await world.loop.run(LIVE_LOOK_MS);
	const live = new Set([
		...live_lines(shown, view(tab.page.mainFrame.document as unknown as Document)),
		...live_lines(loaded, view(fresh.tab.page.mainFrame.document as unknown as Document))
	]);
	let again = mask(loaded, live);
	shown = mask(shown, live);
	const said = [...fresh.tab.errors, ...fresh.tab.console];
	await world.browsers.close(fresh.visitor, fresh.tab);
	if (first_difference(own_state_out(shown), own_state_out(again)) === '') return null;
	// (what the server makes anew each render, a stamp, a counter, a fresh id, differs between two
	// fresh loads as well: it is the render's, not the tab's state. A second fresh load, and what
	// differs between the two is marked on every side: seeds 107, 188, 268, 280, 326, 340, 477)
	const second = await fresh_load(world, v, url, 'fresh-2');
	const render = per_render(
		loaded,
		view(second.tab.page.mainFrame.document as unknown as Document)
	);
	await world.browsers.close(second.visitor, second.tab);
	again = own_state_out(render(again));
	shown = own_state_out(render(shown));
	const diff = first_difference(shown, again);
	if (diff === '') return null;
	// a difference a filed bug explains is that bug, counted apart until its fix lands
	// (in order: each judged on what the ones before it left)
	const known: Array<(typeof KNOWN)[number]> = [];
	let a = shown;
	let b = again;
	for (const k of KNOWN) {
		if (!k.applies(a, b)) continue;
		known.push(k);
		[a, b] = [k.forgive(a, b), k.forgive(b, a)];
	}
	if (known.length > 0 && a === b)
		return {
			oracle: 'known',
			detail: `${url}: ${known.map((k) => `#${k.issue} (${k.what})`).join(', ')}`
		};
	// (what is left once the filed bugs are set aside: the difference to triage)
	const left =
		known.length > 0 ? `with ${known.map((k) => `#${k.issue}`).join(', ')} set aside, ` : '';
	return {
		oracle: 'mpa-equivalence',
		detail: `${url}\n${left}${first_difference(a, b)}${said.length ? ['', 'the fresh load said:', ...said].join('\n') : ''}`
	};
}

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
	// #820: on a page Kit hydrates, Kit's client that never came leaves its islands' wakes waiting
	if (held.every(([id, s]) => id.startsWith('wake#') && s === 'waking') && kit_never_came(tab))
		return {
			oracle: 'known',
			detail: `${detail}: #820 (an island waits for a Kit that never came)`
		};
	return { oracle: 'stuck', detail };
}

/** A page Kit hydrates (its start entry is in the document) whose Kit never published its page. */
function kit_never_came(tab: Tab): boolean {
	const w = tab.page.mainFrame.window as unknown as Record<symbol, unknown> & {
		document: Document;
	};
	const kit = [...w.document.querySelectorAll('script, link')].some((e) =>
		/\/_app\/immutable\/entry\/start\./.test(e.textContent + (e.getAttribute('href') ?? ''))
	);
	return kit && w[Symbol.for('ogygia.kit-page')] == null;
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
export function faulted(world: World, tab: Tab, since?: number): boolean {
	// (the document it shows, and the one it is loading, whose request may be what failed; or,
	// `since` an exchange, any document of the tab: what it said since then may be an earlier one's)
	const next = `${tab.name}#${tab.documents + 1}`;
	const mine = (from: string): boolean =>
		since === undefined ? from === tab.realm || from === next : from.startsWith(`${tab.name}#`);
	return world.network.exchanges
		.slice(since ?? 0)
		.some(
			(e) =>
				mine(e.from) &&
				(e.cut ||
					e.tampered ||
					e.status === 'dropped' ||
					e.status === 'offline' ||
					(typeof e.status === 'number' && e.status >= 500))
		);
}

/** Was the HTML of the document `tab` shows changed or cut on its way? */
export function document_faulted(world: World, tab: Tab): boolean {
	const url = tab.page.mainFrame.url.split('#')[0];
	return world.network.exchanges.some(
		(e) => e.from === tab.realm && e.method === 'GET' && e.url === url && (e.tampered || e.cut)
	);
}

/** What a page may say when the network failed it: ogygia's coded reports, the network's own
 *  failures (a script cut midway fails to parse), Vite's preload helper on a sheet whose
 *  download failed (seeds 65, 425), and Kit's remote functions on an answer they cannot read
 *  ("Invalid query.live response": seed 193, a changed byte in a live query's stream). An uncaught
 *  TypeError is never excused. */
const EXPLAINED =
	/ogygiajs\.dev\/e\/|Unable to preload CSS|Failed to fetch|network error|stream was cut|Failed to perform request|SyntaxError|Invalid or unexpected token|Unexpected token|Status [45]\d\d|offline|connection lost|Invalid [\w.]+ response/;

/** No uncaught error, unhandled rejection or console error in the page (beyond what a network
 *  fault on this document explains, when `world` is given). */
export function page_errors(tab: Tab, world?: World, since?: number): Broken | null {
	// (a fault on the shown document stays its fact: a module whose download was cut fails every
	// later import of it in that document, as the module map keeps the failure)
	const excused = world !== undefined && (faulted(world, tab) || faulted(world, tab, since));
	// (a document whose own HTML was changed or cut on the way is not the page the server sent:
	// what its scripts then do is the network's, a TypeError too. Seed 150: a flipped byte in
	// `type="application/ogygia-page"` hid the page data, and the island read a missing field)
	if (world !== undefined && document_faulted(world, tab)) return null;
	const errors = [...tab.errors, ...tab.console.filter((l) => l.startsWith('error:'))].filter(
		(l) => !(excused && EXPLAINED.test(l))
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

/** What a page says because of a filed bug, as KNOWN is for a DOM difference: a seed that says
 *  only these is counted `known`, not failed. Each entry goes when its fix lands. */
export const KNOWN_SAID: ReadonlyArray<{ issue: number; what: string; said: RegExp }> = [
	{ issue: 817, what: 'a kept island loses its live query', said: /No cached query found/ }
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
	return left.length === 0 ? null : { oracle: 'uncaught', detail: left.join('\n') };
}

/** A shared cache never hands one visitor's personal bytes to another (cdn.ts records each hit
 *  served across cookies; any is a finding until the oracle can compare against the origin). */
export function no_cross_visitor_cache(world: World): Broken | null {
	const crossed = world.cdn.crossed.filter((c) => c.made_for !== '' || c.served_to !== '');
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
 * something after it ends looks like.
 */
export class Leaks {
	readonly #samples = new Map<string, Array<Record<string, number>>>();
	/** Each tab's last sample's key: the same key twice running is one visit. */
	readonly #at = new Map<string, string>();
	/** Notes `tab`'s sample now; what grew, if it has grown visit after visit. */
	check(tab: Tab): Broken | null {
		const url = tab.page.mainFrame.url;
		if (!url.startsWith('http')) return null;
		const key = `${tab.realm} ${url.split('#')[0]}`;
		const list = this.#samples.get(key) ?? [];
		const held = tab.held();
		// (a module preload stays in the head once added, as Vite's own do: one per chunk the app
		// has, so bounded by the app, not by the visits; set aside)
		const preloads = preloads_in_head(tab);
		const now: Record<string, number> = {
			...held,
			head: held.head - preloads,
			elements: held.elements - preloads,
			explained: explained_head(tab)
		};
		// (one sample per visit, its latest: the visit may still have been settling)
		if (this.#at.get(tab.name) === key && list.length > 0) list[list.length - 1] = now;
		else list.push(now);
		this.#at.set(tab.name, key);
		this.#samples.set(key, list);
		if (list.length < LEAK_VISITS) return null;
		const run = list.slice(-LEAK_VISITS);
		// (BOUNDED MEMORY: the head and the element count too; a page visited again is the same page)
		const grew = (field: string, less = 0) =>
			run.every(
				(s, i) =>
					i === 0 || s[field] - less * s.explained > run[i - 1][field] - less * run[i - 1].explained
			);
		let known = false;
		for (const field of ['listeners', 'intervals', 'observers', 'head', 'elements']) {
			if (!grew(field)) continue;
			// (head nodes a filed bug explains are set aside: if then it does not grow, it is known)
			if ((field === 'head' || field === 'elements') && !grew(field, 1)) {
				known = true;
				continue;
			}
			return {
				oracle: 'leak',
				detail: `${url}: ${field} grew visit after visit in one document: ${run.map((s) => s[field]).join(' → ')}${field === 'intervals' ? `\nrunning: ${tab.platform?.pending().join(', ')}` : ''}`
			};
		}
		return known
			? {
					oracle: 'known',
					detail: `${url}: #799 (a left page's region sheet kept), #821 (a second runtime script after a navigation to another depth)`
				}
			: null;
	}
}

/** The module preloads in a tab's head. */
function preloads_in_head(tab: Tab): number {
	const head = (tab.page.mainFrame.document as unknown as Document).head;
	return head ? head.querySelectorAll('link[rel="modulepreload"]').length : 0;
}

/**
 * Head nodes a filed bug explains: runtime scripts past the first (#821) and region sheets (#799
 * keeps a left page's for a navigation; until it is fixed a sheet's coming and going is set aside).
 */
function explained_head(tab: Tab): number {
	const head = (tab.page.mainFrame.document as unknown as Document).head;
	if (!head) return 0;
	const runtime = head.querySelectorAll('script[data-ogygia-runtime]').length;
	const sheets = head.querySelectorAll('[data-ogygia-region-css]').length;
	return Math.max(0, runtime - 1) + sheets;
}
