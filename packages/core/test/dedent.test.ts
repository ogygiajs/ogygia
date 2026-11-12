// `dedent` keeps a block's own indentation and trims its edges; `dedent.inline` writes one line as a
// block: the lines join with nothing between them, so every space is one the author wrote.
import { describe, expect, it } from 'vitest';
import { dedent } from '../src/contract/dedent.ts';

describe('dedent', () => {
	it('strips the common indent, trims blank edges, and puts values in after', () => {
		const block = 'a\n  b';
		expect(dedent`
			first ${1}
			  second
			${block}
		`).toBe(dedent`
			first 1
			  second
			a
			  b
		`);
	});
});

describe('dedent.inline', () => {
	it('joins the lines with nothing between them: a space is written where one is wanted', () => {
		const href = '/x.js';
		expect(dedent.inline`
			<link
			 rel="modulepreload"
			 href="${href}">
		`).toBe('<link rel="modulepreload" href="/x.js">');
	});

	it('keeps a value as it is, newlines and all', () => {
		expect(dedent.inline`
			<p>
				${'a\nb'}
			</p>
		`).toBe('<p>\ta\nb</p>');
	});

	it('one-line JS: each statement ends with `;`, so nothing leans on a newline', () => {
		const code = dedent.inline`
			const a = 1;
			const b = a + 1;
			export { b };
		`;
		expect(code).toBe('const a = 1;const b = a + 1;export { b };');
	});
});
