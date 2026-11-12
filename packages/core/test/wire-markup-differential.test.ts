// DIFFERENTIAL: `tags()` (src/wire-markup.ts) is the one tag reader every HTML scan of ogygia's
// stands on. It must find exactly the start tags the browser's tokenizer reads, at the same spans,
// with the same attributes: generated pages (comments of every form, raw-text elements whose text
// looks like tags, `>` and quotes inside values, any case, valueless and duplicate attributes) are
// read by parse5, and its answer is the truth.
import { expect, it } from 'vitest';
import { fuzz, html_arb, start_tags } from '@ogygia/config/html-fuzz';
import { tags } from '../src/wire-markup.ts';

const NAMES = ['meta', 'link', 'script', 'ogygia-region', 'style', 'title'];

const PAGE = html_arb({
	tags: [...NAMES, 'div', 'textarea', 'template', 'noscript', 'xmp', 'p'],
	attrs: ['name', 'content', 'rel', 'href', 'entry', 'data-ogygia-runtime', 'data-x'],
	values: ['ogygia-router', 'stylesheet', '/a.css', './_app/x.js'],
	texts: ['<meta name="ogygia-router">', '<ogygia-region entry="/x.js">', '</script>']
});

const found = (html: string, name: string) =>
	[...tags(html, name)].map((t) => ({ start: t.start, end: t.end, attrs: t.attrs }));

it('tags() finds exactly the start tags the browser reads, with their attributes as written', () => {
	fuzz(
		PAGE,
		(html) => {
			const truth = start_tags(html);
			for (const name of NAMES) {
				const want = truth
					.filter((t) => t.name === name)
					.map((t) => ({ start: t.start, end: t.end, attrs: t.attrs }));
				expect(found(html, name), `${name} in ${html}`).toEqual(want);
			}
		},
		{ runs: 500 }
	);
});
