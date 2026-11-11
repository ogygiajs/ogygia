/**
 * PRELOAD AN ISLAND'S GRAPH AT WAKE — the runtime half of the island graph (../island-graph.ts).
 *
 * The page carries, as data, the chunks each island entry needs. When an island starts to load (its
 * wake, after the wake gate; a hover or router warm), `preload_island_graph(entry)` inserts one
 * `<link rel="modulepreload">` per chunk not yet linked, in the same task as the entry's `import()`.
 * The browser then fetches the entry and its whole graph at once — no waterfall of discovering each
 * import after the last one parsed — and only for islands that actually start.
 *
 * The graph is read lazily from every `script[data-ogygia-graph]` in the document (the document
 * tail, a head copy a self-contained render emitted, the body a router swap brought in), each script
 * once. Chunks are content-hashed URLs and entries are identities (their files, content-hashed too,
 * resolve through runtime/entry-locations.ts), so a list read on one page is never wrong on the
 * next: nothing to invalidate. A router warm reads the NEXT page's graph out of its fetched HTML
 * (`register_island_graph`) before that page is in the DOM.
 */
import {
	ISLAND_GRAPH_ATTR,
	decode_island_graph,
	decode_island_locations
} from '../island-graph.ts';
import { note_entry_location } from './entry-locations.ts';
import { code_url } from './code-origins.ts';
import { runtime_session } from './session.ts';

const GRAPH_SELECTOR = `script[${ISLAND_GRAPH_ATTR}]`;
const MODULEPRELOAD_SELECTOR = 'link[rel="modulepreload"]';
/** Marks a link this module inserted (tests and devtools tell them from the HTML's own). */
export const GRAPH_PRELOAD_ATTR = 'data-ogygia-graph-preload';

/** entry URL (absolute) → its chunk URLs (absolute). */
const graph = new Map<string, string[]>();
let read_scripts = new WeakSet<Element>();
/** Chunk URLs (absolute) already linked: ours with the link we put in, or a modulepreload the HTML
 *  carried (`null`: the page's own, left as it wrote it). */
let linked: Map<string, HTMLLinkElement | null> | null = null;

type Priority = 'high' | 'auto' | 'low';
const RANK: Readonly<Record<Priority, number>> = { high: 0, auto: 1, low: 2 };

/** A link's priority as it stands (none written: `auto`). */
function priority_of(link: HTMLLinkElement): Priority {
	const p = link.getAttribute('fetchpriority');
	return p === 'high' || p === 'low' ? p : 'auto';
}

function absolute(href: string, base: string): string | null {
	try {
		return new URL(href, base).href;
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

function read_document_graphs(): void {
	for (const s of document.querySelectorAll(GRAPH_SELECTOR)) {
		if (read_scripts.has(s)) continue;
		read_scripts.add(s);
		register_island_graph(s.textContent ?? '');
	}
}

function linked_map(): Map<string, HTMLLinkElement | null> {
	if (linked) return linked;
	linked = new Map();
	for (const l of document.querySelectorAll(MODULEPRELOAD_SELECTOR)) {
		const url = absolute(l.getAttribute('href') ?? '', location.href);
		if (url) linked.set(url, null);
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
	if (!graph.has(key)) read_document_graphs();
	const hrefs = graph.get(key);
	if (!hrefs || hrefs.length === 0) return;
	const seen = linked_map();
	for (const href of hrefs) {
		// (a chunk on an origin the page loads no code from is never asked for: ./code-origins.ts)
		if (code_url(href) === null) continue;
		if (seen.has(href)) {
			const ours = seen.get(href);
			if (ours && RANK[priority] < RANK[priority_of(ours)])
				ours.setAttribute('fetchpriority', priority);
			continue;
		}
		const link = document.createElement('link');
		link.rel = 'modulepreload';
		// the load class's priority (load-scheduler.ts); the island's `import()` reuses this in-flight fetch
		if (priority !== 'auto') link.setAttribute('fetchpriority', priority);
		link.href = href;
		link.setAttribute(GRAPH_PRELOAD_ATTR, '');
		seen.set(href, link);
		runtime_session.claim_page_head(link); // the page's (session.ts); a navigation may drop it
		document.head.appendChild(link);
	}
}

/** Test seam: forget every graph read and every chunk linked. */
export function reset_island_graph(): void {
	graph.clear();
	read_scripts = new WeakSet();
	linked = null;
}
