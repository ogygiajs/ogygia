import type { HistoryEntry, SpaRouter } from './router.ts';
/**
 * Why a page fetch is happening — sent to the server so it can skip side effects a speculative or
 * restorative fetch must not fire (analytics beacons, "last seen" writes, one-time banners):
 *  • `nav`      — a real, user-driven navigation (default). No purpose header.
 *  • `prefetch` — warmed on hover / press / viewport, BEFORE any intent to visit. Marked so the
 *                 server can treat it as a dry run (htmx's `HX-Preloaded`).
 *  • `history`  — a back/forward restore, re-fetched because we snapshot no DOM (htmx's
 *                 `HX-History-Restore-Request`). The visitor has seen this page already.
 * The header is advisory: a server that ignores it still renders correctly.
 */
export type NavPurpose = 'nav' | 'prefetch' | 'history';
/** The `Accept` a browser sends for a top-level document navigation (Chromium's value). */
export declare const DOCUMENT_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
/** One attribute's value in an open tag's attribute text (our own SSR: `name="value"`, no quotes
 *  inside a value). Null when absent. @internal Exported for unit tests. */
export declare function tag_attr(attrs: string, name: string): string | null;
/** Stable-ish head node identity without serializing full outerHTML when possible. */
export declare function head_node_key(node: Element): string;
/**
 * Head nodes that must survive SPA swaps even when absent from the next SSR head.
 * @internal
 */
export declare function keep_head_node_across_spa(node: Element): boolean;
/**
 * Install a `<style>` into the live document. `cloneNode` from a `DOMParser` tree
 * often fails to register the sheet; recreate with textContent instead.
 * @internal
 */
export declare function install_head_style(source: Element, head?: HTMLHeadElement, before?: Node | null): HTMLStyleElement;
/** Apply STREAMED-page late chunks after an SPA body swap: move each inert
 *  `<template data-og-late>` into its `og-late-slot` (stylesheets hoisted first via the same
 *  keyed head installer, so the swap never paints unstyled). On a full load the inline boot
 *  script in the streamed head does this progressively during parse — this is the swap-path
 *  twin. Islands inside the adopted content are custom elements: they connect and wake alone. */
export declare function apply_late_templates(root: ParentNode): void;
/** A page as a fetch got it: its HTML and the address it belongs to (where the fetch landed, after
 *  the server's redirects; the requested href when there were none). */
export type FetchedPage = {
    html: string;
    url: string;
};
/** Moves the world the cached pages are made in: what is kept goes, and a fetch that started before
 *  the move (a prefetch out when a remote mutation lands) never fills the cache after it with the
 *  page as it was (#208), and a navigation that waited on it fetches again. (No pages yet: none to
 *  put out of date.) */
export declare function bust_page_cache(): void;
/**
 * The page at `href`, as HTML plus the address it belongs to: a server redirect (a Kit `redirect()`
 * in load, a trailing-slash canonicalization) is followed by `fetch` transparently, and
 * `response.url` is its only trace. The landing travels WITH the HTML, through the cache and to the
 * navigation that reads it, so nothing else (a cache clear, another fetch) can take it away.
 */
export declare function fetch_page(href: string, signal?: AbortSignal, purpose?: NavPurpose): Promise<FetchedPage | null>;
export declare function navigate(r: SpaRouter, url: URL, from: URL, { push, pop, type, replace }?: {
    push?: boolean;
    /** the entry a back or forward step is on (./router.ts `RouterHistory`) */
    pop?: HistoryEntry;
    type?: string;
    replace?: boolean;
}, 
/** the router's claim for this navigation (SpaRouter.navigate made it: ./navigation.ts) */
claim?: SpaRouter['nav']['now']): Promise<void>;
/**
 * Soft invalidate: refresh page/remote seeds for the current URL without navigation.
 *
 * Kit's `invalidateAll` re-runs loads in place — it is **not** a navigation (no
 * `beforeNavigate` / `afterNavigate`). Remote `form()` always calls this on success; a
 * full SPA navigate+VT here was wiping live island state. We bust the HTML cache,
 * re-fetch, merge head, and refresh document seeds only — no VT, no body swap, no
 * island remount, no live query-map clear, no auto-refresh of live queries. Islands
 * that need query updates use `.refresh()`, or `submit().updates(q)` with server
 * `requested(q).refreshAll()` (updates alone does not populate response `q`).
 *
 * Its own machine (`soft`, ./soft-refresh.ts, which the boot holds: a page without the router
 * refreshes too) so soft fetches never cancel an in-flight click navigation; a real navigation's
 * commit ends a soft refresh in flight.
 *
 * It refreshes the PAGE ON SCREEN (`on_screen`: the router's, which knows it; the address bar
 * without the router), never the page a navigation is still bringing (#268). The refreshed page is
 * staged like a navigation's (`stage`): fetched and parsed off to the side, merged in one commit,
 * which a navigation that went in first refuses (its commit ended this refresh). A refresh whose
 * devalue fails to load ends, and says so to its caller.
 */
export declare function invalidate_all(on_screen?: URL | null): Promise<void>;
