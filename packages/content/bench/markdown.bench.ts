// The markdown pipeline's own passes on docs-shaped pages (frontmatter, nested headings, prose
// with inline code and links, fences, code groups, callout containers): the frontmatter parser
// over a site's worth of pages, the tab-group and container rewrites, the heading collector (TOC
// ids, scoping, dedupe), and the search index's section split, prose strip and excerpt.
//
// The pages are generated, not read from apps/docs: a docs edit must never move these counts.
// The full `ogygiaPreprocess` run (mdsvex, Shiki fences) reaches @ogygia/core's built compiler
// (`dist`) and Shiki's WASM engine, so it waits for Heisenbench's coverage run of a built tree.
import { bench } from '@bench/heisenbench/bench';
import { transform_containers } from '../src/markdown/containers.ts';
import { parseFrontmatter } from '../src/markdown/frontmatter.ts';
import { remarkHeadings } from '../src/markdown/remark-headings.ts';
import { transform_tabs } from '../src/markdown/tabs.ts';
import { excerpt_of, split_sections, strip_prose } from '../src/site/search.ts';
import type { Heading } from '../src/index.ts';

const F = '```';
const WORDS = [
	'region',
	'island',
	'hydrates',
	'the',
	'server',
	'renders',
	'once',
	'and',
	'a',
	'lake',
	'stays',
	'frozen',
	'while',
	'every',
	'hole',
	'streams',
	'its',
	'answer'
];

function sentence(i: number, words: number): string {
	let s = '';
	for (let w = 0; w < words; w++) s += (w ? ' ' : '') + WORDS[(i * 7 + w * 3) % WORDS.length];
	return `${s[0].toUpperCase() + s.slice(1)}.`;
}

/** One docs page: `sections` `##` sections, each with subsections, prose, a fence, and a group. */
function doc_page(n: number, sections: number): string {
	const lines = [
		'---',
		`title: Page ${n}: regions and islands`,
		`summary: ${sentence(n, 24)}`,
		`order: ${n}`,
		'draft: false',
		'tags: [regions, islands, "server render"]',
		'related:',
		`  - guide/page-${n + 1}`,
		`  - reference/api-${n}`,
		'meta:',
		'  author: docs',
		`  updated: 2026-09-${String((n % 28) + 1).padStart(2, '0')}`,
		'---',
		'',
		sentence(n, 30)
	];
	for (let s = 0; s < sections; s++) {
		lines.push(
			'',
			`## Section ${s}: \`wake\` and &lt;holes&gt;`,
			'',
			`${sentence(s, 40)} See [the guide](/guide/${s}) and \`maxAge\`.`
		);
		for (let sub = 0; sub < 3; sub++) {
			lines.push(
				'',
				`### Options ${sub}`,
				'',
				sentence(s + sub, 50),
				'',
				`#### Options ${sub}`,
				'',
				sentence(sub, 20)
			);
		}
		lines.push(
			'',
			`${F}ts`,
			`import Chart from './Chart.svelte' with { wake: 'visible' };`,
			`const n = ${s};`,
			F
		);
		if (s % 2 === 0) {
			lines.push(
				'',
				'::: code-group',
				`${F}bash [npm]`,
				'npm i ogygia',
				F,
				`${F}bash [pnpm]`,
				'pnpm add ogygia',
				F,
				':::'
			);
		} else {
			lines.push('', `::: warning A note on section ${s}`, sentence(s, 60), ':::');
		}
	}
	return `${lines.join('\n')}\n`;
}

/** A docs site: `count` pages of a few sections each (`k` times as many sections per page). */
const site = (count: number, k = 1): string[] =>
	Array.from({ length: count }, (_, i) => doc_page(i, (3 + (i % 4)) * k));

/** A long page and the `##` headings its collector would hand the section split. */
function sectioned(sections: number): { source: string; headings: Heading[] } {
	const source = doc_page(3, sections);
	const headings: Heading[] = [];
	for (const line of source.split('\n')) {
		if (line.startsWith('## '))
			headings.push({ depth: 2, id: line.slice(3).toLowerCase(), text: line.slice(3) });
	}
	return { source, headings };
}

interface MdNode {
	type: string;
	depth?: number;
	value?: string;
	children?: MdNode[];
}

/** An mdast-shaped tree of a page's headings and paragraphs (what remark hands the plugin). */
function md_tree(source: string): MdNode {
	const children: MdNode[] = [];
	for (const line of source.split('\n')) {
		let depth = 0;
		while (line[depth] === '#') depth++;
		if (depth > 0 && line[depth] === ' ') {
			children.push({
				type: 'heading',
				depth,
				children: [
					{ type: 'text', value: line.slice(depth + 1) },
					{ type: 'inlineCode', value: 'wake' }
				]
			});
		} else if (line.trim() !== '') {
			children.push({ type: 'paragraph', children: [{ type: 'text', value: line }] });
		}
	}
	return { type: 'root', children };
}

bench(
	'frontmatter: a 120-page docs site',
	({ sources }) => {
		let keys = 0;
		for (const s of sources) keys += Object.keys(parseFrontmatter(s).data).length;
		return keys;
	},
	{ setup: () => ({ sources: site(120) }), scale: (_ctx, k) => ({ sources: site(120 * k) }) }
);

bench(
	'tabs and containers: the rewrite passes over a long page',
	({ source }) => transform_containers(transform_tabs(source).code).length,
	{
		setup: () => ({ source: doc_page(1, 20) }),
		scale: (_ctx, k) => ({ source: doc_page(1, 20 * k) })
	}
);

bench(
	'headings: the TOC of a long page',
	({ tree }) => {
		const file = { data: {} as Record<string, unknown> };
		remarkHeadings({ minDepth: 2, maxDepth: 4 })(tree as never, file);
		return file.data;
	},
	{
		setup: () => ({ tree: md_tree(doc_page(2, 20)) }),
		scale: (_ctx, k) => ({ tree: md_tree(doc_page(2, 20 * k)) })
	}
);

bench(
	'search: split a long page into sections and strip their prose',
	({ source, headings }) => split_sections(source, headings).length,
	{ setup: () => sectioned(20), scale: (_ctx, k) => sectioned(20 * k) }
);

bench(
	'search: strip and excerpt a docs site for a two-word query',
	({ sources }) => {
		let n = 0;
		for (const s of sources) n += excerpt_of(strip_prose(s), ['lake', 'frozen']).length;
		return n;
	},
	// Grows the pages, not their number: a longer page is where a strip pass could go superlinear.
	{ setup: () => ({ sources: site(60) }), scale: (_ctx, k) => ({ sources: site(60, k) }) }
);
