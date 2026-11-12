/**
 * The browser a hydration bench runs in, in Node: the unit tests' DOM shim
 * (test/_stubs/dom.ts) for the document, and stand-ins for the few window APIs the hydration path
 * reads. Import it FIRST in a bench file: the runtime reads some of them as its modules load.
 *
 * - `scheduler.yield` / `scheduler.postTask`: Chromium's, as a task on the timer loop (Heisenbench
 *   runs timers on a fake loop, so every hop is a counted, ordered task).
 * - `IntersectionObserver`: reports every observed element once, in one callback a task after it
 *   was observed (a browser reports after layout); an element is in view when the page put it in
 *   `in_view`.
 * - `addEventListener`, `location`: what the runtime's modules touch at load.
 *
 * And the page: a CMS document of a header, a list of blocks and a footer, every region
 * with its props sidecar in the keyed tail at the end of the body, as the server renders it.
 * Setup only: nothing here runs inside a measured window, except the stand-ins' own callbacks.
 */
import { DomElement, document, el, frag, type DomNode } from '../test/_stubs/dom.ts';
import { encode_island_graph } from '../src/island-graph.ts';
import { OGYGIA_GRAPH as ISLAND_GRAPH_ATTR } from '../src/wire-markup.ts';
import { block, header, island_entry } from './fixtures.ts';

const chunk_of = (i: number): string => `/_app/immutable/chunks/c${i}.js`;

type G = Record<string, unknown>;
const g = globalThis as unknown as G;

g.scheduler = {
	yield: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
	postTask: (fn: () => void) => void setTimeout(fn, 0)
};
g.addEventListener ??= () => {};
g.removeEventListener ??= () => {};
g.location ??= { origin: 'https://shop.example.test', href: 'https://shop.example.test/catalog' };

/** The elements the stand-in observer reports as intersecting (the page's first screen). */
export const in_view = new WeakSet<object>();

type Report = (
	entries: Array<{
		target: Element;
		isIntersecting: boolean;
		boundingClientRect: { width: number; height: number };
	}>,
	io: unknown
) => void;
/** Every element the stand-in reports has a box of its own (a block's). */
const BOX = { width: 320, height: 48 };

class StandInObserver {
	#cb: Report;
	#queued: Element[] = [];
	constructor(cb: Report) {
		this.#cb = cb;
	}
	observe(target: Element): void {
		if (this.#queued.length === 0) setTimeout(() => this.#report(), 0);
		this.#queued.push(target);
	}
	unobserve(): void {}
	disconnect(): void {}
	#report(): void {
		const entries = this.#queued.map((target) => ({
			target,
			isIntersecting: in_view.has(target),
			boundingClientRect: BOX
		}));
		this.#queued = [];
		this.#cb(entries, this);
	}
}
g.IntersectionObserver = StandInObserver;

// `MutationObserver` is the shim's own (test/_stubs/dom.ts): every child-list and text change of the
// page, the runtime's included, as a browser records them.

// The custom element registry, as a browser's: `define` upgrades every element of that name already
// in the document, in document order (the constructor runs on the element itself, then its
// `connectedCallback`). `HTMLElement` is the shim's element; constructed for an upgrade, it is that
// element.
let upgrading: DomElement | null = null;
function StandInHTMLElement(): DomElement {
	const el = upgrading;
	upgrading = null;
	if (!el) throw new TypeError('Illegal constructor');
	return el;
}
StandInHTMLElement.prototype = Object.create(DomElement.prototype);
g.HTMLElement = StandInHTMLElement;
g.Element = DomElement;
g.window = globalThis;

type Ctor = new () => { connectedCallback?: () => void };
const defined = new Map<string, Ctor>();
g.customElements = {
	get: (name: string) => defined.get(name),
	define(name: string, ctor: Ctor) {
		defined.set(name, ctor);
		for (const el of document.querySelectorAll(name)) {
			Object.setPrototypeOf(el, ctor.prototype);
			upgrading = el;
			const upgraded = new ctor();
			upgraded.connectedCallback?.();
		}
	}
};

/**
 * A script edits a sleeping island: the whitespace text nodes go. The observer hears it, as a browser's would.
 */
export function edit_while_asleep(region: Element): void {
	strip_whitespace(region as unknown as DomNode);
}

const WAKES = ['load', 'visible', 'idle', 'interaction'] as const;
export type Wake = (typeof WAKES)[number];

export interface PageRegion {
	el: Element;
	wake: Wake;
	entry: string;
	/** the island's server markup as it connected (core.ts `#ssr_html`) */
	ssr_html: string;
	/** a script edited it while it slept (stripped its whitespace) */
	touched: boolean;
}

const fp = (i: number): string => (i * 2654435761 + 977).toString(16).slice(-8).padStart(8, '0');

/** One block island's server markup: a card of rows inside Svelte's anchor pair, with whitespace. */
function block_html(i: number, rows: number): string {
	let inner = `<!--[--><section class="block b${i}">\n\t<h2>Block ${i}</h2>\n\t<ul>`;
	for (let r = 0; r < rows; r++)
		inner += `\n\t\t<li data-sku="SKU-${i}-${r}"><a href="/p/${i}/${r}">Row ${r}</a> <span>${(i * 7 + r) % 97}</span></li>`;
	return inner + '\n\t</ul>\n</section><!--]-->';
}

/** The header island: a nav of menus, a search box and an account menu. */
function header_html(menus: number): string {
	let inner = '<!--[--><header class="site">\n\t<nav>';
	for (let m = 0; m < menus; m++)
		inner += `\n\t\t<div class="menu"><button type="button">Menu ${m}</button> <ul><li><a href="/m/${m}/a">A</a></li> <li><a href="/m/${m}/b">B</a></li></ul></div>`;
	return (
		inner +
		'\n\t</nav>\n\t<form role="search"><input name="q"> <button>Go</button></form>\n</header><!--]-->'
	);
}

/** Where an island's code is (`src`, the location the server names): the identity's built file on
 *  the page's origin, as a browser loads it (runtime/code-origins.ts `is_location_of`). The bench
 *  preload serves each as its own instance of the stand-in island module
 *  (internal/heisenbench/src/preload.ts). */
export const src_of = (entry: string): string =>
	`${location.origin}${entry.slice(0, -3)}.0bench0.js`;

/** Every island the pages below name: the header's, the blocks' 24, the footer's, the grid's. */
export const ISLAND_ENTRIES: string[] = [
	0,
	...Array.from({ length: 24 }, (_, i) => i + 1),
	30,
	50
].map(island_entry);

const region_open = (i: number, wake: Wake, entry: string): string =>
	`<ogygia-region entry="${entry}" src="${src_of(entry)}" wake="${wake}" data-og-fp="${fp(i)}">`;

// (the server escapes `<` in a sidecar, so the script's text never closes it)
const sidecar = (i: number, json: string): string =>
	`<script type="application/ogygia-props" data-ogygia-props="${fp(i)}" id="og-props-${fp(i)}" data-og-format="json">${json.replaceAll('<', '\\u003c')}</script>`;

/** Strip the whitespace text nodes under `node`, as a page script might. */
export function strip_whitespace(
	node: DomNode,
	removed: (parent: DomNode) => void = () => {}
): void {
	let any = false;
	for (const c of node.childNodes) {
		if (c.nodeType === 3 && !(c.nodeValue ?? '').trim()) {
			c.remove();
			any = true;
		} else if (c.nodeType === 1) strip_whitespace(c, removed);
	}
	if (any) removed(node);
}

/**
 * The page's `<head>` as the server rendered it: one block in ten renders a `<svelte:head>` of its
 * own (its markers around a JSON-LD script inside an `{#if}`).
 */
export function page_head(blocks: number): void {
	let html =
		'<meta charset="utf-8"><meta name="ogygia-csr" content="false"><title>Catalog</title>' +
		'<!--h1a2b3--><meta name="description" content="Every product"><!----><link rel="stylesheet" href="/app.css">';
	for (let i = 0; i < blocks; i += 10)
		html += `<!--h${fp(i)}--><!--[--><script type="application/ld+json">{"@id":"b${i}"}</script><!--]--><!---->`;
	(document.head as unknown as DomElement).replaceChildren(...frag(html));
}

/**
 * The page, in the shim's document: a header (wake `load`, a large props config), `blocks`
 * blocks with mixed wakes, a footer (`idle`). One block in five is edited while it sleeps: here
 * (`edit`), or by the bench once the runtime has its copy (`edit_while_asleep`). The head carries
 * Svelte's head-block markers for the islands' `<svelte:head>`.
 */
export function cms_page(blocks: number, rows = 6, edit = true): PageRegion[] {
	const body = document.body as unknown as DomElement;
	body.replaceChildren();
	page_head(blocks);
	const parts: Array<{ html: string; wake: Wake; entry: string; props: string }> = [];
	const h = header();
	parts.push({
		html: header_html(12),
		wake: 'load',
		entry: island_entry(0),
		props: JSON.stringify({ config: h })
	});
	for (let i = 0; i < blocks; i++) {
		const b = block(i % 40);
		const small = { id: i, title: b.title, rows: b.rows.slice(0, rows) };
		parts.push({
			html: block_html(i, rows),
			wake: i < 4 ? 'load' : WAKES[i % 4],
			entry: island_entry(1 + (i % 24)),
			props: JSON.stringify(small)
		});
	}
	parts.push({
		html: '<!--[--><footer>\n\t<p>Footer</p>\n</footer><!--]-->',
		wake: 'idle',
		entry: island_entry(30),
		props: JSON.stringify({ year: 2026, links: ['a', 'b', 'c'] })
	});
	let html = '<main><div class="blocks">';
	parts.forEach((p, i) => (html += region_open(i, p.wake, p.entry) + p.html + '</ogygia-region>'));
	html += '</div></main><div hidden>';
	parts.forEach((p, i) => (html += sidecar(i, p.props)));
	// the tail's island graph: each entry's chunks, preloaded at its wake (island-graph-preload.ts)
	const graph = new Map<string, string[]>();
	for (const p of parts)
		if (!graph.has(p.entry)) {
			const k = graph.size;
			graph.set(p.entry, [chunk_of(k), chunk_of(k + 1), chunk_of(40)]);
		}
	html += `<script type="application/json" ${ISLAND_GRAPH_ATTR}>${encode_island_graph(graph)}</script>`;
	html += '</div>';
	for (const n of frag(html)) body.appendChild(n);
	const els = (body as unknown as Element).querySelectorAll('ogygia-region');
	return parts.map((p, i) => {
		const region = els[i];
		const ssr_html = (region as unknown as DomElement).innerHTML;
		const touched = i > 0 && i % 5 === 0;
		if (touched && edit) strip_whitespace(region as unknown as DomNode);
		// (the first screen: the header and the first blocks)
		if (i < 8) in_view.add(region);
		return { el: region, wake: p.wake, entry: p.entry, ssr_html, touched };
	});
}

/**
 * A page of one product-grid island whose component renders its cards at its root (an `{#each}` with
 * no wrapper element): `cards` root elements in the island's anchor pair.
 */
export function grid_page(cards: number): PageRegion {
	const body = document.body as unknown as DomElement;
	body.replaceChildren();
	page_head(0);
	const entry = island_entry(50);
	let inner = '<!--[-->';
	for (let i = 0; i < cards; i++)
		inner += `<article class="card"><h3>Product ${i}</h3> <p>${(i * 13) % 97} USD</p></article>`;
	inner += '<!--]-->';
	const props = JSON.stringify({ ids: Array.from({ length: cards }, (_, i) => i) });
	for (const n of frag(
		region_open(0, 'load', entry) + inner + '</ogygia-region>' + sidecar(0, props)
	))
		body.appendChild(n);
	const region = (body as unknown as Element).querySelector('ogygia-region')!;
	return { el: region, wake: 'load', entry, ssr_html: inner, touched: false };
}

/** The server copy of a region's markup under a detached region element (what the repair compares). */
export function server_copy(r: PageRegion): Element {
	return el(`<ogygia-region>${r.ssr_html}</ogygia-region>`) as unknown as Element;
}
