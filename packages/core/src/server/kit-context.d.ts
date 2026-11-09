/**
 * Kit's request context for ogygia's OWN server render roots.
 *
 * Kit's server `$app/state` answers `page.*` from `getContext('__request__').page` — a Svelte
 * context Kit's page render sets on ITS root. Every `svelte/server` `render()` ogygia starts is a
 * fresh root with no such context: the routeless document (`document()`), the inline island render
 * (`region.ts`), the deferred-region endpoint, snippet bodies. A component reading `page.data`
 * during SSR under any of them crashed with "reading 'page' of undefined". Every such root now
 * passes `kit_render_context()`, which rebuilds Kit's shape from the per-request page snapshot
 * (Region.svelte records it; the handle keeps it in the request bag) or, absent that, from the
 * live request via the reader hooks.ts installs.
 *
 * Isomorphic and dependency-free by design: `region.ts` is in the client graph, so nothing here may
 * import Kit's server internals. The reader rides ONE `globalThis` + `Symbol.for` slot — the
 * PAGE-STATE-SINGLETON law (dist entries can double-evaluate a module).
 */
export declare const KIT_REQUEST_CONTEXT = "__request__";
/** Kit's `$app/stores` server side reads `getContext('__svelte__')` — `{ page, navigating, updated }`
 *  stores Kit's page render sets on ITS root (`render.js`). Same gap as `__request__`: a component
 *  using the (deprecated, still everywhere) `$page` store crashed under every ogygia render root. */
export declare const KIT_STORES_CONTEXT = "__svelte__";
/** Kit's `props.page` shape (what `$app/state`'s server getters read). */
export interface KitPage {
    url: URL | undefined;
    params: Record<string, string | undefined>;
    route: {
        id: string | null;
    };
    status: number;
    data: unknown;
    form: unknown;
    error: unknown;
    state: Record<string, unknown>;
}
type Reader = () => KitPage | null;
type EventReader = () => unknown | null;
/** THE PAGE OF A RENDER, as a render root uses it (server/render-page.ts behind it). */
interface RenderPagePort {
    /** Before the root renders: its page ready for the reader. `reads_data` — `true`: this render
     *  reads `page.data`; `false`: it does not; `null`: unknown here (the request's kind decides). */
    ready(reads_data: boolean | null): Promise<void> | void;
    /** After it rendered: what its answer carries of the page it rendered for (`''`: nothing). */
    tail(): string;
    /** A hole minted in this render: the address part naming the page facts it renders from
     *  (`&pv=…`), `''` for a hole whose tree reads no `page.data`. */
    version(hole_id: string): string;
}
/** hooks.ts installs the request-scoped reader (page snapshot + live event). */
export declare function set_kit_page_reader(fn: Reader | null): void;
/** hooks.ts installs the live `RequestEvent` reader — what `requestEvent()` (public, isomorphic)
 *  hands a server island: `locals`, `cookies`, `url`, `request` of the request rendering it. */
export declare function set_kit_event_reader(fn: EventReader | null): void;
/** hooks.ts installs the render-page port: in a request rendering for a page it is not (a hole, a
 *  remote call), that page is looked up once (server/page-facts.ts) so the reader answers from it,
 *  and an answer carries the facts its islands read. */
export declare function set_render_page_port(port: RenderPagePort | null): void;
/**
 * Await before an async render root starts: the page this render belongs to, ready for the reader.
 * Inside a page request, on the client, or for a render that reads no `page.data`: nothing to wait for
 * (`undefined`, no microtask).
 */
export declare function kit_page_ready(reads_data?: boolean | null): Promise<void> | void;
/** Append to a render root's HTML: the page facts its islands read, when it rendered for a page. */
export declare function kit_page_facts_tail(): string;
/** Append to a minted hole endpoint: its page version (server/render-page.ts), or `''`. */
export declare function kit_page_version(hole_id: string): string;
/** The live event the installed reader answers (null off-request / on the client). */
export declare function kit_request_event(): unknown | null;
/** A page no component can crash on: what a render outside any request sees (tests, tools). */
export declare function empty_kit_page(): KitPage;
/** The `context` option for a `svelte/server` `render()` ogygia starts. An explicit `page` (the
 *  document root, built from the router's seed) wins; else the request reader; else empty. Both
 *  of Kit's contexts ride along: `__request__` for `$app/state`, `__svelte__` for `$app/stores`.
 *  The `__request__` entry also carries the live `event` (Kit's own render sets `{ page }` only)
 *  — the channel `requestEvent()` reads, so a server island can see its request without importing
 *  `$app/server` (which Kit's client guard rejects the moment a csr=true page shares the layout). */
export declare function kit_render_context(page?: KitPage, event?: unknown): Map<string, unknown>;
export {};
