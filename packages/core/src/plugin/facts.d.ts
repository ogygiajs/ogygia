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
export interface RequestFacts {
    /** This render MAY be stored and served to others later (a plugin decided so before the render):
     *  the holes it mints get prerender-grade capabilities, and data-source receipts are kept. */
    storable: boolean;
    /** The first reason this render is per-visitor (a flag read, a streamed promise, a personal
     *  cookie or header a plugin observed), named for the dev note — or null. */
    perVisitor: string | null;
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
}
/** This request's facts (made on first touch). */
export declare function facts_of(request: Request): RequestFacts;
/** Core only (hooks.ts): how the running code's Request is found. */
export declare function set_current_request(fn: (() => Request | undefined) | null): void;
/** The Request the running code belongs to, or undefined outside one (the client, a test). */
export declare function current_request(): Request | undefined;
/** The facts of the request the running code belongs to, or null outside one (the client, a test). */
export declare function current_facts(): RequestFacts | null;
/** Name the first reason a render is per-visitor (later reasons do not replace it). */
export declare function mark_per_visitor(facts: RequestFacts, reason: string): void;
