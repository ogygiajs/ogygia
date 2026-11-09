import type { RegionValue } from './region.ts';
export interface DocumentOptions {
    /** `<title>` — used only when no component set one via `<svelte:head>` (the component wins). */
    title?: string;
    /** Raw extra head HTML (meta tags, fonts, …), appended after the rendered head. */
    head?: string;
    /** HTTP status (default 200). */
    status?: number;
    /** Extra/override response headers. `content-type` and `cache-control: no-store` are the defaults
     *  (under an eligible FREEZE request the cache-control default is left to the verdict). */
    headers?: HeadersInit;
    /** `<html lang>` (default 'en'). */
    lang?: string;
    /** Seed for `$app/state` inside islands (`page.data`/`params`/`url`, `route.id`, `form`). The router
     *  passes it so islands on a rendered page read `$page` just like on a Kit-served page. Promises in
     *  `data`/`form` aren't streamed here — a non-serializable leaf is left out where it sits. */
    pageState?: {
        url?: {
            href?: string;
        };
        params?: Record<string, string | undefined>;
        route?: {
            id: string | null;
        };
        status?: number;
        data?: unknown;
        form?: unknown;
        error?: unknown;
    };
}
/**
 * Render a region into a complete ogygia document and return it as a `Response`.
 *
 * ```ts
 * import { document } from 'ogygia/server';
 * import { region } from 'ogygia';
 *
 * return document(region(Dashboard, { stats }), { title: 'ogygia profiler' });
 * ```
 */
export declare function document(of: RegionValue | PromiseLike<RegionValue>, options?: DocumentOptions): Promise<Response>;
