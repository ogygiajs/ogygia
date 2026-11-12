// The DOM-free HTML passes over a rendered document: the head's link dedupe and runtime placement,
// the final assembly, a hole answer's URL rewrite, and the region-CSS scan. Per page or per hole, on
// a CMS document of a few hundred regions. (The region splitter and the reversible-transform marks:
// packages/reshape/bench.)
import { bench } from '@bench/heisenbench/bench';
import { assemble, locate } from '../src/server/document-assembly.ts';
import {
	dedupe_head_links,
	page_declares_dev_hmr_script,
	page_declares_router_meta,
	page_declares_runtime_script,
	page_declares_speculation_rules,
	runtime_first
} from '../src/server/head-presence.ts';
import { with_early_holes_meta_csp } from '../src/server/early-holes-csp.ts';
import { absolutize_hole_html } from '../src/server/hole-urls.ts';
import { hole_head } from '../src/server/hole-graph.ts';
import { island_graph_script } from '../src/server/document-tail.ts';
import { region_css_tags } from '../src/server/html-scan.ts';
import { next_tag, read_tag, tags, text_of } from '../src/wire-markup.ts';
import { document, head, hole_answer } from './fixtures.ts';
import { attr, decode_text, html, trusted_html } from '../src/html.ts';

bench(
	'head: dedupe repeated hints and sheets, then put the runtime first',
	({ h }) => runtime_first(dedupe_head_links(h), null).length,
	{
		setup: () => ({ h: head(40) }),
		scale: (_ctx, k) => ({ h: head(40 * k) })
	}
);

bench(
	'head: the presence checks (router meta, runtime, dev bridge, speculation rules)',
	({ h }) =>
		+page_declares_router_meta(h) +
		+page_declares_runtime_script(h) +
		+page_declares_dev_hmr_script(h) +
		+page_declares_speculation_rules(h),
	{
		setup: () => ({
			h: head(40).replace('<title>', '<meta name="ogygia-router" content="vt"><title>')
		}),
		scale: (_ctx, k) => ({
			h: head(40 * k).replace('<title>', '<meta name="ogygia-router" content="vt"><title>')
		})
	}
);

bench(
	'assemble: inject the head and the tail into a document',
	({ html, h, tail }) => assemble(html, locate(html), h, '<meta name="x">', tail).length,
	{
		setup: () => {
			const html = document(300);
			return { html, h: head(40), tail: '<script type="application/json">{}</script>'.repeat(20) };
		}
	}
);

bench(
	'hole answer: absolutize entry, endpoint and CSS URLs',
	({ html, base }) => absolutize_hole_html(html, base).length,
	{
		setup: () => ({
			html: hole_answer(60),
			base: new URL('https://example.test/shop/__ogygia__/r?id=abc')
		}),
		scale: (ctx, k) => ({ html: hole_answer(60 * k), base: ctx.base })
	}
);

// (a hole render's head: its islands' graph script and their region CSS among the page's tags)
bench(
	'hole answer: the graph and CSS its head carries',
	({ h, base }) => hole_head(h, base).length,
	{
		setup: () => ({
			h:
				head(8) +
				island_graph_script(
					new Map([
						['./_app/immutable/a.js', ['./_app/immutable/c1.js', './_app/immutable/c2.js']]
					]),
					new Map([['./_app/immutable/a.js', './_app/immutable/a.123.js']])
				),
			base: new URL('https://example.test/shop/__ogygia__/r?id=abc')
		})
	}
);

bench('region CSS: the tags a held region carries forward', ({ h }) => region_css_tags(h).length, {
	setup: () => ({ h: head(40) })
});

// (what a held region's own render head holds: its nested regions' sheets, nothing else)
bench('region CSS: the tags of a region render’s head', ({ h }) => region_css_tags(h).length, {
	setup: () => ({ h: region_css_tags(head(8)) })
});

bench(
	'head: the early start’s hash into a policy meta',
	({ h }) => with_early_holes_meta_csp(h).length,
	{
		setup: () => ({
			h: head(40).replace(
				'<title>',
				`<meta http-equiv="content-security-policy" content="script-src 'self' 'nonce-abc'"><title>`
			)
		})
	}
);

bench(
	'tags: every region open tag of a document, attributes read',
	({ html }) => {
		let n = 0;
		for (const t of tags(html, 'ogygia-region')) n += t.attrs.size;
		return n;
	},
	{
		setup: () => ({ html: document(100) }),
		scale: (_ctx, k) => ({ html: document(100 * k) })
	}
);

// (document()'s title check: a head with none is read to its end)
bench('next_tag: a title in a head that has none', ({ h }) => next_tag(h, 'title', 0) === null, {
	setup: () => ({ h: head(40).replace(/<title>.*?<\/title>/, '') })
});

bench('read_tag: one link tag of a head', ({ h, at }) => read_tag(h, at, at + 5)?.attrs.size, {
	setup: () => {
		const h = head(40);
		return { h, at: h.indexOf('<link') };
	}
});

bench(
	'text_of: a script element of a document',
	({ html, tag }) => text_of(html, tag, 'script')?.length,
	{
		setup: () => {
			const html = document(100);
			return { html, tag: tags(html, 'script').next().value! };
		}
	}
);

bench(
	'html: cards built from author text, escaped for where each value sits, and read back',
	({ rows }) => {
		let bytes = 0;
		for (const r of rows) {
			const card = html`<li${attr('id', r.id)} class="card"><a href="${r.href}">${r.title}</a>${trusted_html('<i>new</i>', 'a constant')}</li>`;
			bytes += String(card).length + decode_text(card.valueOf()).length;
		}
		return bytes;
	},
	{
		setup: () => ({ rows: cards(40) }),
		scale: (_ctx, k) => ({ rows: cards(40 * k) })
	}
);

bench(
	'tags: every region start tag of a document, read past its scripts, styles and comments',
	({ html }) => {
		let n = 0;
		for (const t of tags(html, 'ogygia-region')) n += t.attrs.size;
		return n;
	},
	{
		setup: () => ({ html: document(300) }),
		scale: (_ctx, k) => ({ html: document(300 * k) })
	}
);

bench(
	'tags: the head links of a page with forty islands',
	({ h }) => {
		let n = 0;
		for (const t of tags(h, 'link')) n += t.end - t.start;
		return n;
	},
	{ setup: () => ({ h: head(40) }) }
);

/** `n` rows of author text, one in three full of the characters that need escaping. */
function cards(n: number): { id: string; href: string; title: string }[] {
	return Array.from({ length: n }, (_, i) =>
		i % 3 === 0
			? { id: `c"${i}<`, href: `/p?a=${i}&b="x"`, title: `Tom & Jerry <${i}> 'q'` }
			: { id: `c${i}`, href: `/p/${i}`, title: `Card ${i}` }
	);
}
