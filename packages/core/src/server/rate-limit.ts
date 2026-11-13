/**
 * Shared rate-limit bucket for the region endpoint.
 * - The buckets are a `cache()`: at most `cap` addresses (the least recently charged go first), each
 *   kept for its window, so a window that ended is a bucket that is gone.
 * - Render limiter: charge AFTER a valid MAC (RATE-BURN).
 * - Probe limiter: charge BEFORE HMAC (HMAC-CPU-DOS).
 */
import { cache, clock, type Cache } from '@ogygia/machine';

/** One address's window: what it was charged, and when the window began. */
export type RateBucket = { n: number; t: number };

const DEFAULT_CAP = 4096;

export class RateLimiter {
	#buckets: Cache<string, RateBucket>;
	#max: number;
	#windowMs: number;

	constructor(opts: { max: number; windowMs: number; cap?: number }) {
		this.#max = opts.max;
		this.#windowMs = opts.windowMs;
		// (a charge is a `get`, a use: past the cap the least recently charged go, test/rate-limit-lru.test.ts)
		this.#buckets = cache({
			name: 'rate limit',
			max: Math.max(1, opts.cap ?? DEFAULT_CAP),
			keep: opts.windowMs
		});
	}

	/** @returns true if this IP is over budget (request should 429). */
	limited(ip: string): boolean {
		if (this.#max <= 0) return false;
		const b = this.#buckets.get(ip);
		if (b === undefined) {
			// a new window (a use too: the most recent)
			this.#buckets.set(ip, { n: 1, t: clock.mono() });
			return false;
		}
		if (b.n >= this.#max) return true;
		b.n++;
		return false;
	}

	/** @returns true if this IP has spent its budget for the window, charging nothing (a budget
	 *  spent only on failures checks first, and charges with {@link limited} when one happens). */
	over(ip: string): boolean {
		if (this.#max <= 0) return false;
		const b = this.#buckets.peek(ip);
		return b !== undefined && b.n >= this.#max;
	}

	/** Whole seconds until `ip`'s window resets (at least 1), for a 429's `Retry-After` (#959). */
	retry_after_s(ip: string): number {
		const b = this.#buckets.peek(ip);
		const left = b ? this.#windowMs - (clock.mono() - b.t) : 0;
		return Math.max(1, Math.ceil(left / 1000));
	}

	get size(): number {
		return this.#buckets.size;
	}

	clear(): void {
		this.#buckets.clear();
	}
}

/** IPv4 ranges no visitor on the internet has: private, loopback, link-local, shared (100.64/10). */
const SHARED_V4 =
	/^(?:10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\.|^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;
/** IPv6: loopback, unique local (fc00::/7), link-local (fe80::/10). */
const SHARED_V6 = /^(?:::1$|f[cd][0-9a-f]{0,2}:|fe[89ab][0-9a-f]?:)/i;

/**
 * Whether `ip` is an address no visitor on the internet has (an IPv4-mapped IPv6 one too). A client
 * address like that is a proxy's or a load balancer's: every visitor behind it shares its rate-limit
 * budget (#894, test/rate-limit-shared-address.test.ts).
 */
export function is_shared_address(ip: string): boolean {
	return SHARED_V4.test(ip.replace(/^::ffff:/i, '')) || SHARED_V6.test(ip);
}
