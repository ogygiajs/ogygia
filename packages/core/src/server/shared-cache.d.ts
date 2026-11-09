/** The default for how long after expiry a capability can still be renewed
 *  (`maxPageAge`): the longest a stale document is expected to live in a shared cache (a
 *  week of `s-maxage` plus a day of revalidation). */
export declare const RENEW_WINDOW_SEC: number;
/**
 * How long shared caches may serve a document with this `cache-control`, in seconds: its freshness
 * (`s-maxage`, else `max-age`) plus `stale-while-revalidate`. 0 when shared caches may not keep it
 * (`private`, `no-store`) or must revalidate every use (`no-cache`). `max-age` counts without
 * `public`: a shared cache may store any response not marked `private` (RFC 9111 §3).
 * `stale-if-error` does not count: it serves a stale copy only while the origin is failing, when a
 * hole could not render anyway.
 */
export declare function shared_cache_lifetime(cache_control: string): number;
/**
 * The capability lifetime to mint with: prerender-grade for a stored page (prerender / postrender);
 * for an anonymous hole on a document shared caches keep for `shared` seconds, twice that (so the
 * window-aligned expiry still covers the whole cache life), capped at prerender-grade; else
 * `ttl`. A session-bound hole is never extended — its document is the visitor's own.
 */
export declare function mint_ttl_sec(o: {
    stored: boolean;
    session: string;
    shared: number;
    region_ttl: number;
}): number;
/** A renewable expiry: an integer that HAS passed, by at most `window` seconds (the app's
 *  `maxPageAge`; `0` renews nothing). */
export declare function renewable_expiry(exp_raw: string, now_sec: number, window?: number): boolean;
/** Why a capability's `exp` refuses it, or null: past it (`expired`); for a renewal, not inside
 *  the renew window (`renew-window`), so a URL that has not expired never renews. */
export declare function expiry_refusal(exp_raw: string, now_sec: number, renewal: boolean, window: number): 'expired' | 'renew-window' | null;
/** The handle: a load set `cache-control` on this page request. */
export declare function note_cache_control(request: Request, cache_control: string): void;
/** The mint: how long shared caches keep the document this request renders (0 = unknown / none). */
export declare function document_shared_lifetime(request: Request | null | undefined): number;
