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
		out.push(`${'  '.repeat(depth)}<${tag}${attrs ? ' ' + attrs : ''}>`);
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
		// (the tab holds a region sheet the fresh load does not)
		applies: (shown, fresh) => {
			const there = new Set(region_sheets(fresh));
			return region_sheets(shown).some((s) => !there.has(s));
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
	const shown = view(tab.page.mainFrame.document as unknown as Document);
	const fresh_visitor = world.visitor(`${v.name}-fresh`);
	const jar = (b: Visitor) =>
		(
			b.browser.defaultContext as unknown as {
				cookieContainer: {
					getCookies(u: URL | null, http: boolean): unknown[];
					addCookies(c: unknown[]): void;
				};
			}
		).cookieContainer;
	jar(fresh_visitor).addCookies(jar(v).getCookies(null, true));
	const fresh = world.tab(fresh_visitor);
	// (the reference is a load the network does not fail: a fault there is no finding about the tab)
	world.network.calm(fresh.name);
	const path = new URL(url);
	await world.go(fresh, 'goto', path.pathname + path.search + path.hash);
	const again = view(fresh.page.mainFrame.document as unknown as Document);
	const said = [...fresh.errors, ...fresh.console];
	await world.browsers.close(fresh_visitor, fresh);
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
	return {
		oracle: 'mpa-equivalence',
		detail: `${url}\n${diff}${said.length ? `\nthe fresh load said:\n${said.join('\n')}` : ''}`
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

/** What a page may say when the network failed it: ogygia's coded reports and the network's own
 *  failures (a script cut midway fails to parse). An uncaught TypeError is never excused. */
const EXPLAINED =
	/ogygiajs\.dev\/e\/|Failed to fetch|network error|stream was cut|Failed to perform request|SyntaxError|Invalid or unexpected token|Unexpected token|Status [45]\d\d|offline|connection lost/;

/** No uncaught error, unhandled rejection or console error in the page (beyond what a network
 *  fault on this document explains, when `world` is given). */
export function page_errors(tab: Tab, world?: World, since?: number): Broken | null {
	// (a fault on the shown document stays its fact: a module whose download was cut fails every
	// later import of it in that document, as the module map keeps the failure)
	const excused = world !== undefined && (faulted(world, tab) || faulted(world, tab, since));
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
		const now: Record<string, number> = { ...tab.held() };
		// (one sample per visit, its latest: the visit may still have been settling)
		if (this.#at.get(tab.name) === key && list.length > 0) list[list.length - 1] = now;
		else list.push(now);
		this.#at.set(tab.name, key);
		this.#samples.set(key, list);
		if (list.length < LEAK_VISITS) return null;
		const run = list.slice(-LEAK_VISITS);
		// (BOUNDED MEMORY: the head and the element count too; a page visited again is the same page)
		for (const field of ['listeners', 'intervals', 'observers', 'head', 'elements']) {
			if (run.every((s, i) => i === 0 || s[field] > run[i - 1][field]))
				return {
					oracle: 'leak',
					detail: `${url}: ${field} grew visit after visit in one document: ${run.map((s) => s[field]).join(' → ')}${field === 'intervals' ? `\nrunning: ${tab.platform?.pending().join(', ')}` : ''}`
				};
		}
		return null;
	}
}
