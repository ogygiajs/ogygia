import { s as sign, P as PRERENDER_REGION_TTL_SEC$1 } from './Region.js-SNqDpRL3.js';

// ../../../core/src/server/signing-key.ts
/**
* THE region signing key, decided once at first use (the first mint or verify), not at module eval:
* a host that fills `process.env` after the server's modules load (an adapter loading a `.env` late)
* still counts. The runtime's `OGYGIA_SECRET` wins; else this build's random key.
*
* A capability carries its minter's key FINGERPRINT (`&k=`): an HMAC of a constant under the key —
* the same on every instance sharing the key, and it reveals nothing of the key. A deployment that
* verifies a capability minted under another key can then say so (`x-ogygia-deny: foreign-key`)
* instead of an opaque 403: the page and its islands endpoint came from different deployments (a CDN
* routing them to two backends, HTML cached across a key change).
*/
var key;
function signing_key() {
	if (key) return key;
	const from_env = typeof process !== "undefined" && process.env?.OGYGIA_SECRET || "";
	const secret = from_env || "a590445be7d747faa4d576dae2cbc6ccfc02ad38d9805af7e92d391aea64ad8d";
	key = {
		secret,
		stable: from_env !== "",
		fp: key_fingerprint(secret)
	};
	if (!key.stable && true) warn_build_key();
	return key;
}
function key_fingerprint(secret) {
	return sign(secret, "ogygia:key-fp").slice(0, 8);
}
/** One message per process (a shared Symbol: one across every copy of this module): a server
*  signing with this build's random key. */
function warn_build_key() {
	const g = globalThis;
	const K = Symbol.for("ogygia.build-key-warned");
	if (g[K]) return;
	g[K] = true;
	console.warn("[ogygia] OGYGIA_SECRET is not set: region capabilities are signed with this build's random key, so a page cached across a deploy, or served by another deployment than its islands endpoint, gets its holes refused (403, x-ogygia-deny: foreign-key). Set a stable OGYGIA_SECRET.");
}
// ../../../core/src/plugin/facts.ts
var slot$1 = globalThis[Symbol.for("ogygia.facts.v2")] ??= {
	by_request: /* @__PURE__ */ new WeakMap(),
	current: null
};
/** This request's facts (made on first touch). */
function facts_of(request) {
	let facts = slot$1.by_request.get(request);
	if (!facts) slot$1.by_request.set(request, facts = {
		storable: false,
		perVisitor: null,
		streamed: false,
		private: false,
		answerForm: false,
		sources: null,
		assignments: {}
	});
	return facts;
}
/** Core only (hooks.ts): how the running code's Request is found. */
function set_current_request(fn) {
	slot$1.current = fn;
}
/** The facts of the request the running code belongs to, or null outside one (the client, a test). */
function current_facts() {
	try {
		const request = slot$1.current?.();
		return request ? facts_of(request) : null;
	} catch {
		return null;
	}
}
/** Name the first reason a render is per-visitor (later reasons do not replace it). */
function mark_per_visitor(facts, reason) {
	if (facts.perVisitor === null) facts.perVisitor = reason;
}
// ../../../core/src/server/shared-cache.ts
/**
* HOLES ON A CACHED DOCUMENT — a deferred hole's capability must outlive the document it sits in.
*
* A page whose load says `cache-control: public, s-maxage=604800` is served from a CDN for a week,
* but its holes were minted for `ttl` (an hour by default, capped at a day): once that passed,
* every visitor served the cached copy got a 403 for every hole, and nothing logged it. Prerender
* already solves the same problem by signing for the life of the deploy; this is the request-time
* equivalent, bounded by what the app itself declared.
*
* 1. The handle notes the `cache-control` a load sets (`setHeaders`) on the page request; the mint
*    reads it and signs an ANONYMOUS hole for twice that lifetime (`capability_expiry` guarantees
*    only half of a ttl). Same safety argument as prerender: the props are already in the public
*    HTML, and nothing session-bound is extended.
* 2. A document already cached with short-lived holes (or one whose cache header a handle set after
*    the render, where the mint cannot see it) is rescued by RENEWAL: the runtime retries an expired
*    hole once with `&renew=1`, and the handle re-signs a capability it minted itself, anonymous,
*    expired by at most {@link RENEW_WINDOW_SEC}.
*
* State rides ONE `globalThis` + `Symbol.for` slot (the PAGE-STATE-SINGLETON law): the handle
* (hooks.js) records and the mint (server/region-endpoint.js) reads, and dist entries can each carry
* their own evaluation of this module — a module-local map would split the seam.
*/
/** The default for how long after expiry a capability can still be renewed
*  (`maxPageAge`): the longest a stale document is expected to live in a shared cache (a
*  week of `s-maxage` plus a day of revalidation). */
var RENEW_WINDOW_SEC = 691200;
/**
* How long shared caches may serve a document with this `cache-control`, in seconds: its freshness
* (`s-maxage`, else `max-age`) plus `stale-while-revalidate`. 0 when shared caches may not keep it
* (`private`, `no-store`) or must revalidate every use (`no-cache`). `max-age` counts without
* `public`: a shared cache may store any response not marked `private` (RFC 9111 §3).
* `stale-if-error` does not count: it serves a stale copy only while the origin is failing, when a
* hole could not render anyway.
*/
function shared_cache_lifetime(cache_control) {
	let s_maxage = -1;
	let max_age = -1;
	let swr = 0;
	for (const part of cache_control.toLowerCase().split(",")) {
		const eq = part.indexOf("=");
		const name = (eq === -1 ? part : part.slice(0, eq)).trim();
		if (name === "private" || name === "no-store" || name === "no-cache") return 0;
		if (eq === -1) continue;
		const n = seconds(part.slice(eq + 1));
		if (n === null) continue;
		if (name === "s-maxage") s_maxage = n;
		else if (name === "max-age") max_age = n;
		else if (name === "stale-while-revalidate") swr = n;
	}
	return (s_maxage >= 0 ? s_maxage : max_age >= 0 ? max_age : 0) + swr;
}
/** A delta-seconds value (optionally quoted), or null. */
function seconds(raw) {
	let v = raw.trim();
	if (v.length >= 2 && v[0] === "\"" && v[v.length - 1] === "\"") v = v.slice(1, -1);
	if (v === "" || v.length > 10) return null;
	for (let i = 0; i < v.length; i++) {
		const c = v.charCodeAt(i);
		if (c < 48 || c > 57) return null;
	}
	return Number(v);
}
/**
* The capability lifetime to mint with: prerender-grade for a stored page (prerender / freeze);
* for an anonymous hole on a document shared caches keep for `shared` seconds, twice that (so the
* window-aligned expiry still covers the whole cache life), capped at prerender-grade; else
* `ttl`. A session-bound hole is never extended — its document is the visitor's own.
*/
function mint_ttl_sec(o) {
	if (o.stored) return PRERENDER_REGION_TTL_SEC$1;
	if (o.shared <= 0) return o.region_ttl;
	return Math.min(PRERENDER_REGION_TTL_SEC$1, Math.max(o.region_ttl, 2 * o.shared));
}
/** A renewable expiry: an integer that HAS passed, by at most `window` seconds (the app's
*  `maxPageAge`; `0` renews nothing). */
function renewable_expiry(exp_raw, now_sec, window = RENEW_WINDOW_SEC) {
	if (window <= 0 || exp_raw === "" || exp_raw.length > 12) return false;
	for (let i = 0; i < exp_raw.length; i++) {
		const c = exp_raw.charCodeAt(i);
		if (c < 48 || c > 57) return false;
	}
	const exp = Number(exp_raw);
	return exp < now_sec && now_sec - exp <= window;
}
var SLOT_KEY = Symbol.for("ogygia.shared-cache");
var slot = globalThis[SLOT_KEY] ??= { by_request: /* @__PURE__ */ new WeakMap() };
/** The handle: a load set `cache-control` on this page request. */
function note_cache_control(request, cache_control) {
	slot.by_request.set(request, shared_cache_lifetime(cache_control));
}
/** The mint: how long shared caches keep the document this request renders (0 = unknown / none). */
function document_shared_lifetime(request) {
	return request ? slot.by_request.get(request) ?? 0 : 0;
}
// ../../../core/src/server/payload.ts
var NodeBuffer = globalThis.Buffer;
var B64Url = class {
	/** @param str utf-8 string */
	static encode(str) {
		if (NodeBuffer) return NodeBuffer.from(str, "utf8").toString("base64url");
		const bytes = new TextEncoder().encode(str);
		let bin = "";
		for (const b of bytes) bin += String.fromCharCode(b);
		return btoa(bin).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
	}
	/** @param b64 base64url string (decoded only after its MAC verified) */
	static decode(b64) {
		if (NodeBuffer) return NodeBuffer.from(b64, "base64url").toString("utf8");
		const norm = b64.replaceAll("-", "+").replaceAll("_", "/");
		const bin = atob(norm);
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		return new TextDecoder().decode(bytes);
	}
};

export { B64Url as B, set_current_request as a, mint_ttl_sec as b, current_facts as c, document_shared_lifetime as d, facts_of as f, mark_per_visitor as m, note_cache_control as n, renewable_expiry as r, signing_key as s };
//# sourceMappingURL=payload.js-DW7rNLSc.js.map
