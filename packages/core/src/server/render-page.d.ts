/**
 * THE PAGE OF A RENDER — one model for every server render ogygia starts
 * (internal/notes/region-page-context.md).
 *
 * A region always belongs to a page. Which page, and where its facts come from, depends on the
 * request the render runs in — three venues, one answer shape (Kit's `page`):
 *
 *  - IN THE PAGE: a Kit page request. Its render recorded the page (Region.svelte, the routeless
 *    document root): that snapshot IS the page, the live event fills what it lacks.
 *  - FOR A PAGE: a request rendering on behalf of a page it is not — the islands endpoint (a hole, a
 *    batch) or a remote function call (a `query` / `command` rendering a region). Its page is the
 *    same-origin `Referer` (the runtime's and Kit's client fetches send the full URL same-origin).
 *    Identity (url) from there; `page.data`, `params`, `route` from Kit's data request for that page,
 *    looked up once per request and only for a render that reads `page.data` (server/page-facts.ts).
 *  - ITS OWN: anything else (no Referer, cross-origin, an ESI subrequest, a `+server.ts`): the
 *    request's own url, params and route; no `page.data`.
 *
 * Nothing here trusts the browser for data: a Referer only names a page; its facts are the server's,
 * for this visitor, now.
 */
import type { RequestEvent } from '@sveltejs/kit';
import type { KitPage } from './kit-context.ts';
import type { PageSnapshot } from '../page-seed-registry.ts';
import { type SeedAsk } from './seed-shape.ts';
type Transport = Record<string, {
    decode: (v: unknown) => unknown;
    encode: (v: unknown) => unknown;
}>;
/** Where a dev warning goes (the handle's setting). */
export declare function configure_render_page(o: {
    warn: ((message: string) => void) | null;
}): void;
/** A request rendering on behalf of a page it is not: the islands endpoint or a remote call. */
export declare function renders_for_a_page(event: RequestEvent): boolean;
/** The page a request renders for: the same-origin Referer of a request rendering for a page, else
 *  the request's own url. */
export declare function page_url_of(event: RequestEvent): URL;
/**
 * Before an async render root starts: in a request rendering FOR a page, that page's facts, looked
 * up once. `reads_data`: does this render read `page.data` (`null`: unknown here — a remote call
 * looks up, a hole relies on its tree's build answer). The venue is the request's kind, as Kit and
 * the islands endpoint name it — never whether some per-request state happens to exist.
 */
export declare function prepare_render_page(event: RequestEvent | undefined, transport: Transport | undefined, reads_data: boolean | null): Promise<void> | void;
/**
 * The page a render sees. `snapshot`: what this request's page render recorded, if anything. `null`
 * when there is neither a snapshot nor a request (a render off-request: the caller's empty page).
 */
export declare function render_page(snapshot: PageSnapshot | undefined, event: RequestEvent | undefined): KitPage | null;
/**
 * A HOLE'S ADDRESS NAMES ITS PAGE: the call (id + props) and the page facts its tree renders from.
 * A region refreshed after the page's data changed (a locale saved) re-mints its holes with a new
 * version, so each fetches its new answer; a refresh that changed nothing keeps the address and the
 * answer it has. The version of this request's page: its looked-up facts (a render for a page) or
 * its recorded snapshot (in the page) — hashed once per request; `''` when there is no data.
 */
export declare function render_page_version(event: RequestEvent | undefined, snapshot: PageSnapshot | undefined): string;
/**
 * An island rendering FOR a page asks for the `page.data` keys its client reads (Region.svelte's
 * record, the build's answer): kept for the answer's facts. `true` when the request renders for a
 * page — the ask is this model's, never a page render's snapshot.
 */
export declare function note_render_page_ask(event: RequestEvent, seed: SeedAsk): boolean;
/**
 * ONE PAGE, NOT TWO: what an answer rendered FOR a page carries — the looked-up `page.data` keys its
 * islands read, so they hydrate against the values their HTML was rendered from (the runtime merges
 * them into the page store: seeds.ts). `''` when no island in it reads the page, the page was not
 * looked up, or a value does not serialize (a still-streaming promise).
 */
export declare function render_page_facts_script(event: RequestEvent | undefined, transport: Transport | undefined): string;
export {};
