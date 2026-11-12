/**
 * WHAT A HOLE'S HEAD CARRIES INTO ITS ANSWER. A hole renders on its own, and the endpoint ships only
 * the body — but the islands inside it write into the render's head what the page needs of them:
 *
 * - their GRAPH (the chunks their code needs — island-graph.ts). Without it the islands a hole brings
 *   loaded in a waterfall: each chunk discovered only after the last one parsed (+1.1 s at a 150 ms
 *   round trip, measured). Carried as one script; the runtime reads any graph script in the document
 *   (runtime/island-graph-preload.ts), so a nested island's wake preloads its whole graph at once.
 * - their CSS (the `data-ogygia-region-css` tags Region.svelte writes for each island it renders: the
 *   island's own chunk CSS, exact — the bundler's, over what the island really imports). Without it
 *   an island in a hole had only the hole's own sheet, and whatever it rendered after the server
 *   render (a dropdown's contents, a branch behind a click) arrived unstyled. Carried as written; the
 *   runtime hoists these tags from an answer into `<head>` before the swap, deduped by href.
 *
 * URLs are made root-absolute (the graph here, the CSS tags by the answer's own absolutizing pass):
 * the answer lands in a page at any depth, and a `./_app/…` resolved there would 404. Tags are read the way a browser reads them (wire-markup.ts).
 */
import { decode_island_graph, decode_island_locations } from '../island-graph.ts';
import { Needle, next_tag, OGYGIA_GRAPH, text_of } from '../wire-markup.ts';
import { island_graph_script } from './document-tail.ts';
import { region_css_tags } from './html-scan.ts';

function root_absolute(value: string, base: URL): string {
	if (!value.startsWith('./') && !value.startsWith('../')) return value;
	try {
		const u = new URL(value, base);
		return u.origin === base.origin ? u.pathname + u.search + u.hash : value;
	} catch {
		return value;
	}
}

/** What the answer carries of the render's head: its islands' graph and their CSS (html-scan.ts
 *  `region_css_tags`, the scan a held region carries its sheets forward by), '' for none. */
export function hole_head(head: string, base: URL | undefined): string {
	return (base ? hole_graph_script(head, base) : '') + region_css_tags(head);
}

// (the attribute's name in any case: where a graph script can be; a script without it is not read)
const GRAPH_ANY_CASE = new RegExp(OGYGIA_GRAPH, 'gi');

/** One graph script for the answer (or '' when the render's head carries none): every
 *  `script[data-ogygia-graph]`, as the runtime selects them. */
export function hole_graph_script(head: string, base: URL): string {
	const mark = new Needle(head, GRAPH_ANY_CASE);
	if (mark.gone) return '';
	const graph = new Map<string, string[]>();
	const locations = new Map<string, string>();
	for (let t = next_tag(head, 'script', 0); t !== null; t = next_tag(head, 'script', t.next)) {
		const held = mark.holds(t);
		if (mark.gone) break;
		if (!held || t.attr(OGYGIA_GRAPH) === undefined) continue;
		const text = text_of(head, t, 'script');
		if (text === null) break;
		for (const [entry, hrefs] of decode_island_graph(text)) {
			const key = root_absolute(entry, base);
			if (!graph.has(key))
				graph.set(
					key,
					hrefs.map((h) => root_absolute(h, base))
				);
		}
		for (const [entry, src] of decode_island_locations(text))
			locations.set(root_absolute(entry, base), root_absolute(src, base));
	}
	return island_graph_script(graph, locations);
}
