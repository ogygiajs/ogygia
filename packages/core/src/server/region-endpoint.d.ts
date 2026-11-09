import { type CapabilityLifetime } from './capability-lifetime.ts';
/** A hole's own stylesheet hrefs, by region id — the list its endpoint answer links (hooks.ts
 *  `region_css_links`), for a render that inlines the hole in the page instead (Region.svelte). */
export declare function holeCss(entry: string): string[];
/** The app's capability lifetime, bound to its settings: every hole it signs (these, and the
 *  plugins' `app.capability`, which the handle hands it) expires and renews by this one rule. */
export declare const app_lifetime: CapabilityLifetime;
export declare function known_region_fps(): ReadonlySet<string>;
/**
 * Shared minting core for signed region capabilities — the ONE source of truth for the
 * `/__ogygia__?id&props&exp&sig` URL, its MAC message, TTL policy, and session sealing. Both held regions
 * (via {@link makeRegionEndpoint}) and server islands (Region.svelte's server branch) sign through this,
 * each deriving/validating its own `payload` first (held regions degrade to `''` on failure, server
 * islands throw). Given a valid encoded `payload`, the emitted URL/MAC/exp is identical to both.
 *
 * @param entry region id (server-manifest key baked into the MAC)
 * @param payload b64url props blob (already encoded + size-checked by the caller)
 * @param ttl response cache max-age in **seconds** (`0` = no-store, the default). Signed into the MAC
 *   and echoed as a `ttl` query param so the handle sets `Cache-Control` from it — a harvested URL
 *   can't be re-pointed at a longer browser cache.
 */
export declare function mint_region_capability(entry: string, payload: string, ttl?: number): string;
/**
 * Server-island mint: encode `props` (devalue + wire codec), enforce the size cap (THROW — a server
 * island with oversized/non-serializable props is an author bug the handle would reject anyway), and
 * sign. The one place `Region.svelte`'s `__mode: 'server'` branch signs its hole; routed through the
 * `virtual:ogygia/region-endpoint` virtual so the client build stubs it to `''` (server islands never
 * mint on the client — the runtime fetches the endpoint). Mirrors the old `ServerIsland.svelte`.
 */
export declare function mintServerIsland(entry: string, props: Record<string, unknown>, ttl?: number): string;
/** HMAC-signed `<endpoint>?id&props&exp&sig` (`handle({ endpoint })`, default `/__ogygia__`) for re-rendering `entry` with `props`. */
export declare function makeRegionEndpoint(entry: string, props?: Record<string, unknown>): string;
export { encode_region_props } from './region-props.ts';
/** The island `data-og-fp` (server/fingerprint.ts) — Region.svelte reaches it through this
 *  client-stubbed virtual, so the native digest never enters the client graph. */
export { island_fingerprint as islandFingerprint } from './fingerprint.ts';
