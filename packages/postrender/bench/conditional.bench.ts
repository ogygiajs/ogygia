// A stored page's revalidation (server.ts postrender_response): a browser or CDN asks with
// If-None-Match, a list of entity tags (weakened by a compressing edge), and the page answers 304
// when one matches, compared as RFC 9110 says.
import { bench } from '@bench/heisenbench/bench';
import { postrender_response } from '../src/server.ts';
import type { PostrenderEntry } from '../src/types.ts';

const ETAG = '"0123456789abcdef0123456789abcdef"';

const entry: PostrenderEntry = {
	kind: 'page',
	html: '<html><head></head><body>page</body></html>',
	headers: { 'content-type': 'text/html', etag: ETAG },
	created: 0
};

/** `n` other entity tags, then the stored one, weakened. */
const list = (n: number) =>
	[
		...Array.from({ length: n }, (_, i) => `W/"${i.toString(16).padStart(32, '0')}"`),
		`W/${ETAG}`
	].join(', ');

bench(
	'a stored page revalidated: If-None-Match read as a list of entity tags, weakly compared',
	({ request }) => postrender_response(entry, 'hit', request).status,
	{
		setup: () => ({
			request: new Request('https://app.test/', { headers: { 'if-none-match': list(8) } })
		}),
		scale: (_ctx, k) => ({
			request: new Request('https://app.test/', { headers: { 'if-none-match': list(8 * k) } })
		})
	}
);
