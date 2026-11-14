// The HTML quality oracle (src/html.ts): it finds bad HTML a server sent (by the tree its source
// says, before a parser repairs it) and bad HTML a document holds at rest (a DOM code built), lets
// good HTML pass, and leaves what the app wrote badly on purpose (`data-gen-messy`) to the app.
import { describe, expect, it } from 'vitest';
import {
	content_model,
	error_answer_shown,
	from_dom,
	html_sent,
	lint_html,
	reshape_marks_left,
	source_tree
} from '../src/html.ts';
import type { World } from '../src/world.ts';

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

	it("sets aside a page whose server's hop for it the network tampered with (gen 178)", async () => {
		// (a mounted peer page passes on the peer's bytes: a changed byte on the hop is no bad HTML)
		const hop = (fault: 'tampered' | 'cut' | null) => ({
			id: 2,
			from: 'server-0',
			for: 'tab-1#1',
			method: 'GET',
			url: 'https://peer.test/peer/q0',
			at: 0,
			status: 200,
			cut: fault === 'cut',
			tampered: fault === 'tampered',
			duplicated: false,
			redirected: false
		});
		const world = (fault: 'tampered' | 'cut' | null) =>
			({
				html: [
					{
						from: 'tab-1#1',
						url: 'https://app.test/peer/q0',
						whole: true,
						html: Promise.resolve(page('<ma6n data-gen="peer-page">x</main>'))
					}
				],
				network: { exchanges: [hop(fault)] }
			}) as unknown as World;
		expect(await html_sent(world('tampered'))).toBe(null);
		// (a cut hop is a failure the app must answer well: still judged)
		expect((await html_sent(world('cut')))?.oracle).toBe('html-sent');
		expect((await html_sent(world(null)))?.oracle).toBe('html-sent');
	});

	it("sets aside another document's answer of a peer page the app kept from a tampered hop (gen 195, seed 25)", async () => {
		// (the app keeps a peer's page documents, `cache: { ttl }`: a later request of the same page
		// is answered from the changed copy, with no hop of its own)
		const world = {
			html: [
				{
					from: 'tab-1#6',
					url: 'https://app.test/peer/q0',
					whole: true,
					html: Promise.resolve(page('<ma6n data-gen="peer-page">x</main>'))
				}
			],
			network: {
				exchanges: [
					{
						id: 2,
						from: 'server-1',
						for: 'tab-1#5',
						method: 'GET',
						url: 'https://peer.test/og/fragment/page?path=%2Fq0',
						at: 0,
						status: 200,
						cut: false,
						tampered: true,
						duplicated: false,
						redirected: false
					}
				]
			}
		} as unknown as World;
		expect(await html_sent(world)).toBe(null);
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

	it("finds a region error answer's body in the page, and passes a hole on its fallback (hole-fetch.ts's hole-error-answer-swapped-in)", async () => {
		const { Window } = await import('happy-dom');
		const w = new Window({ url: 'https://app.test/' });
		w.document.write(
			page('<ogygia-region render="defer"><p data-gen-fallback>loading n3…</p></ogygia-region>')
		);
		const doc = w.document as unknown as Document;
		expect(error_answer_shown(doc.documentElement)).toEqual([]);
		doc.querySelector('ogygia-region')!.textContent = 'Region render failed';
		expect(error_answer_shown(doc.documentElement).map((l) => `${l.rule} at ${l.where}`)).toEqual([
			'an error answer shown at html > body > ogygia-region'
		]);
	});

	it("finds a reshape mark the restore left (a stand-in, a mark attribute, a comment mark), and passes a restored document (restore.ts's reshape-stand-in-kept survived without it)", async () => {
		const { Window } = await import('happy-dom');
		const w = new Window({ url: 'https://app.test/' });
		w.document.write(
			page('<div data-gen="plain"><x-gen-box data-n="1"><span>n1</span></x-gen-box></div>')
		);
		const doc = w.document as unknown as Document;
		expect(reshape_marks_left(doc.documentElement)).toEqual([]);
		const box = doc.querySelector('x-gen-box')!;
		box.setAttribute('og-h', '0');
		box.appendChild(doc.createElement('og-as'));
		box.appendChild(doc.createComment('og-c 0.1 t'));
		expect(reshape_marks_left(doc.documentElement).map((l) => `${l.rule} at ${l.where}`)).toEqual([
			'a reshape mark left (og-h) at html > body > div[data-gen=plain] > x-gen-box',
			'a reshape stand-in left (<og-as>) at body > div[data-gen=plain] > x-gen-box > og-as',
			'a reshape mark left (<!--og-c-->) at html > body > div[data-gen=plain] > x-gen-box'
		]);
	});
});
