/**
 * WHAT ONE DOCUMENT COUNTS: its slot ids and the live copies a server-delta navigation may skip.
 * Kit hands one request's code several event objects (the handle's traced copy, the page render's,
 * each load's, a remote call's), all carrying the one `Request`; a held region rendered under any of
 * them lands in the same document as the page's own regions. So the counts are the request's, made
 * on first use and gone with it (test/request-claims-one-request.test.ts, #1209).
 *
 * What a render root writes into its own head (the runtime script, a kit-island stamp, its region
 * sheets) is not counted here: a held region's root keeps only its sheets, so those claims stay with
 * the root that writes them (context.ts).
 *
 * Isomorphic and dependency-light: region-snippet.ts is in the client graph. One global slot, so
 * two module copies (src beside dist) count one document once.
 */
import { slot as shared } from '@ogygia/machine';

/** A document's slot-id sequence: its prefix (a hole answer's region id) and a count per island. */
export type SlotSeq = { prefix: string; n: Map<string, { n: number; tag: string }> };

/** One request's document counts. `null` fields: not asked for yet in this request. */
export type DocumentCounts = {
	slots: SlotSeq | null;
	/** fingerprint → live copies the browser holds that no region of this response took yet */
	known: Map<string, number> | null;
};

const counts = shared<{ by_request: WeakMap<Request, DocumentCounts> }>({
	name: 'ogygia.document-counts',
	version: 1,
	make: () => ({ by_request: new WeakMap() })
});

/** The counts of the request `event` belongs to, or null when it carries none (off-request). */
export function document_counts(event: unknown): DocumentCounts | null {
	const request = (event as { request?: Request } | null | undefined)?.request;
	if (typeof request !== 'object' || request === null) return null;
	let c = counts.by_request.get(request);
	if (c === undefined) counts.by_request.set(request, (c = { slots: null, known: null }));
	return c;
}
