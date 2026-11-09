import type { BeforeNavigateCallback, AfterNavigateCallback } from '../runtime/router.ts';
export declare function goto(url: string | URL, opts?: {
    replaceState?: boolean;
    external?: boolean;
}): Promise<void>;
export declare function invalidate(resource?: unknown): Promise<void>;
export declare function invalidateAll(): Promise<void>;
/**
 * Kit's `refreshAll` (Kit 2.7x, Kit 3), which Kit 3's remote `form()` also calls after a successful
 * submit (through the remote client stub). Island queries live in ogygia's remote cache, not Kit's,
 * so they refresh here on every document; the page's data then refreshes through whoever owns the
 * document. With neither runtime, the queries alone refresh: never a reload.
 */
export declare function refreshAll(): Promise<void>;
export declare function preloadData(url: string | URL): Promise<unknown>;
export declare function preloadCode(url?: string): Promise<void>;
export declare function pushState(url: string | URL, state: unknown): void;
export declare function replaceState(url: string | URL, state: unknown): void;
export declare function disableScrollHandling(): void;
export declare function beforeNavigate(fn: BeforeNavigateCallback): () => void;
export declare function afterNavigate(fn: AfterNavigateCallback): () => void;
export declare function onNavigate(fn: (navigation: unknown) => unknown): () => void;
type SnapshotOptions = {
    id?: string;
    capture: () => unknown;
    restore: (value: never) => void;
    reset?: () => void;
};
export declare function snapshot(options: SnapshotOptions): void;
/** `ogygia/app`'s `bust_page_cache`: drop the SPA router's warmed page HTML (after mutations / auth
 *  changes). A no-op without the router — there is no page cache. */
export declare function bust_page_cache(): void;
export {};
