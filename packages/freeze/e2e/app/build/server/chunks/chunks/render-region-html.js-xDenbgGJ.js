import { h as stringify$1 } from './shared.js-iXTe6R8-.js';
import { r as render } from './server.js-BBF-BCcH.js';
import { ad as MAX_REGION_PROPS_LEN$1, k as kit_page_ready, q as kit_render_context$1, ae as region_css_tags, t as kit_page_facts_tail, n as REF_WIRE_KEY$1, O as ref_reducer$1, u as capability_expiry$1, s as sign, af as region_mac_message, ag as island_render, i as islands_endpoint$1, g as register_wire_kind$1, h as register_store_kind$1, j as register_snippet_kind$1, l as register_fn_kind$1, m as register_derived_kind$1, U as regionTtl } from './Region.js-SNqDpRL3.js';
import { g as islandCss } from './island-deps.js-DRCEB_nS.js';
import { r as resolve } from './paths.js-DM9UWvpx.js';
import './remote.js-CcSc56f7.js';
import { A as getRequestEvent } from './utils.js-Ca9I6N5J.js';
import { B as B64Url, c as current_facts, b as mint_ttl_sec, d as document_shared_lifetime, s as signing_key } from './payload.js-DW7rNLSc.js';

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
	const stored = current_facts()?.storable === true;
	const exp = capability_expiry$1(Math.floor(Date.now() / 1e3), mint_ttl_sec({
		stored,
		shared: stored || session !== "" ? 0 : document_shared_lifetime(current_request()),
		region_ttl: regionTtl
	}));
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
// ../../../core/src/server/render-region-html.ts
/**
* A held region's server render to HTML (`__renderHtml` of a region binding): the component's body,
* prefixed with its island's stylesheet links and the region-CSS links its nested regions put in the
* head — the page never imported a server-picked component, so its CSS is on no page stylesheet.
* ONE copy for every island (the compiler used to inline this into each binding: hundreds of copies
* of the same code in the server bundle, parsed at every cold start).
*
* A fresh render root: it sees the page of the render (server/render-page.ts) like every other root
* ogygia starts — awaited first, so a region a remote call renders reads its page's `page.data`.
*/
/** context.ts's LAKE key (`isInLake`), by its global name — context.ts reaches virtual modules. */
var LAKE_SUBTREE_KEY = Symbol.for("ogygia.lake-subtree");
async function render_region_html(component, module_url, props) {
	await kit_page_ready();
	const context = kit_render_context$1();
	context.set(LAKE_SUBTREE_KEY, true);
	const r = await render(component, {
		props,
		context
	});
	let own = "";
	for (const href of islandCss(module_url)) own += "<link rel=\"stylesheet\" href=\"" + href + "\" data-ogygia-region-css>";
	return own + region_css_tags(r.head) + r.body + kit_page_facts_tail();
}

export { makeRegionEndpoint as m, render_region_html as r };
//# sourceMappingURL=render-region-html.js-xDenbgGJ.js.map
