// ONE SCRIPT-URL CHECK (src/script-url.ts), read as the URL parser reads a scheme. html.ts refuses
// a script URL in a URL attribute with it, and the rewrite restorer refuses one in any attribute
// (packages/rewrite/test/browser/script-url.test.ts runs the same table there).
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { is_script_url } from '../src/script-url.ts';
import { attr, html } from '../src/html.ts';
import { escape_attr } from '../src/escape.ts';
import { parser_says_script, SCRIPT_URL_CASES } from './_fixtures/script-urls.ts';

const NBSP = String.fromCharCode(0xa0);
const BOM = String.fromCharCode(0xfeff);

describe('the script-URL table', () => {
	for (const c of SCRIPT_URL_CASES) {
		it(`${c.name}: ${c.script ? 'script' : 'not script'}, as the URL parser says`, () => {
			expect(parser_says_script(c.value)).toBe(c.script);
			expect(is_script_url(c.value)).toBe(c.script);
		});

		it(`${c.name}: html.ts ${c.script ? 'refuses it' : 'keeps it'} in a URL attribute`, () => {
			const placed = c.script ? 'about:invalid#unsafe' : escape_attr(c.value);
			expect(String(html`<a href="${c.value}">x</a>`)).toBe(`<a href="${placed}">x</a>`);
			expect(String(attr('src', c.value))).toBe(` src="${placed}"`);
			expect(String(attr('title', c.value))).toBe(` title="${escape_attr(c.value)}"`);
		});
	}
});

describe('is_script_url', () => {
	it('agrees with the URL parser on strings made of scheme pieces, controls, spaces and colons', () => {
		const pieces = ['java', 'script', 'vb', 'data', 'JaVa', 'SCRIPT', 'DAT', 'a', 's', 'x', '1'];
		const marks = ['+', '.', ':', '/', '?', '#', ' ', '\t', '\n', '\r', '\u0000', '\u0001'];
		const more = ['\u000b', '\u000c', '\u001f', '\u007f', NBSP, BOM];
		const piece = fc.constantFrom(...pieces, ...marks, ...more);
		fc.assert(
			fc.property(
				fc.array(piece, { maxLength: 8 }).map((p) => p.join('')),
				(s) => {
					expect(is_script_url(s)).toBe(parser_says_script(s));
				}
			),
			{ numRuns: 4000 }
		);
	});

	it('ships as its own source: the text alone gives the same answers', () => {
		// oxlint-disable-next-line typescript/no-implied-eval -- the test proves the function's own source runs with no module scope
		const copy = new Function(`return ${is_script_url.toString()}`)() as typeof is_script_url;
		for (const c of SCRIPT_URL_CASES) expect(copy(c.value)).toBe(c.script);
	});
});
