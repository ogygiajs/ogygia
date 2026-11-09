import { type Navigation } from './navigation.ts';
/**
 * The `<a>` a pointer event is about — through SHADOW ROOTS. A click inside a web component's
 * shadow tree (a web component such as `<x-link>`, `<x-button href>`, a breadcrumb item)
 * reaches the document with `event.target` retargeted to the host, so `target.closest('a')` finds
 * nothing and the browser navigates natively — a full reload instead of a body swap. The composed
 * path still holds the real anchor; Kit's own router reads it the same way.
 */
export declare function anchor_of(event: Event): HTMLAnchorElement | null;
export declare const push_state: (state: unknown, url: string) => void;
export declare const replace_state: (state: unknown, url?: string) => void;
/** Resolved navigation target (URL + Kit-shaped stubs for params/route). */
export interface NavTarget {
    url: URL;
    params: Record<string, string>;
    route: {
        id: string | null;
    };
}
/** Payload for {@link beforeNavigate} callbacks. */
export interface BeforeNavigation {
    from: NavTarget;
    to: NavTarget;
    type: string;
    cancel: () => void;
    willUnload: boolean;
}
/** Payload for {@link afterNavigate} callbacks. */
export interface AfterNavigation {
    from: NavTarget | null;
    to: NavTarget;
    type: string;
    willUnload: boolean;
}
/** Callback registered with {@link beforeNavigate}. */
export type BeforeNavigateCallback = (nav: BeforeNavigation) => void;
/** Callback registered with {@link afterNavigate}. */
export type AfterNavigateCallback = (nav: AfterNavigation) => void;
/** Same document = pathname + search. Hash is not part of document identity. */
export declare function same_document(a: URL, b: URL): boolean;
/**
 * Kit's `data-sveltekit-reload` grammar, nearest ancestor wins (Kit walks up from the anchor and
 * takes the first element that carries the attribute): `""` / `"true"` = full-page load, `"off"` /
 * `"false"` = SPA navigation — so a layout can opt a whole subtree OUT of the SPA and a child
 * subtree can opt back IN. Presence alone used to force a reload, which turned a
 * `data-sveltekit-reload="false"` subtree (an app's way of saying "SPA here") into full loads.
 * Across shadow roots: a link a web component renders in its own shadow tree sits under the page's
 * markup all the same (a card's link in a full-load subtree was swapped in place).
 */
export declare function reload_opt_out(anchor: Element): boolean;
/**
 * What a click on a link to the CURRENT document means. `hash`: a fragment jump — the browser's.
 * `swallow`: the navigation to this exact address is already in flight — a web-component link
 * (`<x-link>`, `<x-button href>`) handles the click itself and re-dispatches one on
 * its inner anchor; the router pushed the URL for the first click, so the second one looks like a
 * link to the current page — left to the browser it would RELOAD the document mid-swap. `refresh`:
 * a real click on a link to the page one is on — re-render in place (Kit re-runs the navigation
 * too; a full reload is never the answer for a same-origin link).
 */
export declare function same_document_link(url: URL, current: URL, in_flight: string | null): 'hash' | 'swallow' | 'refresh';
export declare function document_key(url: URL): string;
/** Instant scroll to a hash target (or top). Ignores CSS `scroll-behavior: smooth`. */
export declare function jump_to_hash(hash: string): void;
/** One entry of the visitor's history the router made (or took over): its address, and where the
 *  page was when the visitor left it: its scroll, and the id of the element that had focus. */
export interface HistoryEntry {
    readonly id: string;
    url: URL;
    scroll: {
        x: number;
        y: number;
    } | null;
    focus: string | null;
}
/** How a navigation writes history: a new entry, the current one's address, or the entry a back or
 *  forward step is already on. */
export type HistoryMove = 'push' | 'replace' | 'pop';
export declare class RouterHistory {
    #private;
    /** The entry of the page on screen. */
    get current(): HistoryEntry;
    /** Takes over the entry the browser is on as the router starts: its state names it now. */
    start(): void;
    /** The entry a history state names: this model's, `'foreign'` (another document's), or null
     *  (no id: an entry the browser or the app made). */
    find(state: unknown): HistoryEntry | 'foreign' | null;
    /** The page on screen is being left: keep where it is. */
    leave(): void;
    /** A page goes in at `url` (the browser's entry is written now). `push`: a new entry after the
     *  one left; `replace`: the current one at a new address; `pop`: `to`, the entry a back or
     *  forward step is on. */
    commit(url: URL, move: HistoryMove, to?: HistoryEntry): HistoryEntry;
    /** The entry the browser stepped to, which no id names: this model's from now on. */
    adopt(url: URL): HistoryEntry;
}
export declare class SpaRouter {
    #private;
    /**
     * THE NAVIGATION, one machine (./navigation.ts): idle, claimed (the click, while the navigation
     * chunk loads), loading (its fetch through its swap), settling (swapped: the last steps run). A
     * new click is a new visit, so whatever the old one still had in flight sees it is not current
     * (`nav.now !== mine`) and stops, and its fetch is aborted. It was three fields kept by hand; two
     * clicks during the first chunk load once held the same generation and the last one was lost.
     */
    readonly nav: Navigation;
    /** href of the router's navigation in flight (claimed or loading; cleared once it applied,
     *  ended, or went to the browser: `hand_off`) */
    get nav_target(): string | null;
    /** The visitor's history, as the router keeps it (`RouterHistory`): the rest is read from it. */
    readonly history: RouterHistory;
    /**
     * Full URL of the page on screen: its history entry's. `navigate()` uses this as its `from`
     * instead of `location.href`, because on a `popstate` (back/forward) the browser has ALREADY
     * changed `location` to the target — so `location.href` would equal the target and the
     * same-document guard would wrongly bail into the hash-only branch, never swapping the body
     * (browser back left the old page's DOM in place). POP-FROM.
     */
    get current_url(): URL;
    /** pathname+search of the page on screen (hash ignored). */
    get doc_key(): string;
    beforeNavigate(fn: BeforeNavigateCallback): () => boolean;
    afterNavigate(fn: AfterNavigateCallback): () => boolean;
    /**
     * Keep the document in the DOM: the navigation in flight (if any) never swaps. The document key
     * moves only when a swap commits, so every "same document" decision is about the page still on
     * screen — and one made while the next page loads (back to this page, a link to it) must cancel
     * that load, or it lands under this page's address (back pressed before `/plain` finished
     * swapping left the URL on the old page and `/plain` in the DOM).
     */
    supersede(): void;
    /**
     * GIVE `visit`'s NAVIGATION TO THE BROWSER — a page the router will not render (a csr=true Kit
     * page, a page that is not ogygia's, another build), or one it could not fetch or load its code
     * for: a document navigation to `url`, from the document on screen (`from`).
     *
     * It ENDS the visit, on every path: from here on the navigation is the browser's, never the
     * router's in flight. The browser may well keep this page on screen (a file download, a 204, a
     * body it does not show), and then nothing else ends it: left `loading`, every later click on the
     * link joined it and was swallowed (#266). A visit already left (a newer click took over, or back
     * to the page on screen) hands nothing off: the browser never goes where the visitor no longer is.
     *
     * The router writes an entry only when a page goes in, so a click handed off has none: the
     * browser's navigation is a new entry of its own, and one it keeps the page on screen for adds
     * none (#297). A back or forward step is already on its entry, and a refresh on the one on
     * screen: the browser's navigation REPLACES it, so its document holds the entry alone, never
     * shares it with the router's page (back from a csr=true page then loads the router page, #259).
     * So does a commit that failed after it wrote the entry (the address is already `url`).
     *
     * `error`: the navigation failed part way (its devalue did not load, its swap threw, #276). It
     * is said (the page's error handler, as an uncaught throw would be), and the browser loads the
     * page whole.
     */
    hand_off(url: URL, visit: Navigation['now'], move: HistoryMove, error?: unknown): void;
    bust_page_cache(): void;
    /** The page at `href`, or `null` when there is none to have: the fetch failed (./router-nav.ts
     *  `fetch_page`), or the navigation code itself did not load. The prefetches (a hover, a
     *  viewport link, `preloadData`) start it and never wait on it: a rejection here was uncaught. */
    fetch_page(href: string, signal?: AbortSignal, purpose?: 'nav' | 'prefetch' | 'history'): Promise<import('./router-nav.ts').FetchedPage | null>;
    navigate(url: URL, opts?: {
        push?: boolean;
        /** the entry a back or forward step is on */
        pop?: HistoryEntry;
        type?: string;
        replace?: boolean;
    }): Promise<void>;
    goto(url: string | URL, opts?: {
        replaceState?: boolean;
        external?: boolean;
    }): Promise<void>;
    invalidateAll(): Promise<void>;
    invalidate(): Promise<void>;
    preloadData(url: string | URL): Promise<{
        type: string;
        status: number;
        data: {};
    }>;
    preloadCode(): Promise<void>;
    disableScrollHandling(): void;
    pushState(): void;
    replaceState(): void;
    start(): void;
    run_before(from: URL, to: URL, type: string): boolean;
    run_after(from: URL, to: URL, type: string): void;
    /**
     * After start + every navigation, in IDLE: eager links warm now; viewport links get observed.
     * Only anchors under a preload-marked element are read — an unmarked anchor has no trigger. Idle,
     * because the scan competes with the freshly swapped page's own islands for the main thread and
     * a warm is speculation by definition. The scan and its observer are the page visit's
     * (./session.ts `PageVisit`): the next page's swap disconnects it, so the anchors of a page left
     * behind are never held, and a scan still waiting for idle time when its page is left never runs.
     */
    scan_preload_links(): void;
}
/**
 * Register a callback before a client-side navigation.
 * Call `nav.cancel()` to abort. Returns an unsubscribe function. Inside a component, prefer the
 * `$app/navigation` / `ogygia/app` export, which unsubscribes on destroy.
 */
export declare function beforeNavigate(fn: BeforeNavigateCallback): () => boolean;
/**
 * Register a callback after a successful client-side navigation.
 * Returns an unsubscribe function. Inside a component, prefer the `$app/navigation` /
 * `ogygia/app` export, which unsubscribes on destroy.
 */
export declare function afterNavigate(fn: AfterNavigateCallback): () => boolean;
/** Drop all warmed page HTML (call after mutations / auth changes). */
export declare function bust_page_cache(): void;
/**
 * Programmatic same-origin navigation. Mirrors Kit's `goto()` subset.
 * @param url - Absolute or relative URL (http(s) only).
 * @param opts.replaceState - Replace the current history entry instead of pushing.
 */
export declare function goto(url: string | URL, opts?: {
    replaceState?: boolean;
}): Promise<void>;
/**
 * Soft-refresh the current URL's document seeds + head (not a navigation).
 * Busts the SPA HTML cache so the next real route change is fresh. Coarser than
 * Kit's dependency-scoped invalidate — see `invalidate_all` in ./router-nav.ts.
 */
export declare function invalidateAll(): Promise<void>;
/**
 * Refresh navigation data. Without Kit's client we cannot invalidate a single
 * dependency, so this refreshes everything (same as {@link invalidateAll}).
 */
export declare function invalidate(): Promise<void>;
/**
 * Warm the next page: fetch it into the swap-readable HTML cache (+ its island modules) — this is
 * what makes the eventual click instant, and no browser cache can feed a body swap. (Router OFF —
 * the browser owns navigation — is the MPA navigation handle's Speculation Rules hint, not this
 * module: ./nav-handle.ts. This module only loads with the router feature.)
 */
export declare function preloadData(url: string | URL): Promise<{
    type: string;
    status: number;
    data: {};
}>;
/** No-op with the router on: page “code” arrives with the HTML body swap (+ island chunks on
 *  connect). Router OFF is the MPA navigation handle's prefetch hint (./nav-handle.ts). */
export declare function preloadCode(_url?: string | URL): Promise<void>;
/** Skip scroll restoration / scroll-to-top on the next client-side navigation. */
export declare function disableScrollHandling(): void;
/**
 * Shallow routing is not supported without Kit's client runtime.
 * @throws Always — use full navigations instead.
 */
export declare function pushState(): void;
/**
 * Shallow routing is not supported without Kit's client runtime.
 * @throws Always — use full navigations instead.
 */
export declare function replaceState(): void;
/**
 * Install click/popstate listeners and start SPA navigation.
 * Invoked by the runtime once the module loads (handle-injected on every ogygia page, or by an island).
 * @internal
 */
export declare function startRouter(): void;
/**
 * Feature entry: start the SPA router once the DOM is ready, but only when the page carries
 * `<meta name="ogygia-router">` (the handle injects it globally unless `ogygia({ router: false })`)
 * and Kit is not already booting it.
 */
export declare function install(): void;
