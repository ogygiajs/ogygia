/**
 * Whether an SPA navigation's HTML response may warm the page cache. The navigation chunk
 * (./router-nav.ts) applies it and `ogygia/app` exports it to island code, which never imports a
 * boot module (test/runtime-boot-svelte-free.test.ts): so it lives in no router module.
 *
 * @packageDocumentation
 */

const CC_UNCACHEABLE = /(?:^|,)\s*(?:private|no-store|no-cache)\b/i;

/**
 * Whether a fetch response may warm the SPA page-HTML cache.
 * @param cacheControl - Response `Cache-Control` header value.
 * @param setCookie - True if the response included `Set-Cookie`.
 * @returns False when the response is private / no-store / no-cache or set a cookie.
 */
export function spa_html_cacheable(cacheControl: string, setCookie: boolean): boolean {
	return !CC_UNCACHEABLE.test(cacheControl || '') && !setCookie;
}
