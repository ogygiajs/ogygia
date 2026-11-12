// ─────────────────────────────────────────────────────────────────────────────
// Frame — the one wire unit of the frames architecture (see internal/notes/frames.md).
//
// A region is a call (component + props); the call is the ADDRESS; content travels as frames:
// `{ a, v, html }`. Every delivery channel (defer fetch, streamed parcel, mutation fragment, live
// refresh) produces frames, and frames are only ever WRITTEN to the client frame-store — never
// applied to the DOM directly. Shared by server and client; keep it dependency-free.
// ─────────────────────────────────────────────────────────────────────────────

export type Frame = {
	/** Address — the serialized call that produced this content. */
	a: string;
	/**
	 * Version ticket. Assigned at REQUEST time (not arrival time) by the store, so a slow response
	 * that started earlier can never overwrite one that started later. `write()` drops `v <=` applied.
	 */
	v: number;
	/**
	 * Data version, when the server gave one (`region(C, props, { version })`). It orders frames
	 * first: between two versioned frames the newer data wins, whatever its ticket. Equal versions,
	 * or a frame without one, fall back to the ticket.
	 */
	d?: number;
	/** The content. HTML in, morph out — no component trees over the wire. */
	html: string;
};

/** A capability's own parameters: its expiry, MAC, key fingerprint, lifetime and a renewal flag.
 *  They change per mint; the call they sign does not. */
const CAPABILITY_PARAMS: ReadonlySet<string> = new Set(['exp', 'sig', 'k', 'ttl', 'renew']);
/** An absolute URL's scheme and host: the address is the path it names on its page's origin. */
const ORIGIN_RE = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

/**
 * Address of a region: the CALL that produced it — the endpoint's path and every parameter that says
 * what is asked (a core hole's id, props and page facts; a plugin hole's own, like a peer widget's
 * name and props), whatever the endpoint — NOT the full signed URL. The capability's own parameters
 * vary per mint (time + MAC), so keying on the whole URL would give the same call a different
 * address every request, and a mutation's fresh region could never update a mounted one. Same call
 * ⇒ same address, so single-flight updates land in place and identical twins dedupe; two calls are
 * never one address (#914: a plugin endpoint with no `id` was its bare path, one answer for all).
 * Parameters are sorted and written again, so a renewal that rewrites them is the same address.
 * Test: test/frame-address.test.ts.
 */
export function frameAddress(endpoint: string): string {
	const hash = endpoint.indexOf('#');
	const url = (hash === -1 ? endpoint : endpoint.slice(0, hash)).replace(ORIGIN_RE, '');
	const q = url.indexOf('?');
	const path = endpoint_path(q === -1 ? url : url.slice(0, q));
	if (q === -1) return path;
	const call: [string, string][] = [];
	for (const [k, v] of new URLSearchParams(url.slice(q + 1)))
		if (!CAPABILITY_PARAMS.has(k)) call.push([k, v]);
	call.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
	return path + '?' + new URLSearchParams(call);
}

/** A path as the browser asks it: a relative one (`./__ogygia__`) resolved against the document,
 *  as the head's early start resolves it (early-holes.ts). The server has no document: as written. */
function endpoint_path(path: string): string {
	if (path.charCodeAt(0) === 47 /* / */ || typeof document === 'undefined') return path;
	return new URL(path, document.baseURI).pathname;
}
