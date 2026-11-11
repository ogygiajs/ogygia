/**
 * FACTS — per-request shared state. A fact is filled by whoever learns it and read by whoever needs
 * it; neither side imports the other. Keyed by the `Request` (every request has its own record, made
 * on first touch, gone with the request), so a plugin's own code can reach them outside a hook too:
 * a `flag()` read during the render holds its request.
 *
 * Plugins add their own facts by declaration merging:
 *
 *   declare module 'ogygia/plugin' { interface RequestFacts { myThing?: string } }
 *
 * One global slot, not module scope: a plugin package and core can end up as two module instances
 * of this file (src beside dist, a dual install), and a fact written through one must be read
 * through the other.
 */
import { note_visitor_read, read_set, type Reads } from './reads.ts';

export interface RequestFacts {
	/** This render MAY be stored and served to others later (a plugin decided so before the render):
	 *  the holes it mints get prerender-grade capabilities, and data-source receipts are kept. */
	storable: boolean;
	/** What this request's render read that is not the same for every visitor (a flag, a streamed
	 *  promise, a personal cookie or header): `reads.perVisitor` names the first, or is null. */
	readonly reads: Reads;
	/** The page streams load promises after the document. */
	streamed: boolean;
	/** The response belongs to one browser (devtools switched on for it): never store or share it. */
	private: boolean;
	/** An app transform renders this router-fetched page as an ANSWER, a form a store keyed by path
	 *  does not hold. */
	answerForm: boolean;
	/** Data-source receipts (`s:<id>:<fp>`) the render filed — collected only once a plugin asks for
	 *  them by setting a list here (a storable render's reverse index, a fragment's provenance). */
	sources: string[] | null;
	/** Every flag decided for this request (name → variant): federation carries them as claims. */
	assignments: Record<string, string>;
	/** Origins island code on this page may load from, learned by the render (a peer fragment's own
	 *  runtime origin): written on the runtime's script with the plugins' (`codeOrigins`). */
	codeOrigins?: string[];
}

interface FactsSlot {
	by_request: WeakMap<Request, RequestFacts>;
	/** core (hooks.ts): the Request of the code running now, through Kit's request store */
	current: (() => Request | undefined) | null;
}
const slot: FactsSlot = ((globalThis as Record<symbol, FactsSlot | undefined>)[
	Symbol.for('ogygia.facts.v3')
] ??= {
	by_request: new WeakMap(),
	current: null
});

/** This request's facts (made on first touch). */
export function facts_of(request: Request): RequestFacts {
	let facts = slot.by_request.get(request);
	if (!facts)
		slot.by_request.set(
			request,
			(facts = {
				storable: false,
				reads: read_set(),
				streamed: false,
				private: false,
				answerForm: false,
				sources: null,
				assignments: {}
			})
		);
	return facts;
}

/** Core only (hooks.ts): how the running code's Request is found. */
export function set_current_request(fn: (() => Request | undefined) | null): void {
	slot.current = fn;
}

/** The Request the running code belongs to, or undefined outside one (the client, a test). */
export function current_request(): Request | undefined {
	try {
		return slot.current?.();
	} catch {
		return undefined;
	}
}

/** The facts of the request the running code belongs to, or null outside one (the client, a test). */
export function current_facts(): RequestFacts | null {
	const request = current_request();
	return request ? facts_of(request) : null;
}

/** A per-visitor read by `request`'s code (the first reason names it): into the read set of the
 *  work running now, and the request's. */
export function note_per_visitor(request: Request, reason: string): void {
	note_visitor_read(facts_of(request).reads, reason);
}
