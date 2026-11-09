/**
 * Capability virtual-module emitters — the leg-split sources for the signed-capability family:
 * `virtual:ogygia/secret`, `/sign`, `/rate-limit`, `/session-cookie`, `/region-ttl`. Each is a pure
 * `(ssr, <one resolved config value>) => string`: the SSR leg carries the real signer / baked config,
 * the client leg gets an inert stub (a browser never mints). The driver's `emit` dispatch calls these.
 */
/**
 * `virtual:ogygia/secret` — SERVER only: the per-build random key material and whether the BUILD
 * saw an `OGYGIA_SECRET` (its region ids are salted from it). CLIENT build: empty (never mint in the
 * browser). Which key signs is decided at first use, not here (server/signing-key.ts): the runtime's
 * `OGYGIA_SECRET` when the host sets it — read then, so an env a host fills after module eval still
 * counts — else this build's key.
 */
export declare function secret_module(ssr: boolean, build_secret: string, build_had_secret: boolean): string;
/**
 * `virtual:ogygia/sign` — same split as secret: SSR mints with node:crypto (re-exports the real
 * HMAC module); client never mints (secret is ''), but still needs `region_mac_message` for the
 * length-prefixed canonical form the runtime compares against.
 */
export declare function sign_module(ssr: boolean, hmac_module: string): string;
/**
 * `virtual:ogygia/server-plugins` — SERVER only: each plugin's server half, one static import per
 * plugin, in the order the app listed them. The handle runs their stages straight off this list; an
 * app with no plugins gets an empty one (and the client always does).
 */
/** One plugin's server realm, as the build wires it. */
export interface ServerRealm {
    /** the plugin's (package) name */
    name: string;
    /** the realm module's absolute POSIX path (the plugin's `server`) */
    module: string;
    /** the plugin's options (JSON) */
    options: unknown;
}
export declare function server_plugins_module(ssr: boolean, realms: readonly ServerRealm[]): string;
/** `virtual:ogygia/route-config` — SERVER only: every Kit page route id → the keys the plugins claim
 *  inside Kit's `config` page option, merged the way Kit merges it (a key no level sets is absent).
 *  Empty on the client, and when no plugin claims a key: the route list never ships to the browser. */
export declare function route_config_module(ssr: boolean, routesDir: string, keys: readonly string[]): string;
/** `virtual:ogygia/rate-limit` — SERVER only; the region handle is the only consumer. */
export declare function rate_limit_module(ssr: boolean, rate_limit: {
    max: number;
    windowMs: number;
}): string;
/** `virtual:ogygia/session-cookie` — SERVER only; sealed into the region MAC when non-empty. */
export declare function session_cookie_module(ssr: boolean, session_cookie: string): string;
/** `virtual:ogygia/region-ttl` — SERVER only; the capability expiry window for mint, and how long
 *  after expiry an anonymous capability still renews. */
export declare function region_ttl_module(ssr: boolean, region_ttl: number, renew_window: number): string;
/** `virtual:ogygia/route-csr` — SERVER only: the csr=true route ids, so a csr=false layout's islands
 *  degrade to inline when the LEAF page is csr=true (Kit hydrates the whole document). The CLIENT leg
 *  is an empty set — the client reads the identical signal from `kit_hydrates_page()`, and the route
 *  list never ships to the browser. */
export declare function route_csr_module(ssr: boolean, routesDir: string): string;
