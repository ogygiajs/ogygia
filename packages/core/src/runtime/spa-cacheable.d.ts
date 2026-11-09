/**
 * Whether an SPA navigation's HTML response may warm the page cache. A dependency-free leaf: the
 * lazy navigation chunk (./router-nav.ts) applies it, and `ogygia/app` exports it — island code —
 * so it must not live in the router's boot module (island code never imports a boot module).
 */
/**
 * Whether a fetch response may warm the SPA page-HTML cache.
 * @param cacheControl - Response `Cache-Control` header value.
 * @param setCookie - True if the response included `Set-Cookie`.
 * @returns False when the response is private / no-store / no-cache or set a cookie.
 */
export declare function spa_html_cacheable(cacheControl: string, setCookie: boolean): boolean;
