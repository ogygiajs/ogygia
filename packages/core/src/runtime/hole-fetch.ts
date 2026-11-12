/**
 * THE ONE NETWORK FETCH OF A HOLE'S HTML. The element's own wake, its `prefetch` warm and `preload()`
 * all fetch a hole through here, so whatever lands in the frame store at its address was read one
 * way: the endpoint's text, the keep-fallback marker on a 204 (`keepFallback()` on the server), or a
 * refusal when the answer is not the region's. An expired capability renews once, and the fresh one
 * is handed to `renewed` (the frame store keeps it for the address). No DOM, no store, no scheduler:
 * the caller decides when it may go out.
 */
import { net } from '@ogygia/machine';
import { KEEP_FALLBACK_HTML } from '../keep-fallback-marker.ts';
import { warn } from '../messages/lazy.ts';
import {
	capability_expired,
	deny_of,
	is_allowed_region_endpoint,
	is_document_answer,
	is_redirected_answer,
	is_same_origin_response,
	RegionAnswerLater,
	RegionAnswerRefused,
	renewal_url,
	retry_after_ms
} from './region-endpoint-url.ts';
import { vouch_region_answer, type VerifiedHtml } from './html-sink.ts';

export type HoleFetch = {
	/** Past the browser cache: the endpoint may answer `private, max-age`, and stale is the whole
	 *  point of revalidating. */
	revalidate?: boolean;
	priority?: 'high' | 'auto' | 'low';
	signal?: AbortSignal;
	/** A renewal answered this fresh capability for the hole. */
	renewed?: (fresh: string) => void;
};

/** A hole's fetch: its request started ({@link start_hole}), its answer read ({@link read_hole}). */
export async function fetch_hole(endpoint: string, opts: HoleFetch = {}): Promise<VerifiedHtml> {
	// (HOLE-TRUST: nothing goes out to another origin, whoever asks: the element, its warm, preload())
	if (!is_allowed_region_endpoint(endpoint)) {
		if (import.meta.env.DEV) warn('region_endpoint_foreign', { endpoint });
		throw new Error('foreign region endpoint');
	}
	return read_hole(endpoint, start_hole(endpoint, opts), opts);
}

/** The request for a hole's HTML (the page's head starts a `load` hole's the same way:
 *  ../early-holes.ts). */
export function start_hole(
	endpoint: string,
	{ revalidate = false, priority = 'auto', signal }: HoleFetch = {}
): Promise<Response> {
	return net.fetch(endpoint, {
		credentials: 'same-origin',
		cache: revalidate ? 'no-store' : 'default',
		priority,
		signal
	} as RequestInit);
}

/** A hole's answer, read: whatever lands at an address is read this one way, whoever started its
 *  request. */
export async function read_hole(
	endpoint: string,
	response: Promise<Response>,
	opts: Pick<HoleFetch, 'signal' | 'renewed'> = {}
): Promise<VerifiedHtml> {
	let res = await response;
	// An EXPIRED capability (its document outlived it in a cache): renew once. The handle re-signs an
	// anonymous hole it minted itself and answers with the hole AND the fresh capability.
	if (res.status === 403 && capability_expired(endpoint)) {
		res = await start_hole(renewal_url(endpoint), { revalidate: true, signal: opts.signal });
		const fresh = res.ok ? res.headers.get('x-ogygia-capability') : null;
		if (fresh && is_allowed_region_endpoint(fresh)) opts.renewed?.(fresh);
	}
	if (!is_same_origin_response(res)) throw new Error('cross-origin redirect');
	// THE ANSWER MUST BE THE REGION'S. ogygia's handle answers a region request in place — a
	// fragment, a 204, an error status — and never redirects; a redirected response, or a body that
	// is a whole document, means a handle in front of `ogygia.handle()` took the request (an auth
	// wall, a locale bounce, a 404 handler) and the browser followed it. Swapping that in put a site's
	// account page — scripts, skeletons, a second header — into every hole of its header for
	// signed-in visitors. Refused: the fallback stands.
	if (is_redirected_answer(res)) throw new RegionAnswerRefused('redirected', res.url);
	// A refused capability is deterministic (its key, its MAC, its id): no retry would differ.
	if (res.status === 403)
		throw new RegionAnswerRefused('forbidden', res.url || endpoint, deny_of(res, endpoint));
	// the visitor's budget is spent: ask again when it says, not inside its window (#959)
	if (res.status === 429) throw new RegionAnswerLater(retry_after_ms(res), res.url || endpoint);
	if (!res.ok) throw new Error(`status ${res.status}`);
	// 204: the hole said keepFallback() — the page's fallback stands, nothing to swap.
	const text = res.status === 204 ? KEEP_FALLBACK_HTML : await res.text();
	if (res.status !== 204 && is_document_answer(text))
		throw new RegionAnswerRefused('document', res.url);
	// (the sink's gate: a same-origin endpoint whose answer stayed same-origin, ./html-sink.ts)
	const html = vouch_region_answer(endpoint, res, text);
	if (html === null) throw new Error('foreign region endpoint');
	return html;
}
