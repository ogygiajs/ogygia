/**
 * Shared rate-limit bucket for the region endpoint.
 * - Hard-caps map size with LRU eviction (Map insertion order).
 * - Render limiter: charge AFTER a valid MAC (RATE-BURN).
 * - Probe limiter: charge BEFORE HMAC (HMAC-CPU-DOS).
 */
export type RateBucket = {
    n: number;
    t: number;
};
export declare class RateLimiter {
    #private;
    constructor(opts: {
        max: number;
        windowMs: number;
        cap?: number;
    });
    /** @returns true if this IP is over budget (request should 429). */
    limited(ip: string): boolean;
    get size(): number;
    clear(): void;
}
