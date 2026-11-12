// A stored page answers If-None-Match as RFC 9110 §13.1.2 says (#1109): the weak comparison (a
// `W/` etag a compressing CDN made matches the stored strong one), `*` for any stored page, and a
// list read by its grammar (an etag may hold a comma), compared against a reference reader.
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { postrender_response } from '../src/server.ts';
import type { PostrenderEntry } from '../src/types.ts';

const ETAG = '"0123456789abcdef0123456789abcdef"';

function entry(): PostrenderEntry {
	return {
		kind: 'page',
		html: '<html><head></head><body>page</body></html>',
		headers: { 'content-type': 'text/html', etag: ETAG, 'cache-control': 'public, max-age=60' },
		created: 0
	};
}

const ask = (inm: string) =>
	postrender_response(
		entry(),
		'hit',
		new Request('https://app.test/', { headers: { 'if-none-match': inm } })
	).status;

/** RFC 9110: `*`, or a list of `[W/]"opaque"`; true when any opaque tag is the stored one's. */
function reference(inm: string): boolean {
	if (inm.trim() === '*') return true;
	const opaque = ETAG.slice(1, -1);
	const tag = /^\s*(?:W\/)?"([^"]*)"\s*(?:,|$)/;
	let rest = inm;
	while (rest.trim() !== '') {
		const m = tag.exec(rest);
		if (!m) return false;
		if (m[1] === opaque) return true;
		rest = rest.slice(m[0].length);
		while (rest.startsWith(',') || rest.startsWith(' ')) rest = rest.slice(1);
	}
	return false;
}

describe('If-None-Match on a stored page', () => {
	it('a weakened etag, `*`, and the etag in a list all answer 304', () => {
		expect(ask(ETAG)).toBe(304);
		expect(ask(`W/${ETAG}`)).toBe(304);
		expect(ask('*')).toBe(304);
		expect(ask(`"a,b", W/${ETAG}`)).toBe(304);
		expect(ask('"other"')).toBe(200);
		expect(ask(`"x${ETAG.slice(1)}`)).toBe(200);
	});

	it('any list of entity tags: 304 exactly when RFC 9110 says the page matches', () => {
		const opaque = fc.oneof(
			fc.constant(ETAG.slice(1, -1)),
			fc.string({ unit: fc.constantFrom('a', '0', 'f', ',', ' ', 'W', '/', '-'), maxLength: 6 })
		);
		const tag = fc.tuple(fc.boolean(), opaque).map(([weak, o]) => `${weak ? 'W/' : ''}"${o}"`);
		const sep = fc.constantFrom(',', ', ', ' ,', ' , ');
		fc.assert(
			fc.property(fc.array(tag, { minLength: 1, maxLength: 5 }), sep, (tags, s) => {
				const inm = tags.join(s);
				expect(ask(inm) === 304).toBe(reference(inm));
			}),
			{ numRuns: 1000 }
		);
	});
});
