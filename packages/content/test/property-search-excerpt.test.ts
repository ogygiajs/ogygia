// A search hit's excerpt is rendered with `{@html}`, and its terms are the visitor's query
// (site/search.ts `excerpt_of`). Over generated texts and queries: the only markup in it is `<mark>`
// around text, and taking the marks out gives back the escaped text, whatever the terms are (one
// term can be part of `mark`, of an entity like `&amp;`, or of another term).
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { escapeText } from '@ogygia/core/plugin/utils';
import { excerpt_of } from '../src/site/search.ts';

const piece = fc.oneof(
	fc.constantFrom('mark', 'ma', 'rk', '<', '>', '&', 'amp', 'lt', 'gt', 'quot', '/', ' ', 'a', 'M'),
	fc.string({ maxLength: 4 })
);
const text = fc.array(piece, { maxLength: 30 }).map((p) => p.join(''));
const terms = fc.array(
	fc.array(piece, { minLength: 1, maxLength: 3 }).map((p) => p.join('').toLowerCase().trim()),
	{ maxLength: 4 }
);

describe('search excerpt', () => {
	it('marks only text: no other markup, and without the marks it is the escaped text', () => {
		fc.assert(
			fc.property(text, terms, (t, ts) => {
				const out = excerpt_of(t, ts.filter(Boolean), 1000);
				const bare = out.replaceAll('<mark>', '').replaceAll('</mark>', '');
				expect(bare).toBe(escapeText(t));
				// every mark opens, then closes, with no mark inside another
				expect(/^(?:[^<]|<mark>[^<]*<\/mark>)*$/.test(out), out).toBe(true);
			}),
			{ numRuns: 1000 }
		);
	});
});
