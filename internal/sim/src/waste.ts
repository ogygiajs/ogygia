/**
 * NO WASTE: a page does its work once. At rest, for a document the network left alone (no fault, no
 * deploy's skew, no press of the visitor's: a press may ask again on purpose):
 *
 * - no answer asked for twice: the same request (method, path and query, less a hole's expiry and
 *   signature) answered 200 twice in one document, but a content-hashed file (a browser's module
 *   map and cache keep it; the simulator has neither, so it may fetch one again), an image (the
 *   document's image cache keeps it: a router swap that brings it back loads none) and a page (a
 *   navigation back asks again by design), and a remote query counted per router visit (a back is
 *   a new visit: a held region mounts and asks again, as its page is asked again); a hole's answer,
 *   by its own GET or a router batch's part, counts when asked again within the 60 s the frame
 *   store keeps a left page's answers (later, it was let go by design);
 * - no POST the app refused (4xx): a batch to a path that answers none (#987);
 * - nothing alive after its owner: an observer still observing once every element it watches has
 *   left the document (`tab.orphans()`; test/orphans.node.test.ts), and no woken island still
 *   watched for where it is ({@link watched_awake});
 * - nothing sent twice in the document: one stylesheet linked twice, one `<style>` text twice, one
 *   island's props (`data-ogygia-props`) or a page seed twice, one module preloaded twice;
 * - nothing said: a console warning in such a document is something ogygia (or the app) found wrong.
 *
 * Long tasks and layout shift need a layout engine and real time: the real-browser tier measures
 * them (`@ogygia/tooling/e2e/sim-replay.ts`).
 */
import type { Tab } from './browser.ts';
import { known_said, type Broken } from './oracles.ts';
import { answer_key, is_page_path, type World } from './world.ts';

/** An image's path: the document's image cache keeps one it loaded. */
const IMAGE = /\.(?:png|jpe?g|gif|webp|avif|svg|ico)$/i;

/** The requests a document had answered twice, by key (see the top). `swaps`: when the router
 *  swapped the document's page (`og:before-swap`, virtual ms): a remote query (`/_app/remote/`) is
 *  counted per visit, since a visit's regions mount and ask anew, a back's too, as a page is asked
 *  again (gen 187, seed 187004). */
export function asked_twice(
	world: World,
	realm: string,
	swaps: readonly number[] = [],
	until = Infinity,
	/** Filled with the hole answers asked again only by a router visit's batch (#1020). */
	known?: string[]
): string[] {
	const count = new Map<string, number>();
	/** Each hole answer's asks (virtual ms), its own GETs' and the batches' that named it. */
	const holes = new Map<string, number[]>();
	/** The asks a router visit's batch made (sent as the router swapped the page in). */
	const nav = new Set<string>();
	// (the router sends a visit's batch once it has the next page and before it swaps it in: a wait for
	// the page's sheets comes between, so a batch from the visit's page fetch to its swap is the visit's)
	const fetched = world.network.exchanges
		.filter((e) => e.from === realm && e.method === 'GET' && e.status === 200)
		.filter((e) => is_page_path(decodeURIComponent(new URL(e.url).pathname)))
		.map((e) => e.at);
	const visits = (t: number): boolean => {
		const next = swaps.find((s) => s >= t);
		if (next === undefined) return false;
		const since = Math.max(...swaps.filter((s) => s < t));
		return next === t || fetched.some((f) => f > since && f <= t);
	};
	/** A hole answer whose last ask the page gave up on (stalled, cut, lost, changed), by key: when it
	 *  was asked, and whether a router visit's batch asked it. The next ask of it is its recovery,
	 *  the same ask (test/waste.test.ts). */
	const given_up = new Map<string, { at: number; nav: boolean }>();
	/** An ask of hole answer `k` at `at` (a recovery takes the given-up ask's place). */
	const ask = (k: string, at: number, by_visit: boolean): void => {
		const was = given_up.get(k);
		given_up.delete(k);
		const t = was?.at ?? at;
		holes.set(k, [...(holes.get(k) ?? []), t]);
		if (was?.nav ?? by_visit) nav.add(`${k} ${t}`);
	};
	for (const [i, e] of world.network.exchanges.entries()) {
		if (i >= until) break;
		if (e.from !== realm || e.status !== 200) continue;
		// (a stalled answer the page may have given up on: asking again is its recovery)
		if (e.cut || e.lost === true || e.tampered || e.duplicated || e.stalled === true) {
			if (e.duplicated) continue;
			const keys =
				e.method === 'POST'
					? (e.holes ?? [])
					: new URL(e.url).pathname === '/__ogygia__'
						? [answer_key(new URL(e.url))]
						: [];
			const by_visit = e.method === 'POST' && visits(e.at);
			for (const k of keys) if (!given_up.has(k)) given_up.set(k, { at: e.at, nav: by_visit });
			continue;
		}
		if (e.method === 'POST') {
			const by_visit = visits(e.at);
			for (const k of e.holes ?? []) ask(k, e.at, by_visit);
			continue;
		}
		if (e.method !== 'GET') continue;
		const url = new URL(e.url);
		const path = decodeURIComponent(url.pathname);
		if (path.startsWith('/_app/immutable/') || is_page_path(path) || IMAGE.test(path)) continue;
		if (path === '/__ogygia__') {
			ask(answer_key(url), e.at, false);
			continue;
		}
		const visit = path.startsWith('/_app/remote/') ? swaps.filter((t) => t <= e.at).length : 0;
		const key = `${visit} ${answer_key(url)}`;
		count.set(key, (count.get(key) ?? 0) + 1);
	}
	// a hole answer asked again within its linger after the one before: the store still held it (an
	// ask later than that may be a page left longer and come back to, its answer let go by design)
	for (const [k, asks] of holes) {
		const soon = asks.filter((t, i) => i > 0 && t - asks[i - 1] <= LINGER_MS);
		// (a router visit's batch asks every `load` hole of its page, held or not: #1020)
		const again = known ? soon.filter((t) => !nav.has(`${k} ${t}`)).length : soon.length;
		if (again > 0) count.set(`0 ${k}`, again + 1);
		else if (soon.length > 0) known?.push(k);
	}
	return [...count]
		.filter(([, n]) => n > 1)
		.map(([k, n]) => `${k.slice(k.indexOf(' ') + 1)} ×${n}`);
}

/**
 * Asked twice, in EVERY document of the run (`swaps`: each one's router swaps, by realm), each up
 * to what first disturbed it: a press or a deploy (`disturbed`: the exchange count when it came), or
 * a fault on one of its exchanges (a retry asks again by design). A document a deploy skewed, or
 * one buggify lost an answer of, is set aside whole. Judged only at the end of a run, a document
 * was nearly always set aside by then, and a re-ask the frame store should have saved went unseen.
 */
export function asked_twice_each(
	world: World,
	swaps: ReadonlyMap<string, readonly number[]>,
	disturbed: ReadonlyMap<string, number>
): Broken | null {
	const found: string[] = [];
	const known = new Set<string>();
	const exchanges = world.network.exchanges;
	for (const [realm, s] of swaps) {
		if (world.skewed_for(realm) || world.fired_in.has(realm)) continue;
		const fault = exchanges.findIndex(
			(e) =>
				(e.from === realm || e.for === realm) &&
				(e.cut ||
					e.tampered ||
					e.redirected ||
					e.lost === true ||
					e.status === 'dropped' ||
					e.status === 'offline' ||
					(typeof e.status === 'number' && e.status >= 500))
		);
		const until = Math.min(disturbed.get(realm) ?? Infinity, fault === -1 ? Infinity : fault);
		const nav: string[] = [];
		for (const k of asked_twice(world, realm, s, until, nav))
			found.push(`${realm}: asked twice: ${k}`);
		if (nav.length > 0) known.add(realm);
	}
	if (found.length > 0) return { oracle: 'waste', detail: found.join('\n') };
	return known.size === 0
		? null
		: {
				oracle: 'known',
				detail: `${[...known].join(', ')}: #1020 (a router return asks again for hole answers the frame store holds)`
			};
}

/** How long core's frame store keeps a left page's hole answer for a quick return (its
 *  `EVICT_TTL`, runtime/frame-store.ts). */
const LINGER_MS = 60_000;

/** The POSTs of a document the app refused (4xx): a batch or a call a correct page never sends. A
 *  refused GET is left out (a hole's expired capability renews with one, as designed). */
export function refused(world: World, realm: string): string[] {
	const out = new Set<string>();
	for (const e of world.network.exchanges) {
		if (e.from !== realm || e.method !== 'POST' || typeof e.status !== 'number') continue;
		if (e.status < 400 || e.status >= 500 || e.cut || e.tampered) continue;
		out.add(`POST ${decodeURIComponent(new URL(e.url).pathname)} ${e.status}`);
	}
	return [...out];
}

/** What one document holds twice: a stylesheet, a style text, an island's props, a page seed, a
 *  module preload. */
export function held_twice(doc: Document): string[] {
	/** `keys` held twice, each within its own `scope` (default: the document). */
	const twice = (what: string, keys: Array<string | null>, scope?: number[]): string[] => {
		const seen = new Set<string>();
		const out = new Set<string>();
		for (const [i, k] of keys.entries()) {
			if (k === null || k === '') continue;
			const at = `${scope?.[i] ?? 0} ${k}`;
			if (seen.has(at)) out.add(`${what} ${k.length > 80 ? `${k.slice(0, 80)}…` : k}`);
			seen.add(at);
		}
		return [...out];
	};
	const all = (s: string) => [...doc.querySelectorAll(s)];
	// (an island's props are its answer's: a region fetched apart carries its own, so one island in
	// two answers holds them twice by design; gen 173, seed 17. Twice in one answer is waste)
	const answers = new Map<Element | null, number>();
	const answer_of = (e: Element): number => {
		const a = e.closest('ogygia-region[endpoint]');
		if (!answers.has(a)) answers.set(a, answers.size);
		return answers.get(a)!;
	};
	return [
		...twice(
			'stylesheet',
			all('link[rel="stylesheet"]').map((l) => (l as HTMLLinkElement).href)
		),
		...twice(
			'style',
			all('style').map((s) => s.textContent)
		),
		...twice(
			'props',
			all('script[data-ogygia-props]').map(
				(s) => `${s.getAttribute('data-ogygia-props')}:${s.textContent}`
			),
			all('script[data-ogygia-props]').map(answer_of)
		),
		...twice(
			'page seed',
			all('script[type="application/ogygia-page"]').map((s) => s.textContent)
		),
		...twice(
			'module preload',
			all('link[rel="modulepreload"]').map((l) => (l as HTMLLinkElement).href)
		)
	];
}

/** Waste a filed bug explains, by what is held twice (as KNOWN is for an MPA difference). Each entry
 *  goes when its fix lands. */
const KNOWN_WASTE: ReadonlyArray<{
	issue: number;
	what: string;
	is: (held: string, doc: Document) => boolean;
}> = [
	{
		issue: 1255,
		what: "the viewport tracker's swap observer keeps observing a region it let go",
		is: (held) => held === 'MutationObserver watching <ogygia-region>'
	}
];

/** What is held twice, less what a filed bug explains (and which bugs did). */
export function known_waste(doc: Document, held: string[]): { left: string[]; known: number[] } {
	const known = new Set<number>();
	const left = held.filter((h) => {
		const k = KNOWN_WASTE.find((x) => x.is(h, doc));
		if (k) known.add(k.issue);
		return k === undefined;
	});
	return { left, known: [...known] };
}

/** The warnings the document itself said. */
export function warned(tab: Tab): string[] {
	return tab.console.filter(
		(l) => l.startsWith('warn:') && (tab.said_by.get(l) ?? tab.realm) === tab.realm
	);
}

/**
 * The woken islands an IntersectionObserver still watches at rest: nothing asks where one is once it
 * woke (its `visible` wake fired once, the scheduler's viewport snapshot stops at its turn, a load's
 * class at its end), so a watch kept is a watch nobody stopped, held until the island leaves. A
 * mutant that dropped the snapshot's stop survived every other oracle (schedule.ts `drain`). Each
 * as its open tag, less its props.
 */
export function watched_awake(tab: Tab): string[] {
	return tab
		.observed('IntersectionObserver')
		.filter(
			(t) =>
				t.isConnected &&
				t.localName === 'ogygia-region' &&
				t.hasAttribute('entry') &&
				!t.hasAttribute('render') &&
				t.hasAttribute('data-hydrated')
		)
		.map(
			(t) => `<ogygia-region entry="${t.getAttribute('entry')}" wake="${t.getAttribute('wake')}">`
		)
		.sort();
}

/** NO WASTE, for one tab's document at rest (the caller sets aside the documents the top names). */
export function waste(world: World, tab: Tab): Broken | null {
	const doc = tab.page.mainFrame.document as unknown as Document;
	if (!tab.page.mainFrame.url.startsWith('http')) return null;
	const held = known_waste(doc, held_twice(doc));
	const asked = known_waste(doc, refused(world, tab.realm));
	const orphans = known_waste(doc, tab.orphans());
	const said = known_said(warned(tab));
	const found = [
		...asked.left.map((k) => `refused: ${k}`),
		...held.left.map((k) => `held twice: ${k}`),
		...orphans.left.map((o) => `alive after its owner: ${o}`),
		...watched_awake(tab).map((r) => `watched after its wake: ${r}`),
		...said.left.map((l) => `said: ${l.split('\n')[0].slice(0, 200)}`)
	];
	if (found.length > 0)
		return { oracle: 'waste', detail: `${tab.page.mainFrame.url}: ${found.join('\n')}` };
	const known = [
		...new Set(
			[...held.known, ...asked.known, ...orphans.known].map((i) =>
				KNOWN_WASTE.find((k) => k.issue === i)!
			)
		),
		...said.known
	];
	return known.length === 0
		? null
		: {
				oracle: 'known',
				detail: `${tab.page.mainFrame.url}: ${known.map((k) => `#${k.issue} (${k.what})`).join(', ')}`
			};
}
