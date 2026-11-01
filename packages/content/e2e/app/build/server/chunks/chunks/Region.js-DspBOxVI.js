import './async.js-CdyA1ipx.js';
import { K as getAllContexts, J as getContext, F as setContext, E as run, Y as head, Z as spread_props, _ as attr, $ as html, T as derived, a0 as save } from './server.js-Cx6qdlSj.js';
import { c as createRawSnippet, m as mount, u as unmount } from './index-server2.js-Dp0Lnfg2.js';
import { a2 as isInLiveSnippet, a3 as isNested, a4 as setInLiveSnippet, a5 as kit_request_event, a6 as KIT_REQUEST_CONTEXT, a7 as document_tail, a8 as documentIsCsrTrue, a9 as isInLake, aa as setNested, ab as setHoleInline, ac as next_slot_id, ad as claimRuntimeEmit, r as runtime_bootstrap, J as kit_asset, R as REGION_BRAND, ae as prepare_region_props, af as props_sidecar, ag as kit_page_version, ah as fingerprint_of, ai as plan_props_wire, aj as entryLocation, ak as register_late_region, al as islandInteractivity, am as slot_marker_open, an as SLOT_MARKER_CLOSE, ao as MAX_REGION_PROPS_LEN, ap as slot_pointer, aq as capability_expiry, s as sign, ar as region_mac_message, as as island_render, at as islands_endpoint, au as PRERENDER_REGION_TTL_SEC, Y as regionTtl, av as notify, aw as watcher_count, ax as region_snippet, ay as islandReadsPage, az as islandPageKeys, aA as islandRemotes, aB as record_page, aC as escape_attr, aD as hole_copy_of, aE as setInLake, aF as islandDeps, aG as modulepreload_tag, Q as island_graph_script, aH as claim_region_css, H as islandCss, I as region_css_tag, aI as claim_kit_island, K as escape_amp_quot, aJ as contentCss, k as kit_page_ready, u as kit_render_context, aK as region_css_tags, v as kit_page_facts_tail, aL as with_portable_forms, S as escape_amp, E as island_url } from './late-region-registry.js-DFACBCYi.js';
import { h as stringify$1 } from './shared.js-B7aDE0fO.js';
import { d as building } from './internal.js-NlsCutcl.js';
import { R as REF_WIRE_KEY, g as ref_reducer, b as register_wire_kind, c as register_store_kind, d as register_snippet_kind, e as register_fn_kind, f as register_derived_kind } from './live-transport.js-DcfVhxYl.js';
import { r as resolve } from './paths.js-DBACMOFs.js';
import { p as page } from './state.js-PRJNi6S7.js';
import { createHash } from 'node:crypto';
import { z as getRequestEvent } from './utils.js-DOLeCbnX.js';

// ../../../core/dist/server/signing-key.js
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
	const secret = from_env || "1476a3bd49eb730287dac66138c11df7537e759165252c3a5a3c7e865155b400";
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
// ../../../core/dist/plugin/facts.js
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
/** The facts of the request the running code belongs to, or null outside one (the client, a test). */
function current_facts() {
	try {
		const request = slot$1.current?.();
		return request ? facts_of(request) : null;
	} catch {
		return null;
	}
}
// ../../../core/dist/server/shared-cache.js
/**
* The capability lifetime to mint with: prerender-grade for a stored page (prerender / freeze);
* for an anonymous hole on a document shared caches keep for `shared` seconds, twice that (so the
* window-aligned expiry still covers the whole cache life), capped at prerender-grade; else
* `ttl`. A session-bound hole is never extended — its document is the visitor's own.
*/
function mint_ttl_sec(o) {
	if (o.stored) return PRERENDER_REGION_TTL_SEC;
	if (o.shared <= 0) return o.region_ttl;
	return Math.min(PRERENDER_REGION_TTL_SEC, Math.max(o.region_ttl, 2 * o.shared));
}
var SLOT_KEY = Symbol.for("ogygia.shared-cache");
var slot = globalThis[SLOT_KEY] ??= { by_request: /* @__PURE__ */ new WeakMap() };
/** The mint: how long shared caches keep the document this request renders (0 = unknown / none). */
function document_shared_lifetime(request) {
	return request ? slot.by_request.get(request) ?? 0 : 0;
}
// ../../../core/dist/server/payload.js
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
// ../../../core/dist/server/region-props.js
/**
* Encode region capability props (devalue → b64url) with the same size bound the handle enforces.
* No virtual imports — safe to unit-test and share between mint paths.
*/
/** Ensure the island-prop kinds are registered (called per encode; Map.has-cheap). */
function ensure_prop_kinds() {
	register_wire_kind();
	register_store_kind();
	register_snippet_kind();
	register_fn_kind();
	register_derived_kind();
}
/** Island props carry classes, stores, snippets, og.$ fns and resumable deriveds. */
var PROP_FAMILIES$1 = /* @__PURE__ */ new Set([
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
		payload = B64Url.encode(stringify$1(props, { [REF_WIRE_KEY]: ref_reducer(PROP_FAMILIES$1) }));
	} catch {
		return null;
	}
	if (payload.length > 8192) return null;
	return payload;
}
// ../../../core/dist/server/fingerprint.js
/**
* ISLAND FINGERPRINT (`data-og-fp`) — the server's identity for one island instance: its module
* URL + the canonical text of its props (server/props-wire.ts), 64 bits as 16 hex chars.
*
* What reads it: the runtime's sidecar lookup (`id="og-props-<fp>"`), the hydration self-heal
* copy, the reconciler's data-key on a client navigation, and the server-delta skip (the client
* sends the fingerprints it holds back in `x-ogygia-known`). Every one of them READS the emitted
* attribute — the client never recomputes an island's fingerprint (runtime/reconcile.ts computes
* one only for a region that carries none) — so the server is free to hash however is cheapest
* here, as long as two servers agree on the same input: SHA-1 through Node's native digest,
* ~4× the speed of the pure-JS lane hash on a 130 KB props text, and identical on every instance
* behind a load balancer.
*
* NOT for a hole's identity (`data-og-hole`): the client leg of a Kit-hydrated document recomputes
* that one, so it stays on the universal `fingerprint_of` (runtime/hash.ts) on both legs.
*
* Server-only (`node:crypto`), reached from Region.svelte through the client-stubbed
* `virtual:ogygia/region-endpoint` — Region computes a fingerprint only on the server.
*/
function island_fingerprint(entry, canonical) {
	return createHash("sha1").update(entry).update(" ").update(canonical).digest("hex").slice(0, 16);
}
// ../../../core/dist/server/region-endpoint.js
/** A hole's own stylesheet hrefs, by region id — the list its endpoint answer links (hooks.ts
*  `region_css_links`), for a render that inlines the hole in the page instead (Region.svelte). */
function holeCss(entry) {
	const url = island_url[entry];
	return url ? islandCss(url) : [];
}
/** Same families as encode_region_props — one seam law for island props. */
var PROP_FAMILIES = /* @__PURE__ */ new Set([
	"wire",
	"store",
	"snippet",
	"fn",
	"derived"
]);
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
* SERVER-DELTA NAV (D3) — the set of region fingerprints the CLIENT already has live, sent on an
* SPA nav via `x-ogygia-known`. Region.svelte consults this to SKIP re-rendering an island the
* client is keeping. Honored ONLY on an SPA nav (`x-ogygia-spa`); a full page load has no header →
* empty set → everything renders. Memoized per request-event (parsed once). Client-stubbed to empty.
* A missing/oversized header is always the SAFE full render — this is a pure optimization signal.
*/
var KNOWN_FPS = /* @__PURE__ */ new WeakMap();
var EMPTY_FPS = /* @__PURE__ */ new Set();
function known_region_fps() {
	let event;
	try {
		event = getRequestEvent();
	} catch {
		return EMPTY_FPS;
	}
	const cached = KNOWN_FPS.get(event);
	if (cached !== void 0) return cached;
	let set;
	try {
		const known = event.request.headers.get("x-ogygia-spa") ? event.request.headers.get("x-ogygia-known") : null;
		set = known ? new Set(known.split(",")) : /* @__PURE__ */ new Set();
	} catch {
		set = /* @__PURE__ */ new Set();
	}
	KNOWN_FPS.set(event, set);
	return set;
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
	const exp = capability_expiry(Math.floor(Date.now() / 1e3), mint_ttl_sec({
		stored,
		shared: stored || session !== "" ? 0 : document_shared_lifetime(current_request()),
		region_ttl: regionTtl
	}));
	const key = signing_key();
	const ttl_field = ttl > 0 ? String(Math.floor(ttl)) : "";
	const render = island_render[entry] ?? "";
	const sig = sign(key.secret, region_mac_message(entry, exp, payload, session, ttl_field, render));
	const ttl_param = ttl_field ? `&ttl=${ttl_field}` : "";
	return `${resolve(islands_endpoint())}?id=${encodeURIComponent(entry)}${render ? `&r=${render}` : ""}&props=${payload}&exp=${exp}${ttl_param}&sig=${sig}&k=${key.fp}`;
}
/**
* Server-island mint: encode `props` (devalue + wire codec), enforce the size cap (THROW — a server
* island with oversized/non-serializable props is an author bug the handle would reject anyway), and
* sign. The one place `Region.svelte`'s `__mode: 'server'` branch signs its hole; routed through the
* `virtual:ogygia/region-endpoint` virtual so the client build stubs it to `''` (server islands never
* mint on the client — the runtime fetches the endpoint). Mirrors the old `ServerIsland.svelte`.
*/
function mintServerIsland(entry, props, ttl = 0) {
	ensure_prop_kinds();
	const payload = B64Url.encode(stringify$1(props, { [REF_WIRE_KEY]: ref_reducer(PROP_FAMILIES) }));
	if (payload.length > 8192) throw new Error(`[ogygia] server island "${entry}": props payload is ${payload.length} b64 chars (max ${MAX_REGION_PROPS_LEN}). Shrink what you pass into the deferred region — the handle would reject this capability anyway.`);
	return mint_region_capability(entry, payload, ttl);
}
/** HMAC-signed `<endpoint>?id&props&exp&sig` (`handle({ endpoint })`, default `/__ogygia__`) for re-rendering `entry` with `props`. */
function makeRegionEndpoint(entry, props = {}) {
	const payload = encode_region_props(props);
	if (payload == null) {
		console.warn(`[ogygia] render:'live' region ${entry} has props that cannot cross the wire (non-serializable or >${MAX_REGION_PROPS_LEN} b64 chars) — no revalidate endpoint minted (behaves like a static lake).`);
		return "";
	}
	return mint_region_capability(entry, payload);
}
// ../../../core/src/region.ts
/** Brand so the transport can recognize a region without false-matching plain objects. */
/** context.ts's LAKE key (`isInLake`), by its global name — context.ts reaches virtual modules. */
var LAKE_SUBTREE_KEY = Symbol.for("ogygia.lake-subtree");
/** True for any value produced by {@link region} (or decoded from the wire). */
function isRegion(value) {
	return typeof value === "object" && value !== null && value[REGION_BRAND] === true;
}
function isBinding(value) {
	return (typeof value === "object" || typeof value === "function") && value !== null && typeof value.__ogRegion === "string";
}
/** `region()` itself; the export below adds `region.snippet`. */
function make_region(component, props, opts, content_id) {
	const p = props ?? {};
	const o = opts ? opts(props) : void 0;
	if (isBinding(component)) {
		if (!component.__component || !component.__sign) {
			if (typeof component === "function") return make_inline_awaitable({
				[REGION_BRAND]: true,
				kind: "inline",
				component,
				props: p,
				...content_id ? { content_id } : {}
			});
			throw new Error("[ogygia] a `with { region: 'raw' }` component must be turned into a region on the server (the signer lives server-side). Call region() in a load / remote / render context, not in client code.");
		}
		const hydrate = o?.wake ?? component.__hydrate;
		const hydrateMargin = o?.margin ?? component.__hydrateMargin;
		return make_awaitable({
			[REGION_BRAND]: true,
			kind: "dual",
			component: component.__component,
			props: p,
			id: component.__ogRegion,
			module: component.__module,
			...hydrate ? { hydrate } : {},
			...hydrateMargin ? { hydrateMargin } : {},
			sign: component.__sign,
			...component.__renderHtml ? { renderHtml: component.__renderHtml } : {}
		});
	}
	return make_inline_awaitable({
		[REGION_BRAND]: true,
		kind: "inline",
		component,
		props: p,
		...content_id ? { content_id } : {}
	});
}
/**
* Give an inline region a non-enumerable `then` so `await`-ing it (server-side) renders the
* component to HTML and resolves to a plain (non-thenable) inline region carrying that HTML — which
* is what lets it cross the wire as an HTML-only ticket (see the transport). Mirrors
* {@link make_awaitable} for duals; `svelte/server` is imported lazily and only on the server, so
* this module stays browser-safe. Awaiting on the client settles to an unchanged copy.
*/
function make_inline_awaitable(inline) {
	Object.defineProperty(inline, "then", {
		enumerable: false,
		configurable: true,
		writable: true,
		value(onFulfilled, onRejected) {
			const run = async () => {
				if (typeof document !== "undefined") return { ...inline };
				if (inline.html != null) return { ...inline };
				const { render } = await import('./server2.js-Uy3-wDrF.js');
				await kit_page_ready();
				const context = kit_render_context();
				context.set(LAKE_SUBTREE_KEY, true);
				const r = await render(inline.component, {
					props: inline.props,
					context
				});
				const nested = region_css_tags(r.head);
				return {
					...inline,
					html: nested + r.body + kit_page_facts_tail()
				};
			};
			return run().then(onFulfilled, onRejected);
		}
	});
	return inline;
}
/**
* Give a dual region a non-enumerable `then` so `await`-ing it renders the component to HTML and
* resolves to a plain (non-thenable) dual region carrying that HTML. Non-enumerable so a spread or
* `devalue` walk never copies it (which would re-arm the thenable / try to serialize a function);
* the transport reads only the data fields. A held region with no `renderHtml` (SSR leg absent) is left
* un-awaitable — awaiting it would be a no-op and only masks a mis-wired build.
*/
function make_awaitable(dual) {
	if (!dual.renderHtml) return dual;
	Object.defineProperty(dual, "then", {
		enumerable: false,
		configurable: true,
		writable: true,
		value(onFulfilled, onRejected) {
			const run = async () => {
				const html = dual.renderHtml ? await dual.renderHtml(with_portable_forms(dual.props)) : void 0;
				return {
					...dual,
					...html != null ? { html } : {}
				};
			};
			return run().then(onFulfilled, onRejected);
		}
	});
	return dual;
}
/**
* INTERNAL (content formats): an inline region whose SSR HTML is already known — a serialized-region
* content body, baked at markdown-compile time. Renders like any inline region (the component is the
* thin `{@html}` shell the emitter produced); awaiting it is a no-op because the HTML is present from
* birth, so the wire crossing never pays a svelte/server render.
*/
function prebaked_region(component, html, content_id) {
	return make_inline_awaitable({
		[REGION_BRAND]: true,
		kind: "inline",
		component,
		props: {},
		html,
		...content_id ? { content_id } : {}
	});
}
/**
* Make a held region with type-checked props.
*
* - A plain component import → an **inline** region (renders in this pass; can't cross the wire).
* - A component imported `with { region: 'raw' }` → a **dual** region: inline where it's made,
*   a signed ticket where it travels. Minting the marked form is server-only (the signer lives on
*   the SSR leg) — call it in a load / remote / render context.
*
* **A dual region is awaitable.** `await region(Card, props)` renders the component to HTML on
* the server and bakes it into the ticket, so the client swaps it in with no extra request. In an
* async generator (`query.live`) or an async remote, `yield region(…)` / `return region(…)` is
* awaited by the language, so the HTML travels automatically — LiveView over the channel you already
* have. A held region you *don't* await renders inline where it lands (first paint, same SSR pass).
*/
var region = Object.assign(make_region, { snippet: region_snippet });
// ../../../core/src/LateIslandAwait.svelte
function LateIslandAwait($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* LateIsland.svelte, for an app that runs Svelte's async mode: the build imports this one in its
		* place (vite/late-island.ts). The load is awaited, so the navigation's update batch waits for it
		* and Kit keeps the old page until the island's code is in — then swaps the whole new page at once
		* (an island nested in it awaits in the same batch). Without async mode this file does not compile,
		* which is why it is never the default.
		*/
		/** @type {{ load: () => Promise<import('svelte').Component>, props: Record<string, unknown>, children?: import('svelte').Snippet }} */
		let { load, props, children } = $$props;
		var Component;
		var $$promises = $$renderer.run([async () => Component = await load().catch(() => void 0)]);
		$$renderer.async_block([$$promises[0]], ($$renderer) => {
			if (Component) {
				$$renderer.push("<!--[0-->");
				$$renderer.async_block([$$promises[0]], ($$renderer) => {
					Component($$renderer, spread_props([props, {
						children: ($$renderer) => {
							children?.($$renderer);
							$$renderer.push(`<!---->`);
						},
						$$slots: { default: true }
					}]));
				});
			} else $$renderer.push("<!--[-1-->");
		});
		$$renderer.push(`<!--]-->`);
	});
}
// ../../../core/src/frame.ts
/**
* Address of a region: the CALL that produced it — region id + serialized props — NOT the full
* signed URL. Critically, `exp` and `sig` vary per request (they're time + MAC), so keying on the
* whole URL would give the same call a different address every request, and a mutation's fresh
* region could never update a mounted one. Keying on `id|props` makes the address stable across
* requests: same component + same props ⇒ same address, so single-flight updates land in place and
* identical twins dedupe. Falls back to the raw endpoint when there's no query to parse.
*/
function frameAddress(endpoint) {
	const q = endpoint.indexOf("?");
	if (q === -1) return endpoint;
	const params = new URLSearchParams(endpoint.slice(q + 1));
	const id = params.get("id");
	const props = params.get("props");
	const pv = params.get("pv");
	return id != null ? `${id}|${props ?? ""}${pv ? "|" + pv : ""}` : endpoint.slice(0, q);
}
// ../../../core/src/runtime/frame-store.ts
/** Frame addresses live in the hub's watcher space under a namespace, so region binders subscribe
*  through the ONE hub `watch`/`notify` primitive (hub v2 phase W) — the frame store no longer owns
*  a parallel subscriber set. Fetch orchestration (ticket, inflight, reserve, evict) stays here. */
var frame_id = (a) => "frame:" + a;
/** Entries with no subscribers linger this long (ms) so quick remounts / SPA swaps reuse content. */
var EVICT_TTL = 6e4;
var GLOBAL_KEY = "__ogygia_frames__";
var store_host = typeof globalThis !== "undefined" ? globalThis : {};
var entries = store_host[GLOBAL_KEY] ?? (store_host[GLOBAL_KEY] = /* @__PURE__ */ new Map());
function entry(a) {
	let e = entries.get(a);
	if (!e) {
		e = {
			v: 0,
			html: null,
			seq: 0,
			inflight: null,
			evict: null
		};
		entries.set(a, e);
	}
	return e;
}
/**
* Let an idle entry (no subscribers, no in-flight fetch) linger EVICT_TTL, then drop it. A late binder
* that mounts inside the window still catches its content (prefetch / batch-stream ahead of the DOM);
* nothing bound means nothing to keep. Idempotent — resets the timer. Both channels that leave an
* entry idle call this: a subscriber unbinding, AND a `write()` that lands where nothing is listening
* (a single-flight mutation for an unmounted region, or a live tick whose address keeps changing).
* Without the write path, those orphan entries would accumulate forever — they never had a subscriber
* to trigger eviction.
*/
function schedule_evict(a, e) {
	if (watcher_count(frame_id(a)) > 0 || e.inflight) return;
	if (e.evict) clearTimeout(e.evict);
	e.evict = setTimeout(() => {
		const cur = entries.get(a);
		if (cur === e && watcher_count(frame_id(a)) === 0 && !cur.inflight) entries.delete(a);
	}, EVICT_TTL);
}
/** Next request ticket for an address. External channels (streaming, mutations) use this too. */
function ticket(a) {
	return ++entry(a).seq;
}
/**
* Write a frame. Applied only if strictly newer than the current content; stale writes are
* dropped and reported `false`. Subscribers are notified on apply.
*/
function write(f) {
	const e = entry(f.a);
	if (f.v <= e.v) return false;
	if (f.v > e.seq) e.seq = f.v;
	e.v = f.v;
	e.html = f.html;
	const held = e.inflight;
	if (held?.settle) {
		e.inflight = null;
		held.settle(f.html);
	}
	notify(frame_id(f.a), f);
	schedule_evict(f.a, e);
	return true;
}
// ../../../core/src/transport.ts
/**
* `ogygiaTransport` — the SvelteKit `transport` entry that lets a held region cross the wire.
*
* A held region holds a live component, which devalue can't serialize. This teaches the wire to carry
* one: at **encode** (server → wire) it signs the capability and drops the component, sending just
* the ticket; at **decode** (client) it rebuilds a `deferred` region. It fires only when a
* held region actually crosses the wire — an inline region rendered in the same pass never touches it.
*
* Install once, in the app's UNIVERSAL hooks (kept separate from `ogygiaHandle`, which is
* server-only), so no server code leaks into the client:
*
* ```ts
* // src/hooks.ts
* import { ogygiaTransport } from 'ogygia';
* export const transport = { ...ogygiaTransport };
* ```
*/
/** The region ENCODE law (ticket pass-through / dual signs at crossing / awaited-inline bakes /
*  inline-unawaited throws), byte-for-byte the pre-hub behavior. */
function encode_region(value) {
	{
		if (typeof value !== "object" || value === null) return false;
		const f = value;
		if (f[REGION_BRAND] !== true) return false;
		if (f.kind === "deferred") return pack(f.id, f.props, f.url, f.module, f.hydrate, f.hydrateMargin, f.html);
		if (f.kind === "dual") {
			const sign = f.sign;
			const props = f.props ?? {};
			return pack(f.id, props, sign(f.id, props), f.module, f.hydrate, f.hydrateMargin, f.html);
		}
		if (typeof f.html === "string") return pack("", f.props ?? {}, "", "", void 0, void 0, f.html);
		throw new Error("[ogygia] a held region reached the wire but its component is a plain import, so nothing built a chunk for it. `await` the region before returning it from a remote/load — an awaited region bakes its SSR HTML and crosses as an HTML-only ticket. Or import the component `with { region: 'raw' }` (or a `wake:` mark) to make it a signed, fetchable capability. On a csr=false page you can also skip the wire entirely: call `get()` in a universal `+page.ts` load / the component — its data reaches the render by reference.");
	}
}
/** The region DECODE law (single-flight frame write for baked HTML + deferred rebuild),
*  byte-for-byte the pre-hub behavior. */
function decode_region(raw) {
	if (raw.x != null && raw.u && typeof document !== "undefined") {
		const a = frameAddress(raw.u);
		write({
			a,
			v: ticket(a),
			html: raw.x
		});
	}
	return {
		[REGION_BRAND]: true,
		kind: "deferred",
		id: raw.i,
		props: raw.p,
		url: raw.u,
		module: raw.m,
		...raw.h ? { hydrate: raw.h } : {},
		...raw.g ? { hydrateMargin: raw.g } : {},
		...raw.x != null ? { html: raw.x } : {}
	};
}
/**
* A region value AS THE BROWSER RECEIVES IT: through the crossing (encode, then decode) on the server,
* itself in the browser (it already crossed). A promise `of` resolves to a wire value — a remote's
* answer — so a server render that awaits one renders this form, the same shape the browser hydrates
* against (PromiseRegionAwait.svelte). Not a region: unchanged. A plain inline region nothing awaited
* throws, exactly as the crossing would.
*/
function wire_form(value) {
	if (typeof document !== "undefined") return value;
	const encoded = encode_region(value);
	return encoded === false ? value : decode_region(encoded);
}
function pack(id, props, url, module, hydrate, hydrateMargin, html) {
	const out = {
		i: id,
		p: props,
		u: url,
		m: module
	};
	if (hydrate) out.h = hydrate;
	if (hydrateMargin) out.g = hydrateMargin;
	if (html != null) out.x = html;
	return out;
}
// ../../../core/src/PromiseRegionAwait.svelte
function PromiseRegionAwait($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* PromiseRegion.svelte, for an app that runs Svelte's async mode: the build imports this one in its
		* place (vite/late-island.ts). The promise is AWAITED IN THE RENDER: the server render waits for it
		* (Kit seeds a remote query's result into the page), hydration awaits the same value, and the page
		* arrives with the region in it — no placeholder flash, no client fetch. The value renders in its
		* WIRE form on both sides (`wire_form`: what crossed, as the browser has it), baked: its first HTML
		* is in the page, and every later value (a refresh) morphs in.
		*
		* Inside a document that delivers late chunks (the server router's streamed document), the late
		* slot still wins: the document streams instead of waiting. Without async mode this file does not
		* compile, which is why it is never the default.
		*/
		/** @type {{ of: Promise<import('./region.ts').RegionValue>, placeholder?: import('svelte').Snippet, children?: import('svelte').Snippet }} */
		let { of, placeholder, children } = $$props;
		const late_slot = typeof window === "undefined" ? register_late_region(of) : null;
		if (late_slot) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<og-late-slot${attr("data-og-slot", late_slot)} style="display:contents">`);
			placeholder?.($$renderer);
			$$renderer.push(`<!----></og-late-slot>`);
		} else {
			$$renderer.push("<!--[-1-->");
			$$renderer.child_block(async ($$renderer) => {
				Region($$renderer, {
					of: wire_form((await save(of))()),
					placeholder,
					children,
					__baked: true
				});
			});
		}
		$$renderer.push(`<!--]-->`);
	});
}
// ../../../core/src/LakeBoundary.svelte
function LakeBoundary($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { children } = $$props;
		setNested(false);
		setInLake();
		children?.($$renderer);
		$$renderer.push(`<!---->`);
	});
}
// ../../../core/src/SlotBoundary.svelte
function SlotBoundary($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* The nested-context RESET around an island's in-place slot children. Region `setNested()`s for its
		* subtree so islands rendered INSIDE an island degrade to plain inline components — but slot children
		* belong to the HOST page, not the island: an island inside them must render as a FULL region
		* (`<ogygia-region>` + payload) so the runtime can wake it independently after the parent ADOPTS the
		* slot DOM. Server-only in practice (the client adopts, never re-renders slot children).
		*/
		let { children } = $$props;
		setNested(false);
		children?.($$renderer);
		$$renderer.push(`<!---->`);
	});
}
// ../../../core/src/Region.svelte
function Region($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* Every prop is optional: a HELD usage passes only `of`, a PLACEMENT usage (the transform's
		* wrappers) passes only the `__*` internals — so `<Region of={value} />` type-checks for consumers
		* without the internal props.
		* @type {{
		*   of?: import('./region.ts').RegionValue | Promise<import('./region.ts').RegionValue>;
		*   placeholder?: import('svelte').Snippet;
		*   children?: import('svelte').Snippet;
		*   __mode?: 'island' | 'server' | 'lake'; __baked?: boolean;
		*   visible?: string | boolean; idle?: boolean; media?: string; load?: boolean; interaction?: boolean;
		*   __keep?: string; __entry?: string; __src?: string; __component?: import('svelte').Component; __css?: unknown;
		*   __load?: () => Promise<import('svelte').Component>;
		*   __props?: Record<string, unknown>; __defer?: string; __margin?: string; __hydrate?: string;
		*   __hydrateMargin?: string; __module?: string; __cacheTtl?: number; __stitch?: string; __prefetch?: string;
		*   ogygiaFallback?: import('svelte').Snippet;
		*   __remount?: string; __when?: string; __maxAge?: number; __onExpire?: 'empty' | 'fetch';
		* }}
		*/
		let { of, placeholder, children, __baked = false, __mode, visible, idle, media, load, interaction, __keep, __entry = "", __src = "", __component, __css, __load, __props, __defer = "load", __margin, __hydrate, __hydrateMargin, __module = "", __cacheTtl, __stitch = "", __prefetch = "", ogygiaFallback, __remount = "cache", __when = "load", __maxAge, __onExpire } = $$props;
		const GT = String.fromCharCode(62);
		/**
		* ADOPTION — the one shape of every OPAQUE region (region-attrs.ts `OPAQUE_SELECTOR`: a lake, a hole,
		* a baked live region) a client hydrates over. Its inside is never a Svelte tree the browser could
		* render — server HTML, a fallback a fetched answer replaces, a server-only component — so it renders
		* through ONE snippet: the SERVER form emits exactly the region element with its inside, the CLIENT
		* form is a raw snippet, and hydration ADOPTS the element verbatim at its position — no walk into it,
		* no attribute set, nothing to mismatch (the adoption slot children get). As a template the browser
		* leg rendered placeholders, `{@html}` walks, or empty `endpoint`s over the server's DOM: Svelte
		* discarded it, threw, or blanked an address. CREATED FRESH in the browser instead (Kit remounting
		* after a failed hydration, a Kit client navigation, an `{#if}` re-creating it in an island or a
		* snippet) the element comes up empty, and each kind refills it from its own source of content: a
		* hole renders its fallback (the page's snippet: what the server showed until the answer lands, and
		* what an `interaction` hole is woken through), a lake repaints from the runtime's copy (lakes.ts), a
		* baked region morphs in its live value. `setup` sees the element either way.
		* @param {() => string} attrs the element's attribute text (both legs)
		* @param {(renderer: never) => void} [inner] SERVER: renders its inside into the element
		* @param {(el: Element) => void | (() => void)} [setup] CLIENT: the adopted (or created) element
		*/
		function adopt_region(attrs, inner, setup) {
			return typeof window === "undefined" ? (renderer) => {
				renderer.push("<ogygia-region" + attrs() + GT);
				inner?.(
					/** @type {never} */
					renderer
				);
				renderer.push("</ogygia-region>");
			} : createRawSnippet(() => ({
				render: () => "<ogygia-region" + attrs() + "></ogygia-region>",
				setup
			}));
		}
		/** Context mark: "this subtree renders inside Kit's own page pass" (see `kit_page_pass`). */
		const KIT_PAGE_PASS = Symbol.for("ogygia.kit-page-pass");
		const of_is_promise = !!of && typeof of.then === "function" && !isRegion(of);
		const resolved = derived(() => of_is_promise ? void 0 : /** @type {import('./region.ts').RegionValue | undefined} */ of);
		const holds_live = of_is_promise || of?.kind === "deferred";
		const of_init = of_is_promise ? void 0 : /** @type {import('./region.ts').RegionValue | undefined} */ of;
		const held_dual_island = !!(of_init && of_init.kind === "dual" && of_init.hydrate);
		const is_island = __mode === "island" || held_dual_island;
		const is_server = __mode === "server";
		const is_lake = __mode === "lake";
		const in_live_snippet = isInLiveSnippet();
		const nested = isNested() && !(is_server && in_live_snippet);
		if (is_island && nested && in_live_snippet) setInLiveSnippet(false);
		typeof window !== "undefined" && is_server ? getAllContexts() : void 0;
		let kit_page_pass = false;
		let ogygia_root = false;
		if (typeof window === "undefined") {
			const req = getContext(KIT_REQUEST_CONTEXT);
			kit_page_pass = getContext(KIT_PAGE_PASS) === true || !!(req && req.event == null);
			ogygia_root = !kit_page_pass && !!(req && req.event != null);
			if (kit_page_pass && getContext(KIT_PAGE_PASS) !== true) setContext(KIT_PAGE_PASS, true);
			if (req && req.event == null) {
				const event = kit_request_event();
				if (event) setContext(KIT_REQUEST_CONTEXT, {
					...req,
					event
				});
			}
		}
		const tail = typeof window === "undefined" && kit_page_pass ? document_tail() : null;
		function page_error_render() {
			try {
				return page.error != null;
			} catch {
				return false;
			}
		}
		const is_csr = documentIsCsrTrue(page_error_render()) && !isInLake() && !ogygia_root;
		const island_inline = nested || is_csr;
		if ((is_island || is_server) && !nested) setNested();
		if (is_server && nested) setHoleInline();
		const as_dual = derived(() => held_dual_island && resolved()?.kind === "dual" ? resolved() : void 0);
		const island_entry = derived(() => as_dual() ? as_dual().module : __mode === "island" ? __entry : "");
		const island_component = derived(() => as_dual() ? as_dual().component : __component);
		const late_load = derived(() => typeof window !== "undefined" && island_inline && !__component ? __load : void 0);
		const island_props = derived(() => as_dual() ? as_dual().props : __props);
		const island_children = derived(() => children);
		if (typeof window === "undefined") run(() => {
			const entry = nested ? "" : is_island ? island_entry() : is_server ? __hydrate ? __module : "" : of_is_promise ? "?" : of_init && of_init.kind === "deferred" ? of_init.module : "";
			const seed = !entry ? false : entry === "?" || !islandReadsPage(entry) ? entry === "?" ? "all" : false : islandPageKeys(entry) ?? "all";
			const remotes = !entry ? [] : entry === "?" ? null : islandRemotes(entry);
			try {
				record_page({
					data: page.data,
					form: page.form,
					error: page.error,
					status: page.status
				}, seed, remotes, entry === "?" ? "" : entry);
			} catch {}
		});
		const island_props_ready = derived(() => island_inline ? island_props() : prepare_region_props(island_props()));
		const slot_id = next_slot_id(run(() => island_entry()) ?? "");
		const has_slot_children = derived(() => !nested && island_children() != null);
		const slot_children = (renderer) => {
			renderer.push(slot_marker_open(slot_id));
			SlotBoundary(renderer, { children: island_children() });
			renderer.push(SLOT_MARKER_CLOSE);
		};
		const island_props_body = derived(() => has_slot_children() && typeof window === "undefined" ? {
			...island_props_ready(),
			children: slot_children
		} : island_props_ready());
		const island_props_wire = derived(() => has_slot_children() ? {
			...island_props_ready(),
			children: slot_pointer(slot_id)
		} : island_props_ready());
		const hydrate_attr = derived(() => as_dual() ? as_dual().hydrate : media ? media : idle ? "idle" : visible ? "visible" : interaction ? "interaction" : "load");
		const root_margin = derived(() => as_dual() ? as_dual().hydrateMargin || void 0 : typeof visible === "string" ? visible : void 0);
		const island_module_url = derived(() => nested || !island_entry() ? "" : kit_asset(island_entry()));
		const location_of = (identity) => {
			const found = identity ? entryLocation(identity) : null;
			return found ? kit_asset(found) : "";
		};
		const island_src = derived(() => nested || !island_entry() ? "" : __src || location_of(island_entry()));
		const island_wire = derived(() => nested || !is_island || island_inline ? null : plan_props_wire(island_props_wire(), island_entry()));
		const island_fp = derived(() => island_wire() ? island_fingerprint(island_module_url(), island_wire().canonical) : "");
		const island_skip = derived(() => is_island && !island_inline && !has_slot_children() && (__cacheTtl ?? 0) <= 0 && !!island_fp() && known_region_fps().has(island_fp()));
		const island_props_tail = !!tail && run(() => {
			const wire = island_wire();
			const fp = island_fp();
			if (!wire || !fp) return false;
			tail.props(fp, wire, {
				entry: island_entry(),
				name: island_component()?.name ?? "",
				module_url: island_src() || island_module_url(),
				wake: hydrate_attr(),
				interactivity: islandInteractivity(island_entry())
			});
			return true;
		});
		const island_props_inline = derived(() => island_props_tail || !island_wire() ? "" : props_sidecar(island_fp(), island_wire().wire(null), "adjacent", island_wire().wire_modules));
		/**
		* An island entry's graph: its chunks, as public URLs. Portable region-snippets riding the island's
		* props come alive via `import(desc.e)` at hydrate — their entries (+ deps) join the graph.
		* RENDER-GATED by construction: listed iff the island that carries the snippet rendered. The wire
		* plan found each descriptor's public entry URL in the payload (props-wire.ts).
		* @param {string} entry
		* @param {string} self_url
		* @param {readonly string[] | null | undefined} live_entries
		* @returns {string[]}
		*/
		function graph_hrefs(entry, self_url, live_entries) {
			const deps = islandDeps(entry);
			if (!live_entries?.length) return deps.map((dep) => kit_asset(dep));
			const seen = /* @__PURE__ */ new Set([self_url]);
			/** @type {string[]} */
			const hrefs = [];
			/** @param {string} href */
			const add = (href) => {
				if (href && !seen.has(href)) {
					seen.add(href);
					hrefs.push(href);
				}
			};
			for (const dep of deps) add(kit_asset(dep));
			for (const m of live_entries) {
				add(location_of(m) || kit_asset(m));
				for (const dep of islandDeps(m)) add(kit_asset(dep));
			}
			return hrefs;
		}
		const island_live_locations = derived(() => {
			const live = nested || !is_island ? null : island_wire()?.live_entries;
			if (!live?.length) return null;
			/** @type {Map<string, string>} */
			const out = /* @__PURE__ */ new Map();
			for (const m of live) {
				const loc = location_of(m);
				if (loc) out.set(m, loc);
			}
			return out.size ? out : null;
		});
		const island_graph_hrefs = derived(() => nested || !is_island || !island_module_url() ? [] : graph_hrefs(island_entry(), island_module_url(), island_wire()?.live_entries));
		const island_kit_hint_hrefs = derived(() => is_csr && hydrate_attr() === "load" && island_module_url() ? [island_src() || island_module_url(), ...island_graph_hrefs()] : []);
		const island_graph_tail = !!tail && run(() => {
			if (island_live_locations()) for (const [m, loc] of island_live_locations()) tail.locate(m, loc);
			if (island_kit_hint_hrefs().length) tail.hints(island_kit_hint_hrefs(), island_fp());
			else if (!is_csr && island_module_url()) {
				const hrefs = tail.graph_of(island_module_url()) ?? island_graph_hrefs();
				if (hrefs.length) tail.graph(island_module_url(), hrefs, island_fp(), island_src());
			}
			return true;
		});
		const island_preload_head = derived(() => island_graph_tail ? "" : island_kit_hint_hrefs().length ? island_kit_hint_hrefs().map(modulepreload_tag).join("") : !is_csr && (island_graph_hrefs().length || island_live_locations()) ? island_graph_script(/* @__PURE__ */ new Map([[island_module_url(), island_graph_hrefs()]]), island_live_locations()) : "");
		const server_endpoint = derived(() => {
			if (!is_server || nested) return "";
			return mintServerIsland(__entry, __props || {}, __cacheTtl || 0) + kit_page_version(__entry);
		});
		const server_region_entry = derived(() => !nested && __module ? kit_asset(__module) : "");
		const server_region_src = derived(() => !nested && __module ? __src || location_of(__module) : "");
		const server_wire = derived(() => nested || !__hydrate ? null : plan_props_wire(__props, __entry));
		const server_props_script = derived(() => server_wire() ? props_sidecar("", server_wire().wire(null), "adjacent", server_wire().wire_modules) : "");
		const server_identity = derived(() => nested || !is_server ? "" : fingerprint_of(__entry, "", (server_wire() ?? plan_props_wire(__props || {}, __entry)).canonical));
		const hole_attrs = () => {
			/** @param {string} name @param {unknown} v */
			const a = (name, v) => v == null || v === "" ? "" : " " + name + "=\"" + escape_attr(String(v)) + "\"";
			return " entry=\"" + escape_attr(server_region_entry()) + "\" render=\"defer\"" + a("stitch", __stitch) + a("prefetch", __prefetch) + a("when", __defer) + a("wake", __hydrate) + a("margin", __margin) + a("hydrate-margin", __hydrateMargin) + " endpoint=\"" + escape_attr(server_endpoint()) + "\"" + a("data-og-hole", server_identity()) + a("src", server_region_src());
		};
		const hole_adopt = adopt_region(hole_attrs, (renderer) => {
			if (ogygiaFallback) SlotBoundary(
				renderer,
				/** @type {never} */
				{ children: ogygiaFallback }
			);
		}, (el) => {
			if (el.firstChild || !ogygiaFallback) return;
			mount();
			return () => void unmount();
		});
		const hole_frozen = adopt_region(() => " entry=\"" + escape_attr(String(__entry || "")) + "\" wake=\"none\" remount=\"cache\"", (renderer) => {
			const Component = __component;
			if (Component) LakeBoundary(
				renderer,
				/** @type {never} */
				{ children: (r) => Component(r, __props || {}) }
			);
		});
		const hole_css_html = derived(() => {
			if (!is_server || !nested) return "";
			let html = "";
			for (const href of claim_region_css(holeCss(__entry || ""))) html += region_css_tag(href, kit_asset(href));
			return html;
		});
		if (tail && (is_csr || in_live_snippet) && is_server && !nested) run(() => {
			const endpoint = server_endpoint();
			if (endpoint) tail.hole(server_identity(), endpoint, server_props_script());
		});
		if (tail && is_server && !nested) run(() => tail.note_hole(__entry, __defer, __hydrate || null, __cacheTtl || 0, island_component()?.name ?? "", __props, server_endpoint() ? hole_copy_of(server_endpoint()) : ""));
		const server_graph_hrefs = derived(() => nested || !__module || !__hydrate || !server_region_entry() ? [] : graph_hrefs(__module, server_region_entry(), null));
		const server_fetch_preload = derived(() => {
			if (nested || building || __defer !== "load" || !server_endpoint()) return "";
			return "<link rel=\"preload\" as=\"fetch\" crossorigin=\"anonymous\" href=\"" + escape_amp(server_endpoint()) + "\">";
		});
		const server_graph_tail = !!tail && run(() => {
			if (server_graph_hrefs().length) tail.graph(server_region_entry(), server_graph_hrefs());
			return true;
		});
		const server_preload = derived(() => server_fetch_preload() + (server_graph_tail || !server_graph_hrefs().length ? "" : island_graph_script(/* @__PURE__ */ new Map([[server_region_entry(), server_graph_hrefs()]]))));
		const lake_inside = is_lake && nested;
		const lake_swr = derived(() => __remount === "swr");
		const lake_endpoint = derived(() => lake_inside && lake_swr() ? makeRegionEndpoint(__entry || "", __props || {}) : "");
		const lake_attrs = derived(() => {
			/** @param {unknown} v */
			const esc = (v) => escape_attr(String(v));
			let s = " entry=\"" + esc(__entry || "") + "\" wake=\"none\" remount=\"" + esc(__remount) + "\"";
			if (lake_swr()) s += " when=\"" + esc(__when) + "\"";
			if (__maxAge != null) s += " max-age=\"" + esc(String(__maxAge)) + "\"";
			if (__onExpire) s += " on-expire=\"" + esc(__onExpire) + "\"";
			if (lake_swr() && __margin) s += " margin=\"" + esc(__margin) + "\"";
			if (lake_endpoint()) s += " endpoint=\"" + esc(lake_endpoint()) + "\"";
			return s;
		});
		const lake_adopt = adopt_region(() => lake_attrs(), (renderer) => LakeBoundary(
			renderer,
			/** @type {never} */
			{ children }
		), (el) => {
			if (is_csr && !el.firstChild && false);
		});
		const runtime_script = !nested && (is_island && !is_csr || is_server || holds_live) && claimRuntimeEmit() ? runtime_bootstrap(kit_asset) + "" : "";
		const region_css_html = derived(() => {
			if (!resolved() || resolved().kind !== "dual" || !resolved().module) return "";
			let html = "";
			for (const href of claim_region_css(islandCss(resolved().module))) html += region_css_tag(href, kit_asset(href));
			return html;
		});
		const island_css_html = derived(() => {
			if (__mode !== "island" || !island_entry()) return "";
			let html = "";
			for (const href of claim_region_css(islandCss(island_entry()))) html += region_css_tag(href, kit_asset(href));
			return html;
		});
		const kit_island_meta = derived(() => {
			if (!is_island || !island_inline || !island_entry() || !claim_kit_island(island_entry())) return "";
			return "<meta name=\"ogygia-kit-island\" content=\"" + escape_amp_quot(String(island_entry())) + "\">";
		});
		const content_css_html = derived(() => {
			if (resolved()?.kind !== "inline" || !resolved().content_id) return "";
			let html = "";
			for (const href of claim_region_css(contentCss(resolved().content_id))) html += region_css_tag(href, kit_asset(href));
			return html;
		});
		const head_html = derived(() => (is_island ? runtime_script + island_preload_head() + island_css_html() + kit_island_meta() : is_server ? runtime_script + server_preload() + hole_css_html() : runtime_script) + region_css_html() + content_css_html());
		const stringify_devalue = stringify$1;
		const baked_html = __baked ? resolved()?.html ?? "" : "";
		const baked_adopt = adopt_region(() => " live data-og-baked", (renderer) => renderer.push(baked_html), (el) => {
			return () => null;
		});
		const held_props_script = derived(() => {
			if (!resolved() || resolved().kind !== "deferred" || !resolved().hydrate || !resolved().url) return "";
			return props_sidecar("", {
				text: stringify_devalue(resolved().props),
				json: false
			});
		});
		head("1c3ncy5", $$renderer, ($$renderer) => {
			$$renderer.push(`${html(head_html())}`);
		});
		if (is_island) {
			$$renderer.push("<!--[0-->");
			const Component = island_component();
			if (island_inline) {
				$$renderer.push("<!--[0-->");
				if (Component) {
					$$renderer.push("<!--[0-->");
					if (Component) {
						$$renderer.push("<!--[-->");
						Component($$renderer, spread_props([island_props_ready(), {
							children: ($$renderer) => {
								island_children()?.($$renderer);
								$$renderer.push(`<!---->`);
							},
							$$slots: { default: true }
						}]));
						$$renderer.push("<!--]-->");
					} else {
						$$renderer.push("<!--[!-->");
						$$renderer.push("<!--]-->");
					}
				} else if (late_load()) {
					$$renderer.push("<!--[1-->");
					LateIslandAwait($$renderer, {
						load: late_load(),
						props: island_props_ready(),
						children: island_children()
					});
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]-->`);
			} else if (island_skip()) {
				$$renderer.push("<!--[1-->");
				$$renderer.push(`<ogygia-region data-og-opaque=""${attr("entry", island_module_url())}${attr("wake", hydrate_attr())}${attr("margin", root_margin() || void 0)}${attr("data-ogygia-keep", __keep || void 0)}${attr("data-og-fp", island_fp() || void 0)} data-og-skipped=""${attr("src", island_src() || void 0)}></ogygia-region>${html(island_props_inline())}`);
			} else {
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<ogygia-region${attr("entry", island_module_url())}${attr("wake", hydrate_attr())}${attr("margin", root_margin() || void 0)}${attr("data-ogygia-keep", __keep || void 0)}${attr("data-og-fp", island_fp() || void 0)}${attr("src", island_src() || void 0)}>`);
				if (Component) {
					$$renderer.push("<!--[0-->");
					if (Component) {
						$$renderer.push("<!--[-->");
						Component($$renderer, spread_props([island_props_body()]));
						$$renderer.push("<!--]-->");
					} else {
						$$renderer.push("<!--[!-->");
						$$renderer.push("<!--]-->");
					}
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></ogygia-region>${html(island_props_inline())}`);
			}
			$$renderer.push(`<!--]-->`);
		} else if (is_server) {
			$$renderer.push("<!--[1-->");
			if (nested) {
				$$renderer.push("<!--[0-->");
				hole_frozen($$renderer);
			} else if (in_live_snippet || is_csr) {
				$$renderer.push("<!--[1-->");
				hole_adopt($$renderer);
				$$renderer.push(`<!---->${html(server_props_script())}`);
			} else {
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<ogygia-region${attr("entry", server_region_entry())} render="defer"${attr("stitch", __stitch || void 0)}${attr("prefetch", __prefetch || void 0)}${attr("when", __defer)}${attr("wake", __hydrate || void 0)}${attr("margin", __margin || void 0)}${attr("hydrate-margin", __hydrateMargin || void 0)}${attr("endpoint", server_endpoint())}${attr("data-og-hole", server_identity() || void 0)}${attr("src", server_region_src() || void 0)}>`);
				if (ogygiaFallback) {
					$$renderer.push("<!--[0-->");
					SlotBoundary($$renderer, {
						children: ($$renderer) => {
							ogygiaFallback($$renderer);
							$$renderer.push(`<!---->`);
						}});
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></ogygia-region>${html(server_props_script())}`);
			}
			$$renderer.push(`<!--]-->`);
		} else if (is_lake) {
			$$renderer.push("<!--[2-->");
			if (is_csr || lake_inside) {
				$$renderer.push("<!--[0-->");
				lake_adopt($$renderer);
			} else {
				$$renderer.push("<!--[-1-->");
				children?.($$renderer);
				$$renderer.push(`<!---->`);
			}
			$$renderer.push(`<!--]-->`);
		} else if (resolved()?.kind === "inline") {
			$$renderer.push("<!--[3-->");
			const Component = resolved().component;
			if (Component) {
				$$renderer.push("<!--[-->");
				Component($$renderer, spread_props([resolved().props, {
					children: ($$renderer) => {
						if (children) {
							$$renderer.push("<!--[0-->");
							children($$renderer);
							$$renderer.push(`<!---->`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]-->`);
					},
					$$slots: { default: true }
				}]));
				$$renderer.push("<!--]-->");
			} else {
				$$renderer.push("<!--[!-->");
				$$renderer.push("<!--]-->");
			}
		} else if (resolved()?.kind === "dual") {
			$$renderer.push("<!--[4-->");
			const Component = resolved().component;
			if (Component) {
				$$renderer.push("<!--[-->");
				Component($$renderer, spread_props([resolved().props, {
					children: ($$renderer) => {
						if (children) {
							$$renderer.push("<!--[0-->");
							children($$renderer);
							$$renderer.push(`<!---->`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]-->`);
					},
					$$slots: { default: true }
				}]));
				$$renderer.push("<!--]-->");
			} else {
				$$renderer.push("<!--[!-->");
				$$renderer.push("<!--]-->");
			}
		} else if (resolved()?.html != null) {
			$$renderer.push("<!--[5-->");
			if (__baked) {
				$$renderer.push("<!--[0-->");
				baked_adopt($$renderer);
			} else {
				$$renderer.push("<!--[-1-->");
				$$renderer.push(`<ogygia-region live="">`);
				if (placeholder) {
					$$renderer.push("<!--[0-->");
					placeholder($$renderer);
					$$renderer.push(`<!---->`);
				} else if (children) {
					$$renderer.push("<!--[1-->");
					children($$renderer);
					$$renderer.push(`<!---->`);
				} else $$renderer.push("<!--[-1-->");
				$$renderer.push(`<!--]--></ogygia-region>`);
			}
			$$renderer.push(`<!--]-->`);
		} else if (resolved()) {
			$$renderer.push("<!--[6-->");
			const d = resolved();
			$$renderer.push(`<!---->`);
			$$renderer.push(`<ogygia-region${attr("entry", d.module || "")} render="defer" when="load"${attr("wake", d.hydrate || void 0)}${attr("hydrate-margin", d.hydrateMargin || void 0)}${attr("endpoint", d.url)}${attr("src", location_of(d.module || "") || void 0)}>`);
			if (placeholder) {
				$$renderer.push("<!--[0-->");
				placeholder($$renderer);
				$$renderer.push(`<!---->`);
			} else if (children) {
				$$renderer.push("<!--[1-->");
				children($$renderer);
				$$renderer.push(`<!---->`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--></ogygia-region>${html(held_props_script())}`);
			$$renderer.push(`<!---->`);
		} else if (of_is_promise) {
			$$renderer.push("<!--[7-->");
			PromiseRegionAwait($$renderer, {
				of,
				placeholder,
				children
			});
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}

export { Region as R, prebaked_region as p, region as r };
//# sourceMappingURL=Region.js-DspBOxVI.js.map
