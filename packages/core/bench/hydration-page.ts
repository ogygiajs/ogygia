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
 * And the page: a CMS document of a header, a builder list of blocks and a footer, every region
 * with its props sidecar in the keyed tail at the end of the body, as the server renders it.
 * Setup only: nothing here runs inside a measured window, except the stand-ins' own callbacks.
 */
import { document, el, frag, type DomElement, type DomNode } from '../test/_stubs/dom.ts';
import { block, header, island_entry } from './fixtures.ts';

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

type Report = (entries: Array<{ target: Element; isIntersecting: boolean }>, io: unknown) => void;

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
		const entries = this.#queued.map((target) => ({ target, isIntersecting: in_view.has(target) }));
		this.#queued = [];
		this.#cb(entries, this);
	}
}
g.IntersectionObserver = StandInObserver;

const WAKES = ['load', 'visible', 'idle', 'interaction'] as const;
export type Wake = (typeof WAKES)[number];

export interface PageRegion {
	el: Element;
	wake: Wake;
	entry: string;
	/** the island's server markup as it connected (core.ts `#ssr_html`) */
	ssr_html: string;
	/** a script edited it while it slept (a design-system runtime stripped its whitespace) */
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

const region_open = (i: number, wake: Wake, entry: string): string =>
	`<ogygia-region entry="${entry}" wake="${wake}" data-og-fp="${fp(i)}">`;

// (the server escapes `<` in a sidecar, so the script's text never closes it)
const sidecar = (i: number, json: string): string =>
	`<script type="application/ogygia-props" data-ogygia-props="${fp(i)}" id="og-props-${fp(i)}" data-og-format="json">${json.replaceAll('<', '\\u003c')}</script>`;

/** Strip the whitespace text nodes under `node`, as a design-system runtime does while it upgrades. */
export function strip_whitespace(node: DomNode): void {
	for (const c of node.childNodes) {
		if (c.nodeType === 3 && !(c.nodeValue ?? '').trim()) c.remove();
		else if (c.nodeType === 1) strip_whitespace(c);
	}
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
 * The page, in the shim's document: a header (wake `load`, a large props config), `blocks` builder
 * blocks with mixed wakes, a footer (`idle`). One block in five was edited while it slept. The head
 * carries Svelte's head-block markers for the islands' `<svelte:head>`.
 */
export function cms_page(blocks: number, rows = 6): PageRegion[] {
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
	let html = '<main><div class="builder">';
	parts.forEach((p, i) => (html += region_open(i, p.wake, p.entry) + p.html + '</ogygia-region>'));
	html += '</div></main><div hidden>';
	parts.forEach((p, i) => (html += sidecar(i, p.props)));
	html += '</div>';
	for (const n of frag(html)) body.appendChild(n);
	const els = (body as unknown as Element).querySelectorAll('ogygia-region');
	return parts.map((p, i) => {
		const region = els[i];
		const ssr_html = (region as unknown as DomElement).innerHTML;
		const touched = i > 0 && i % 5 === 0;
		if (touched) strip_whitespace(region as unknown as DomNode);
		// (the first screen: the header and the first blocks)
		if (i < 8) in_view.add(region);
		return { el: region, wake: p.wake, entry: p.entry, ssr_html, touched };
	});
}

/** The server copy of a region's markup under a detached region element (what the repair compares). */
export function server_copy(r: PageRegion): Element {
	return el(`<ogygia-region>${r.ssr_html}</ogygia-region>`) as unknown as Element;
}
