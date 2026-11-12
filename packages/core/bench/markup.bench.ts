// The DOM-free HTML passes over a rendered document: the head's link dedupe and runtime placement,
// the final assembly, a hole answer's URL rewrite, and the region-CSS scan. Per page or per hole, on
// a CMS document of a few hundred regions. (The region splitter and the reversible-transform marks:
// packages/reshape/bench.)
import { bench } from '@bench/heisenbench/bench';
import { assemble, locate } from '../src/server/document-assembly.ts';
import { dedupe_head_links, runtime_first } from '../src/server/head-presence.ts';
import { absolutize_hole_html } from '../src/server/hole-urls.ts';
import { region_css_tags } from '../src/server/html-scan.ts';
import { document, head, hole_answer } from './fixtures.ts';
import { attr, decode_text, html, trusted_html } from '../src/html.ts';
import { tags } from '../src/wire-markup.ts';

bench(
	'head: dedupe repeated hints and sheets, then put the runtime first',
	({ h }) => runtime_first(dedupe_head_links(h), null).length,
	{
		setup: () => ({ h: head(40) }),
		scale: (_ctx, k) => ({ h: head(40 * k) })
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

bench('region CSS: the tags a held region carries forward', ({ h }) => region_css_tags(h).length, {
	setup: () => ({ h: head(40) })
});

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
