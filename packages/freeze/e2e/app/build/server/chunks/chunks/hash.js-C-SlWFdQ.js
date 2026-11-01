// ../../../core/src/runtime/hash.ts
/**
* Region fingerprint — the PURE core (no DOM, no imports) shared by the client reconciler AND the
* server (Region.svelte, server-delta nav). Kept dependency-free so it is safe in BOTH bundles and
* so client↔server fingerprints are IDENTICAL BY CONSTRUCTION: the server emits `data-og-fp =
* fingerprint_of(entry, '', props_payload)` on each island, and the client's `region_props_fp`
* reads the same entry attribute + '' endpoint + props-script text → the same hash. That parity is
* what makes server-delta nav safe (the server skips exactly the regions the client says it has).
*
*   • signature   — WHICH region slot (entry + the endpoint's stable id/props, minus exp/sig).
*   • fingerprint — DID ITS INPUTS CHANGE (hash of entry + endpoint + the props seed).
*/
/** 64-bit fingerprint over a string → 16-char hex. Two independent 32-bit lanes (FNV-1a-32 and an
*  FNV-style lane with murmur's mixing constant + an xorshift), concatenated. 64 bits on purpose:
*  the server-delta SKIPS a region on a fingerprint match, so a collision would keep stale/wrong
*  content silently — 64 bits makes that a non-risk on any real page. NOT canonical FNV-1a-64: the
*  previous BigInt implementation cost 20 ms per island on a CMS page whose props run to 480 KB
*  (one BigInt allocation per character — 0.4 s of a 3.7 s server render, seen in the profiler);
*  this loop is pure int32 arithmetic and hashes the same page in about a millisecond. Parity is by
*  construction — the same function runs on both legs — so the algorithm is free to change. */
function fnv1a(s) {
	let a = 2166136261;
	let b = 522970236;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		a ^= c;
		a = Math.imul(a, 16777619);
		b ^= c;
		b = Math.imul(b, 668265263);
		b ^= b >>> 15;
	}
	return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}
/** WHICH COPY of a hole: copies of one component share its id, and differ by their props. The key is
*  a short hash of the props PAYLOAD as it rides in the hole's signed endpoint (`?props=`) — the one
*  string the server's request, the page's note and the browser's report all hold, verbatim. */
function hole_copy_key(payload) {
	return fnv1a32(payload).toString(36);
}
/** The copy key of a hole endpoint (its `props` parameter), or '' when it has none. */
function hole_copy_of(endpoint) {
	let at = endpoint.indexOf("&props=");
	if (at === -1) at = endpoint.indexOf("?props=");
	if (at === -1) return "";
	at += 7;
	const end = endpoint.indexOf("&", at);
	return hole_copy_key(endpoint.slice(at, end === -1 ? endpoint.length : end));
}
/** FNV-1a 32-bit over a string → uint32. The NUMERIC sibling for callers that bucket/mod rather
*  than compare (experiment splits, build-cache keys) — no BigInt, no hex round-trip. This is THE
*  one shared implementation; the driver/vite copies were folded into it. */
function fnv1a32(s) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
/**
* The stable part of a signed endpoint URL: everything up to the volatile `&exp=…&sig=…` tail.
* A deferred region's endpoint encodes `?id=…&props=…&exp=…&sig=…`; exp/sig rotate per render, so
* they must NOT enter identity or two renders of the same region would never match. Returns the
* `id`+`props` portion; empty string when there is no endpoint.
*/
function endpoint_key(endpoint) {
	return "";
}
/** Change key: DID this region's inputs change (testable without a DOM). */
function fingerprint_of(entry, endpoint, props_text) {
	return fnv1a(entry + " " + endpoint_key() + " " + props_text);
}

export { fnv1a32 as a, fingerprint_of as b, hole_copy_key as c, fnv1a as f, hole_copy_of as h };
//# sourceMappingURL=hash.js-C-SlWFdQ.js.map
