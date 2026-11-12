// The HTML quality oracle (src/html.ts): it finds bad HTML a server sent (by the tree its source
// says, before a parser repairs it) and bad HTML a document holds at rest (a DOM code built), lets
// good HTML pass, and leaves what the app wrote badly on purpose (`data-gen-messy`) to the app.
import { describe, expect, it } from 'vitest';
import { content_model, from_dom, lint_html, source_tree } from '../src/html.ts';

const page = (body: string, head = '<title>t</title>') =>
	`<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const rules = (html: string) => lint_html(html, true).map((l) => l.rule);

describe('html sent', () => {
	it('passes good HTML: void elements, raw text, comments, a table', () => {
		expect(
			rules(
				page(
					'<!--[--><div><p>a<br>b<img src="x"></p><table><tbody><tr><td>1</td></tr></tbody></table></div><!--]--><script>if (a < b && c > d) {}</script>',
					'<title>t</title><meta charset="utf-8"><style>p > a { color: red }</style>'
				)
			)
		).toEqual([]);
	});

	it('finds what a parser would silently repair', () => {
		expect(rules(page('<p>a<div>b</div></p>'))).toContain('<div> inside <p>');
		expect(rules(page('<a href="x"><a href="y">z</a></a>'))).toContain('<a> inside <a>');
		expect(rules(page('<form><form></form></form>'))).toContain('<form> inside <form>');
		expect(rules(page('<button><a href="x">z</a></button>'))).toContain('<a> inside <button>');
		expect(rules(page('<table><div>x</div></table>'))).toContain('<div> inside <table>');
		expect(rules(page('<div id="q"></div><span id="q"></span>'))).toContain('id "q" twice');
		expect(rules(page('<div><style>p{}</style></div>'))).toContain('<style> in the body');
		expect(rules(page('', '<title></title>'))).toContain('an empty <title>');
		expect(rules(page('<div><span></div></span>'))).toContain('</div> closes <span>');
	});

	it("reports the spec parser's errors, in the element they fall in", () => {
		const found = lint_html(page('<div x="1" x="2"></div>'), true);
		expect(found.map((l) => l.rule)).toContain('parse error duplicate-attribute');
	});

	it("leaves what the app wrote badly on purpose to the app, and a hole's answer is a fragment", () => {
		const found = lint_html(
			'<p data-gen-messy>a<div>b</div></p><ogygia-region><p><div></div></p></ogygia-region>',
			false
		);
		expect(found.map((l) => [l.rule, l.app])).toEqual([
			['<div> inside <p>', true],
			['<div> inside <p>', false]
		]);
	});

	it('reads attribute text with quotes, `>` and unicode in it', () => {
		const tree = source_tree('<div title="a > b" data-x=\'"q"\' data-u="é😀"><p>ok</p></div>');
		expect(tree.unbalanced).toEqual([]);
		expect(tree.roots[0].attr('title')).toBe('a > b');
		expect(tree.roots[0].kids.map((k) => k.tag)).toEqual(['p']);
	});
});

describe('html kept', () => {
	it('finds a block a script put in a paragraph, and passes a good document', async () => {
		const { Window } = await import('happy-dom');
		const w = new Window({ url: 'https://app.test/' });
		w.document.write(page('<p id="p">text</p><div id="ok"><p>fine</p></div>'));
		const doc = w.document as unknown as Document;
		expect(content_model(from_dom(doc.documentElement))).toEqual([]);
		doc.getElementById('p')!.appendChild(doc.createElement('section'));
		expect(content_model(from_dom(doc.documentElement)).map((l) => l.rule)).toEqual([
			'<section> inside <p>'
		]);
	});
});
