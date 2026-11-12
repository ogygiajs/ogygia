// EVERY REGION RESPONSE SAYS HOW IT MAY BE CACHED (PRELOAD-CACHE, internal/notes/INVARIANTS.md). A
// hole's answer carries its own policy (`no-store`, or `private, max-age` when it opted in), and so
// does an empty `keepFallback()` answer (a 204 is cacheable by default). A refusal or an error is
// `no-store`. Usage: pnpm exec playwright test region-cache-headers
import { test, check } from '@ogygia/tooling/e2e';
import { AMP_ENTITY_G_RE } from '@ogygia/tooling/e2e/re.ts';

const DEFER_ENDPOINT_G_RE = /render="defer"[^>]*?\bendpoint="([^"]+)"/g;
const SIG_RE = /sig=[0-9a-f]+/;

/** Every deferred hole's endpoint on `path`, absolute. */
async function hole_endpoints(base: string, path: string): Promise<string[]> {
	const html = await (await fetch(base + path)).text();
	return [...html.matchAll(DEFER_ENDPOINT_G_RE)].map(
		(m) => new URL(m[1]!.replace(AMP_ENTITY_G_RE, '&'), base + path).href
	);
}

test('a keepFallback() answer (204) carries its hole’s cache policy', async ({ baseURL }) => {
	const answers = await Promise.all(
		(await hole_endpoints(baseURL!, '/lake-kit/')).map(async (url) => {
			const res = await fetch(url, { headers: { 'sec-fetch-site': 'same-origin' } });
			return { status: res.status, cache: res.headers.get('cache-control') };
		})
	);
	const kept = answers.find((a) => a.status === 204);
	check(
		'the page has a hole that answers keepFallback()',
		kept !== undefined,
		JSON.stringify(answers)
	);
	check(
		'its 204 says how it may be cached (no-store, or private)',
		kept?.cache === 'no-store' || (kept?.cache ?? '').startsWith('private'),
		String(kept?.cache)
	);
});

test('a refused or failed region request is no-store', async ({ baseURL }) => {
	const [endpoint] = await hole_endpoints(baseURL!, '/server');
	check('the page has a hole', endpoint !== undefined);
	const forged = await fetch(endpoint!.replace(SIG_RE, `sig=${'0'.repeat(64)}`));
	check('a forged capability is refused (403)', forged.status === 403, String(forged.status));
	check(
		'the 403 is no-store',
		forged.headers.get('cache-control') === 'no-store',
		String(forged.headers.get('cache-control'))
	);
	const put = await fetch(endpoint!, { method: 'PUT' });
	check('a PUT is refused (405)', put.status === 405, String(put.status));
	check(
		'the 405 is no-store',
		put.headers.get('cache-control') === 'no-store',
		String(put.headers.get('cache-control'))
	);
	// (a POST is a batch of holes: one with no list in it is a bad request)
	const batch = await fetch(endpoint!.split('?')[0]!, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: '{"not":"a list"}'
	});
	check('a malformed batch is refused (400)', batch.status === 400, String(batch.status));
	check(
		'the 400 is no-store',
		batch.headers.get('cache-control') === 'no-store',
		String(batch.headers.get('cache-control'))
	);
});
