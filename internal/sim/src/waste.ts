/**
 * NO WASTE: a page does its work once. At rest, for a document the network left alone (no fault, no
 * deploy's skew, no press of the visitor's: a press may ask again on purpose):
 *
 * - no answer asked for twice: the same request (method, path and query, less a hole's expiry and
 *   signature) answered 200 twice in one document, but a content-hashed file (a browser's module
 *   map and cache keep it; the simulator has neither, so it may fetch one again) and a page (a
 *   navigation back asks again by design);
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

/** The requests a document had answered twice, by key (see the top). */
export function asked_twice(world: World, realm: string): string[] {
	const count = new Map<string, number>();
	for (const e of world.network.exchanges) {
		if (e.from !== realm || e.method !== 'GET' || e.status !== 200) continue;
		if (e.cut || e.lost === true || e.tampered || e.duplicated) continue;
		const url = new URL(e.url);
		const path = decodeURIComponent(url.pathname);
		if (path.startsWith('/_app/immutable/') || is_page_path(path)) continue;
		const key = answer_key(url);
		count.set(key, (count.get(key) ?? 0) + 1);
	}
	return [...count].filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`);
}

/** What one document holds twice: a stylesheet, a style text, an island's props, a page seed, a
 *  module preload. */
export function held_twice(doc: Document): string[] {
	const twice = (what: string, keys: Array<string | null>): string[] => {
		const seen = new Set<string>();
		const out = new Set<string>();
		for (const k of keys) {
			if (k === null || k === '') continue;
			if (seen.has(k)) out.add(`${what} ${k.length > 80 ? k.slice(0, 80) + '…' : k}`);
			seen.add(k);
		}
		return [...out];
	};
	const all = (s: string) => [...doc.querySelectorAll(s)];
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
			)
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
	const found = [
		...asked_twice(world, tab.realm).map((k) => `asked twice: ${k}`),
		...held_twice(doc).map((k) => `held twice: ${k}`),
		...warned(tab).map((l) => `said: ${l.split('\n')[0].slice(0, 200)}`)
	];
	return found.length === 0
		? null
		: { oracle: 'waste', detail: `${tab.page.mainFrame.url}: ${found.join('\n')}` };
}
