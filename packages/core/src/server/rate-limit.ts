/**
 * Shared rate-limit bucket for the region endpoint.
 * - Hard-caps map size with LRU eviction (Map insertion order).
 * - Render limiter: charge AFTER a valid MAC (RATE-BURN).
 * - Probe limiter: charge BEFORE HMAC (HMAC-CPU-DOS).
 */
import { clock } from '@ogygia/machine';

export type RateBucket = { n: number; t: number };

const DEFAULT_CAP = 4096;

export class RateLimiter {
	#buckets = new Map<string, RateBucket>();
	#cap: number;
	#max: number;
	#windowMs: number;
	#since_prune = 0;

	constructor(opts: { max: number; windowMs: number; cap?: number }) {
		this.#max = opts.max;
		this.#windowMs = opts.windowMs;
		this.#cap = Math.max(1, opts.cap ?? DEFAULT_CAP);
	}

	/** Mark `ip` as most-recently used (Map: delete + set → end of iteration order). */
	#touch(ip: string, b: RateBucket) {
		this.#buckets.delete(ip);
		this.#buckets.set(ip, b);
	}

	#evict_lru() {
		while (this.#buckets.size > this.#cap) {
			const oldest = this.#buckets.keys().next().value;
			if (oldest === undefined) return;
			this.#buckets.delete(oldest);
		}
	}

	#maybe_prune(now: number) {
		this.#since_prune++;
		if (this.#since_prune >= 64) {
			this.#since_prune = 0;
			for (const [k, v] of this.#buckets) {
				if (now - v.t >= this.#windowMs) this.#buckets.delete(k);
			}
		}
		this.#evict_lru();
	}

	/** @returns true if this IP is over budget (request should 429). */
	limited(ip: string): boolean {
		if (this.#max <= 0) return false;
		const now = clock.mono();
		const b = this.#buckets.get(ip);
		if (!b || now - b.t >= this.#windowMs) {
			this.#buckets.set(ip, { n: 1, t: now });
			this.#maybe_prune(now);
			return false;
		}
		if (b.n >= this.#max) {
			this.#touch(ip, b);
			return true;
		}
		b.n++;
		this.#touch(ip, b);
		return false;
	}

	/** @returns true if this IP has spent its budget for the window, charging nothing (a budget
	 *  spent only on failures checks first, and charges with {@link limited} when one happens). */
	over(ip: string): boolean {
		if (this.#max <= 0) return false;
		const b = this.#buckets.get(ip);
		return b !== undefined && clock.mono() - b.t < this.#windowMs && b.n >= this.#max;
	}

	/** Whole seconds until `ip`'s window resets (at least 1), for a 429's `Retry-After` (#959). */
	retry_after_s(ip: string): number {
		const b = this.#buckets.get(ip);
		const left = b ? this.#windowMs - (clock.mono() - b.t) : 0;
		return Math.max(1, Math.ceil(left / 1000));
	}

	get size(): number {
		return this.#buckets.size;
	}

	clear(): void {
		this.#buckets.clear();
		this.#since_prune = 0;
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
