export interface PageSnapshot {
    url: URL;
    params: Record<string, string>;
    route: {
        id: string | null;
    };
    status: number;
    data: Record<string, unknown>;
    form: unknown;
    error: {
        message: string;
    } | null;
    state: Record<string, unknown>;
}
export declare class PageState {
    #private;
    url: URL;
    params: Record<string, string>;
    route: {
        id: string | null;
    };
    status: number;
    data: Record<string, unknown>;
    form: unknown;
    error: {
        message: string;
    } | null;
    state: Record<string, unknown>;
    set(snap: Partial<PageSnapshot> | undefined | null): void;
    reset(): void;
    subscribe(fn: () => void): () => void;
}
export declare const page_state: PageState;
/** Seed from an island's SSR snapshot (pre-hydration / SPA remount). */
export declare function set_page(snap: Partial<PageSnapshot> | undefined | null): void;
/** Reset to location-based fallback between SPA body swaps (clears stale route data). */
export declare function reset_page(): void;
export declare function subscribe_page(fn: () => void): () => void;
export declare function warn_foreign_page_read(expr: string): void;
