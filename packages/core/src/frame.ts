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

/** Where a frame stands in its address's order: its request ticket, and its data version if any. */
export type FrameOrder = { v: number; d?: number | undefined };

/** Why an answer is not newer than another: an older request's (by ticket), or older data (by version). */
export type DropWhy = 'older request' | 'older data';

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

/**
 * Address of a region: the CALL that produced it — region id + serialized props — NOT the full
 * signed URL. Critically, `exp` and `sig` vary per request (they're time + MAC), so keying on the
 * whole URL would give the same call a different address every request, and a mutation's fresh
 * region could never update a mounted one. Keying on `id|props` makes the address stable across
 * requests: same component + same props ⇒ same address, so single-flight updates land in place and
 * identical twins dedupe. Falls back to the raw endpoint when there's no query to parse.
 */
export function frameAddress(endpoint: string): string {
	const q = endpoint.indexOf('?');
	if (q === -1) return endpoint;
	const params = new URLSearchParams(endpoint.slice(q + 1));
	const id = params.get('id');
	const props = params.get('props');
	// the page facts a hole renders from name it too (server/render-page.ts): new facts, new address
	const pv = params.get('pv');
	return id != null ? `${id}|${props ?? ''}${pv ? '|' + pv : ''}` : endpoint.slice(0, q);
}
