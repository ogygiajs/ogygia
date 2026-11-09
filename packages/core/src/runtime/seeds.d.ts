/**
 * THE PAGE SEED on the client — parsed ONCE per document, kept in ONE place.
 *
 * The handle ships `page.data` (and url/params/route/…) as `<script type="application/ogygia-page">`
 * so islands can read `$page`, and a seed REFERENCE in an island's props (`seed-refs.ts`) points into
 * that same tree. Both readers resolve here:
 *   • the LIVE document's seed is `page_state` — the `$app/state` store the shims already read. It is
 *     parsed once (`seed_page_once`, lazily on the first hydrate) and every seed reference resolves
 *     against `page_state.data` — the exact object the islands' `page.data` is, not a second parse.
 *   • a FOREIGN document (the one a navigation fetched) is parsed once per `Document` and remembered
 *     on it: a kept island absorbs the incoming page's props BEFORE the router applies that page's
 *     seed, so its references must resolve against the incoming seed, not the current one. The
 *     navigation's soft-invalidate then applies the SAME parse — never a second one.
 * A parse count of one per document is what `test/browser/seed-single-parse.test.ts` pins; the old
 * two-cache shape (a per-element cache the morph reused across pages) handed a navigated page the
 * previous page's data — the stale-reference regression that test also carries.
 *
 * WIRE FORMATS: a seed or props script carries `data-og-format="json"` when its payload is plain
 * JSON (no custom types, no seed references) — then it is `JSON.parse`d, nothing else. Without the
 * attribute it is devalue text and parses with the revivers the caller hands in. One helper
 * (`parse_sidecar_text`) is the only place that decision is made.
 *
 * After a successful parse the seed's TEXT is blanked (router on, devtools off): the graph lives in
 * `page_state` from here on and nothing reads the script again — 690 KB of text on a CMS page has
 * no second reader, and the morph carries the next page's seed in (already blank, parsed in the
 * navigation's preflight). Devtools keeps the text: its byte ledger reads it. A props SIDECAR is
 * never blanked: a region can read it again — an island moved by its host's snippet adoption
 * disconnects, reconnects and hydrates anew (the island-children shape).
 */
import { parse_sidecar_text } from './wire-format.ts';
import { type PageSnapshot } from '../shims/page-store.svelte.ts';
export declare const PAGE_SEED_SELECTOR = "script[type=\"application/ogygia-page\"]";
export { parse_sidecar_text };
/**
 * The PAGE feature (link/runtime-entry.ts, hydrate phase): what island code sees of its page — the
 * page seed behind `$app/state` / `$app/stores`, the seed references in island props, and, on a
 * Kit-hydrated document, the wait for Kit's own page. Installed only when island code can reach
 * Kit's world (the driver's island-closure walk, failing open on anything it cannot follow): an app
 * whose islands never read their page gets no seed from the server and ships none of this.
 */
export declare function install(): void;
type PageSeed = Partial<Omit<PageSnapshot, 'url'> & {
    url: string | URL;
}>;
/** Test seam: how many page-seed scripts were parsed since boot (one per document is the law). */
export declare function seed_parse_count(): number;
/**
 * The parsed seed of a document that is NOT the live one (a navigation's incoming document): parsed
 * on first ask, remembered on the document. The router asks in its preflight (off the view
 * transition's critical path); the soft-invalidate and any kept island's props absorb reuse it.
 */
export declare function page_seed_of(doc: Document): PageSeed | null;
/**
 * The `data` a seed reference resolves against: the live page store for the live document (seeded
 * on first ask), the once-parsed seed for a foreign one. `undefined` when the document has no seed.
 */
export declare function seed_data_of(doc: Document): unknown;
/** Document-level page seed (one script from ogygiaHandle) — once per document; then any page facts
 *  an answer brought since. Every hydrate calls it, before the island reads `page`. */
export declare function seed_page_once(): void;
/**
 * Soft invalidate: refresh document-level page + remote **seeds** from a fetched HTML document
 * without replacing `<body>`, remounting islands, or clearing live query/live instance maps. The
 * router runs it on every navigation (before the body morph — seeds first, DOM second) and
 * `invalidateAll` runs it alone, so Kit remote `form()` success does not view-transition wipe live
 * island state. It is the ONLY seed writer on a navigation and marks the document seeded, so the
 * next island to wake never re-parses. Does **not** auto-refresh live queries — callers that need
 * that use `.refresh()`, or `submit().updates(q)` with server `requested(q).refreshAll()`.
 */
export declare function apply_soft_invalidate_doc(doc: Document): void;
/**
 * Reset per-document session + SSR remote seeds before a new body connects.
 *
 * Do **not** clear `query_map` / `live_query_map` here — old islands are still mounted, and Kit's
 * LiveQueryProxy throws if its cache entry vanishes mid-render. Instance sweep happens in
 * {@link finish_spa_document} after the swap.
 *
 * `next`: the visit of the page going in, made by its navigation (runtime/session.ts `PageVisit`):
 * from here on it is the page's, and the visit of the page going out ends.
 */
export declare function prepare_spa_document(next?: import('./session.ts').PageVisit): void;
/**
 * After the body swap: old islands have disconnected; new ones have only queued their hydrate.
 * Sweep Kit query/live instance maps so the next page cannot reuse a LiveQuery whose `#start` is
 * already spent (`once`) — that reuse never opens SSE again and leaves "connecting…".
 */
export declare function finish_spa_document(): void;
