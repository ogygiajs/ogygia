/**
 * Inputs for the core bench files, sized like a real CMS page: the palaestra's server-cost page data
 * (twenty block islands over a ~700 KB `page.data`, a ~300 KB header config), and a rendered
 * document of the same shape (head hints and sheets with the duplicates islands emit, regions of
 * every kind, Svelte's hydration comments, tag-like text in scripts and styles). And a CMS page of
 * blocks for the request path: nested blocks in `page.data`, the rendered page around them (a header
 * and a footer region, ~10 KB of markup per block), and a page with no region on it.
 *
 * Setup only: nothing here runs inside a measured window.
 */
import { block, header_config, page_tree } from '../../../apps/palaestra/src/lib/bench/data.ts';
import type { Block, HeaderConfig } from '../../../apps/palaestra/src/lib/bench/data.ts';

export { block, page_tree };
export type { Block, HeaderConfig };

/** A fresh copy of the header config (the props analysis caches per object). */
export function header(): HeaderConfig {
	return structuredClone(header_config);
}

/** `page_tree()` with `blocks` blocks instead of twenty. */
export function page_of(blocks: number): ReturnType<typeof page_tree> {
	const tree = page_tree();
	tree.catalog.blocks = Array.from({ length: blocks }, (_, i) => block(i));
	return tree;
}

/** A block that only the devalue lane can carry (a Date, a Map, an undefined field). */
export function rich_block(
	i: number
): Block & { at: Date; index: Map<string, number>; gone: undefined } {
	const b = block(i);
	return {
		...b,
		at: new Date(Date.UTC(2026, 8, 10, 12, i)),
		index: new Map(b.rows.map((r, k) => [r.sku, k])),
		gone: undefined
	};
}

const hex = (n: number): string => (n * 2654435761).toString(16).slice(0, 8).padStart(8, '0');

export const island_entry = (i: number): string => `/_app/ogygia/og-region.${hex(i + 1)}.js`;
const chunk = (i: number): string => `/_app/immutable/chunks/${hex(i + 101)}.js`;
const sheet = (i: number): string => `/_app/immutable/assets/${hex(i + 501)}.css`;

/** The `<head>` of a rendered CMS page: every island repeats its hints and its region CSS. */
export function head(islands: number): string {
	const out = [
		`<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Catalog: every product, every block</title><link rel="stylesheet" href="${sheet(0)}"><link rel="preconnect" href="https://cdn.example.test">`
	];
	for (let i = 0; i < islands; i++) {
		for (let k = 0; k < 4; k++) {
			out.push(`<link rel="modulepreload" href="${chunk((i + k) % 24)}" fetchpriority="low">`);
		}
		out.push(`<link rel="stylesheet" href="${sheet(1 + (i % 6))}" data-ogygia-region-css>`);
		if (i % 5 === 0)
			out.push(
				`<style data-ogygia-region-css="${sheet(40 + i)}">.b${i}{color:red}/* <link rel="stylesheet" href="x"> */</style>`
			);
	}
	out.push(
		`<script type="module" src="/_app/ogygia/runtime.${hex(7)}.js" data-ogygia-runtime></script></head>`
	);
	return out.join('');
}

/** One island's server markup: a card with rows, Svelte's hydration comments, a custom element. */
function island_html(i: number, rows: number): string {
	const items: string[] = [];
	for (let r = 0; r < rows; r++) {
		items.push(
			`<li data-sku="SKU-${i}-${r}"><a href="/p/${i}/${r}">Row ${r}</a> <span>${(i * 7 + r) % 97}</span></li>`
		);
	}
	return `<ogygia-region entry="${island_entry(i)}" wake="${i % 3 === 0 ? 'load' : 'visible'}" data-og-fp="${hex(i + 900)}${hex(i + 901)}"><!--[--><demo-card class="card c${i}"><h2>Block ${i}</h2><ul>${items.join('')}</ul></demo-card><!--]--></ogygia-region>`;
}

/** A rendered CMS document: `regions` regions (islands, lakes holding islands, holes), ~1 KB each. */
export function document(regions: number, rows = 8): string {
	const body = [
		'<body><div style="display: contents"><script>window.__note = "<ogygia-region wake=load> is text here";</script><style>/* <ogygia-region> in a comment */ .x{}</style><!-- <ogygia-region> -->'
	];
	for (let i = 0; i < regions; i++) {
		if (i % 7 === 3) {
			body.push(
				`<ogygia-region wake="none"><section class="lake">${island_html(i, rows)}</section></ogygia-region>`
			);
		} else if (i % 11 === 5) {
			body.push(
				`<ogygia-region render="defer" when="visible" endpoint="/__ogygia__/r?id=${hex(i)}&amp;p=${hex(i + 3)}"><p class="fallback">Loading block ${i}</p></ogygia-region>`
			);
		} else {
			body.push(island_html(i, rows));
		}
	}
	return `<!doctype html><html lang="en">${head(Math.min(regions, 40))}${body.join('')}</div></body></html>`;
}

const LOREM_TEXT =
	'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';

/** One block of a CMS page's list: its own fields, a nested layout of child blocks, rich text. */
export function content_block(i: number) {
	return {
		id: `b-${i}`,
		type: ['hero', 'tiles', 'text', 'product-grid', 'banner', 'faq'][i % 6],
		props: {
			title: `Section ${i}: ${LOREM_TEXT.slice(0, 48)}`,
			body: `${LOREM_TEXT}(section ${i}) `.repeat(4),
			image: { src: `/media/${hex(i + 300)}.webp`, alt: `Image ${i}`, width: 1200, height: 630 },
			theme: { tone: i % 2 ? 'light' : 'dark', spacing: i % 3 }
		},
		children: Array.from({ length: 6 }, (_, c) => ({
			id: `b-${i}-${c}`,
			type: 'tile',
			props: {
				label: `Tile ${i}.${c}`,
				href: `/section/${i}/tile/${c}`,
				text: `${LOREM_TEXT.slice(0, 160)} (${i}.${c})`,
				tags: ['new', `t-${c}`]
			}
		}))
	};
}
export type ContentBlock = ReturnType<typeof content_block>;

/** A CMS page's `page.data`: the page's fields and its `blocks`, the site's settings, the
 *  visitor's session. ~4 KB per block. */
export function content_data(blocks: number) {
	return {
		page: {
			id: 'home',
			path: '/',
			title: 'Home',
			seo: { description: LOREM_TEXT, canonical: 'https://example.test/', noindex: false },
			blocks: Array.from({ length: blocks }, (_, i) => content_block(i))
		},
		site: {
			locale: 'en',
			currency: 'USD',
			flags: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`flag_${i}`, i % 3 === 0]))
		},
		session: { signed_in: false, cart: { count: 0 } }
	};
}
export type ContentData = ReturnType<typeof content_data>;

/** A footer's config: columns of links, the legal text (not in `page.data`, like the header's). */
export function footer_config() {
	return {
		columns: Array.from({ length: 6 }, (_, c) => ({
			title: `Column ${c}`,
			links: Array.from({ length: 12 }, (_, k) => ({
				label: `Link ${c}.${k}`,
				href: `/f/${c}/${k}`
			}))
		})),
		legal: LOREM_TEXT.repeat(6)
	};
}

/** A listing page's `page.data`: `items` small products (~130 bytes each, each one a node the seed
 *  index keeps) in one list, beside the site settings and the session. */
export function listing_data(items: number) {
	return {
		page: {
			id: 'listing',
			title: 'All products',
			items: Array.from({ length: items }, (_, i) => ({
				sku: `SKU-${i}`,
				name: `Product ${i} ${LOREM_TEXT.slice(0, 30)}`,
				href: `/p/${i}`,
				price: (i * 7) / 3,
				stock: i % 17
			}))
		},
		site: { locale: 'en', currency: 'USD' },
		session: { signed_in: false }
	};
}
export type ListingData = ReturnType<typeof listing_data>;

/** A `page.data` holding a dictionary: `entries` prices by SKU (one object of many keys), beside a
 *  short list. */
export function dictionary_data(entries: number) {
	return {
		page: { id: 'prices', title: 'Price list' },
		prices: Object.fromEntries(
			Array.from({ length: entries }, (_, i) => [
				`SKU-${i}`,
				{ amount: (i * 7) / 3, currency: 'USD', label: `Price of product ${i}`, tier: i % 4 }
			])
		) as Record<string, { amount: number; currency: string; label: string; tier: number }>,
		site: { locale: 'en', currency: 'USD' }
	};
}

/**
 * A CMS page as Kit hands it to `transformPageChunk` (csr=false, not streamed): the header
 * region, `blocks` block regions (islands, every seventh one a lake holding an island, every
 * eleventh a hole), the footer region. ~10 KB of markup per block: ~2.5 MB at 250 blocks.
 */
export function content_document(blocks: number): string {
	const nav: string[] = [];
	for (let i = 0; i < 240; i++)
		nav.push(
			`<li><a href="/menu/${i % 6}/item/${i}">Item ${i}</a><p>${LOREM_TEXT.slice(0, 100)}</p></li>`
		);
	const header_html = `<ogygia-region entry="${island_entry(900)}" wake="load" data-og-fp="${hex(990)}${hex(991)}"><!--[--><header><nav><ul>${nav.join('')}</ul></nav></header><!--]--></ogygia-region>`;
	const doc = document(blocks, 100);
	const at =
		doc.indexOf('<div style="display: contents">') + '<div style="display: contents">'.length;
	const end = doc.lastIndexOf('</div></body>');
	const footer: string[] = [];
	for (let i = 0; i < 72; i++) footer.push(`<li><a href="/f/${i % 6}/${i}">Link ${i}</a></li>`);
	const footer_html = `<ogygia-region entry="${island_entry(901)}" wake="visible" data-og-fp="${hex(992)}${hex(993)}"><!--[--><footer><ul>${footer.join('')}</ul><p>${LOREM_TEXT.repeat(6)}</p></footer><!--]--></ogygia-region>`;
	return doc.slice(0, at) + header_html + doc.slice(at, end) + footer_html + doc.slice(end);
}

/** A page with no region on it: the same markup as plain HTML (~10 KB per section). */
export function plain_document(sections: number): string {
	const body = ['<body><main>'];
	for (let i = 0; i < sections; i++) {
		body.push(`<section class="s${i}"><h2>Section ${i}</h2><ul>`);
		for (let r = 0; r < 100; r++)
			body.push(
				`<li data-sku="SKU-${i}-${r}"><a href="/p/${i}/${r}">Row ${r}</a> <span>${(i * 7 + r) % 97}</span></li>`
			);
		body.push('</ul></section>');
	}
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Docs</title><link rel="stylesheet" href="${sheet(0)}"></head>${body.join('')}</main><script>window.__note = "</body> is text here";</script></body></html>`;
}

/** A hole's answer: regions with relative entry, endpoint and region-CSS URLs. */
export function hole_answer(regions: number): string {
	const out: string[] = [];
	for (let i = 0; i < regions; i++) {
		out.push(
			`<link rel="stylesheet" href="../_app/immutable/assets/${hex(i)}.css" data-ogygia-region-css><ogygia-region entry="./og-region.${hex(i)}.js" wake="visible"><div><img src="./img/${i}.png" alt=""><a href="/p/${i}">Item ${i}</a></div><ogygia-region render="defer" endpoint="./r?id=${hex(i + 1)}"><i>later</i></ogygia-region></ogygia-region>`
		);
	}
	return out.join('');
}
