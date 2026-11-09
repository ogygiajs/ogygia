export { setNested, isNested } from './nested.ts';
/** Mark the current subtree as opaque to Kit — a lake's inside (LakeBoundary). */
export declare function setInLake(): void;
/** True when the subtree is opaque to Kit (a lake's inside, or a held region's render). */
export declare function isInLake(): boolean;
/** Reset the live-snippet mark for the current subtree (an inline island inside a snippet). */
export declare function setInLiveSnippet(value: boolean): void;
/** True inside a live snippet's body (and not under an island it renders inline). */
export declare function isInLiveSnippet(): boolean;
/** Region.svelte marks the subtree of a server island it is rendering inline (nested). */
export declare function setHoleInline(): void;
/** Is this render a server island's component rendering INLINE (nested in an island)? */
export declare function isHoleInline(): boolean;
/**
 * Does Kit hydrate THIS WHOLE DOCUMENT? The leaf page's effective csr is the single fact that decides
 * it, so a `<Region>` reads it directly — no per-host context cascade. When true, every island (a
 * csr=true page's own, a csr=false layout's chrome, a shared component's) degrades to a plain inline
 * component that Kit hydrates. Server: the route is in the build-time csr=true set. Client: Kit
 * shipped its bootstrap. Same fact on both legs → the inline/island choice can never desync at
 * hydrate. (Replaces the old `CSR_TRUE_KEY` marker + `csr=false` reset, which only re-derived this
 * number indirectly through the context cascade.)
 */
export declare function documentIsCsrTrue(error_render?: boolean): boolean;
/**
 * PUBLIC: is the current page an ogygia page (csr=false), as opposed to a csr=true page Kit hydrates
 * whole? The inverse of {@link documentIsCsrTrue}, so it answers on BOTH legs with no requestEvent
 * handling on the caller's side — server reads the request's route against the build-time csr set,
 * client reads Kit's bootstrap. Meant for shared code (a store, a helper) that must branch on which
 * world it runs in. Off-request on the server (a module init, a prerender helper with no page) there
 * is no document to speak of, so it returns `false`.
 */
export declare function isOgygiaPage(): boolean;
/** The same fact from a route id in hand (the handle has the event): is this route's leaf page
 *  csr=true? A build-time answer — never a scan of the rendered document. */
export declare function route_is_csr_true(id: string | null | undefined): boolean;
/** The ERROR-page twin: does Kit hydrate this route's `+error.svelte`? Kit renders an error page
 *  with the layout branch only (the page node — and its `csr = false` — is dropped), so this reads
 *  the layouts' answer; a routeless response (no route matched) is the root layout's. */
export declare function error_route_is_csr_true(id: string | null | undefined): boolean;
/**
 * Claim an INLINE-rendered island's entry for this SSR request — true the first time, so the page
 * stamps one `<meta name="ogygia-kit-island" content="<entry>">` per rendered island, however many
 * instances render. The client wrapper's lazy component module reads the stamp before Kit hydrates
 * (emit.ts `lazy_entry_source`): a stamped island's entry is imported, an unstamped one costs
 * nothing. Client / no-request → false (nothing to stamp there).
 */
export declare function claim_kit_island(entry: string): boolean;
/**
 * Claim stylesheet hrefs for this SSR request, returning only the not-yet-claimed ones. A held
 * region's component is server-picked, so its CSS is on no page stylesheet (Kit links CSS from the
 * route's STATIC import graph — it never reads the rendered page). The region wrapper links it from
 * the render pass instead, via `<svelte:head>`; claiming here dedupes so five `Feature` blocks on a
 * page link their shared sheet once. Client / no-request → [] (SSR already linked them).
 */
export declare function claim_region_css(hrefs: string[]): string[];
/**
 * Claim the single runtime-script slot for this SSR request. An island/server placement emits the
 * runtime bootstrap so it hydrates even with the router off; when the router is on, the handle
 * injects the same script into `<head>` (presence-checked) on pages that have no island to emit it.
 * Client / no-request → false (SSR already emitted).
 */
export declare function claimRuntimeEmit(): boolean;
