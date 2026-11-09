/** The app's settings the rule reads. */
export interface LifetimeSettings {
    /** prerendering (Kit's `building`) */
    building: boolean;
    /** `ogygia({ ttl })`, seconds */
    region_ttl: number;
    /** `ogygia({ maxPageAge })`, seconds */
    renew_window: number;
    /** the request being rendered (null off-request: prerender, a test) */
    request(): Request | null;
}
export interface CapabilityLifetime {
    /**
     * The `exp` (unix seconds) of a capability minted now, in the render running now. Prerendered
     * (real PPR) or a render a plugin may store (`facts.storable`): prerender-grade, since the stored
     * HTML outlives any `ttl` (a stored page must never carry expired hole URLs). An anonymous hole on
     * a document the app marked shared-cacheable (a load's `cache-control`) outlives that cache life
     * (server/shared-cache.ts). Everything else, and anything sealed to a `session`, keeps the short
     * `ttl` window so harvested URLs age out.
     */
    mint_expiry(session: string): number;
    /** The `exp` of a capability RENEWED now (an expired one re-signed at hole time): the short `ttl`
     *  window — its document is already old, and the runtime adopts the fresh URL for later fetches. */
    renewed_expiry(): number;
    /** Seconds after expiry a capability still renews (`0` renews nothing). */
    readonly renew_window: number;
}
export declare function capability_lifetime(app: LifetimeSettings): CapabilityLifetime;
