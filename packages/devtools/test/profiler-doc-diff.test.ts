import { describe, expect, it } from 'vitest';
import { attr_sites, doc_diff } from '../src/profiler/doc-diff.ts';
import { dedent } from '@ogygia/core/plugin/utils';

// What changes between two renders of one page, grouped by what it is.

describe('doc_diff', () => {
	const page = (id1: string, id2: string, fp: string, n: string) =>
		`<html><body><h1>Shop</h1><a data-track="${id1}" href="/a">A</a><a data-track="${id2}" href="/b">B</a><!--r.${n}--><ogygia-region entry="./_app/immutable/og-region.abc.js" wake="load" data-og-fp="${fp}"><p>price</p></ogygia-region><script type="application/ogygia-props" data-ogygia-props="${fp}" id="og-props-${fp}">{}</script></body></html>`;

	it('the same document: nothing', () => {
		expect(doc_diff(page('1', '2', 'f', '5'), page('1', '2', 'f', '5'))).toBeUndefined();
	});

	it('an attribute stamped per render (one group, whatever tags), an island (region and props as one), comment markers', () => {
		const d = doc_diff(page('x1', 'x2', 'f1', '5'), page('y1', 'y2', 'f2', '9'), (e) =>
			e.includes('og-region.abc') ? 'Price' : undefined
		)!;
		expect(d).toMatchObject({ aligned: true, differing: 5 });
		expect(d.groups).toEqual([
			{ what: 'data-track on <a>', tag: 'a', attr: 'data-track', count: 2, a: 'x1', b: 'y1' },
			{
				what: 'comment markers (<!--…-->)',
				tag: 'comment',
				count: 1,
				a: '<!--r.5-->',
				b: '<!--r.9-->'
			},
			{
				what: "the Price island's props",
				tag: 'ogygia-region',
				island: 'Price',
				count: 1,
				a: 'f1',
				b: 'f2'
			}
		]);
	});

	it('where your markup sets a changing attribute, on the tags the diff saw it on', () => {
		const src = dedent`
			<script>let { m } = $props();</script>
			<aside data-track={m.track}><h5>{m.title}</h5></aside>
			<section data-track={m.other}>not a tag the diff saw</section>
			<a
				href="/x"
				data-track={id}
			>link</a>
			<a data-track="static">fixed</a>
			<article data-track={x}>\`<a\` is not the start of \`<article\`</article>
		`;
		expect(attr_sites(src, 'data-track', ['aside', 'a'])).toEqual([
			{ line: 2, code: '<aside data-track={m.track}><h5>{m.title}</h5></aside>' },
			// a multi-line tag's attribute line
			{ line: 6, code: 'data-track={id}' }
		]);
	});

	it('the review cases: a dropped piece, an added one at the end, a dropped attribute, single quotes, a whole attribute name', () => {
		expect(
			doc_diff(
				'<ul><li>a</li><p>t5</p><li>b</li></ul>',
				'<ul><li>a</li><li>b</li></ul>'
			)!.groups.map((g) => g.what)
		).toEqual(['<p> dropped in the later render']);
		expect(
			doc_diff('<ul><li>a</li></ul>', '<ul><li>a</li></ul><footer>x')!.groups.map((g) => g.what)
		).toEqual(['<footer> added in the later render']);
		expect(
			doc_diff('<a class="x" data-n="1">A</a>', '<a class="x">A</a>')!.groups.map((g) => g.what)
		).toEqual(['data-n on <a>']);
		expect(doc_diff("<a data-n='1'>A</a>", "<a data-n='2'>A</a>")!.groups[0]).toMatchObject({
			what: 'data-n on <a>',
			a: '1',
			b: '2'
		});
		expect(attr_sites('<a data-track-id={x} id={y}>', 'id', ['a'])).toEqual([
			{ line: 1, code: '<a data-track-id={x} id={y}>' }
		]);
		expect(attr_sites('<a data-track-id={x}>', 'id', ['a'])).toEqual([]);
		// Svelte's shorthand
		expect(attr_sites('<a {id} href="/x">', 'id', ['a'])).toEqual([
			{ line: 1, code: '<a {id} href="/x">' }
		]);
	});

	it('past a small insertion, the rest still lines up', () => {
		const a = '<ul><li>a</li><li>b</li></ul><p>end</p>';
		const b = '<ul><li>a</li><li>new</li><li>b</li></ul><p>end</p>';
		const d = doc_diff(a, b)!;
		expect(d.aligned).toBe(false);
		// an inserted item: added, not a changed attribute or text
		expect(d.groups.map((g) => [g.what, g.count])).toEqual([['<li> added in the later render', 2]]);
	});
});

// The documents are cut at their tags the way the browser reads them (#1370): a `<` or `>` inside a
// value, a comment or a script is not a tag edge, and every quoting of a value is read.
describe('doc_diff reads tags as the browser does', () => {
	const groups = (a: string, b: string) =>
		doc_diff(
			`<body><h1>Shop</h1>${a}<p>end</p></body>`,
			`<body><h1>Shop</h1>${b}<p>end</p></body>`
		)!.groups.map((g) => [g.what, g.count, g.a, g.b]);

	/** `data-track` written each way the browser reads it, holding `v`. */
	const spellings = (v: string) => [`data-track="${v}"`, `data-track='${v}'`, `data-track=${v}`];
	/** Values before it that a hand parser trips on. */
	const before = ['', 'title="x>y"', "title='a<b'", 'title="say \'hi\'"', 'title="&quot;=&gt;"'];

	for (const lead of before)
		for (const [i, one] of spellings('1').entries()) {
			const two = spellings('2')[i];
			it(`an attribute: <a ${lead} ${one}>`, () => {
				expect(groups(`<a ${lead} ${one}>A</a>`, `<a ${lead} ${two}>A</a>`)).toEqual([
					['data-track on <a>', 1, '1', '2']
				]);
			});
		}

	it('a script whose text holds `<` changes as the script’s text', () => {
		expect(groups('<script>if(a<b)go(1)</script>', '<script>if(a<b)go(2)</script>')).toEqual([
			['text in <script>', 1, 'if(a<b)go(1)', 'if(a<b)go(2)']
		]);
	});

	it('a comment holding a tag changes as a comment marker', () => {
		expect(groups('<!-- <b>1</b> -->', '<!-- <b>2</b> -->')).toEqual([
			['comment markers (<!--…-->)', 1, '<!-- <b>1</b> -->', '<!-- <b>2</b> -->']
		]);
	});

	it('text after a `<` that opens no tag is the text of the tag before it', () => {
		expect(groups('<p>1 < 2</p>', '<p>1 < 3</p>')).toEqual([['text in <p>', 1, '1 < 2', '1 < 3']]);
	});
});
