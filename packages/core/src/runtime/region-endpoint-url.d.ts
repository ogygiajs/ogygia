import { type LoadClass } from './load-scheduler.ts';
/** Hoisted (hot paths — connectedCallback/hydrate run per region); shared with core's
 *  foreign-origin checks. */
export declare const ABSOLUTE_URL_SCHEME: RegExp;
/**
 * Defense-in-depth: only fetch region HTML from same-origin capability URLs.
 * Mint always emits a path-only URL (`resolve(DEFAULT_ISLANDS_ENDPOINT)?…`). Absolute /
 * protocol-relative endpoints would require prior HTML injection — still reject them so the
 * runtime is not an XSS amplifier. See INVARIANTS.md · HOLE-TRUST.
 */
/** True when `endpoint` resolves to same-origin http(s). */
export declare function is_allowed_region_endpoint(endpoint: string, page_origin?: string): boolean;
/**
 * Has this hole's capability (probably) EXPIRED — worth one retry with `&renew=1` after a 403? Its
 * document outlived it in a cache (server/shared-cache.ts). Read from the signed `exp` in the URL,
 * with {@link CLOCK_SKEW_SEC} of slack for a slow clock; a URL that has not expired never renews
 * (the server refuses it), so a wrong guess costs one refused request.
 */
export declare function capability_expired(endpoint: string, now_ms?: number, page_origin?: string): boolean;
/** The renewal request for an expired capability `endpoint` (the handle re-signs it, anonymous
 *  holes only, and answers the fresh capability in `x-ogygia-capability`). */
export declare function renewal_url(endpoint: string): string;
/**
 * Is this hole answer a WHOLE DOCUMENT rather than the region's fragment? ogygia's handle answers a
 * region request in place — a fragment, a 204, an error status — never with a page. A page here
 * means a handle in front of `ogygia.handle()` took the request instead (an auth wall, a locale
 * bounce, a 404 handler) and the browser followed it: a customer's signed-in visitors had every
 * hole of the header filled with the account area's page — its scripts, its skeletons, a second
 * header. Refused, the fallback stands; the redirect twin is {@link is_redirected_answer}.
 */
export declare function is_document_answer(text: string): boolean;
/** A region request that was redirected (same origin — cross-origin is refused earlier) did not
 *  reach the endpoint it named: whatever answered is not the region. */
export declare function is_redirected_answer(res: Response): boolean;
/**
 * Why a hole's answer was refused:
 * - `redirected` / `document`: something in front of ogygia's handle answered instead;
 * - `forbidden`: the handle refused the capability (a 403, `deny` says why — `foreign-key` when the
 *   page and the islands endpoint came from different deployments).
 */
export type RegionRefusal = 'redirected' | 'document' | 'forbidden';
/** The error a refused answer throws: the fetch loop does not retry it (the answer is
 *  deterministic — a redirect rule, a refused capability, not a flaky network) and DEV names the
 *  culprit. */
export declare class RegionAnswerRefused extends Error {
    name: string;
    readonly reason: RegionRefusal;
    readonly final_url: string;
    /** `forbidden`: the server's `x-ogygia-deny`, with its key fingerprint and the capability's */
    readonly deny?: string;
    constructor(reason: RegionRefusal, final_url: string, deny?: string);
}
/** The reason a 403 without `x-ogygia-deny` gets: ogygia's handle never answered it. */
export declare const NOT_OGYGIA_403 = "not ogygia: a proxy, CDN or firewall in front answered (a 403 without x-ogygia-deny)";
/**
 * A 403 from the islands endpoint, as one line: its `x-ogygia-deny` reason, and for `foreign-key`
 * the two keys (the capability's `&k=`, the answering server's `x-ogygia-key`). A 403 with no reason
 * came from something in front of the handle (a bot wall), or from a server before reasons.
 */
export declare function deny_of(res: Response, endpoint: string): string;
/** After fetch: reject opaque redirects that left the page origin. */
export declare function is_same_origin_response(res: Response, page_origin?: string): boolean;
/**
 * Normalize a hydrate `entry` for `import()`.
 *
 * Root-absolute paths (`/@id/…`, `/_app/…`) and absolute URLs import as-is. Relative specs
 * (`./_app/…`, `../_app/…`) must resolve against the **document** URL — `import()` would
 * otherwise resolve them against the runtime module (`/_app/immutable/og-runtime.*`)
 * and produce `/_app/_app/…` 404s on nested routes.
 */
export declare function island_module_url(entry: string, base?: string): string;
/** Fire-and-forget `import()` of an island's module, deduped by resolved URL. */
export declare function warm_island_module(entry: string, base?: string, cls?: LoadClass): void;
/** Has this island module already been warmed (or imported through the warmer)? `entry` resolves
 *  the way `warm_island_module` resolves it; `base` for an href read off a foreign document. */
export declare function is_warmed_module(entry: string, base?: string): boolean;
