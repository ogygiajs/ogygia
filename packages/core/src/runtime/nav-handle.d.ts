import type { AfterNavigateCallback, BeforeNavigateCallback } from './router.ts';
export declare const NAV_HANDLE_KEY: unique symbol;
export type NavHandle = {
    goto(url: string | URL, opts?: {
        replaceState?: boolean;
        external?: boolean;
    }): Promise<void>;
    invalidate(): Promise<void>;
    invalidateAll(): Promise<void>;
    preloadData(url: string | URL): Promise<unknown>;
    preloadCode(url?: string | URL): Promise<void>;
    disableScrollHandling(): void;
    pushState(): void;
    replaceState(): void;
    beforeNavigate(fn: BeforeNavigateCallback): () => void;
    afterNavigate(fn: AfterNavigateCallback): () => void;
    bust_page_cache(): void;
};
/** Feature entry (`mpa-nav`, boot phase): the MPA handle, first — the router's install, later in
 *  the feature order, replaces it. */
export declare function install(): void;
/** Publish the document's navigation handle (the router's replaces the MPA one). */
export declare function publish_nav(handle: NavHandle): void;
/**
 * The handle when the router feature is not in this runtime (`router: false`): the browser owns
 * navigation. Same contract the router's own functions had for that case.
 */
export declare function mpa_nav(): NavHandle;
