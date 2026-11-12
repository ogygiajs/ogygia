// DIFFERENTIAL: the one tag walk (src/wire-markup.ts) every HTML scan of ogygia's stands on. Each
// entry point (`tags`, `next_tag`, `read_tag`, `text_of`, `value_at`, a tag's `attr`) must read what
// the browser's tokenizer reads: generated pages (comments of every form, raw-text elements whose
// text looks like tags, `>` and quotes inside values, any case, valueless and duplicate attributes)
// are read by parse5, and its answer is the truth.
import { expect, it } from 'vitest';
import { elements, fuzz, html_arb, parse_document, start_tags } from '@ogygia/config/html-fuzz';
import { next_tag, read_tag, tags, text_of, value_at } from '../src/wire-markup.ts';

const NAMES = ['meta', 'link', 'script', 'ogygia-region', 'style', 'title', 'textarea'];

const PAGE = html_arb({
	tags: [...NAMES, 'div', 'template', 'noscript', 'xmp', 'p'],
	// (and names past ASCII, which the browser keeps as written: it lower-cases ASCII only, #1115.
	// `ı` upper-cases to an ASCII `I`, `ä` to `Ä`)
	attrs: [
		'name',
		'content',
		'rel',
		'href',
		'entry',
		'data-ogygia-runtime',
		'data-x',
		'data-äsrc',
		'ıd'
	],
	values: ['ogygia-router', 'stylesheet', '/a.css', './_app/x.js'],
	texts: [
		'<meta name="ogygia-router">',
		'<ogygia-region entry="/x.js">',
		'</script>',
		'<!--<script>'
	]
});

const view = (t: { start: number; end: number; attrs: Map<string, string> }) => ({
	start: t.start,
	end: t.end,
	attrs: t.attrs
});

it('tags() and next_tag() find exactly the start tags the browser reads, with their attributes as written', () => {
	fuzz(
		PAGE,
		(html) => {
			const truth = start_tags(html);
			for (const name of NAMES) {
				const want = truth.filter((t) => t.name === name).map(view);
				expect([...tags(html, name)].map(view), `tags ${name} in ${html}`).toEqual(want);
				const looped = [];
				for (let t = next_tag(html, name, 0); t !== null; t = next_tag(html, name, t.next))
					looped.push(view(t));
				expect(looped, `next_tag ${name} in ${html}`).toEqual(want);
			}
		},
		{ runs: 500 }
	);
});

it('read_tag, attr() and value_at read each tag the browser reads as it does', () => {
	fuzz(PAGE, (html) => {
		for (const truth of start_tags(html)) {
			const t = read_tag(html, truth.start, truth.start + 1 + truth.name.length);
			expect(t && view(t), html).toEqual(view(truth));
			for (const [name, value] of truth.attrs) {
				expect(t!.attr(name), `${name} in ${html}`).toBe(value);
				const at = value_at(html, t!, truth.name, name);
				if (at !== -1) expect(html.slice(at, at + value.length), html).toBe(value);
			}
			expect(t!.attr('absent-attr')).toBeUndefined();
		}
	});
});

it('text_of reads a raw-text element’s text as the browser does', () => {
	fuzz(PAGE, (html) => {
		// (script and style text is raw: the DOM's text is the source's; an element whose end tag
		// never comes has text to the end, where text_of answers null)
		const raw = elements(parse_document(html)).filter(
			(e) => (e.name === 'script' || e.name === 'style') && e.ns === 'html' && e.start_tag
		);
		for (const e of raw) {
			const t = read_tag(html, e.start_tag!.start, e.start_tag!.start + 1 + e.name.length)!;
			const text = text_of(html, t, e.name);
			if (text === null) expect(html.slice(e.start_tag!.end), html).toBe(e.text);
			else expect(text, html).toBe(e.text);
		}
	});
});
