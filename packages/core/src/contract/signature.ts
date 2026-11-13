/**
 * A region's match key: WHICH region slot it is. Pure, no imports, and apart from the fingerprint
 * hashing (./hash.ts) so the boot can name a region without loading the hashing (form continuity
 * does at boot; the lazy nav chunk does through ./hash.ts, which re-exports these).
 */

/**
 * The stable part of a signed endpoint URL: everything up to the volatile `&exp=…&sig=…` tail.
 * A deferred region's endpoint encodes `?id=…&props=…&exp=…&sig=…`; exp/sig rotate per render, so
 * they must NOT enter identity or two renders of the same region would never match. Returns the
 * `id`+`props` portion; empty string when there is no endpoint.
 */
export function endpoint_key(endpoint: string): string {
	if (!endpoint) return '';
	const exp = endpoint.indexOf('&exp=');
	return exp === -1 ? endpoint : endpoint.slice(0, exp);
}

/** Match key: WHICH region slot this is (testable without a DOM). */
export function signature_of(entry: string, endpoint: string): string {
	return `${entry} ${endpoint_key(endpoint)}`;
}
