import { decode_island_graph, decode_island_locations } from '../island-graph.ts';
import { OGYGIA_GRAPH, OGYGIA_GRAPH_PRELOAD } from '../wire-markup.ts';
import { note_entry_location } from './entry-locations.ts';
import { code_url } from './code-origins.ts';
import { cache } from '@ogygia/machine';
import { runtime_session } from './session.ts';

const GRAPH_SELECTOR = `script[${OGYGIA_GRAPH}]`;
const MODULEPRELOAD_SELECTOR = 'link[rel="modulepreload"]';

const graph = cache<string, string[]>({ name: 'island graph', max: 5000 });
let read_scripts = new WeakSet<Element>();

type Priority = 'high' | 'auto' | 'low';
const RANK: Readonly<Record<Priority, number>> = { high: 0, auto: 1, low: 2 };

function priority_of(link: HTMLLinkElement): Priority {
	const p = link.getAttribute('fetchpriority');
	return p === 'high' || p === 'low' ? p : 'auto';
}

function absolute(href: string, base: string): string | null {
	try {
		return new URL(href, base).href;
		// oxlint-disable-next-line ogygia/no-silent-failures -- not a URL: no preload for it
	} catch {
		return null;
	}
}

/** Merge one graph script's text; hrefs resolve against `base` (the document the text came from).
 *  Its locations (`s`) go to the runtime's one identity → location map. */
export function register_island_graph(text: string, base: string = location.href): void {
	for (const [entry, src] of decode_island_locations(text)) note_entry_location(entry, src, base);
	for (const [entry, hrefs] of decode_island_graph(text)) {
		const key = absolute(entry, base);
		if (!key || graph.has(key)) continue;
		const list: string[] = [];
		for (const href of hrefs) {
			const url = absolute(href, base);
			if (url) list.push(url);
		}
		graph.set(key, list);
	}
}

function read_document_graphs(): boolean {
	let read = false;
	for (const s of document.querySelectorAll(GRAPH_SELECTOR)) {
		if (read_scripts.has(s)) continue;
		read_scripts.add(s);
		register_island_graph(s.textContent ?? '');
		read = true;
	}
	return read;
}

function linked_now(): Map<string, HTMLLinkElement | null> {
	const linked = new Map<string, HTMLLinkElement | null>();
	for (const l of document.querySelectorAll<HTMLLinkElement>(MODULEPRELOAD_SELECTOR)) {
		const url = absolute(l.getAttribute('href') ?? '', location.href);
		if (url && !linked.get(url)) linked.set(url, l.hasAttribute(OGYGIA_GRAPH_PRELOAD) ? l : null);
	}
	return linked;
}

/**
 * Start fetching every chunk `entry`'s code needs: one modulepreload link per chunk not linked yet.
 * Call it in the same task as the entry's `import()`. An entry the page has no graph for (dev, an
 * island inside a fetched hole answer) preloads nothing — its `import()` still finds its chunks.
 *
 * A chunk already linked is the load this one joins (the island's `import()` reuses its fetch): one
 * we linked at a lower priority (a speculative warm) is raised to this one's, never lowered
 * (priority inheritance, #437). The browser applies it to a fetch it has not sent yet.
 */
export function preload_island_graph(
	entry: string,
	base: string = location.href,
	priority: Priority = 'auto'
): void {
	if (typeof document === 'undefined') return;
	const key = absolute(entry, base);
	if (!key) return;
	let hrefs = graph.get(key);
	if (hrefs === undefined && read_document_graphs()) hrefs = graph.get(key);
	if (!hrefs || hrefs.length === 0) return;
	const seen = linked_now();
	for (const href of hrefs) {
		if (code_url(href) === null) continue;
		const ours = seen.get(href);
		if (ours !== undefined) {
			if (ours && RANK[priority] < RANK[priority_of(ours)])
				ours.setAttribute('fetchpriority', priority);
			continue;
		}
		const link = document.createElement('link');
		link.rel = 'modulepreload';
		if (priority !== 'auto') link.setAttribute('fetchpriority', priority);
		link.href = href;
		link.setAttribute(OGYGIA_GRAPH_PRELOAD, '');
		seen.set(href, link);
		runtime_session.claim_page_head(link);
		document.head.appendChild(link);
	}
}

/** Test seam: forget every graph read (what is linked is the document's). */
export function reset_island_graph(): void {
	graph.clear();
	read_scripts = new WeakSet();
}
