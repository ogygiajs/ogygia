/**
 * Inputs for the core bench files, sized like a real CMS page: the palaestra's server-cost page data
 * (twenty block islands over a ~700 KB `page.data`, a ~300 KB header config), and a rendered
 * document of the same shape (head hints and sheets with the duplicates islands emit, regions of
 * every kind, Svelte's hydration comments, tag-like text in scripts and styles).
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
	let out = '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width">';
	out += '<title>Catalog: every product, every block</title>';
	out += `<link rel="stylesheet" href="${sheet(0)}"><link rel="preconnect" href="https://cdn.example.test">`;
	for (let i = 0; i < islands; i++) {
		for (let k = 0; k < 4; k++) {
			out += `<link rel="modulepreload" href="${chunk((i + k) % 24)}" fetchpriority="low">`;
		}
		out += `<link rel="stylesheet" href="${sheet(1 + (i % 6))}" data-ogygia-region-css>`;
		if (i % 5 === 0)
			out += `<style data-ogygia-region-css="${sheet(40 + i)}">.b${i}{color:red}/* <link rel="stylesheet" href="x"> */</style>`;
	}
	out += `<script type="module" src="/_app/ogygia/runtime.${hex(7)}.js" data-ogygia-runtime></script>`;
	return out + '</head>';
}

/** One island's server markup: a card with rows, Svelte's hydration comments, a custom element. */
function island_html(i: number, rows: number): string {
	let inner = `<!--[--><demo-card class="card c${i}"><h2>Block ${i}</h2><ul>`;
	for (let r = 0; r < rows; r++) {
		inner += `<li data-sku="SKU-${i}-${r}"><a href="/p/${i}/${r}">Row ${r}</a> <span>${(i * 7 + r) % 97}</span></li>`;
	}
	inner += '</ul></demo-card><!--]-->';
	return (
		`<ogygia-region entry="${island_entry(i)}" wake="${i % 3 === 0 ? 'load' : 'visible'}" ` +
		`data-og-fp="${hex(i + 900)}${hex(i + 901)}">${inner}</ogygia-region>`
	);
}

/** A rendered CMS document: `regions` regions (islands, lakes holding islands, holes), ~1 KB each. */
export function document(regions: number, rows = 8): string {
	let body = '<body><div style="display: contents">';
	body += '<script>window.__note = "<ogygia-region wake=load> is text here";</script>';
	body += '<style>/* <ogygia-region> in a comment */ .x{}</style><!-- <ogygia-region> -->';
	for (let i = 0; i < regions; i++) {
		if (i % 7 === 3) {
			body += `<ogygia-region wake="none"><section class="lake">${island_html(i, rows)}</section></ogygia-region>`;
		} else if (i % 11 === 5) {
			body +=
				`<ogygia-region render="defer" when="visible" endpoint="/__ogygia__/r?id=${hex(i)}&amp;p=${hex(i + 3)}">` +
				`<p class="fallback">Loading block ${i}</p></ogygia-region>`;
		} else {
			body += island_html(i, rows);
		}
	}
	body += '</div></body>';
	return `<!doctype html><html lang="en">${head(Math.min(regions, 40))}${body}</html>`;
}

/** A hole's answer: regions with relative entry, endpoint and region-CSS URLs. */
export function hole_answer(regions: number): string {
	let out = '';
	for (let i = 0; i < regions; i++) {
		out +=
			`<link rel="stylesheet" href="../_app/immutable/assets/${hex(i)}.css" data-ogygia-region-css>` +
			`<ogygia-region entry="./og-region.${hex(i)}.js" wake="visible">` +
			`<div><img src="./img/${i}.png" alt=""><a href="/p/${i}">Item ${i}</a></div>` +
			`<ogygia-region render="defer" endpoint="./r?id=${hex(i + 1)}"><i>later</i></ogygia-region>` +
			'</ogygia-region>';
	}
	return out;
}
