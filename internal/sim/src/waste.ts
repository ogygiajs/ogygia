/**
 * NO WASTE: a page does its work once. At rest, for a document the network left alone (no fault, no
 * deploy's skew, no press of the visitor's: a press may ask again on purpose):
 *
 * - no answer asked for twice: the same request (method, path and query, less a hole's expiry and
 *   signature) answered 200 twice in one document, but a content-hashed file (a browser's module
 *   map and cache keep it; the simulator has neither, so it may fetch one again) and a page (a
 *   navigation back asks again by design), and a remote query counted per router visit (a back is
 *   a new visit: a held region mounts and asks again, as its page is asked again);
 * - no POST the app refused (4xx): a batch to a path that answers none (#987);
 * - nothing alive after its owner: an observer still observing once every element it watches has
 *   left the document (`tab.orphans()`; test/orphans.node.test.ts);
 * - nothing sent twice in the document: one stylesheet linked twice, one `<style>` text twice, one
 *   island's props (`data-ogygia-props`) or a page seed twice, one module preloaded twice;
 * - nothing said: a console warning in such a document is something ogygia (or the app) found wrong.
 *
 * Long tasks and layout shift need a layout engine and real time: the real-browser tier measures
 * them (`@ogygia/tooling/e2e/sim-replay.ts`).
 */
import type { Tab } from './browser.ts';
import type { Broken } from './oracles.ts';
import { answer_key, is_page_path, type World } from './world.ts';

/** The requests a document had answered twice, by key (see the top). `swaps`: when the router
 *  swapped the document's page (`og:before-swap`, virtual ms): a remote query (`/_app/remote/`) is
 *  counted per visit, since a visit's regions mount and ask anew, a back's too, as a page is asked
 *  again (gen 187, seed 187004). */
export function asked_twice(world: World, realm: string, swaps: readonly number[] = []): string[] {
	const count = new Map<string, number>();
	for (const e of world.network.exchanges) {
		if (e.from !== realm || e.method !== 'GET' || e.status !== 200) continue;
		if (e.cut || e.lost === true || e.tampered || e.duplicated) continue;
		const url = new URL(e.url);
		const path = decodeURIComponent(url.pathname);
		if (path.startsWith('/_app/immutable/') || is_page_path(path)) continue;
		const visit = path.startsWith('/_app/remote/') ? swaps.filter((t) => t <= e.at).length : 0;
		const key = `${visit} ${answer_key(url)}`;
		count.set(key, (count.get(key) ?? 0) + 1);
	}
	return [...count]
		.filter(([, n]) => n > 1)
		.map(([k, n]) => `${k.slice(k.indexOf(' ') + 1)} ×${n}`);
}

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
			if (seen.has(at)) out.add(`${what} ${k.length > 80 ? k.slice(0, 80) + '…' : k}`);
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
		issue: 984,
		what: 'the island graph preload links a chunk another loader linked after its first read',
		// (the second link to the chunk is the graph preload's own: gen 180, seed 3)
		is: (held, doc) => {
			const m = /^module preload (.+)$/.exec(held);
			if (m === null) return false;
			const links = [...doc.querySelectorAll('link[rel="modulepreload"]')].filter(
				(l) => (l as HTMLLinkElement).href === m[1]
			);
			return links.slice(1).every((l) => l.hasAttribute('data-ogygia-graph-preload'));
		}
	},
	{
		issue: 987,
		what: "a router navigation posts its deferred holes as one batch to the first hole's path",
		// (a peer widget's first: `POST /og/frag`, refused; gen 157, seed 3)
		is: (line) => line === 'POST /og/frag 403'
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

/** NO WASTE, for one tab's document at rest (the caller sets aside the documents the top names). */
export function waste(world: World, tab: Tab): Broken | null {
	const doc = tab.page.mainFrame.document as unknown as Document;
	if (!tab.page.mainFrame.url.startsWith('http')) return null;
	const held = known_waste(doc, held_twice(doc));
	const asked = known_waste(doc, refused(world, tab.realm));
	const found = [
		...asked_twice(world, tab.realm, tab.swaps).map((k) => `asked twice: ${k}`),
		...asked.left.map((k) => `refused: ${k}`),
		...held.left.map((k) => `held twice: ${k}`),
		...tab.orphans().map((o) => `alive after its owner: ${o}`),
		...warned(tab).map((l) => `said: ${l.split('\n')[0].slice(0, 200)}`)
	];
	if (found.length > 0)
		return { oracle: 'waste', detail: `${tab.page.mainFrame.url}: ${found.join('\n')}` };
	const known = [...new Set([...held.known, ...asked.known])];
	return known.length === 0
		? null
		: {
				oracle: 'known',
				detail: `${tab.page.mainFrame.url}: ${known.map((i) => `#${i} (${KNOWN_WASTE.find((k) => k.issue === i)!.what})`).join(', ')}`
			};
}
