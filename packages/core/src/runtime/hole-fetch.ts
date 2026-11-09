/**
 * THE ONE NETWORK FETCH OF A HOLE'S HTML. The element's own wake, its `prefetch` warm and `preload()`
 * all fetch a hole through here, so whatever lands in the frame store at its address was read one
 * way: the endpoint's text, the keep-fallback marker on a 204 (`keepFallback()` on the server), or a
 * refusal when the answer is not the region's. An expired capability renews once, and the fresh one
 * is handed to `renewed` (the frame store keeps it for the address). No DOM, no store, no scheduler:
 * the caller decides when it may go out.
 */
import { KEEP_FALLBACK_HTML } from '../keep-fallback-marker.ts';
import {
	capability_expired,
	deny_of,
	is_allowed_region_endpoint,
	is_document_answer,
	is_redirected_answer,
	is_same_origin_response,
	RegionAnswerRefused,
	renewal_url
} from './region-endpoint-url.ts';

export type HoleFetch = {
	/** Past the browser cache: the endpoint may answer `private, max-age`, and stale is the whole
	 *  point of revalidating. */
	revalidate?: boolean;
	priority?: 'high' | 'auto' | 'low';
	signal?: AbortSignal;
	/** A renewal answered this fresh capability for the hole. */
	renewed?: (fresh: string) => void;
	/** The request the page's head already started for this endpoint (../early-holes.ts), read in
	 *  place of a new one. Started without a signal: leaving cancels its download here. */
	early?: Promise<Response>;
};

export async function fetch_hole(endpoint: string, opts: HoleFetch = {}): Promise<string> {
	const { revalidate = false, priority = 'auto', signal } = opts;
	let res = await (opts.early ??
		fetch(endpoint, {
			credentials: 'same-origin',
			cache: revalidate ? 'no-store' : 'default',
			priority,
			signal
		} as RequestInit));
	if (opts.early && signal?.aborted) {
		void res.body?.cancel().catch(() => {}); // ok: a download nobody waits for, dropped
		throw signal.reason;
	}
	// An EXPIRED capability (its document outlived it in a cache): renew once. The handle re-signs an
	// anonymous hole it minted itself and answers with the hole AND the fresh capability.
	if (res.status === 403 && capability_expired(endpoint)) {
		res = await fetch(renewal_url(endpoint), {
			credentials: 'same-origin',
			cache: 'no-store',
			signal
		});
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
	if (!res.ok) throw new Error('status ' + res.status);
	// 204: the hole said keepFallback() — the page's fallback stands, nothing to swap.
	if (res.status === 204) return KEEP_FALLBACK_HTML;
	const text = await res.text();
	if (is_document_answer(text)) throw new RegionAnswerRefused('document', res.url);
	return text;
}
