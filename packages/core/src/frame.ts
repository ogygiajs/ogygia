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
	 * A stamp of the store's one world (runtime/frame-store.ts `stamp()`): a fetch's is taken when
	 * its request starts, a write from elsewhere takes one when it writes, so a slow response that
	 * started earlier can never overwrite one that started, or landed, later. `write()` drops `v <=`
	 * applied.
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

/** Where a frame stands in its address's order: its request ticket, and its data version if any. */
export type FrameOrder = { v: number; d?: number | undefined };

/** Why an answer is not newer than another: an older request's (by ticket), or older data (by version). */
export type DropWhy = 'older request' | 'older data';

/** The name of the error a joined reservation rejects with when its batch ended without its frame
 *  (runtime/frame-store.ts `release`): the binder's own fetch runs at once (nothing failed — the
 *  batch just did not carry it). */
export const BATCH_MISS = 'OgygiaBatchMiss';

/** Whether a frame wait failed only because its batch did not carry the frame. */
export const is_batch_miss = (err: unknown): boolean =>
	err instanceof Error && err.name === BATCH_MISS;

/**
 * Why `f` is not newer than `than`, or `null` when it is: by data version when both carry one and
 * they differ (the server knows which data is newer, whatever order the answers arrived in), else by
 * request ticket. Anything is newer than nothing. The one ordering of answers at an address: the
 * frame store's `write` asks it, and so does a static live region of the answer it painted itself
 * (runtime/core.ts `#apply_live`).
 */
export function older_by(f: FrameOrder, than: FrameOrder | null): DropWhy | null {
	if (than === null) return null;
	if (f.d !== undefined && than.d !== undefined && f.d !== than.d)
		return f.d > than.d ? null : 'older data';
	return f.v > than.v ? null : 'older request';
}

/** Where `f` stands once applied over `over` (what was shown): its data version, and the later
 *  ticket of the two — newer data under an older ticket keeps the ticket order going. */
export function stands_at(
	over: FrameOrder | null,
	f: FrameOrder
): { v: number; d: number | undefined } {
	return { v: over !== null && over.v > f.v ? over.v : f.v, d: f.d };
}

/** The order a decoded region value's HTML was written at its address with (transport.ts), kept
 *  beside the value: a live tick paints its own HTML unless the store holds this write or a newer
 *  one, by the store's one ordering (runtime/core.ts `#apply_live`). */
const written = new WeakMap<object, FrameOrder>();

/** Transport: `value`'s HTML was written to the frame store at `order`. */
export function mark_written(value: object, order: FrameOrder): void {
	written.set(value, order);
}

/** The order `value`'s HTML was written at, or undefined when it never went through the store. */
export function written_order(value: object): FrameOrder | undefined {
	return written.get(value);
}

/** A capability's own parameters: its expiry, MAC, key fingerprint, lifetime and a renewal flag.
 *  They change per mint; the call they sign does not. */
// static: the capability's own parameter names
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
	return `${path}?${new URLSearchParams(call)}`;
}

/** A path as the browser asks it: a relative one (`./__ogygia__`) resolved against the document,
 *  as the head's early start resolves it (early-holes.ts). The server has no document: as written. */
function endpoint_path(path: string): string {
	if (path.charCodeAt(0) === 47 /* / */ || typeof document === 'undefined') return path;
	return new URL(path, document.baseURI).pathname;
}
