export declare const DEFAULT_ISLANDS_ENDPOINT = "/__ogygia__";
/** The islands endpoint path (without the app's base: matched by suffix, minted through `resolve`). */
export declare function islands_endpoint(): string;
/** Set by the handle (`handle({ endpoint })`); the default when none is given. */
export declare function configure_islands_endpoint(path: string | undefined): void;
/** Max b64url props blob accepted by the region handle (and refused at mint time). */
export declare const MAX_REGION_PROPS_LEN = 8192;
/**
 * Default capability TTL (seconds) for DYNAMIC pages. Shorter than a day so harvested URLs age
 * out; override via `ogygia({ ttl })`.
 */
export declare const DEFAULT_REGION_TTL_SEC = 3600;
/**
 * Capability TTL for PRERENDERED pages (10 years — effectively the life of the deploy). A static
 * file lives on the CDN indefinitely, so an aging capability would strand every hole on it after
 * `ttl` (real PPR would silently die in an hour). Safe: the capability's props are already
 * baked into the public static HTML, and the mint seals an EMPTY session at prerender — signing
 * that same public tuple for longer reveals nothing new. Redeploy survival additionally needs a
 * stable `OGYGIA_SECRET` (the default per-build key rotates; ServerIsland warns at build).
 */
export declare const PRERENDER_REGION_TTL_SEC: number;
/**
 * WHEN a capability minted now expires — aligned to a window, not `now + ttl`.
 *
 * Every render of the same hole (same id, props, session) in the same window mints the SAME
 * `exp`, hence the SAME signature and URL: the hole's HTML is byte-identical across requests. That
 * is what lets anything keyed on the page's bytes hit — a host app's post-render component cache,
 * a CDN or postrender store comparing documents, an ETag. With `now + ttl` every request minted a new
 * URL and a header block wrapping five holes was re-processed on every request (measured: seconds
 * of server time per page on a Lambda-class host).
 *
 * The window is half the TTL: `exp` is the end of the window after the current one, so a
 * capability is always valid for at least `ttl / 2` and at most `ttl` (harvested URLs still age
 * out on the same order); consecutive windows overlap by construction, so a page rendered at the
 * end of a window and fetched a moment later still verifies.
 */
export declare function capability_expiry(now_sec: number, ttl_sec: number): number;
/** Region ids are always 12 lowercase hex chars from the transform. */
export declare const REGION_ID_RE: RegExp;
/**
 * A hole's optional cache `ttl` (max-age seconds) as it rides in the endpoint URL: empty (no-store,
 * the default) or 1–7 digits (up to ~115 days). Charset-gated before HMAC so a forged value can't
 * reach the response header, though the MAC is the real guard.
 */
export declare const REGION_TTL_RE: RegExp;
/** {@link REGION_ID_RE}: exactly 12 lowercase hex chars. */
export declare function is_region_id(s: string): boolean;
/** {@link REGION_TTL_RE}: empty, or 1–7 ASCII digits. */
export declare function is_region_ttl(s: string): boolean;
/** Exactly `n` chars of `[0-9a-f]`. */
export declare function is_lower_hex(s: string, n: number): boolean;
