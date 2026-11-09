/** Minimum UTF-8 byte length for a user-supplied `OGYGIA_SECRET` in production builds. */
export declare const MIN_SECRET_BYTES = 16;
/** HKDF-SHA256 → 32-byte MAC key (hex for stable logging / tests; Buffer used internally). */
export declare function derive_mac_key(secret: string): Buffer;
/** HKDF-SHA256 → 16-byte id salt (hex). Empty input must not be used — caller gates on env. */
export declare function derive_id_salt(secret: string): string;
/** True when a configured secret meets the production entropy floor. */
export declare function secret_has_min_entropy(secret: string): boolean;
export declare class Hmac {
    static sha256(key: Buffer, message: string): string;
    static sign(secret: string, message: string): string;
    static verify(secret: string, message: string, sig: string): boolean;
    /**
     * MAC message for a signed region capability. Every field is length-prefixed (`<utf8 bytes>:<value>`),
     * so a field's content can never forge a `|` boundary. Two versions:
     *
     * - `v1|id|exp|props|session|ttl` — the capability names only its region `id` (the wrapper that
     *   minted it: component ⊕ page-side schedule ⊕ the build's salt). Only a build that has that
     *   exact id can answer it. Minted before render identities (ogygia ≤ 0.8.6); still verified, so
     *   pages cached before an upgrade keep their holes.
     * - `v2|id|exp|props|session|ttl|render` — the same five, plus the region's render identity (the
     *   URL's `r`: the component the endpoint renders, compiler/region/identity.ts `renderId`). Signing
     *   it lets a build that no longer has `id` (another schedule, preset or salt) answer the
     *   capability with its own entry for that component, and only for that component. Every current
     *   mint is `v2`.
     *
     * The version follows from the URL: a capability with `r` is checked as `v2`, one without as `v1`.
     * A `v2` MAC never verifies as `v1` (the prefix and the field count differ), so stripping `r` or
     * swapping it for another component breaks the signature. Empty `session`/`ttl` are still fields
     * (prerender / unbound / no-store) — never optional concat. `ttl` is the response cache max-age in
     * seconds (`''` = no-store); signing it keeps a harvested URL from being re-pointed at a longer
     * browser cache.
     */
    static region_message(id: string, exp: number | string, props: string, session?: string, ttl?: number | string, render?: string): string;
}
export declare const sign: typeof Hmac.sign;
export declare const verify: typeof Hmac.verify;
export declare const region_mac_message: typeof Hmac.region_message;
