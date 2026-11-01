import { s as sign, c as capability_expiry$1, P as PRERENDER_REGION_TTL_SEC$1, r as renewWindow, a as regionTtl, M as MAX_REGION_PROPS_LEN$1, R as REF_WIRE_KEY$1, b as ref_reducer$1, d as region_mac_message, i as island_render, e as islands_endpoint$1, f as register_wire_kind$1, g as register_store_kind$1, h as register_snippet_kind$1, j as register_fn_kind$1, k as register_derived_kind$1 } from './Region.js-Vj2klmrC.js';
import { d as building } from './internal.js-NlsCutcl.js';
import { r as resolve } from './paths.js-C6xzMLZ4.js';
import { h as stringify$1 } from './shared.js-iXTe6R8-.js';
import './island-deps.js-B57ZxkfE.js';
import './remote.js-CcSc56f7.js';
import { A as getRequestEvent } from './utils.js-Ca9I6N5J.js';

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
	const secret = from_env || "3916139df10f2d5023f12f9e8ed277ac62b114a2c920eb1468ab3514a02f4306";
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
* The capability lifetime to mint with: prerender-grade for a stored page (prerender / postrender);
* for an anonymous hole on a document shared caches keep for `shared` seconds, twice that (so the
* window-aligned expiry still covers the whole cache life), capped at prerender-grade; else
* `ttl`. A session-bound hole is never extended — its document is the visitor's own.
*/
function mint_ttl_sec(o) {
	if (o.stored) return PRERENDER_REGION_TTL_SEC$1;
	if (o.session !== "" || o.shared <= 0) return o.region_ttl;
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
/** Why a capability's `exp` refuses it, or null: past it (`expired`); for a renewal, not inside
*  the renew window (`renew-window`), so a URL that has not expired never renews. */
function expiry_refusal(exp_raw, now_sec, renewal, window) {
	if (renewal) return renewable_expiry(exp_raw, now_sec, window) ? null : "renew-window";
	const exp = Number(exp_raw);
	return !Number.isFinite(exp) || exp < now_sec ? "expired" : null;
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
// ../../../core/src/server/capability-lifetime.ts
/**
* THE CAPABILITY LIFETIME — when a signed hole URL minted now expires, and when a renewed one does.
* One rule for every capability the app signs: core's region holes (server/region-endpoint.ts) and a
* plugin's own (`app.capability`, plugin/capability.ts — a remote region's hole). Expiry is unix
* SECONDS everywhere: the runtime reads it from the URL to tell an expired capability
* (runtime/region-endpoint-url.ts `capability_expired`) and retries it once with `&renew=1`.
*
* Pure: the app's settings come in (server/region-endpoint.ts binds them from the virtuals), so the
* plugin test harness (plugin/testing.ts) runs the same rule without a Kit app.
*/
function capability_lifetime(app) {
	const now_sec = () => Math.floor(Date.now() / 1e3);
	return {
		mint_expiry(session) {
			const stored = app.building || current_facts()?.storable === true;
			return capability_expiry$1(now_sec(), mint_ttl_sec({
				stored,
				session,
				shared: stored || session !== "" ? 0 : document_shared_lifetime(app.request()),
				region_ttl: app.region_ttl
			}));
		},
		renewed_expiry: () => capability_expiry$1(now_sec(), app.region_ttl),
		renew_window: app.renew_window
	};
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
// ../../../core/src/server/region-props.ts
/**
* Encode region capability props (devalue → b64url) with the same size bound the handle enforces.
* No virtual imports — safe to unit-test and share between mint paths.
*/
/** Ensure the island-prop kinds are registered (called per encode; Map.has-cheap). */
function ensure_prop_kinds() {
	register_wire_kind$1();
	register_store_kind$1();
	register_snippet_kind$1();
	register_fn_kind$1();
	register_derived_kind$1();
}
/** Island props carry classes, stores, snippets, og.$ fns and resumable deriveds. */
var PROP_FAMILIES = /* @__PURE__ */ new Set([
	"wire",
	"store",
	"snippet",
	"fn",
	"derived"
]);
/**
* @returns b64url payload, or null when props cannot cross the wire (non-devalue or oversized).
*/
function encode_region_props(props) {
	ensure_prop_kinds();
	let payload;
	try {
		payload = B64Url.encode(stringify$1(props, { [REF_WIRE_KEY$1]: ref_reducer$1(PROP_FAMILIES) }));
	} catch {
		return null;
	}
	if (payload.length > 8192) return null;
	return payload;
}
// ../../../core/src/server/region-endpoint.ts
/**
* Build a signed region capability URL (same shape as server-island holes).
* Used by Region's lake branch for `render: 'live'`. Client build gets a stub that returns ''.
*/
/** The request being rendered (null off-request: prerender, a test). */
function current_request() {
	try {
		return getRequestEvent().request;
	} catch {
		return null;
	}
}
/** The app's capability lifetime, bound to its settings: every hole it signs (these, and the
*  plugins' `app.capability`, which the handle hands it) expires and renews by this one rule. */
var app_lifetime = capability_lifetime({
	building,
	region_ttl: regionTtl,
	renew_window: renewWindow,
	request: current_request
});
/** Session sealed into the MAC when `ogygia({ sessionCookie })` is set; empty at prerender. */
function region_session() {
	return "";
}
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
function mint_region_capability(entry, payload, ttl = 0) {
	const session = region_session();
	const exp = app_lifetime.mint_expiry(session);
	const key = signing_key();
	const ttl_field = ttl > 0 ? String(Math.floor(ttl)) : "";
	const render = island_render[entry] ?? "";
	const sig = sign(key.secret, region_mac_message(entry, exp, payload, session, ttl_field, render));
	const ttl_param = ttl_field ? `&ttl=${ttl_field}` : "";
	return `${resolve(islands_endpoint$1())}?id=${encodeURIComponent(entry)}${render ? `&r=${render}` : ""}&props=${payload}&exp=${exp}${ttl_param}&sig=${sig}&k=${key.fp}`;
}
/** HMAC-signed `<endpoint>?id&props&exp&sig` (`handle({ endpoint })`, default `/__ogygia__`) for re-rendering `entry` with `props`. */
function makeRegionEndpoint(entry, props = {}) {
	const payload = encode_region_props(props);
	if (payload == null) {
		console.warn(`[ogygia] render:'live' region ${entry} has props that cannot cross the wire (non-serializable or >${MAX_REGION_PROPS_LEN$1} b64 chars) — no revalidate endpoint minted (behaves like a static lake).`);
		return "";
	}
	return mint_region_capability(entry, payload);
}

export { B64Url as B, app_lifetime as a, set_current_request as b, current_facts as c, makeRegionEndpoint as d, expiry_refusal as e, facts_of as f, mark_per_visitor as m, note_cache_control as n, signing_key as s };
//# sourceMappingURL=region-endpoint.js-B56gT2fK.js.map
