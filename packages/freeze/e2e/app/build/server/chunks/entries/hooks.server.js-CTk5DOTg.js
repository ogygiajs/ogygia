import { z as get_request_store, m as merge_tracing, w as with_request_store, y as try_get_request_store } from '../chunks/utils.js-Ca9I6N5J.js';
import { r as render, $ as html, Z as spread_props } from '../chunks/server.js-BBF-BCcH.js';
import { c as configure_islands_endpoint, i as islands_endpoint$1, D as DocumentTail, r as runtime_bootstrap, a as index_seed, b as analyze$1, W as WIRE_FORMAT_ATTR, d as WIRE_FORMAT_JSON, R as REGION_BRAND, k as kit_page_ready, C as ConcurrencyGate, e as is_region_id, f as is_region_ttl, g as register_wire_kind$1, h as register_store_kind$1, j as register_snippet_kind$1, l as register_fn_kind$1, m as register_derived_kind$1, n as REF_WIRE_KEY$1, o as ref_reviver, p as load_islands, q as kit_render_context$1, t as kit_page_facts_tail, u as capability_expiry$1, v as error_route_is_csr_true, w as route_is_csr_true, x as html_has_kit_bootstrap, y as is_word$1, z as escape_script_text, A as island_url, B as render_island, E as island_reads_page_data, F as region_css_tag, G as kit_asset, H as escape_amp_quot, I as is_lower_hex$1, J as ISLAND_GRAPH_ATTR, K as decode_island_graph, L as decode_island_locations, M as island_graph_script, N as escape_amp, O as ref_reducer$1, Q as set_kit_event_reader, S as set_render_page_port, T as set_kit_page_reader, U as regionTtl, V as island_name, X as region, Y as escape_text, Z as open_late_scope, _ as take_late_regions, $ as open_ask_scope, a0 as Region, a1 as read_seed_ask, a2 as claim_region_css, a3 as record_page, a4 as og_portable, a5 as set_ask_scope_opener, a6 as set_seed_ask_reader, a7 as set_page_recorder, a8 as set_tail_reader, a9 as set_measure_memo_reader, aa as set_late_scope_opener, ab as set_late_recorder, ac as set_late_taker } from '../chunks/Region.js-SNqDpRL3.js';
import { j as fnManifest, g as islandCss } from '../chunks/island-deps.js-DRCEB_nS.js';
import { h as stringify$1, p as parse, e as create_remote_key, u as unflatten } from '../chunks/shared.js-iXTe6R8-.js';
import { f as facts_of$1, n as note_cache_control, m as mark_per_visitor, r as renewable_expiry, s as signing_key, B as B64Url, c as current_facts, a as set_current_request } from '../chunks/payload.js-DW7rNLSc.js';
import { a as set_source_recorder } from '../chunks/source.js-B4t88Kxi.js';
import { S as SizedLru, f as freeze, n as normalize_prefix, p as prefix_tags, c as current_store, i as invalidate_tags, s as self_evict, a as freeze_get, j as join_flight, b as begin_flight, d as freeze_put, e as current_edges, g as set_freeze_app } from '../chunks/src.js-BillxaDL.js';
import { d as building } from '../chunks/internal.js-NlsCutcl.js';
import { f as flush_exposures, p as prime_flags, s as set_flags_app } from '../chunks/src2.js-DnmMGXlE.js';
import { d as private_env } from '../chunks/internal2.js-2Pg1NhOR.js';
import { c as hole_copy_key } from '../chunks/hash.js-C-SlWFdQ.js';
import { P as Plain, O as Off, F as Frozen, r as router_css_of, S as Shell } from '../chunks/Off.js-BtnpcuUx.js';
import '../chunks/async.js-BHxnfxQk.js';
import { createHmac, timingSafeEqual, hkdfSync, randomUUID, createHash } from 'node:crypto';
import '../chunks/uneval.js-CHOeF-6t.js';
import '../chunks/exports.js-C-11U8cd.js';
import '../chunks/paths.js-DM9UWvpx.js';
import '../chunks/routing.js-BCO6GjuO.js';
import '../chunks/remote.js-CcSc56f7.js';
import '../chunks/state2.js-CxjaPru1.js';
import 'node:fs';
import 'node:path';
import 'node:url';
import '../chunks/rolldown-runtime.js-CTrrmpyn.js';

/** @import { Handle, RequestEvent, ResolveOptions } from '@sveltejs/kit' */
/** @import { MaybePromise } from 'types' */

/**
 * A helper function for sequencing multiple `handle` calls in a middleware-like manner.
 * The behavior for the `handle` options is as follows:
 * - `transformPageChunk` is applied in reverse order and merged
 * - `preload` is applied in forward order, the first option "wins" and no `preload` options after it are called
 * - `filterSerializedResponseHeaders` behaves the same as `preload`
 *
 * ```js
 * /// file: src/hooks.server.js
 * import { sequence } from '@sveltejs/kit/hooks';
 *
 * /// type: import('@sveltejs/kit').Handle
 * async function first({ event, resolve }) {
 * 	console.log('first pre-processing');
 * 	const result = await resolve(event, {
 * 		transformPageChunk: ({ html }) => {
 * 			// transforms are applied in reverse order
 * 			console.log('first transform');
 * 			return html;
 * 		},
 * 		preload: () => {
 * 			// this one wins as it's the first defined in the chain
 * 			console.log('first preload');
 * 			return true;
 * 		}
 * 	});
 * 	console.log('first post-processing');
 * 	return result;
 * }
 *
 * /// type: import('@sveltejs/kit').Handle
 * async function second({ event, resolve }) {
 * 	console.log('second pre-processing');
 * 	const result = await resolve(event, {
 * 		transformPageChunk: ({ html }) => {
 * 			console.log('second transform');
 * 			return html;
 * 		},
 * 		preload: () => {
 * 			console.log('second preload');
 * 			return true;
 * 		},
 * 		filterSerializedResponseHeaders: () => {
 * 			// this one wins as it's the first defined in the chain
 * 			console.log('second filterSerializedResponseHeaders');
 * 			return true;
 * 		}
 * 	});
 * 	console.log('second post-processing');
 * 	return result;
 * }
 *
 * export const handle = sequence(first, second);
 * ```
 *
 * The example above would print:
 *
 * ```
 * first pre-processing
 * first preload
 * second pre-processing
 * second filterSerializedResponseHeaders
 * second transform
 * first transform
 * second post-processing
 * first post-processing
 * ```
 *
 * @param {...Handle} handlers The chain of `handle` functions
 * @returns {Handle}
 */
function sequence(...handlers) {
	const length = handlers.length;
	if (!length) return ({ event, resolve }) => resolve(event);

	return ({ event, resolve }) => {
		const { state } = get_request_store();
		return apply_handle(0, event, {});

		/**
		 * @param {number} i
		 * @param {RequestEvent} event
		 * @param {ResolveOptions | undefined} parent_options
		 * @returns {MaybePromise<Response>}
		 */
		function apply_handle(i, event, parent_options) {
			const handle = handlers[i];

			return state.tracing.record_span({
				name: `sveltekit.handle.sequenced.${handle.name ? handle.name : i}`,
				attributes: {},
				fn: async (current) => {
					const traced_event = merge_tracing(event, current);
					return await with_request_store({ event: traced_event, state }, () =>
						handle({
							event: traced_event,
							resolve: (event, options) => {
								/** @type {ResolveOptions['transformPageChunk']} */
								const transformPageChunk = async ({ html, done }) => {
									if (options?.transformPageChunk) {
										html = (await options.transformPageChunk({ html, done })) ?? '';
									}

									if (parent_options?.transformPageChunk) {
										html = (await parent_options.transformPageChunk({ html, done })) ?? '';
									}

									return html;
								};

								/** @type {ResolveOptions['filterSerializedResponseHeaders']} */
								const filterSerializedResponseHeaders =
									parent_options?.filterSerializedResponseHeaders ??
									options?.filterSerializedResponseHeaders;

								/** @type {ResolveOptions['preload']} */
								const preload = parent_options?.preload ?? options?.preload;

								return i < length - 1
									? apply_handle(i + 1, event, {
											transformPageChunk,
											filterSerializedResponseHeaders,
											preload
										})
									: resolve(event, {
											transformPageChunk,
											filterSerializedResponseHeaders,
											preload
										});
							}
						})
					);
				}
			});
		}
	};
}

// ../../src/adapters/akamai.ts
/**
* freeze — Akamai edge adapter: Fast Purge v3 (url + tag) with real EdgeGrid request signing.
*
* `headers(meta)` stamps the depth-capped PREFIX tags (`edge-cache-tag: p:/fr, p:/fr/fr, …`) the
* property stores by; `purgeWhere({ prefix })` purges the matching tag — Fast Purge has no
* arbitrary-prefix purge, tags ARE the prefix mechanism. `purgeUrl` purges by absolute URL.
*
* `baseUrl` override points the SAME adapter at the harness's edge emulator — e2e exercises this
* exact signing/requesting code, not a mock of it.
*/
var TRAILING_SLASHES_RE$1 = /\/+$/;
/** EdgeGrid timestamp: `yyyyMMddTHH:mm:ss+0000`. */
function edgegrid_timestamp() {
	const d = /* @__PURE__ */ new Date();
	const pad = (n) => String(n).padStart(2, "0");
	return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+0000`;
}
var b64_hmac = (key, data) => createHmac("sha256", key).update(data).digest("base64");
var b64_sha = (data) => createHash("sha256").update(data).digest("base64");
function akamai(config) {
	const network = config.network ?? "production";
	const api_base = (config.baseUrl ?? `https://${config.host}`).replace(TRAILING_SLASHES_RE$1, "");
	/** Real EdgeGrid signing (EG1-HMAC-SHA256) over the canonical request. */
	const signed_post = async (path, body) => {
		const payload = JSON.stringify(body);
		const timestamp = edgegrid_timestamp();
		const nonce = randomUUID();
		const auth_prefix = `EG1-HMAC-SHA256 client_token=${config.clientToken};access_token=${config.accessToken};timestamp=${timestamp};nonce=${nonce};`;
		const url = new URL(api_base + path);
		const data_to_sign = [
			"POST",
			url.protocol.replace(":", ""),
			config.host,
			url.pathname + url.search,
			"",
			b64_sha(payload),
			auth_prefix
		].join("	");
		const signature = b64_hmac(b64_hmac(config.clientSecret, timestamp), data_to_sign);
		const res = await fetch(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `${auth_prefix}signature=${signature}`
			},
			body: payload
		});
		if (!res.ok) throw new Error(`[ogygia] akamai purge failed: ${res.status} ${await res.text().catch(() => "")}`);
	};
	return {
		name: "akamai",
		headers(meta) {
			const tags = prefix_tags(meta.url).map((p) => `p:${p}`);
			const out = {};
			if (tags.length) out["edge-cache-tag"] = tags.join(", ");
			const max_age = config.maxAge ?? meta.ttl;
			if (max_age > 0) out["cache-control"] = `public, s-maxage=${max_age}`;
			return out;
		},
		async purgeUrl(url) {
			await signed_post(`/ccu/v3/invalidate/url/${network}`, { objects: [config.site.replace(TRAILING_SLASHES_RE$1, "") + url] });
		},
		async purgeWhere({ prefix }) {
			await signed_post(`/ccu/v3/invalidate/tag/${network}`, { objects: [`p:${normalize_prefix(prefix)}`] });
		}
	};
}
// ../../src/adapters/cloudfront.ts
/**
* freeze — CloudFront edge adapter: CreateInvalidation with real SigV4 request signing.
*
* CloudFront has NO tag purge — path invalidation with wildcards is native, so
* `purgeWhere({ prefix })` becomes `<prefix>/*` (+ the bare prefix path). `headers()` adds
* nothing: the distribution honors the origin's `cache-control` (stamped by the verdict).
*
* `baseUrl` override points the SAME adapter at the harness's edge emulator — e2e exercises
* this exact signing/requesting code, not a mock of it.
*/
var DASH_COLON_G = /[-:]/g;
var MILLISECONDS_RE = /\.\d{3}/;
var TRAILING_SLASHES_RE = /\/+$/;
var SERVICE = "cloudfront";
var REGION = "us-east-1";
var API_HOST = "cloudfront.amazonaws.com";
var API_VERSION = "2020-05-31";
var hex_sha = (data) => createHash("sha256").update(data).digest("hex");
var hmac = (key, data) => createHmac("sha256", key).update(data).digest();
/** amz dates: `20260901T120000Z` / `20260901`. */
function amz_dates() {
	const iso = (/* @__PURE__ */ new Date()).toISOString().replace(DASH_COLON_G, "").replace(MILLISECONDS_RE, "");
	return {
		datetime: iso,
		date: iso.slice(0, 8)
	};
}
function cloudfront(config) {
	const api_base = (config.baseUrl ?? `https://${API_HOST}`).replace(TRAILING_SLASHES_RE, "");
	const create_invalidation = async (paths) => {
		const items = paths.map((p) => `<Path>${p}</Path>`).join("");
		const body = `<?xml version="1.0" encoding="UTF-8"?><InvalidationBatch xmlns="http://cloudfront.amazonaws.com/doc/${API_VERSION}/"><CallerReference>og-${Date.now()}-${Math.floor(Math.random() * 1e6)}</CallerReference><Paths><Quantity>${paths.length}</Quantity><Items>${items}</Items></Paths></InvalidationBatch>`;
		const path = `/${API_VERSION}/distribution/${config.distributionId}/invalidation`;
		const { datetime, date } = amz_dates();
		const payload_hash = hex_sha(body);
		const canonical = [
			"POST",
			path,
			"",
			`host:${API_HOST}`,
			`x-amz-content-sha256:${payload_hash}`,
			`x-amz-date:${datetime}`,
			"",
			"host;x-amz-content-sha256;x-amz-date",
			payload_hash
		].join("\n");
		const scope = `${date}/${REGION}/${SERVICE}/aws4_request`;
		const string_to_sign = [
			"AWS4-HMAC-SHA256",
			datetime,
			scope,
			hex_sha(canonical)
		].join("\n");
		const k_signing = hmac(hmac(hmac(hmac("AWS4" + config.secretAccessKey, date), REGION), SERVICE), "aws4_request");
		const signature = createHmac("sha256", k_signing).update(string_to_sign).digest("hex");
		const res = await fetch(api_base + path, {
			method: "POST",
			headers: {
				host: API_HOST,
				"content-type": "text/xml",
				"x-amz-content-sha256": payload_hash,
				"x-amz-date": datetime,
				authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`
			},
			body
		});
		if (!res.ok) throw new Error(`[ogygia] cloudfront invalidation failed: ${res.status} ${await res.text().catch(() => "")}`);
	};
	return {
		name: "cloudfront",
		headers() {
			return {};
		},
		async purgeUrl(url) {
			await create_invalidation([url]);
		},
		async purgeWhere({ prefix }) {
			const p = normalize_prefix(prefix);
			await create_invalidation([p, `${p}/*`]);
		}
	};
}
// ../../../core/src/events/server-registry.ts
/** SSR render seams call this; the client (recorder unset) is a no-op, and the whole call DCEs off. */
function record_server_event(input) {}
/** DOM marker the server emits (before `</body>`) and `collect_provided_context` reads. */
var PAGE_CTX_MARKER = "data-ogygia-provide-page";
// ../../../core/src/context-bridge.ts
function ensure_ctx_kinds() {
	register_wire_kind$1();
	register_store_kind$1();
	register_snippet_kind$1();
	register_fn_kind$1();
	register_derived_kind$1();
}
/** The drop-in page-marker seam deliberately EXCLUDES snippets: there, a bare function must
*  THROW (and be dropped with a dev explanation) rather than be silently frozen as one. */
var BRIDGE_FAMILIES = /* @__PURE__ */ new Set([
	"wire",
	"store",
	"fn",
	"derived"
]);
/**
* Serialize for the drop-in `setContext` page marker WITHOUT the region-snippet reducer. That reducer
* treats every function as a snippet (snippets are unbranded functions), which would silently turn a
* `setContext('trackPageView', fn)` — or a class method — into a bogus snippet instead of failing.
* Here a function must THROW so the offending value gets dropped (see below). Transportables
* (`[ogygia.wire]`) and stores (auto-wired: value crosses, islands reunite to one live instance)
* cross. A snippet in context is a `<Provide>` concern, not this drop-in path.
*/
function stringify_bridgeable(value) {
	ensure_ctx_kinds();
	return escape_script_text(stringify$1(value, { [REF_WIRE_KEY$1]: ref_reducer$1(BRIDGE_FAMILIES) }));
}
function serialize_provided_context(map) {
	const obj = {};
	for (const [k, v] of map) obj[k] = v;
	try {
		return stringify_bridgeable(obj);
	} catch {
		const safe = {};
		for (const k in obj) try {
			stringify_bridgeable({ [k]: obj[k] });
			safe[k] = obj[k];
		} catch {}
		return Object.keys(safe).length ? stringify_bridgeable(safe) : null;
	}
}
var hole_stats = /* @__PURE__ */ new WeakMap();
var detailed = false;
function record_hole_stats(request, s) {
	hole_stats.set(request, s);
}
function request_stats_detailed() {
	return detailed;
}
// \0virtual:ogygia/rate-limit
var rateLimit = {
	"max": 60,
	"windowMs": 6e4
};
// \0virtual:ogygia/route-options
var route_options = {
	"/[lang]/[region]/act": {},
	"/[lang]/[region]/c/[slug]": {},
	"/[lang]/[region]/consent": {},
	"/[lang]/[region]/esi": {},
	"/[lang]/[region]/flagged": {},
	"/[lang]/[region]/hole": {},
	"/[lang]/[region]/live-header": {},
	"/[lang]/[region]/optout": { "freeze": false },
	"/[lang]/[region]/redirect-me": {},
	"/[lang]/[region]/setcookie": {},
	"/[lang]/[region]/stitched": {},
	"/[lang]/[region]/stream": {},
	"/spa": {}
};
// ../../../core/src/plugin/routes.ts
var slot = globalThis[Symbol.for("ogygia.route-options.v1")] ??= {
	routers: /* @__PURE__ */ new Map(),
	pages: /* @__PURE__ */ new Map()
};
/** A `routes()` table joins (keyed: dev re-evaluates hooks.server.ts and calls `routes()` again; a
*  matcher with the same key REPLACES its stale twin instead of shadowing it). */
function register_route_options(key, matcher) {
	slot.routers.delete(key);
	slot.routers.set(key, matcher);
}
/** Core only (hooks.ts): the Kit pages' declared values, baked by the compiler. */
function set_page_route_options(pages) {
	slot.pages = new Map(Object.entries(pages));
}
/** Kit's `(group)` segments dropped from a `route.id` (the compiler keys pages the same way). */
function strip_route_groups(id) {
	return "/" + id.split("/").filter(Boolean).filter((s) => !(s.startsWith("(") && s.endsWith(")"))).join("/");
}
/** This request's declared value for `option`, or `undefined` (use the plugin's default). A null
*  `routeId` is never normalized to `/` — that would be a different route. */
function route_option(option, route_id, pathname) {
	for (const matcher of slot.routers.values()) {
		const v = matcher(pathname, option);
		if (v !== void 0) return v ?? void 0;
	}
	if (route_id == null) return void 0;
	return slot.pages.get(strip_route_groups(route_id))?.[option];
}
// ../../../core/src/server/page-facts.ts
/**
* PAGE FACTS — the page a render outside its page belongs to (internal/notes/region-page-context.md).
*
* A hole renders in the islands endpoint's request, a region refreshed by a remote `query` /
* `command` in the remote call's: no page render around them, so no `page.data`. Their page is the
* same-origin `Referer`, and its data is looked up through Kit itself — the data request Kit's own
* client makes on a navigation (`<page>/__data.json`). The app's handle chain and the page's server
* loads run with the visitor's cookies: the facts are the server's, for this visitor, now; nothing
* the browser could forge or that a cache could have kept from someone else.
*
* Cheap by construction: the caller looks up only when a render reads `page.data`, once per request;
* only the answer's FIRST line is waited for (a streamed promise in the data resolves later, in the
* background, without holding the render); no regex.
*/
/** Marks ogygia's own lookup: the handle answers it without setting up a page render. */
var PAGE_FACTS_HEADER = "x-ogygia-page-facts";
/** The route id and params Kit matched for the looked-up page (the data alone carries neither). */
var PAGE_FACTS_ROUTE_HEADER = "x-ogygia-page-route";
/** Kit's data URL for a page, as its client builds it: the data suffix on the path, the page's
*  search kept, the trailing-slash marker when the path ends in `/`. */
function data_url_of(page) {
	const u = new URL(page.href);
	u.hash = "";
	const p = page.pathname;
	u.pathname = p.endsWith(".html") ? p.slice(0, -5) + ".html__data.json" : (p.endsWith("/") ? p.slice(0, -1) : p) + "/__data.json";
	if (p.endsWith("/")) u.searchParams.append("x-sveltekit-trailing-slash", "1");
	return u.href;
}
/**
* The page's facts, or a reason they are not available (a redirect, an error, a load that threw,
* not a Kit data answer). `decoders`: the app's `transport` decoders, as Kit's client uses them.
*/
async function look_up_page(page, fetch, decoders) {
	let res;
	try {
		res = await fetch(data_url_of(page), { headers: { [PAGE_FACTS_HEADER]: "1" } });
	} catch (e) {
		return { miss: `the data request failed (${String(e?.message ?? e)})` };
	}
	if (!res.ok || !res.body) {
		res.body?.cancel().catch(() => {});
		return { miss: `the data request answered ${res.status}` };
	}
	const reader = res.body.getReader();
	const text = new TextDecoder();
	let buf = "";
	let nl = -1;
	while ((nl = buf.indexOf("\n")) === -1) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += text.decode(value, { stream: true });
	}
	const first = nl === -1 ? buf : buf.slice(0, nl);
	const rest = nl === -1 ? "" : buf.slice(nl + 1);
	const stop = (miss) => {
		reader.cancel().catch(() => {});
		return { miss };
	};
	let head;
	try {
		head = JSON.parse(first);
	} catch {
		return stop("the answer is not Kit data");
	}
	if (head?.type === "redirect") return stop(`a load redirected to ${head.location}`);
	if (head?.type !== "data" || !Array.isArray(head.nodes)) return stop("the answer is not Kit data");
	const deferreds = /* @__PURE__ */ new Map();
	const revive = (flat) => unflatten(flat, {
		...decoders,
		Promise: (id) => {
			const p = new Promise((fulfil, reject) => deferreds.set(id, {
				fulfil,
				reject
			}));
			p.catch(() => {});
			return p;
		}
	});
	const data = {};
	try {
		for (const node of head.nodes) {
			if (node?.type === "error") return stop("a load threw");
			if (node?.type === "data") Object.assign(data, revive(node.data));
		}
	} catch (e) {
		return stop(`its data did not decode (${String(e?.message ?? e)})`);
	}
	if (deferreds.size) settle_streamed(reader, text, rest, deferreds, revive);
	else reader.cancel().catch(() => {});
	let route = { id: null };
	let params = {};
	const named = res.headers.get(PAGE_FACTS_ROUTE_HEADER);
	if (named) try {
		const r = JSON.parse(decodeURIComponent(named));
		route = { id: r.id ?? null };
		params = r.params ?? {};
	} catch {}
	return {
		url: page,
		params,
		route,
		data
	};
}
/** The streamed promises in the page's data, fulfilled as their lines arrive (Kit's `chunk` lines). */
async function settle_streamed(reader, text, buf, deferreds, revive) {
	const line = (raw) => {
		if (!raw) return;
		try {
			const chunk = JSON.parse(raw);
			if (chunk.type !== "chunk" || chunk.id === void 0) return;
			const d = deferreds.get(chunk.id);
			if (!d) return;
			deferreds.delete(chunk.id);
			if (chunk.error !== void 0) d.reject(revive(chunk.error));
			else d.fulfil(revive(chunk.data));
		} catch {}
	};
	try {
		for (;;) {
			let nl;
			while ((nl = buf.indexOf("\n")) !== -1) {
				line(buf.slice(0, nl));
				buf = buf.slice(nl + 1);
			}
			if (!deferreds.size) break;
			const { done, value } = await reader.read();
			if (done) break;
			buf += text.decode(value, { stream: true });
		}
		line(buf);
	} catch {} finally {
		reader.cancel().catch(() => {});
	}
}
// ../../../core/src/server/seed-shape.ts
/** Fold one region's ask into the request's union. */
function merge_seed_ask(current, ask) {
	if (ask === false) return current;
	if (ask === "all" || current === "all") return "all";
	const next = current ?? /* @__PURE__ */ new Set();
	for (const k of ask) next.add(k);
	return next;
}
/**
* The slice of `page.data` to ship. A plain object is picked down to `keys` (present keys only — a
* key the load never returned stays absent, so `page.data.x` is `undefined` on both legs alike);
* `'all'`, or a non-object (a load returned nothing, or something exotic), ships as is. A key
* whose value is a promise stays a promise: the streaming/settling that follows sees the same shape.
*/
function shape_page_data(data, keys) {
	if (keys === null || keys === "all") return data;
	if (data === null || typeof data !== "object" || Array.isArray(data)) return data;
	const src = data;
	const out = {};
	for (const k of keys) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
	return out;
}
// ../../../core/src/page-facts-script.ts
/**
* The script an answer carries with the page facts it rendered with (server/render-page.ts writes it,
* the runtime's answer seam `region_fragment` takes it out, seeds.ts merges it). Isomorphic: both
* halves name it from here.
*/
var PAGE_FACTS_SCRIPT_TYPE = "application/ogygia-page-facts";
// ../../../core/src/server/render-page.ts
var warn = null;
/** Where a dev warning goes (the handle's setting). */
function configure_render_page(o) {
	warn = o.warn;
}
/** A request rendering on behalf of a page it is not: the islands endpoint or a remote call. */
function renders_for_a_page(event) {
	return event.url.pathname.endsWith(islands_endpoint$1()) || event.isRemoteRequest === true;
}
/** The page a request renders for: the same-origin Referer of a request rendering for a page, else
*  the request's own url. */
function page_url_of(event) {
	if (!renders_for_a_page(event)) return event.url;
	const referer = event.request.headers.get("referer");
	if (!referer) return event.url;
	try {
		const page = new URL(referer);
		if (page.origin === event.url.origin) return page;
	} catch {}
	return event.url;
}
var looked_up = /* @__PURE__ */ new WeakMap();
var facts_of = /* @__PURE__ */ new WeakMap();
/**
* Before an async render root starts: in a request rendering FOR a page, that page's facts, looked
* up once. `reads_data`: does this render read `page.data` (`null`: unknown here — a remote call
* looks up, a hole relies on its tree's build answer). The venue is the request's kind, as Kit and
* the islands endpoint name it — never whether some per-request state happens to exist.
*/
function prepare_render_page(event, transport, reads_data) {
	if (!event || !renders_for_a_page(event)) return;
	if (!(reads_data ?? event.isRemoteRequest === true)) return;
	const request = event.request;
	const known = looked_up.get(request);
	if (known) return known;
	const page = page_url_of(event);
	if (page === event.url) return;
	const decoders = {};
	for (const name in transport ?? {}) decoders[name] = transport[name].decode;
	const p = look_up_page(page, event.fetch, decoders).then((facts) => {
		if ("miss" in facts) warn?.(`[ogygia] ${page.pathname}: the page's data for a render outside it is unavailable: ${facts.miss}. The render sees an empty page.data.`);
		else facts_of.set(request, facts);
	});
	looked_up.set(request, p);
	return p;
}
/**
* The page a render sees. `snapshot`: what this request's page render recorded, if anything. `null`
* when there is neither a snapshot nor a request (a render off-request: the caller's empty page).
*/
function render_page(snapshot, event) {
	if (!snapshot && !event) return null;
	if (event && renders_for_a_page(event)) {
		const facts = facts_of.get(event.request);
		return {
			url: facts?.url ?? page_url_of(event),
			params: facts?.params ?? {},
			route: facts?.route ?? { id: null },
			status: 200,
			data: facts && warn ? watched_data(facts, warn) : facts?.data ?? {},
			form: null,
			error: null,
			state: {}
		};
	}
	const snap = snapshot ?? {};
	return {
		url: snap.url?.href ? new URL(snap.url.href) : event?.url,
		params: snap.params ?? event?.params ?? {},
		route: snap.route ?? { id: event?.route.id ?? null },
		status: snap.status ?? 200,
		data: snap.data ?? {},
		form: snap.form ?? null,
		error: snap.error ?? null,
		state: {}
	};
}
/** Reads a component makes without meaning a page key (Svelte, devalue, a thenable check). */
var NOT_A_KEY = /* @__PURE__ */ new Set([
	"then",
	"toJSON",
	"constructor",
	"valueOf",
	"toString",
	"$$typeof",
	"nodeType"
]);
var warned_keys = /* @__PURE__ */ new WeakMap();
/**
* DEV: a render for a page reading a `page.data` key the page's server loads did not produce — most
* often one a UNIVERSAL load (`+page.ts` / `+layout.ts`) makes, which exists only inside a full page
* render. Said once per key, naming it, instead of rendering `undefined` silently (a header that
* comes out "signed out" with no error anywhere).
*/
function watched_data(facts, say) {
	return new Proxy(facts.data, { get(target, key, receiver) {
		if (typeof key === "string" && !NOT_A_KEY.has(key) && !(key in target)) {
			let seen = warned_keys.get(facts);
			if (!seen) warned_keys.set(facts, seen = /* @__PURE__ */ new Set());
			if (!seen.has(key)) {
				seen.add(key);
				say(`[ogygia] ${facts.url.pathname}: a region rendered outside its page read page.data.${key}, which this page's server loads do not produce. A key a universal load (+page.ts / +layout.ts) returns exists only inside a full page render: return it from a server load, or pass it as a prop.`);
			}
		}
		return Reflect.get(target, key, receiver);
	} });
}
var versions = /* @__PURE__ */ new WeakMap();
/**
* A HOLE'S ADDRESS NAMES ITS PAGE: the call (id + props) and the page facts its tree renders from.
* A region refreshed after the page's data changed (a locale saved) re-mints its holes with a new
* version, so each fetches its new answer; a refresh that changed nothing keeps the address and the
* answer it has. The version of this request's page: its looked-up facts (a render for a page) or
* its recorded snapshot (in the page) — hashed once per request; `''` when there is no data.
*/
function render_page_version(event, snapshot) {
	if (!event) return "";
	const known = versions.get(event.request);
	if (known !== void 0) return known;
	const data = renders_for_a_page(event) ? facts_of.get(event.request)?.data : snapshot?.data;
	let v = "";
	if (data && typeof data === "object") try {
		v = fnv1a(JSON.stringify(data));
	} catch {}
	if (v) versions.set(event.request, v);
	return v;
}
/** 32-bit FNV-1a, base36: a version tag, not a security boundary. */
function fnv1a(text) {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(36);
}
var asks_of = /* @__PURE__ */ new WeakMap();
/**
* An island rendering FOR a page asks for the `page.data` keys its client reads (Region.svelte's
* record, the build's answer): kept for the answer's facts. `true` when the request renders for a
* page — the ask is this model's, never a page render's snapshot.
*/
function note_render_page_ask(event, seed) {
	if (!renders_for_a_page(event)) return false;
	if (seed !== false) {
		const merged = merge_seed_ask(asks_of.get(event.request) ?? null, seed);
		if (merged) asks_of.set(event.request, merged);
	}
	return true;
}
/**
* ONE PAGE, NOT TWO: what an answer rendered FOR a page carries — the looked-up `page.data` keys its
* islands read, so they hydrate against the values their HTML was rendered from (the runtime merges
* them into the page store: seeds.ts). `''` when no island in it reads the page, the page was not
* looked up, or a value does not serialize (a still-streaming promise).
*/
function render_page_facts_script(event, transport) {
	if (!event || !renders_for_a_page(event)) return "";
	const facts = facts_of.get(event.request);
	const keys = asks_of.get(event.request);
	if (!facts || !keys) return "";
	const encoders = {};
	for (const name in transport ?? {}) encoders[name] = transport[name].encode;
	try {
		return `<script type="${PAGE_FACTS_SCRIPT_TYPE}">${stringify$1(shape_page_data(facts.data, keys), encoders)}<\/script>`;
	} catch {
		return "";
	}
}
// ../../../core/src/server/hole-urls.ts
/**
* Absolute URLs inside a hole's HTML.
*
* A server island renders in its OWN request — `/__ogygia__?…` — and Kit's `asset()` (with the
* default `paths.relative`) emits every URL relative to THAT request: `./_app/immutable/x.js`,
* `./__ogygia__?…`. The HTML then lands in a page at any depth (`/docs/guides/`), and a
* region entry / nested-hole endpoint / region-css link inside it would resolve against the page:
* `/docs/guides/_app/…` → 404, a dead island in a live hole. The batch parcel and an
* ESI-stitched hole (the CDN splices the bytes straight into the page) have the same problem, so
* the fix is on the server, once, at the point the response is assembled: resolve every relative
* ogygia URL against the endpoint request URL and emit it root-absolute (Kit `base` included).
* Absolute (`/…`) and scheme'd (foreign federation entries) values are left alone.
*/
var REGION_CSS_ATTR$1 = "data-ogygia-region-css";
function is_word(c) {
	return c >= 48 && c <= 57 || c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 95;
}
function resolve_attr(value, base) {
	if (!value || !(value.startsWith("./") || value.startsWith("../"))) return value;
	let resolved;
	try {
		resolved = new URL(value.indexOf("&amp;") === -1 ? value : value.replaceAll("&amp;", "&"), base);
	} catch {
		return value;
	}
	if (resolved.origin !== base.origin) return value;
	return escape_amp(resolved.pathname + resolved.search + resolved.hash);
}
/** Rewrite `name="…"` in `tag` (a word boundary before `name`; every occurrence, or the first). */
function rewrite_attr(tag, name, base, all) {
	const needle = name + "=\"";
	let out = "";
	let pos = 0;
	for (let at = tag.indexOf(needle); at !== -1; at = tag.indexOf(needle, at + needle.length)) {
		if (at > 0 && is_word(tag.charCodeAt(at - 1))) continue;
		const start = at + needle.length;
		const end = tag.indexOf("\"", start);
		if (end === -1) break;
		out += tag.slice(pos, start) + resolve_attr(tag.slice(start, end), base);
		pos = end;
		if (!all) break;
	}
	return pos === 0 ? tag : out + tag.slice(pos);
}
/** Does a tag named `name` open at `lt` (`<name` then a non-word character)? */
function opens(html, lt, name) {
	return html.startsWith(name, lt + 1) && !is_word(html.charCodeAt(lt + 1 + name.length));
}
/** Rewrite the relative `entry` / `src` / `endpoint` / region-css `href` values in `html` to root-absolute
*  paths resolved against `base` (the endpoint request URL). */
function absolutize_hole_html(html, base) {
	if (!html.includes("<ogygia-region") && !html.includes(REGION_CSS_ATTR$1)) return html;
	let out = "";
	let pos = 0;
	for (let lt = html.indexOf("<"); lt !== -1; lt = html.indexOf("<", lt + 1)) {
		const region = opens(html, lt, "ogygia-region");
		const link = !region && opens(html, lt, "link");
		const style = !region && !link && opens(html, lt, "style");
		if (!region && !link && !style) continue;
		const gt = html.indexOf(">", lt);
		if (gt === -1) break;
		const tag = html.slice(lt, gt + 1);
		let next = tag;
		if (region) next = rewrite_attr(rewrite_attr(rewrite_attr(tag, "entry", base, true), "src", base, true), "endpoint", base, true);
		else if (tag.indexOf(REGION_CSS_ATTR$1) !== -1) next = link ? rewrite_attr(tag, "href", base, false) : tag.indexOf(REGION_CSS_ATTR$1 + "=\"") !== -1 ? rewrite_attr(tag, REGION_CSS_ATTR$1, base, false) : tag;
		if (next !== tag) {
			out += html.slice(pos, lt) + next;
			pos = gt + 1;
		}
		lt = gt;
	}
	return pos === 0 ? html : out + html.slice(pos);
}
// ../../../core/src/keep-fallback-marker.ts
/**
* The parcel/store stand-in for "keep the fallback" (see ./keep-fallback.ts) — never applied to the
* DOM. A dependency-free leaf: the browser runtime's boot compares a hole's answer against it, and
* `keep-fallback.ts` itself imports the server-side context module (which reaches Svelte), which must
* never enter the boot's static graph.
*/
var KEEP_FALLBACK_HTML = "<!--ogygia:keep-fallback-->";
// ../../../core/src/keep-fallback.ts
var KEEP = Symbol.for("ogygia.keep-fallback");
/** Did a hole render end with {@link keepFallback}? (the handle's catch reads this) */
function is_keep_fallback(e) {
	return !!e && typeof e === "object" && e[KEEP] === true;
}
// ../../../core/src/server/hmac.ts
/**
* HMAC-SHA256 for region capability URLs — Node `createHmac` (sync).
*
* Used by `ogygiaHandle` and by SSR `virtual:ogygia/sign`. The client never imports this
* module: ServerIsland goes through `virtual:ogygia/sign`, which is a no-op on the client
* (secret is already empty there). Web Crypto is not used — browsers must not mint with a
* real secret.
*
* MAC format is versioned (`v1|…`) with UTF-8 length-prefixed fields so `\0` inside a
* field cannot shift boundaries. Signing keys are HKDF-derived (`ogygia-mac-v1`) from the
* raw secret so the id-salt domain stays separate.
*/
var MAC_INFO = Buffer.from("ogygia-mac-v1");
Buffer.from("ogygia-id-salt-v1");
var utf8 = new TextEncoder();
var mac_keys = /* @__PURE__ */ new Map();
/** HKDF-SHA256 → 32-byte MAC key (hex for stable logging / tests; Buffer used internally). */
function derive_mac_key(secret) {
	let key = mac_keys.get(secret);
	if (key === void 0) {
		key = Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), MAC_INFO, 32));
		if (mac_keys.size >= 16) mac_keys.clear();
		mac_keys.set(secret, key);
	}
	return key;
}
/** UTF-8 length-prefix so field contents cannot forge delimiters. */
function lp(s) {
	return `${utf8.encode(s).byteLength}:${s}`;
}
var Hmac = class Hmac {
	static sha256(key, message) {
		return createHmac("sha256", key).update(message, "utf8").digest("hex");
	}
	static sign(secret, message) {
		return Hmac.sha256(derive_mac_key(secret), message);
	}
	static verify(secret, message, sig) {
		if (typeof sig !== "string" || !is_lower_hex$1(sig, 64)) return false;
		const expected = Hmac.sha256(derive_mac_key(secret), message);
		try {
			return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
		} catch {
			return false;
		}
	}
	/**
	* MAC message for a signed region capability. Every field is length-prefixed (`<utf8 bytes>:<value>`),
	* so a field's content can never forge a `|` boundary. Two versions:
	*
	* - `v1|id|exp|props|session|ttl` — the capability names only its region `id` (the wrapper that
	*   minted it: component ⊕ page-side schedule ⊕ the build's salt). Only a build that has that
	*   exact id can answer it. Minted before render identities (ogygia ≤ 0.8.6); still verified, so
	*   pages cached before an upgrade keep their holes.
	* - `v2|id|exp|props|session|ttl|render` — the same five, plus the region's render identity (the
	*   URL's `r`: the component the endpoint renders, compiler/region/identity.ts `renderId`). Signing
	*   it lets a build that no longer has `id` (another schedule, preset or salt) answer the
	*   capability with its own entry for that component, and only for that component. Every current
	*   mint is `v2`.
	*
	* The version follows from the URL: a capability with `r` is checked as `v2`, one without as `v1`.
	* A `v2` MAC never verifies as `v1` (the prefix and the field count differ), so stripping `r` or
	* swapping it for another component breaks the signature. Empty `session`/`ttl` are still fields
	* (prerender / unbound / no-store) — never optional concat. `ttl` is the response cache max-age in
	* seconds (`''` = no-store); signing it keeps a harvested URL from being re-pointed at a longer
	* browser cache.
	*/
	static region_message(id, exp, props, session = "", ttl = "", render = "") {
		const v1 = `${lp(String(id))}|${lp(String(exp))}|${lp(String(props))}|${lp(String(session))}|${lp(String(ttl))}`;
		return render === "" ? `v1|${v1}` : `v2|${v1}|${lp(String(render))}`;
	}
};
var sign = Hmac.sign.bind(Hmac);
var verify = Hmac.verify.bind(Hmac);
var region_mac_message = Hmac.region_message.bind(Hmac);
// ../../../core/src/server/render-cache.ts
/**
* Server-side per-region HTML render cache (reconciler R6 — the SSR-compute lever).
*
* The deferred/held-region endpoint (`#render_component` in hooks.ts) is the ONE place ogygia
* renders a region out-of-band as (id + props) → HTML. Today it re-renders fresh every request.
* When a region opts into a positive `maxAge` (a signed `ttl` on its capability URL), the author
* has DECLARED its output stable for that window — so memoizing the render for `ttl` seconds turns
* an expensive region into a one-render-then-serve-cached region across ALL requests. That is the
* only server-compute win reachable without making the monolithic page render region-granular
* (which would need the off-limits compiler); a plain inline island never reaches this seam.
*
* CORRECTNESS: the cache key includes the SESSION seal, so a per-user (`private, max-age`) render
* is never served to another user — exactly matching the browser Cache-Control the same `ttl`
* produces. `ttl <= 0` (the default `no-store` hole) is never cached. Bounded in BYTES (a region
* render can be up to `MAX_REGION_BODY`, 2 MB) and in entries, TTL-expiring, so it can't grow
* unbounded across a long-lived server process (server/sized-lru.ts).
*/
var store = new SizedLru(67108864, 500);
/** Cache key for a region render — id + props payload + session seal. `exp`/`sig` (which rotate per
*  mint) and `ttl` (a cache-window declaration, not a render input) are DELIBERATELY excluded so
*  two renders of the same region+props+user hit; session is INCLUDED so users never cross. */
function render_cache_key(id, props_payload, session) {
	return id + " " + props_payload + " " + session;
}
/** Cached HTML for `key`, or null on miss/expiry. A live hit is an LRU touch. */
function render_cache_get(key, now) {
	return store.get(key, now);
}
/** Cache `html` for `ttl_sec` seconds. No-op for `ttl_sec <= 0` (dynamic holes are never cached). */
function render_cache_set(key, html, ttl_sec, now) {
	if (ttl_sec <= 0) return;
	store.set(key, html, html.length, now + ttl_sec * 1e3);
}
/**
* THE shared cache-fronted render (G2) — the ONE seam both the deferred-region endpoint
* (#render_component) and the inline-island page render (Region.svelte) call. A hit returns the
* memo; a miss renders via `render_body()` (the caller supplies it — the endpoint wraps its render
* in a concurrency gate + timeout, the inline path renders directly), then caches. `cache` is
* `undefined`/`ttl<=0` for a dynamic hole → always renders, never stores. `now` injected for tests.
*/
async function cached_render(render_body, cache, now, report) {
	if (cache !== void 0 && cache.ttl > 0) {
		const hit = render_cache_get(cache.key, now);
		if (hit !== null) {
			report?.("hit");
			return hit;
		}
	}
	const body = await render_body();
	if (cache !== void 0 && cache.ttl > 0 && body !== null) {
		render_cache_set(cache.key, body, cache.ttl, now);
		report?.("miss");
	} else report?.("none");
	return body;
}
// ../../../core/src/server/late-wire.ts
/**
* The LATE WIRE — how a region that resolves after the document flushed reaches the page down the SAME
* response. A slot (`<og-late-slot>`, also what `<Region of={promise}>` renders around its placeholder)
* sits in the flushed document; each later state rides down as an inert `<template data-og-late>` chunk
* that ONE small classic inline script in the head swaps in as it parses. Module scripts don't run until
* parsing ENDS, which for a streamed document is the very thing we're not waiting for. After an SPA
* navigation the runtime applies remaining templates itself (runtime/router-nav.ts).
*
* A renderer that delivers late chunks (the server router's streamed document) speaks this format; core
* owns it because core's components emit the slots and core's runtime consumes the chunks.
*/
/** Wrap html as the swappable slot `id` (display:contents — layout-invisible). */
function late_slot(id, html) {
	return `<og-late-slot data-og-slot="${id}" style="display:contents">${html}</og-late-slot>`;
}
/** A late chunk: inert template + nothing else — the boot script (or the runtime, post-SPA-swap)
*  performs the swap. Multiple chunks for one slot apply in order (progressive states). */
function late_chunk(id, html) {
	return `<template data-og-late="${id}">${html}</template>`;
}
/**
* The classic inline boot: observes streamed-in `<template data-og-late>` nodes DURING parse and
* swaps each into its slot immediately (stylesheet links hoist to head first so the swap never
* paints unstyled). Kept dependency-free and tiny — it must run before any module script can.
*/
var LATE_BOOT_SCRIPT = "<script data-og-late-boot>(function(){function ap(t){var id=t.getAttribute(\"data-og-late\");var s=document.querySelector('og-late-slot[data-og-slot=\"'+id+'\"]');if(!s){t.remove();return}var c=t.content;var ls=c.querySelectorAll('link[rel=\"stylesheet\"],style');for(var i=0;i<ls.length;i++){var l=ls[i];var h=l.getAttribute&&l.getAttribute(\"href\");if(h&&document.head.querySelector('link[href=\"'+h+'\"]'))l.remove();else document.head.appendChild(l)}while(s.firstChild)s.removeChild(s.firstChild);s.appendChild(c);t.remove()}var mo=new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var ad=ms[i].addedNodes;for(var j=0;j<ad.length;j++){var n=ad[j];if(n.nodeType===1&&n.tagName===\"TEMPLATE\"&&n.hasAttribute(\"data-og-late\"))ap(n)}}});mo.observe(document.documentElement,{childList:true,subtree:true});addEventListener(\"DOMContentLoaded\",function(){var ts=document.querySelectorAll(\"template[data-og-late]\");for(var i=0;i<ts.length;i++)ap(ts[i]);mo.disconnect()},{once:true});})()<\/script>";
// ../../../core/src/plugin/index.ts
/** Typed identity: a plugin's server half. */
function defineServer(plugin) {
	return plugin;
}
/** Stamped into a document served FROM a store (not the render that just happened): the browser
*  runtime then treats `render: 'live'` lakes as stale on first mount and revalidates them. */
var STORED_DOCUMENT_META = "<meta name=\"ogygia-freeze\" content=\"hit\">";
// ../../src/observe.ts
/** Personalization-bearing request headers: reading one during an eligible render disqualifies
*  the page. Everything else (host, sec-fetch-*, accept-encoding, …) is delivery plumbing. */
var DISQUALIFYING_HEADERS = /* @__PURE__ */ new Set([
	"cookie",
	"authorization",
	"accept-language",
	"user-agent",
	"referer",
	"x-user",
	"x-user-id",
	"x-session",
	"x-session-id"
]);
/** Default-valued reads still store: undefined/null/''/false, empty plain object, empty array. */
function is_default_value(value) {
	if (value === void 0 || value === null || value === "" || value === false) return true;
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === "object") {
		const proto = Object.getPrototypeOf(value);
		if (proto === Object.prototype || proto === null) return Object.keys(value).length === 0;
	}
	return false;
}
/**
* Patch `event.cookies` / `event.locals` / `event.request.headers` in place, recording reads.
* Returns the live observation the verdict reads after the render. Patching is per-request
* (the event dies with the request) — nothing to restore.
*/
function observe_event(event, facts = { perVisitor: null }) {
	const obs = {
		get disqualified_by() {
			return facts.perVisitor;
		},
		wrote_cookie: false
	};
	const disqualify = (label) => {
		if (facts.perVisitor === null) facts.perVisitor = label;
	};
	const cookies = event.cookies;
	const orig_get = cookies.get.bind(cookies);
	const orig_get_all = cookies.getAll.bind(cookies);
	const orig_set = cookies.set.bind(cookies);
	const orig_delete = cookies.delete.bind(cookies);
	cookies.get = ((name, opts) => {
		const value = orig_get(name, opts);
		if (!is_default_value(value)) disqualify(`cookie:${name}`);
		return value;
	});
	cookies.getAll = ((opts) => {
		const all = orig_get_all(opts);
		if (all.length > 0) disqualify("cookies.getAll");
		return all;
	});
	cookies.set = ((...args) => {
		obs.wrote_cookie = true;
		return orig_set(...args);
	});
	cookies.delete = ((...args) => {
		obs.wrote_cookie = true;
		return orig_delete(...args);
	});
	const headers = event.request.headers;
	const orig_header_get = headers.get.bind(headers);
	headers.get = ((name) => {
		const value = orig_header_get(name);
		if (value !== null && DISQUALIFYING_HEADERS.has(name.toLowerCase())) disqualify(`header:${name.toLowerCase()}`);
		return value;
	});
	event.locals = new Proxy(event.locals, { get(target, prop, receiver) {
		const value = Reflect.get(target, prop, receiver);
		if (typeof prop === "string" && !is_default_value(value) && typeof value !== "function") disqualify(`locals.${prop}`);
		return value;
	} });
	return obs;
}
// ../../src/stitch.ts
/**
* freeze — SERVE-TIME STITCHING (the zero-flash upgrade over `render: 'live'`).
*
* A `with { render: 'deferred', stitch: 'serve' }` hole ships in the stored shell as a normal
* signed hole PLUS a `stitch` attribute. On every serve of that entry the handle renders the
* hole server-side RIGHT THEN (the visitor's cookies ride the request) and SPLICES the HTML
* into the stored bytes — one response, personalized first paint, view-source included.
*
* Laws: fail-open PER HOLE (a failed/timed-out render keeps the fallback + the client fetch —
* a slow upstream never blocks the page); the spliced wrapper becomes a neutral
* `display:contents` div so nested islands inside the stitched HTML are TOP-LEVEL regions that
* wake themselves (no region ancestor to ride or wait on); stitched entries are per-visitor —
* the capture stamps them `private, no-store` and mints no validators.
*
* Pure string functions (unit-tested); the handle threads its own `#render_capability`.
*/
/** Cheap presence probe — the capture uses it to flag entries; serves use it to skip the scan. */
var STITCH_HOLE_RE = /<ogygia-region\b[^>]*\bstitch\b[^>]*>/;
var REGION_TOKEN_RE = /<ogygia-region\b[^>]*>|<\/ogygia-region>/g;
var STITCH_ATTR_RE = /\bstitch\b/;
/** `stitch="edge"` — the ESI mode. Anything else that carries `stitch` (`"serve"`, or the bare
*  attribute an older build emitted) is the origin-serve mode. */
var STITCH_EDGE_RE = /\bstitch="edge"/;
var ENDPOINT_ATTR_RE = /\bendpoint="([^"]*)"/;
var AMP_RE = /&amp;/g;
/** Which stitch modes a stored page carries. One `'serve'` hole makes the WHOLE page per-visitor
*  (serve taints); a page whose stitch holes are all `'edge'` stays edge-cacheable. */
function stitch_modes(html) {
	if (!STITCH_HOLE_RE.test(html)) return {
		serve: false,
		edge: false
	};
	const holes = find_stitch_holes(html);
	return {
		serve: holes.some((h) => h.mode === "serve"),
		edge: holes.some((h) => h.mode === "edge")
	};
}
/**
* EDGE STITCHING (ESI): rewrite every `stitch="edge"` hole so an ESI-capable CDN (Akamai, Fastly,
* Varnish) fills it per request from the hole's own signed capability, while the shell around it
* stays cached at the edge. The region block is wrapped in `<esi:remove>` and followed by an
* `<esi:include>`:
*   - on an ESI edge the wrapper is stripped and the include is fetched from origin (with the
*     viewer's cookies, per the edge config) → a personal first paint, shell served from cache,
*     origin renders ONE region;
*   - anywhere ESI is not processed (direct origin, dev, a non-ESI CDN) `<esi:remove>` is an
*     unknown element whose CHILDREN still render and `<esi:include>` is inert — the hole ships its
*     fallback and the client fetches it exactly like a normal deferred hole. Graceful either way.
* Pure string function; the capture runs it at store time (the etag is minted over the result).
* `page_path` is the stored page's pathname: the hole's endpoint is emitted PAGE-RELATIVE
* (`../../__ogygia__?…` under Kit's relative paths), and an ESI include must be an absolute path
* the edge can fetch from origin without knowing the page — so each src is resolved here.
*/
function esi_rewrite(html, page_path = "/") {
	const holes = find_stitch_holes(html).filter((h) => h.mode === "edge");
	if (!holes.length) return html;
	let out = "";
	let last = 0;
	for (const h of holes) {
		const abs = new URL(h.endpoint, "http://o" + page_path);
		const src = escape_amp_quot(abs.pathname + abs.search);
		out += html.slice(last, h.start);
		out += `<esi:remove>${html.slice(h.start, h.end)}</esi:remove><esi:include src="${src}" onerror="continue"/>`;
		last = h.end;
	}
	out += html.slice(last);
	return out;
}
/** Find every TOP-LEVEL stitch-marked region block, balanced across nested regions. */
function find_stitch_holes(html) {
	const holes = [];
	let depth = 0;
	let open = null;
	REGION_TOKEN_RE.lastIndex = 0;
	let m;
	while (m = REGION_TOKEN_RE.exec(html)) {
		const token = m[0];
		if (token[1] === "/") {
			depth--;
			if (depth === 0 && open) {
				if (STITCH_ATTR_RE.test(open.tag)) {
					const endpoint = ENDPOINT_ATTR_RE.exec(open.tag)?.[1]?.replace(AMP_RE, "&") ?? "";
					if (endpoint) holes.push({
						start: open.start,
						end: m.index + token.length,
						endpoint,
						mode: STITCH_EDGE_RE.test(open.tag) ? "edge" : "serve"
					});
				}
				open = null;
			}
		} else {
			if (depth === 0) open = {
				start: m.index,
				tag: token
			};
			depth++;
		}
	}
	return holes;
}
/**
* Splice fresh renders into every stitch hole. `render` resolves an endpoint to HTML or null;
* null (failure/timeout) keeps the original block VERBATIM — the fallback ships and the client
* fetches exactly as an unstitched hole would (fail-open). Holes render in PARALLEL.
*/
async function stitch_html(html, render) {
	const holes = find_stitch_holes(html);
	if (!holes.length) return html;
	const rendered = await Promise.all(holes.map((h) => render(h.endpoint).catch(() => null)));
	let out = "";
	let last = 0;
	for (let i = 0; i < holes.length; i++) {
		const fill = rendered[i];
		if (fill === null) continue;
		out += html.slice(last, holes[i].start);
		out += `<div style="display:contents" data-og-stitched="">${fill}</div>`;
		last = holes[i].end;
	}
	out += html.slice(last);
	return out;
}
// ../../src/server.ts
/**
* The freeze plugin's server half (imported by the build through `virtual:ogygia/server-plugins`,
* with the `freeze({ ttl, default })` options).
*
* `page`: the read path. A GET, no query string, not prerendering, on a route that opts in: a stored
* copy answers — Kit, loads and Svelte never run. A concurrent cold miss JOINS the in-flight render
* (the stampede law: N concurrent requests, ONE render). The first cold request opens the flight,
* marks the render `facts.storable` (its holes mint prerender-grade, its data-source receipts are
* kept) and observes it for personalization.
*
* `response`: the write path. The verdict (nothing personal read, nothing streamed, a cacheable
* 200 or permanent redirect) stores the page and sends the stored copy; a refusal stamps
* `private, no-store` when the app set nothing. A successful mutation self-evicts its page.
*
* In dev nothing is stored or served — HMR truth beats byte reuse — but the verdict still runs and
* teaches: an eligible page gets `x-ogygia-freeze: would-store`, a refused one a console note.
*/
/** Kit's boot declares its deferred map ONLY on pages with pending (streamed) load promises —
*  verified against @sveltejs/kit 2.70 (render.js: `blocks.push('const deferred = new Map();')`). */
var KIT_DEFERRED_BOOT_RE = /const deferred = new Map\(\);/;
/** The build marker key in the store (NUL-prefixed: no page path can collide with it). */
var BUILD_MARKER_KEY = "\0og:build";
/** Rebuild a Response from a stored page. `via` rides a debug header the harness asserts on.
*  With the incoming `request`, a matching validator answers 304 — plain-HTTP conditional
*  requests (RFC 9110), which is what makes a CDN or browser revalidation of a stored page cost
*  zero body bytes. Validators live on the ENTRY, never in edge adapters: they are the render's
*  identity, not a CDN dialect. */
function freeze_response(entry, via, request) {
	if (entry.kind === "redirect") return new Response(null, {
		status: entry.status,
		headers: {
			location: entry.location,
			"x-ogygia-freeze": via
		}
	});
	if (request) {
		const etag = entry.headers.etag;
		const inm = request.headers.get("if-none-match");
		const ims = request.headers.get("if-modified-since");
		const last_modified = entry.headers["last-modified"];
		if (!!etag && !!inm && inm.split(",").some((t) => t.trim() === etag) || !inm && !!ims && !!last_modified && Date.parse(ims) >= Date.parse(last_modified)) {
			const headers = { "x-ogygia-freeze": via };
			for (const h of [
				"etag",
				"last-modified",
				"cache-control"
			]) if (entry.headers[h]) headers[h] = entry.headers[h];
			return new Response(null, {
				status: 304,
				headers
			});
		}
	}
	return new Response(served_html(entry, via), {
		status: 200,
		headers: {
			...entry.headers,
			"x-ogygia-freeze": via
		}
	});
}
/** The stored page as served: copies served FROM the store carry the doc marker so live regions
*  self-freshen (`stored` = the render that JUST happened — fresh by definition, no marker). The
*  marker goes in by slicing at the entry's `</head>` (recorded at capture; found once for an
*  entry written before the field existed) — never a `replace` over a multi-MB page per hit. */
function served_html(entry, via) {
	if (via === "stored") return entry.html;
	const at = entry.head_end ?? entry.html.indexOf("</head>");
	return at === -1 ? entry.html : entry.html.slice(0, at) + STORED_DOCUMENT_META + entry.html.slice(at);
}
/** Serve-time stitching: fill every `stitch` hole in the stored shell with a fresh SERVER render
*  (`ctx.renderHole` verifies the hole's own signed MAC and renders with THIS request's event, so
*  the visitor's cookies ride in and the splice is personalized in the first response). FAIL-OPEN
*  per hole (a null render keeps the fallback + client fetch). hit/join serves still carry the doc
*  marker first, so live regions inside keep self-freshening. */
async function serve_stitched(entry, via, ctx) {
	const html = await stitch_html(served_html(entry, via), (endpoint) => ctx.renderHole(endpoint));
	return new Response(html, {
		status: 200,
		headers: {
			...entry.headers,
			"x-ogygia-freeze": via
		}
	});
}
function serve(entry, via, ctx) {
	return entry.kind === "page" && entry.stitch ? serve_stitched(entry, via, ctx) : freeze_response(entry, via, ctx.event.request);
}
/** The verdict's other word: a REFUSED page gets `private, no-store` when the app set nothing —
*  per-page proven headers replace blanket CDN rules in both directions. Best-effort (some
*  platforms hand out immutable headers). */
function stamp_no_store(response) {
	try {
		if (response.status !== 200) return;
		if (!(response.headers.get("content-type") ?? "").includes("text/html")) return;
		if (response.headers.get("cache-control")) return;
		response.headers.set("cache-control", "private, no-store");
	} catch {}
}
/**
* The write-path verdict + store. Returns the stored entry AND a fresh Response (reading the
* body consumes the original) — or null when the page must stay per-request. Pre-body guards
* run FIRST so an ineligible response's stream is never consumed.
*/
async function capture_freeze(response, ctx, obs, ttl) {
	const { path, facts } = ctx;
	const tags = facts.sources ?? [];
	if (obs.disqualified_by || obs.wrote_cookie) return null;
	if (response.status === 301 || response.status === 308) {
		const location = response.headers.get("location");
		if (!location) return null;
		const entry = {
			kind: "redirect",
			status: response.status,
			location,
			created: Date.now()
		};
		await freeze_put(path, entry, {
			ttl,
			tags
		});
		return {
			entry,
			response
		};
	}
	if (response.status !== 200) return null;
	if (response.headers.has("set-cookie")) return null;
	const content_type = response.headers.get("content-type") ?? "";
	if (!content_type.includes("text/html")) return null;
	const app_cc = response.headers.get("cache-control") ?? "";
	if (app_cc.includes("private") || app_cc.includes("no-store")) return null;
	if (facts.streamed) return null;
	const html = await response.text();
	if (KIT_DEFERRED_BOOT_RE.test(html)) return null;
	const created = Date.now();
	const modes = stitch_modes(html);
	const has_serve = modes.serve;
	const stored_html = !has_serve && modes.edge ? esi_rewrite(html, path) : html;
	const headers = has_serve ? {
		"content-type": content_type,
		"cache-control": "private, no-store"
	} : {
		"content-type": content_type,
		"cache-control": `public, s-maxage=${ttl}`,
		etag: `"${createHash("sha256").update(stored_html).digest("hex").slice(0, 32)}"`,
		"last-modified": new Date(created).toUTCString(),
		...modes.edge ? { "surrogate-control": "content=\"ESI/1.0\"" } : {}
	};
	if (!has_serve) for (const edge of current_edges()) try {
		Object.assign(headers, edge.headers({
			url: path,
			ttl
		}));
	} catch {}
	const entry = {
		kind: "page",
		html: stored_html,
		head_end: stored_html.indexOf("</head>"),
		headers,
		created,
		...has_serve ? { stitch: true } : {}
	};
	await freeze_put(path, entry, {
		ttl,
		tags
	});
	return {
		entry,
		response: freeze_response(entry, "stored")
	};
}
var server$1 = defineServer({
	setup(app) {
		set_freeze_app(app);
	},
	state: () => ({
		settle: null,
		obs: null,
		eligible: false
	}),
	async page(ctx) {
		const { event, path, facts, state } = ctx;
		if (!(!facts.private && !building && event.request.method.toUpperCase() === "GET" && event.url.search === "" && !path.endsWith("__data.json") && !facts.answerForm && (ctx.routeOption("freeze") ?? ctx.options.default) === true)) return;
		state.eligible = true;
		const hit = await freeze_get(path);
		if (hit) {
			ctx.app.devtools({
				domain: "server",
				name: "server.freeze",
				op: "hit",
				url: path
			});
			return serve(hit, "hit", ctx);
		}
		const flight = join_flight(path);
		if (flight) {
			const outcome = await flight;
			if (outcome.stored) {
				ctx.app.devtools({
					domain: "server",
					name: "server.freeze",
					op: "join",
					url: path
				});
				return serve(outcome.stored, "join", ctx);
			}
			return;
		}
		state.settle = begin_flight(path);
		state.obs = observe_event(event, facts);
		facts.storable = true;
		facts.sources ??= [];
	},
	async response(ctx, response) {
		const { event, path, state } = ctx;
		if (event.request.method.toUpperCase() !== "GET" && response.status < 400) self_evict(path);
		const { settle, obs } = state;
		if (settle && obs) try {
			const stored = await capture_freeze(response, ctx, obs, ctx.options.ttl);
			settle({ stored: stored?.entry ?? null });
			ctx.app.devtools(stored ? {
				domain: "server",
				name: "server.freeze",
				op: "stored",
				url: path,
				bytes: stored.entry.kind === "page" ? stored.entry.html.length : 0
			} : {
				domain: "server",
				name: "server.freeze",
				op: "skip",
				url: path,
				reason: obs.disqualified_by ?? "response-ineligible"
			});
			if (stored) return stored.entry.kind === "page" && stored.entry.stitch ? await serve_stitched(stored.entry, "stored", ctx) : stored.response;
			stamp_no_store(response);
		} catch {
			settle({ stored: null });
		}
	},
	async invalidate(tags) {
		await invalidate_tags(tags);
	},
	async lastBuild(version) {
		const store = current_store();
		const marker = await store.get(BUILD_MARKER_KEY);
		const seen = marker?.kind === "page" ? marker.html : void 0;
		if (seen !== version) await store.put(BUILD_MARKER_KEY, {
			kind: "page",
			html: version,
			headers: {},
			created: Date.now()
		}, {
			ttl: 86400,
			tags: []
		});
		return seen;
	}
});
// ../../../flags/src/server.ts
/**
* The flags plugin's server realm (named by `flags()`).
* `request`: prime the decision source once, above the page / hole split, so every read stays sync.
* `done`: drain queued exposures at the request's end, always (the serverless-safe tail).
*/
var server = defineServer({
	setup(app) {
		set_flags_app(app);
	},
	async request({ event }) {
		await prime_flags({
			request: event.request,
			url: event.url,
			cookies: event.cookies
		});
	},
	done() {
		flush_exposures();
	}
});
// \0virtual:ogygia/server-plugins
var plugins$1 = [{
	name: "@ogygia/freeze",
	options: {
		"ttl": 86400,
		"default": true
	},
	server: server$1
}, {
	name: "@ogygia/flags",
	options: {},
	server
}];
// ../../../core/src/plugin/hooks.ts
var implementations = globalThis[Symbol.for("ogygia.server-hooks.v1")] ??= [];
/** Core only: a set of hook implementations joins (a plugin's server half, or core's own). Keyed by
*  identity; returns the leave. */
function register_hooks(impl) {
	const entry = impl;
	if (!implementations.includes(entry)) implementations.push(entry);
	return () => {
		const at = implementations.indexOf(entry);
		if (at !== -1) implementations.splice(at, 1);
	};
}
/** Every implementation of the named hook runs; a failing one is logged, never thrown. */
var notify = new Proxy({}, { get: (_, name) => async (...args) => {
	for (const impl of implementations.slice()) {
		const fn = impl[name];
		if (typeof fn !== "function") continue;
		try {
			await fn.apply(impl, args);
		} catch (e) {
			console.warn(`[ogygia] a \`${name}\` hook failed —`, e);
		}
	}
} });
/** The first implementation that answers something other than `undefined`. */
var ask = new Proxy({}, { get: (_, name) => async (...args) => {
	for (const impl of implementations.slice()) {
		const fn = impl[name];
		if (typeof fn !== "function") continue;
		try {
			const answer = await fn.apply(impl, args);
			if (answer !== void 0) return answer;
		} catch (e) {
			console.warn(`[ogygia] a \`${name}\` hook failed —`, e);
		}
	}
} });
// ../../../core/src/plugin/server.ts
/** Make each plugin live, in order: app, shared hooks, `setup`. */
function start_plugins(entries, signer) {
	return entries.map(({ name, options, server }) => {
		const warned = /* @__PURE__ */ new Set();
		const app = {
			name,
			options,
			notify,
			ask,
			facts: facts_of$1,
			current: current_facts,
			sign: signer.sign,
			verify: signer.verify,
			devtools: record_server_event,
			warn(message) {
				if (warned.has(message)) return;
				warned.add(message);
				console.warn(`[${name}] ${message}`);
			}
		};
		register_hooks(server);
		server.setup?.(app);
		return {
			def: server,
			app
		};
	});
}
/** Two `resolve()` option sets as one: the inner transform (ogygia's document injection) runs first,
*  the outer (a plugin's `handle`) sees the finished chunk; the other options merge, outer last. */
function compose_resolve_options(inner, outer) {
	if (!inner) return outer;
	if (!outer) return inner;
	const a = inner.transformPageChunk;
	const b = outer.transformPageChunk;
	return {
		...inner,
		...outer,
		transformPageChunk: !a ? b : !b ? a : async (input) => {
			const first = await a(input);
			if (first === void 0) return first;
			return b({
				...input,
				html: first
			});
		}
	};
}
/** The plugins' `handle` hooks nested around `core`, first plugin outermost. No hook: `core` itself. */
function around(plugins, core) {
	let inner = core;
	for (let i = plugins.length - 1; i >= 0; i--) {
		const { def, app } = plugins[i];
		const handle = def.handle;
		if (!handle) continue;
		const next_handle = inner;
		inner = async ({ event, resolve }) => handle({
			event,
			options: app.options,
			app
		}, (outer) => Promise.resolve(next_handle({
			event,
			resolve: (ev, opts) => resolve(ev, compose_resolve_options(opts, outer))
		})));
	}
	return inner;
}
/** The per-plugin contexts of one request. */
function request_contexts(plugins, event, path, facts, render_hole) {
	const route_id = event.route?.id;
	const route_opt = (name) => route_option(name, route_id, path);
	const per_visitor = (reason) => mark_per_visitor(facts, reason);
	return plugins.map(({ def, app }) => ({
		event,
		path,
		state: def.state?.(),
		options: app.options,
		app,
		facts,
		routeOption: route_opt,
		renderHole: render_hole,
		perVisitor: per_visitor
	}));
}
// ../../../core/src/server/stream-regions.ts
/**
* Region parcels for the batch endpoint (single-flight navigation, a page's first-load holes, OOO).
* Each rendered region call is boxed as a `<template data-ogygia-slot>` parcel keyed by its capability
* signature; the client frame stream reads them out of order and drops each into the matching region.
* A done-sentinel ends the batch.
*
* The client reads a parcel as TEXT (runtime/frame-nav.ts), never as DOM. A plain parcel ends at the
* first `</template>`; an answer that itself carries `</template` (a web component's declarative
* shadow root) is LENGTH-FRAMED instead — `data-og-len` is its UTF-16 length, the unit the client's
* decoded string counts in — so its content can never close the box or forge a parcel for another
* slot, and it no longer falls back to a second request.
*
* Pure (no I/O, no Kit) so it stays unit-testable.
*/
/** Sentinel slot appended once a batch finishes, so waiting regions know it is complete. */
var STREAM_DONE_SLOT = "__ogygia_done__";
/** Does `html` carry a `</template` (any case) — one that would close a plain parcel early? */
function has_template_close(html) {
	for (let i = html.indexOf("</"); i !== -1; i = html.indexOf("</", i + 2)) {
		if (html.length - i < 10) return false;
		if (html.slice(i + 2, i + 10).toLowerCase() === "template") return true;
	}
	return false;
}
/** Build a parcel `<template data-ogygia-slot="…">…rendered html…</template>` (length-framed when
*  the html carries a `</template` of its own). */
function build_parcel(slot, html) {
	if (has_template_close(html)) return `<template data-ogygia-slot="${slot}" data-og-len="${html.length}">${html}</template>`;
	return `<template data-ogygia-slot="${slot}">${html}</template>`;
}
/** The done-sentinel parcel (empty template) the client watches to end the batch. */
function done_parcel() {
	return `<template data-ogygia-slot="${STREAM_DONE_SLOT}"></template>`;
}
// ../../../core/src/server/head-presence.ts
/**
* Presence checks for the head tags the `handle()` transform injects (the router meta, the runtime
* bootstrap, the dev-HMR script, MPA speculation rules). Each must detect a REAL element, never the
* tag's name as TEXT.
*
* Why this exists as its own module: a page that DOCUMENTS one of these tags in a code block renders
* it HTML-escaped — `` `<meta name="ogygia-router" content="plain">` `` becomes
* `<code>&lt;meta name="ogygia-router" content="plain"></code>`. A substring check like
* `html.includes('name="ogygia-router"')` false-matches that prose and suppresses the injection; for
* the router marker that silently drops the whole page to full-page navigation (no marker → the
* client router hands off to `location.href`, so no SPA and no view transition). The changelog page
* documents exactly these tags, which is how the bug surfaced.
*
* The fix each predicate shares: require a literal `<meta` / `<script` — the escaped copy carries
* `&lt;`, never a bare `<`, so it can't match. `[^>]*` is bounded to the opening tag, so a `<script>`
* whose BODY mentions the attribute (inline JS) can't false-match either. Every pattern is a single
* unnested `[^>]*`, so `.test()` is linear — no backtracking on any input.
*
* The patterns are module constants (compiled once), never rebuilt per call: these predicates run on
* the page HTML during every SSR response transform. They STAY regexes: measured against hand-written
* scans (a tag walk, a rare-needle-first search), the engine's compiled matcher was 2–4× faster on
* real heads, allocation-free either way. `dedupe_head_links` is hand-written: it won.
*/
/** A real `<meta name="ogygia-router" …>` element — a page opting a route out of view transitions. */
var ROUTER_META_RE = /<meta\b[^>]*\bname=["']ogygia-router["']/i;
/** A real runtime bootstrap `<script … data-ogygia-runtime …>` (Region emits it on island pages). */
var RUNTIME_SCRIPT_RE = /<script\b[^>]*\bdata-ogygia-runtime\b/i;
function page_declares_router_meta(html) {
	return ROUTER_META_RE.test(html);
}
function page_declares_runtime_script(html) {
	return RUNTIME_SCRIPT_RE.test(html);
}
/** The value of the first `\b<attr>=` + quote in `[from, to)`, up to the next quote of either kind
*  (case-sensitive, as the `rel` / `href` probes always were), or `undefined`. */
function quoted_attr(s, from, to, attr) {
	const n = attr.length;
	for (let i = s.indexOf(attr, from); i !== -1 && i + n + 2 <= to; i = s.indexOf(attr, i + 1)) {
		if (is_word$1(s.charCodeAt(i - 1)) || s.charCodeAt(i + n) !== 61) continue;
		const q = s.charCodeAt(i + n + 1);
		if (q !== 34 && q !== 39) continue;
		const start = i + n + 2;
		let end = start;
		for (; end < to; end++) {
			const c = s.charCodeAt(end);
			if (c === 34 || c === 39) return s.slice(start, end);
		}
	}
}
/**
* Drop duplicate `<link>` tags in the HEAD — one pass over the head slice, two families:
*
*  - `rel="stylesheet"`: same href → first occurrence wins. Kit links a route's client-graph CSS
*    and Region.svelte links a rendered island's CSS from the render pass; a layout island compiled
*    as a real wrapper (a csr=true-capable layout host) is in both, so its sheet was linked twice —
*    two render-blocking fetches of one asset. `<style>` tags are untouched.
*  - `rel="modulepreload"`: same href → first occurrence wins. Each island's SSR emits its own
*    dep-hint block, so islands sharing dep chunks — or one island rendered N times — repeat
*    identical hints (a real page carried ~44 duplicate tags). Every hint ogygia emits is
*    `fetchpriority="low"` (Region.svelte), so there is no priority to arbitrate between copies.
*
* Every other `<link>` passes through byte-identical. The handle calls this on the HEAD SLICE of
* the document only (everything before `</head>`, tens of KB): the hints and the sheets live there,
* so the 2.6 MB body is never scanned for them.
*/
function dedupe_head_links(head) {
	if (!head.includes("<link")) return head;
	const sheets = /* @__PURE__ */ new Set();
	const hints = /* @__PURE__ */ new Set();
	let out = null;
	let kept = 0;
	for (let lt = head.indexOf("<link"), gt = 0; lt !== -1; lt = head.indexOf("<link", gt + 1)) {
		if (is_word$1(head.charCodeAt(lt + 5))) {
			gt = lt;
			continue;
		}
		gt = head.indexOf(">", lt);
		if (gt === -1) break;
		const from = lt + 5;
		const rel = quoted_attr(head, from, gt, "rel");
		const seen = rel === "stylesheet" ? sheets : rel === "modulepreload" ? hints : null;
		if (seen === null) continue;
		const href = quoted_attr(head, from, gt, "href");
		if (href === void 0) continue;
		if (!seen.has(href)) {
			seen.add(href);
			continue;
		}
		(out ??= []).push(head.slice(kept, lt));
		kept = gt + 1;
	}
	if (out === null) return head;
	out.push(head.slice(kept));
	return out.join("");
}
var RUNTIME_SCRIPT_ELEMENT_RE = /<script\b[^>]*\bdata-ogygia-runtime\b[^>]*><\/script>(?:<link\b[^>]*\bdata-ogygia-runtime-dep\b[^>]*>)*/i;
var HEAD_OPEN_RE = /<head\b[^>]*>/i;
var FIRST_JS_G = /<script\b|<link\b[^>]*\brel=["']?modulepreload\b/gi;
var HEAD_CLOSE_G = /<\/head\s*>/gi;
/** The first match of a global pattern at or after `from` (its index), or -1. */
function search_from(re, s, from) {
	re.lastIndex = from;
	const m = re.exec(s);
	return m ? m.index : -1;
}
/**
* Put the runtime bootstrap BEFORE ALL OF THE PAGE'S JAVASCRIPT in `<head>` — immediately ahead of
* the first `<script>` or `<link rel="modulepreload">` the app's template and the page carry, and
* no earlier. `runtime` is the tag to place when the head has none yet (`null` = only reorder what
* is there; the tag an island page emits sits wherever Kit's head slot is, after the app's own
* scripts in `app.html`). With no JavaScript in the head it goes last in it. Returns `head` itself
* when there is nothing to move.
*
* Why BEFORE THE JS: module and deferred scripts run in document order once parsing ends, and the
* runtime's custom-element definition is what makes every `<ogygia-region>` connect and keep its
* server markup — the copy an island hydrates against when something edited it while it slept
* (runtime/core.ts `#ssr_html`). A design-system runtime loaded from the app template ran BEFORE the
* runtime on a customer page and stripped the whitespace nodes of every island in the header before
* the runtime ever saw them, so the "server copy" was the edited DOM and the login island still
* re-rendered client-side on its first tap. Ahead of every script, the runtime sees the document as
* the server sent it, whatever the app loads after it.
*
* Why NOT FIRST IN THE HEAD: that ordering guarantee is about execution, and only needs "before the
* other scripts". Heading the whole `<head>` also made the runtime the page's FIRST REQUEST, ahead of
* its stylesheets and its LCP image preload. Everything that is not JavaScript — the charset and
* other `<meta>`, the `<title>`, stylesheets, preconnects, image/font preloads — keeps its place in
* front of it.
*/
function runtime_first(head, runtime) {
	const found = RUNTIME_SCRIPT_ELEMENT_RE.exec(head);
	const tag = found ? found[0] : runtime;
	if (tag === null) return head;
	const rest = found ? head.slice(0, found.index) + head.slice(found.index + found[0].length) : head;
	const open = HEAD_OPEN_RE.exec(rest);
	const from = open ? open.index + open[0].length : 0;
	let at = search_from(FIRST_JS_G, rest, from);
	if (at === -1) {
		const close = search_from(HEAD_CLOSE_G, rest, from);
		at = close === -1 ? rest.length : close;
	}
	if (found && found.index === at) return head;
	return rest.slice(0, at) + tag + rest.slice(at);
}
// ../../../core/src/server/document-assembly.ts
var HEAD_CLOSE = "</head>";
var BODY_CLOSE = "</body>";
/** The two injection points, each found with one bounded scan. */
function locate(html) {
	return {
		head_end: html.indexOf(HEAD_CLOSE),
		body_end: html.lastIndexOf(BODY_CLOSE)
	};
}
/**
* Put `head_inject` before `</head>` and `body_inject` before `</body>`, replacing the head slice
* with `head` when the caller rewrote it (the deduped head; `null` = unchanged). A missing
* injection point drops that injection (a streamed chunk without `</body>` gets no body work).
* Returns `html` itself when there is nothing to do.
*/
function assemble(html, { head_end, body_end }, head, head_inject, body_inject) {
	const has_head = head_end !== -1 && (head !== null || head_inject !== "");
	const has_body = body_end !== -1 && body_inject !== "";
	if (!has_head && !has_body) return html;
	if (!has_head) return html.slice(0, body_end) + body_inject + html.slice(body_end);
	const front = (head ?? html.slice(0, head_end)) + head_inject;
	if (!has_body) return front + html.slice(head_end);
	return front + html.slice(head_end, body_end) + body_inject + html.slice(body_end);
}
// ../../../core/src/server/reversible.ts
/**
* REVERSIBLE TRANSFORMS — an app's server transform (a web-component server render, say) may reshape
* the markup ogygia hands it, Svelte-owned markup included, and ogygia puts back what hydration needs.
*
* The one rule this rests on, vendor-neutral: **a custom element's server render may move its light
* DOM children** (a scoped render emulates slots by moving them into its rendered tree). So:
*
*   1. MARK, before the transform: every custom element gets an id (`og-h="K"` when ogygia will restore
*      it — in Svelte-owned markup, above Svelte-owned markup, or anywhere in a hole / lake answer;
*      `og-u="K"` otherwise), and each of its children a tag (`og-c="K.i"` on an element, a
*      `<!--og-c K.i t|c-->` comment before a text or comment node). Text a trimmer could change,
*      deeper inside a restored host's children, gets `<!--og-t K.n-->`.
*   2. The app's transform runs. On an `og-h` host it renders the plan: its slot positions as real
*      `<slot>` wrappers, `og-shadow="key …"` (the sheets for the host's shadow root), `og-keep="attr …"`.
*   3. SETTLE, after it: hosts without a plan (no `og-shadow`) lose every mark and are left as the
*      transform wrote them; a planned host keeps its marks plus what the restorer needs to put the
*      children back exactly (`og-r`: the attributes to reset; the original text of a trimmed or
*      dropped text node). Start tags the HTML parser would restructure (an `<a>` in an `<a>`, a block
*      in a `<p>`, …) where the render introduced the tag or the element it would close become
*      `<og-as tag="…">` stand-ins. `data-og-head` assets move into `<head>` (a document), deduped.
*
* The browser half (runtime/restore.ts) attaches each planned host's shadow root, moves the rendered
* tree into it, and puts Svelte's children back — before anything snapshots or hydrates.
*
* Pure string work over one tokenizer pass each (indexOf-driven, no regex, no DOM): it runs on every
* response of an app that configures a transform.
*/
var RAW = /* @__PURE__ */ new Set([
	"script",
	"style",
	"textarea",
	"title",
	"xmp",
	"iframe",
	"noembed",
	"noframes"
]);
var VOID = /* @__PURE__ */ new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"source",
	"track",
	"wbr",
	"param",
	"keygen",
	"frame"
]);
function is_space(c) {
	return c === 32 || c === 9 || c === 10 || c === 12 || c === 13;
}
function is_alpha(c) {
	return c >= 65 && c <= 90 || c >= 97 && c <= 122;
}
/** Index of the `>` ending the tag at `open`, respecting quoted values; `html.length` if none. */
function tag_end(html, open) {
	let quote = 0;
	for (let i = open + 1; i < html.length; i++) {
		const c = html.charCodeAt(i);
		if (quote) {
			if (c === quote) quote = 0;
		} else if (c === 34 || c === 39) quote = c;
		else if (c === 62) return i;
	}
	return html.length;
}
function read_name(html, from) {
	let i = from;
	while (i < html.length) {
		const c = html.charCodeAt(i);
		if (is_space(c) || c === 62 || c === 47) break;
		i++;
	}
	return i;
}
/** The raw-text body end (`<` of the matching `</name`), or `html.length`. */
function raw_end(html, from, name) {
	let at = from;
	for (;;) {
		const lt = html.indexOf("</", at);
		if (lt === -1) return html.length;
		let ok = true;
		for (let k = 0; k < name.length; k++) {
			const c = html.charCodeAt(lt + 2 + k);
			if ((c >= 65 && c <= 90 ? c + 32 : c) !== name.charCodeAt(k)) {
				ok = false;
				break;
			}
		}
		const after = html.charCodeAt(lt + 2 + name.length);
		if (ok && (Number.isNaN(after) || is_space(after) || after === 62 || after === 47)) return lt;
		at = lt + 2;
	}
}
/** A tag name, lower-cased only when it has an upper-case letter (the common case allocates nothing
*  beyond the slice). */
function tag_name(html, from, to) {
	const name = html.slice(from, to);
	for (let k = from; k < to; k++) {
		const c = html.charCodeAt(k);
		if (c >= 65 && c <= 90) return name.toLowerCase();
	}
	return name;
}
/**
* The tokenizer: ONE token object, rewritten in place by each `next()` (a document is tens of
* thousands of tokens; an object per token, or a generator, is garbage the collector pays for on
* every request). Read a token's fields before the next `next()`.
*/
var Lexer = class {
	t = "text";
	name = "";
	start = 0;
	end = 0;
	name_end = 0;
	self = false;
	#html;
	#i = 0;
	/** the raw-text element just opened: its body is the next token */
	#raw = "";
	constructor(html) {
		this.#html = html;
	}
	#set(t, start, end) {
		this.t = t;
		this.start = start;
		this.end = end;
		this.#i = end;
		return true;
	}
	next() {
		const html = this.#html;
		const n = html.length;
		let i = this.#i;
		if (this.#raw) {
			const name = this.#raw;
			this.#raw = "";
			const re = raw_end(html, i, name);
			if (re > i) return this.#set("raw", i, re);
			i = this.#i = re;
		}
		if (i >= n) return false;
		const lt = html.indexOf("<", i);
		if (lt === -1) return this.#set("text", i, n);
		const c1 = html.charCodeAt(lt + 1);
		if (!(is_alpha(c1) || c1 === 47 && is_alpha(html.charCodeAt(lt + 2)) || c1 === 33 || c1 === 63)) {
			let j = lt + 1;
			for (;;) {
				const nx = html.indexOf("<", j);
				if (nx === -1) {
					j = n;
					break;
				}
				const d = html.charCodeAt(nx + 1);
				if (is_alpha(d) || d === 47 && is_alpha(html.charCodeAt(nx + 2)) || d === 33 || d === 63) {
					j = nx;
					break;
				}
				j = nx + 1;
			}
			return this.#set("text", i, j);
		}
		if (lt > i) return this.#set("text", i, lt);
		if (html.startsWith("<!--", lt)) {
			const close = html.indexOf("-->", lt + 4);
			return this.#set("comment", lt, close === -1 ? n : close + 3);
		}
		if (c1 === 33 || c1 === 63) return this.#set("other", lt, tag_end(html, lt) + 1);
		if (c1 === 47) {
			const ne = read_name(html, lt + 2);
			this.name = tag_name(html, lt + 2, ne);
			return this.#set("end", lt, tag_end(html, lt) + 1);
		}
		const ne = read_name(html, lt + 1);
		const name = tag_name(html, lt + 1, ne);
		const gt = tag_end(html, lt);
		this.name = name;
		this.name_end = ne;
		this.self = html.charCodeAt(gt - 1) === 47;
		if (RAW.has(name) && !this.self) this.#raw = name;
		return this.#set("start", lt, gt + 1);
	}
};
/** (the attributes of a tag nobody asked about: one shared empty list, never an allocation per tag) */
var NO_ATTRS = Object.freeze([]);
/** (nothing to remove from a tag without ogygia's marks; only a tag with marks ever adds to its set) */
var NO_REMOVE = /* @__PURE__ */ new Set();
function parse_attrs(html, from, to) {
	const out = [];
	let i = from;
	while (i < to) {
		let c = html.charCodeAt(i);
		if (is_space(c) || c === 47) {
			i++;
			continue;
		}
		const ns = i;
		while (i < to) {
			c = html.charCodeAt(i);
			if (is_space(c) || c === 61 || c === 62 || c === 47) break;
			i++;
		}
		const name = html.slice(ns, i).toLowerCase();
		let j = i;
		while (j < to && is_space(html.charCodeAt(j))) j++;
		if (html.charCodeAt(j) === 61) {
			j++;
			while (j < to && is_space(html.charCodeAt(j))) j++;
			const q = html.charCodeAt(j);
			let value;
			if (q === 34 || q === 39) {
				const close = html.indexOf(q === 34 ? "\"" : "'", j + 1);
				const e = close === -1 || close > to ? to : close;
				value = html.slice(j + 1, e);
				j = e + 1;
			} else {
				const vs = j;
				while (j < to && !is_space(html.charCodeAt(j)) && html.charCodeAt(j) !== 62) j++;
				value = html.slice(vs, j);
			}
			if (name) out.push({
				name,
				value: decode(value),
				start: ns,
				end: j
			});
			i = j;
		} else {
			if (name) out.push({
				name,
				value: "",
				start: ns,
				end: i
			});
			if (i === ns) i++;
		}
	}
	return out;
}
var NAMED = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: "\"",
	apos: "'",
	nbsp: "\xA0",
	"#39": "'"
};
/** Decode character references (the common named ones and every numeric one): enough to compare two
*  serializations of the same text or attribute value. */
function decode(s) {
	if (s.indexOf("&") === -1) return s;
	let out = "";
	let i = 0;
	for (;;) {
		const amp = s.indexOf("&", i);
		if (amp === -1) return out + s.slice(i);
		out += s.slice(i, amp);
		const semi = s.indexOf(";", amp);
		if (semi === -1 || semi - amp > 10) {
			out += "&";
			i = amp + 1;
			continue;
		}
		const ref = s.slice(amp + 1, semi);
		let ch;
		if (ref.charCodeAt(0) === 35) {
			const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
			if (Number.isFinite(code) && code > 0 && code <= 1114111) ch = String.fromCodePoint(code);
		} else ch = NAMED[ref];
		if (ch === void 0) {
			out += "&";
			i = amp + 1;
		} else {
			out += ch;
			i = semi + 1;
		}
	}
}
var esc_attr = escape_amp_quot;
/** JSON safe inside an HTML comment: no `--`, no `>`. */
function comment_json(v) {
	return replace_all(replace_all(JSON.stringify(v), "-", "\\u002d"), ">", "\\u003e");
}
function script_json(v) {
	return replace_all(JSON.stringify(v), "<", "\\u003c");
}
/** `replaceAll` behind a native search: no copy when there is nothing to replace. */
function replace_all(s, from, to) {
	return s.indexOf(from) === -1 ? s : s.replaceAll(from, to);
}
var P_CLOSERS = /* @__PURE__ */ new Set([
	"address",
	"article",
	"aside",
	"blockquote",
	"center",
	"details",
	"dialog",
	"dir",
	"div",
	"dl",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"form",
	"header",
	"hgroup",
	"main",
	"menu",
	"nav",
	"ol",
	"p",
	"search",
	"section",
	"summary",
	"ul",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"pre",
	"listing",
	"table",
	"hr",
	"xmp",
	"li",
	"dd",
	"dt",
	"plaintext"
]);
var HEADINGS = /* @__PURE__ */ new Set([
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6"
]);
var SCOPE = /* @__PURE__ */ new Set([
	"applet",
	"caption",
	"html",
	"table",
	"td",
	"th",
	"marquee",
	"object",
	"template",
	"foreignobject",
	"desc"
]);
var TRACKED = new Map([
	"a",
	"nobr",
	"button",
	"form",
	"li",
	"dd",
	"dt",
	"p",
	"td",
	"th",
	"tr"
].map((n, i) => [n, i]));
function push(stack, f) {
	const slot = TRACKED.get(f.name) ?? -1;
	(stack.slots ??= []).push(slot);
	if (slot !== -1) (stack.open ??= Array.from({ length: TRACKED.size }, () => 0))[slot]++;
	stack.push(f);
}
/** Close the elements from `k` up. */
function cut(stack, k) {
	const slots = stack.slots;
	if (slots) {
		const open = stack.open;
		if (open) {
			for (let j = slots.length - 1; j >= k; j--) if (slots[j] !== -1) open[slots[j]]--;
		}
		slots.length = k;
	}
	stack.length = k;
}
/** The index of the open `name` in scope, or -1. (A stand-in `<og-as tag="a">` is not an `<a>` to
*  the parser: the element's own name is what counts.) */
function in_scope(stack, name, extra) {
	const slot = TRACKED.get(name);
	if (slot === void 0 || !stack.open?.[slot]) return -1;
	for (let k = stack.length - 1; k >= 0; k--) {
		const f = stack[k];
		if (f.name === name) return k;
		if (SCOPE.has(f.name) || extra?.has(f.name)) return -1;
	}
	return -1;
}
var BUTTON_SCOPE = /* @__PURE__ */ new Set(["button"]);
var LIST_SCOPE = /* @__PURE__ */ new Set(["ol", "ul"]);
/** `implied_close`: the parser ignores this start tag (a form in a form) */
var DROP = -2;
/** What the parser does to the stack BEFORE inserting start tag `name`: the index of the element it
*  would close (and everything above it), -1 for nothing, or `DROP` (it ignores the tag). A number,
*  never an object: this runs on every start tag. */
function implied_close(stack, name) {
	if (name === "a" || name === "nobr" || name === "button") return in_scope(stack, name);
	if (name === "form") return in_scope(stack, "form") === -1 ? -1 : DROP;
	if (name === "li") {
		const li = in_scope(stack, "li", LIST_SCOPE);
		if (li !== -1) return li;
	}
	if (name === "dd" || name === "dt") {
		const k = Math.max(in_scope(stack, "dd"), in_scope(stack, "dt"));
		if (k !== -1) return k;
	}
	if (P_CLOSERS.has(name)) {
		const p = in_scope(stack, "p", BUTTON_SCOPE);
		if (p !== -1) return p;
		if (HEADINGS.has(name)) {
			const top = stack[stack.length - 1];
			if (top && HEADINGS.has(top.name)) return stack.length - 1;
		}
	}
	if (name === "option" || name === "optgroup") {
		const top = stack[stack.length - 1];
		if (top && top.name === "option") return stack.length - 1;
	}
	if (name === "td" || name === "th") {
		const k = Math.max(in_scope(stack, "td"), in_scope(stack, "th"));
		if (k !== -1) return k;
	}
	if (name === "tr") {
		const k = in_scope(stack, "tr");
		if (k !== -1) return k;
	}
	return -1;
}
/** An end tag: close up to the innermost element of that name (a stand-in answers to its real tag,
*  whose end tag the settle pass rewrites). */
function pop_to(stack, name) {
	for (let k = stack.length - 1; k >= 0; k--) if ((stack[k].as ?? stack[k].name) === name) {
		cut(stack, k);
		return;
	}
}
function is_custom(name, foreign) {
	if (foreign || name.indexOf("-") === -1 || !is_alpha(name.charCodeAt(0))) return false;
	return !name.startsWith("ogygia-") && !name.startsWith("og-");
}
/** Who renders a region's inside, for Svelte ownership: a hole's and a lake's are opaque to any
*  hydration — and so is a BAKED live region's (its first HTML is one `{@html}` string to Svelte), the
*  same set the client calls opaque (region-attrs.ts `OPAQUE_SELECTOR`). Restoring a host in there to
*  Svelte's render undid what the server's transform wrote for no hydration to follow (a closed
*  dropdown lost `hidden` and pushed the page down until its own runtime set it again). */
function region_kind(attrs) {
	if (attrs.some((a) => a.name === "endpoint")) return "hole";
	if (attrs.some((a) => a.name === "wake" && a.value === "none" || a.name === "data-og-baked")) return "lake";
	return "island";
}
/** Text the serializer could change: whitespace-only, or with leading / trailing whitespace. */
function trimmable(s) {
	if (!s.length) return false;
	const a = s.charCodeAt(0);
	const b = s.charCodeAt(s.length - 1);
	return is_space(a) || is_space(b) || a === 160 || b === 160 || s.indexOf("&nbsp;") !== -1 || s.indexOf("&#160;") !== -1;
}
/** (the record of a host ogygia won't restore: shared, never written) */
var NO_RECORD = Object.freeze({});
var NO_CHILDREN = /* @__PURE__ */ new Map();
var NO_TEXTS = /* @__PURE__ */ new Map();
var attr_map = (attrs) => {
	const m = {};
	for (const a of attrs) m[a.name] = a.value;
	return m;
};
/**
* Which custom elements (in document order) get a plan: every one in an ANSWER — markup the runtime
* morphs into a live page (a hole / lake answer, or a document the router fetched: `answer`) — whose
* hosts meet live ones its own runtime already rendered, so they must arrive in the form the restorer
* gives (Svelte's children in the light DOM), never in the transform's server form only the
* component's first hydrate reads (that form, morphed into a live host, left the transform's tree in
* its light DOM: a site nav collapsed to one unstyled item after an in-place navigation). In a
* document loaded as one, every one in Svelte-owned markup, and every one with Svelte-owned markup
* below it (a server-owned host around an island: adopting it would reach into the island). A first
* pass, so the marking pass knows a host's plan before it reaches the host's children.
*/
function plan_hosts(html, kind, csr, answer) {
	const planned = [];
	const stack = [];
	let in_body = kind !== "document";
	for (const tok = new Lexer(html); tok.next();) if (tok.t === "start") {
		const name = tok.name;
		if (name === "body") in_body = true;
		const close = implied_close(stack, name);
		if (close === DROP) continue;
		if (close !== -1) cut(stack, close);
		const parent = stack[stack.length - 1];
		const foreign = name === "svg" || name === "math" || !!parent?.foreign;
		let owned = name === "body" && kind === "document" && csr || (parent ? parent.owned : false);
		if (name === "ogygia-region") owned = region_kind(parse_attrs(html, tok.name_end, tok.end - 1)) === "island";
		let host = -1;
		if (in_body && is_custom(name, foreign)) {
			host = planned.length;
			planned.push(answer || kind !== "document" || owned);
		}
		if (owned && !(parent ? parent.owned : false)) {
			for (const f of stack) if (f.host !== -1) planned[f.host] = true;
		}
		if (!(VOID.has(name) || tok.self && foreign)) push(stack, {
			name,
			host,
			owned,
			foreign
		});
	} else if (tok.t === "end") pop_to(stack, tok.name);
	return planned;
}
/** Is there any custom element (in a document: after `<body`) — a hop from `<` to `<` reading only
*  tag names, no tokenization. Most pages of most apps have none, and then there is nothing to mark. */
function has_custom_element(html, document) {
	let at = document ? html.indexOf("<body") : 0;
	if (at === -1) return false;
	for (at = html.indexOf("<", at); at !== -1; at = html.indexOf("<", at + 1)) {
		if (!is_alpha(html.charCodeAt(at + 1))) continue;
		const ne = read_name(html, at + 1);
		const dash = html.indexOf("-", at + 1);
		if (dash !== -1 && dash < ne && is_custom(tag_name(html, at + 1, ne), false)) return true;
	}
	return false;
}
/**
* Tag `html` for the transform. `csr`: a Kit-hydrated document (its whole body is Svelte's, except
* lakes and holes). `answer`: a document the router fetched, morphed into the live page (every host
* planned, as in a region answer — see `plan_hosts`). Returns the tagged HTML, or `null` when there is
* no custom element to tag (the transform then gets the HTML as is, and settle has nothing to do).
*/
function mark(html, kind, csr, answer = false) {
	if (!has_custom_element(html, kind === "document")) return null;
	const planned = plan_hosts(html, kind, csr, answer);
	if (!planned.length) return null;
	const out = [];
	let pos = 0;
	const hosts = /* @__PURE__ */ new Map();
	let next_k = 0;
	const stack = [];
	let in_body = kind !== "document";
	let last_was_pre_start = false;
	const top = () => stack[stack.length - 1];
	const under_now = () => top() ? top().under : -1;
	for (const tok = new Lexer(html); tok.next();) {
		if (tok.t === "start") {
			const name = tok.name;
			if (name === "body") in_body = true;
			const close = implied_close(stack, name);
			if (close === DROP) continue;
			if (close !== -1) cut(stack, close);
			const parent = top();
			const foreign = name === "svg" || name === "math" || !!parent?.foreign;
			const custom = in_body && is_custom(name, foreign);
			const child_of_host = !!parent && parent.host !== -1 && in_body;
			const recorded = custom && planned[next_k] === true || child_of_host && planned[parent.host] === true;
			const attrs = name === "ogygia-region" || name === "template" || recorded ? parse_attrs(html, tok.name_end, tok.end - 1) : NO_ATTRS;
			let owned = name === "body" && kind === "document" && csr || (parent ? parent.owned : false);
			if (name === "ogygia-region") owned = region_kind(attrs) === "island";
			let insert = "";
			const shadow_tpl = name === "template" && attrs.some((a) => a.name === "shadowrootmode");
			if (child_of_host && !shadow_tpl) {
				const i = parent.next++;
				insert += ` og-c="${parent.host}.${i}"`;
				if (planned[parent.host]) hosts.get(parent.host).children.set(i, { attrs: attr_map(attrs) });
			}
			let host = -1;
			if (custom) {
				host = next_k++;
				const is_planned = planned[host] ?? false;
				hosts.set(host, {
					planned: is_planned,
					owned,
					attrs: is_planned ? attr_map(attrs) : NO_RECORD,
					children: is_planned ? /* @__PURE__ */ new Map() : NO_CHILDREN,
					texts: is_planned ? /* @__PURE__ */ new Map() : NO_TEXTS,
					text_next: 0,
					inner_start: tok.end,
					inner_end: tok.end
				});
				insert += is_planned ? ` og-h="${host}"` : ` og-u="${host}"`;
			}
			if (insert) {
				out.push(html.slice(pos, tok.name_end), insert);
				pos = tok.name_end;
			}
			if (!(VOID.has(name) || tok.self && foreign)) push(stack, {
				name,
				host,
				next: 0,
				owned,
				under: host !== -1 && planned[host] ? host : under_now(),
				introduced: false,
				foreign
			});
			last_was_pre_start = name === "pre" || name === "listing";
			continue;
		}
		if (tok.t === "end") {
			const name = tok.name;
			for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === name) {
				for (let j = stack.length - 1; j >= k; j--) {
					const f = stack[j];
					if (f.host !== -1) hosts.get(f.host).inner_end = tok.start;
				}
				cut(stack, k);
				break;
			}
			last_was_pre_start = false;
			continue;
		}
		if (tok.t === "text" || tok.t === "comment") {
			const parent = top();
			if (parent && parent.host !== -1 && in_body && !hosts.get(parent.host).planned) parent.next++;
			else if (parent && parent.host !== -1 && in_body) {
				const i = parent.next++;
				const rec = hosts.get(parent.host);
				if (tok.t === "text") {
					const raw = html.slice(tok.start, tok.end);
					rec.children.set(i, { text: raw });
					out.push(html.slice(pos, tok.start), `<!--og-c ${parent.host}.${i} t-->`);
				} else {
					rec.children.set(i, {});
					out.push(html.slice(pos, tok.start), `<!--og-c ${parent.host}.${i} c-->`);
				}
				pos = tok.start;
			} else if (tok.t === "text" && parent && under_now() !== -1 && !last_was_pre_start) {
				const raw = html.slice(tok.start, tok.end);
				if (trimmable(raw)) {
					const k = under_now();
					const rec = hosts.get(k);
					const n = rec.text_next++;
					rec.texts.set(n, raw);
					out.push(html.slice(pos, tok.start), `<!--og-t ${k}.${n}-->`);
					pos = tok.start;
				}
			}
			last_was_pre_start = false;
			continue;
		}
		last_was_pre_start = false;
	}
	if (!hosts.size) return null;
	out.push(html.slice(pos));
	return {
		html: out.join(""),
		record: {
			kind,
			source: html,
			hosts
		}
	};
}
/** How the stand-ins keep their element's box before the restore swaps them back (zero specificity:
*  the component's own class rules still win). */
var STAND_IN_CSS = ":where(og-as){display:inline}:where(og-as[tag=address],og-as[tag=article],og-as[tag=aside],og-as[tag=blockquote],og-as[tag=center],og-as[tag=details],og-as[tag=dialog],og-as[tag=dir],og-as[tag=div],og-as[tag=dl],og-as[tag=dd],og-as[tag=dt],og-as[tag=fieldset],og-as[tag=figcaption],og-as[tag=figure],og-as[tag=footer],og-as[tag=form],og-as[tag=header],og-as[tag=hgroup],og-as[tag=main],og-as[tag=menu],og-as[tag=nav],og-as[tag=ol],og-as[tag=p],og-as[tag=search],og-as[tag=section],og-as[tag=summary],og-as[tag=ul],og-as[tag=h1],og-as[tag=h2],og-as[tag=h3],og-as[tag=h4],og-as[tag=h5],og-as[tag=h6],og-as[tag=pre],og-as[tag=listing],og-as[tag=hr],og-as[tag=xmp]){display:block}:where(og-as[tag=li]){display:list-item}:where(og-as[tag=table]){display:table}:where(og-as[tag=button]){display:inline-block}";
/** The attributes a restore resets: `name → Svelte's value`, or `null` to remove. */
function attr_diff(now, was, keep) {
	let diff = null;
	const seen = /* @__PURE__ */ new Set();
	for (const a of now) {
		if (a.name.startsWith("og-")) continue;
		seen.add(a.name);
		if (a.name in was) {
			if (was[a.name] !== a.value) (diff ??= {})[a.name] = was[a.name];
		} else if (!keep.has(a.name)) (diff ??= {})[a.name] = null;
	}
	for (const name in was) if (!seen.has(name) && !name.startsWith("og-")) (diff ??= {})[name] = was[name];
	return diff;
}
/** Rewrite a start tag: drop the attributes named in `drop`, append `add`, rename to `rename`. */
function rewrite_start(html, tok, attrs, drop, add, rename) {
	let s = "<" + (rename ?? html.slice(tok.start + 1, tok.name_end));
	let at = tok.name_end;
	for (const a of attrs) {
		if (!drop.has(a.name)) continue;
		let from = a.start;
		while (from > at && is_space(html.charCodeAt(from - 1))) from--;
		s += html.slice(at, from);
		at = a.end;
	}
	const close = html.charCodeAt(tok.end - 2) === 47 ? tok.end - 2 : tok.end - 1;
	return s + html.slice(at, close) + add + html.slice(close, tok.end);
}
function settle(html, record, opts = {}) {
	const plan = /* @__PURE__ */ new Set();
	for (let at = html.indexOf(" og-shadow="); at !== -1; at = html.indexOf(" og-shadow=", at + 11)) {
		const lt = html.lastIndexOf("<", at);
		if (lt === -1) continue;
		const gt = tag_end(html, lt);
		if (gt < at) continue;
		const h = parse_attrs(html, read_name(html, lt + 1), gt).find((a) => a.name === "og-h");
		if (h) plan.add(Number(h.value));
	}
	/** Does the tag at `[from, to)` hold `needle`? A forward-only cursor: tags come in document order,
	*  so each occurrence is searched for once (a search from every tag is quadratic in the gaps). */
	const within = (needle) => {
		let at = html.indexOf(needle);
		return (from, to) => {
			if (at !== -1 && at < from) at = html.indexOf(needle, from);
			return at !== -1 && at < to;
		};
	};
	const og_in = within(" og-");
	const head_in = within("data-og-head");
	const out = [];
	let pos = 0;
	const stack = [];
	const head = [];
	const head_keys = /* @__PURE__ */ new Set();
	let head_cut = null;
	let stand_ins = 0;
	let pending_text = null;
	const doc = record.kind === "document";
	/** Close a pending text mark: `text` is the text that follows it in the output (or null: none). */
	const finish_text = (text) => {
		const p = pending_text;
		pending_text = null;
		const rec = record.hosts.get(p.k);
		const was = p.og === "c" ? rec?.children.get(p.i)?.text : rec?.texts.get(p.i);
		if (was === void 0) {
			out[p.comment_at] = "";
			return;
		}
		if (!plan.has(p.k)) {
			out[p.comment_at] = "";
			if (text === null || decode(text) !== decode(was)) for (let s = stack.length - 1; s >= 0; s--) {
				const a = stack[s].host;
				if (a === -1 || !plan.has(a)) continue;
				const ra = record.hosts.get(a);
				if (ra) out[p.comment_at] = `<!--og-t ${a}.${ra.text_next++} ${comment_json(decode(was))}-->`;
				break;
			}
			return;
		}
		if (p.og === "t") {
			out[p.comment_at] = text !== null && decode(text) === decode(was) ? "" : `<!--og-t ${p.k}.${p.i} ${comment_json(decode(was))}-->`;
			return;
		}
		out[p.comment_at] = text !== null && decode(text) === decode(was) ? `<!--og-c ${p.k}.${p.i} t-->` : `<!--og-c ${p.k}.${p.i} t ${comment_json(decode(was))}-->`;
	};
	for (const tok = new Lexer(html); tok.next();) {
		if (head_cut) {
			if (tok.t === "end" && tok.name === head_cut.name && --head_cut.depth === 0) {
				const asset = html.slice(head_cut.start, tok.end);
				pos = tok.end;
				if (!head_keys.has(head_cut.key)) {
					head_keys.add(head_cut.key);
					head.push(asset);
				}
				head_cut = null;
			} else if (tok.t === "start" && tok.name === head_cut.name) head_cut.depth++;
			continue;
		}
		if (pending_text && tok.t !== "text") finish_text(null);
		if (tok.t === "text") {
			if (pending_text) {
				out.push(html.slice(pos, tok.start));
				pos = tok.start;
				finish_text(html.slice(tok.start, tok.end));
			}
			continue;
		}
		if (tok.t === "comment") {
			const body = html.slice(tok.start + 4, tok.end - 3);
			const is_c = body.startsWith("og-c ");
			const is_t = body.startsWith("og-t ");
			if (!is_c && !is_t) continue;
			const sp = body.indexOf(" ", 5);
			const id = body.slice(5, sp === -1 ? body.length : sp);
			const dot = id.indexOf(".");
			const k = Number(id.slice(0, dot));
			const i = Number(id.slice(dot + 1));
			out.push(html.slice(pos, tok.start));
			pos = tok.end;
			if (is_c && body.endsWith(" c")) {
				out.push(plan.has(k) ? html.slice(tok.start, tok.end) : "");
				continue;
			}
			out.push("");
			pending_text = {
				k,
				i,
				comment_at: out.length - 1,
				og: is_c ? "c" : "t"
			};
			continue;
		}
		if (tok.t === "start") {
			const name = tok.name;
			const implied = implied_close(stack, name);
			const drop = implied === DROP;
			const close = drop ? -1 : implied;
			const parent = stack[stack.length - 1];
			const has_og = og_in(tok.start, tok.end);
			const head_attr = head_in(tok.start, tok.end);
			const attrs = has_og || head_attr || close !== -1 ? parse_attrs(html, tok.name_end, tok.end - 1) : NO_ATTRS;
			if (doc && head_attr && !has_og) {
				const key = attrs.find((a) => a.name === "data-og-head")?.value;
				if (key !== void 0 && (name === "style" || name === "link" || name === "template")) {
					out.push(html.slice(pos, tok.start));
					pos = tok.start;
					if (name === "link" || tok.self) {
						pos = tok.end;
						if (!head_keys.has(key)) {
							head_keys.add(key);
							head.push(html.slice(tok.start, tok.end));
						}
					} else head_cut = {
						start: tok.start,
						name,
						depth: 1,
						key
					};
					continue;
				}
			}
			const og_c = has_og ? attrs.find((a) => a.name === "og-c") : void 0;
			const og_h = has_og ? attrs.find((a) => a.name === "og-h" || a.name === "og-u") : void 0;
			const foreign = name === "svg" || name === "math" || !!parent?.foreign;
			const is_host = !!og_h;
			const introduced = og_c ? false : parent ? parent.host !== -1 ? true : parent.introduced : false;
			let stand_in = false;
			if ((close !== -1 || drop) && !foreign) {
				const trigger = close !== -1 ? stack[close] : void 0;
				if (introduced || trigger?.introduced || drop && introduced) stand_in = true;
			}
			if (!stand_in) {
				if (close !== -1) cut(stack, close);
				if (drop) continue;
			}
			const remove = has_og ? /* @__PURE__ */ new Set() : NO_REMOVE;
			let add = "";
			let reset = null;
			let planned_host = false;
			if (og_h) {
				const k = Number(og_h.value);
				if (og_h.name === "og-u" || !plan.has(k)) {
					remove.add(og_h.name);
					remove.add("og-shadow");
					remove.add("og-keep");
				} else {
					planned_host = true;
					const keep = new Set((attrs.find((a) => a.name === "og-keep")?.value ?? "").split(" ").filter(Boolean));
					reset = attr_diff(attrs, record.hosts.get(k)?.attrs ?? {}, keep);
				}
			}
			if (og_c) {
				const dot = og_c.value.indexOf(".");
				const k = Number(og_c.value.slice(0, dot));
				if (!plan.has(k)) remove.add("og-c");
				else if (!planned_host && og_h?.name !== "og-u") reset = attr_diff(attrs, record.hosts.get(k)?.children.get(Number(og_c.value.slice(dot + 1)))?.attrs ?? {}, /* @__PURE__ */ new Set());
			}
			if (reset) add += ` og-r="${esc_attr(JSON.stringify(reset))}"`;
			if (stand_in) {
				add += ` tag="${name}"`;
				stand_ins++;
			}
			if (remove.size || add || stand_in) {
				out.push(html.slice(pos, tok.start), rewrite_start(html, tok, attrs, remove, add, stand_in ? "og-as" : void 0));
				pos = tok.end;
			}
			if (!(VOID.has(name) || tok.self && foreign)) push(stack, {
				name: stand_in ? "og-as" : name,
				as: stand_in ? name : void 0,
				host: is_host ? Number(og_h.value) : -1,
				next: 0,
				owned: false,
				under: -1,
				introduced,
				foreign
			});
			continue;
		}
		if (tok.t === "end") {
			const name = tok.name;
			for (let k = stack.length - 1; k >= 0; k--) {
				const f = stack[k];
				if ((f.as ?? f.name) === name) {
					if (f.as) {
						out.push(html.slice(pos, tok.start), "</og-as>");
						pos = tok.end;
					}
					cut(stack, k);
					break;
				}
			}
			continue;
		}
	}
	if (pending_text) finish_text(null);
	out.push(html.slice(pos));
	let check;
	if (opts.dev) for (const k of plan) {
		const rec = record.hosts.get(k);
		if (rec && rec.planned) (check ??= {})[k] = record.source.slice(rec.inner_start, rec.inner_end);
	}
	return {
		html: out.join(""),
		planned: plan.size,
		stand_ins,
		head,
		...check ? { check } : {}
	};
}
/** The dev check's payload: each planned Svelte-owned host's original children, by its id. */
function check_script(check) {
	return `<script type="application/ogygia-restore-check">${script_json(check)}<\/script>`;
}
// ../../../core/src/server/hole-graph.ts
/**
* WHAT A HOLE'S HEAD CARRIES INTO ITS ANSWER. A hole renders on its own, and the endpoint ships only
* the body — but the islands inside it write into the render's head what the page needs of them:
*
* - their GRAPH (the chunks their code needs — island-graph.ts). Without it the islands a hole brings
*   loaded in a waterfall: each chunk discovered only after the last one parsed (+1.1 s at a 150 ms
*   round trip, measured). Carried as one script; the runtime reads any graph script in the document
*   (runtime/island-graph-preload.ts), so a nested island's wake preloads its whole graph at once.
* - their CSS (the `data-ogygia-region-css` tags Region.svelte writes for each island it renders: the
*   island's own chunk CSS, exact — the bundler's, over what the island really imports). Without it
*   an island in a hole had only the hole's own sheet, and whatever it rendered after the server
*   render (a dropdown's contents, a branch behind a click) arrived unstyled. Carried as written; the
*   runtime hoists these tags from an answer into `<head>` before the swap, deduped by href.
*
* URLs are made root-absolute (the graph here, the CSS tags by the answer's own absolutizing pass):
* the answer lands in a page at any depth, and a `./_app/…` resolved there would 404. indexOf only.
*/
function root_absolute(value, base) {
	if (!value.startsWith("./") && !value.startsWith("../")) return value;
	try {
		const u = new URL(value, base);
		return u.origin === base.origin ? u.pathname + u.search + u.hash : value;
	} catch {
		return value;
	}
}
/** What the answer carries of the render's head: its islands' graph and their CSS ('' for none). */
function hole_head(head, base) {
	return (base ? hole_graph_script(head, base) : "") + head_region_css(head);
}
var REGION_CSS_ATTR = "data-ogygia-region-css";
/** Every region-CSS tag in the head, as written (`<link … data-ogygia-region-css>` or
*  `<style data-ogygia-region-css="…">…</style>`). */
function head_region_css(head) {
	let out = "";
	for (let at = head.indexOf(REGION_CSS_ATTR); at !== -1; at = head.indexOf(REGION_CSS_ATTR, at + 1)) {
		const start = head.lastIndexOf("<", at);
		if (start === -1) continue;
		const is_style = head.startsWith("<style", start);
		const end = is_style ? head.indexOf("</style>", at) : head.indexOf(">", at);
		if (end === -1) break;
		const stop = is_style ? end + 8 : end + 1;
		out += head.slice(start, stop);
		at = stop - 1;
	}
	return out;
}
/** One graph script for the answer (or '' when the render's head carries none). */
function hole_graph_script(head, base) {
	let at = head.indexOf(ISLAND_GRAPH_ATTR);
	if (at === -1) return "";
	const graph = /* @__PURE__ */ new Map();
	const locations = /* @__PURE__ */ new Map();
	for (; at !== -1; at = head.indexOf(ISLAND_GRAPH_ATTR, at + ISLAND_GRAPH_ATTR.length)) {
		const open = head.indexOf(">", at);
		const close = open === -1 ? -1 : head.indexOf("<\/script", open);
		if (close === -1) break;
		const text = head.slice(open + 1, close);
		for (const [entry, hrefs] of decode_island_graph(text)) {
			const key = root_absolute(entry, base);
			if (!graph.has(key)) graph.set(key, hrefs.map((h) => root_absolute(h, base)));
		}
		for (const [entry, src] of decode_island_locations(text)) locations.set(root_absolute(entry, base), root_absolute(src, base));
		at = close;
	}
	return island_graph_script(graph, locations);
}
// ../../../core/src/runtime/restore.ts
/**
* THE RESTORER — the browser half of reversible transforms (server/reversible.ts). An app's server
* transform rendered each planned custom element (`og-h`) in scoped form: its rendered tree in the
* host's light DOM, Svelte's children moved into `<slot>` wrappers inside it. This puts it back into
* the form hydration and the component's runtime both expect:
*
*   1. stand-ins (`<og-as tag="a">`: tags the HTML parser would have restructured) become their real
*      element, in place — a DOM operation, which no content-model rule applies to;
*   2. for each planned host, innermost first: an open shadow root with the host's keyed sheets, the
*      rendered tree moved into it (its `<slot>` wrappers become real slots), Svelte's children back
*      in the light DOM in their original order and exactly as Svelte rendered them (attributes reset,
*      trimmed or dropped text put back), the host's attributes back to Svelte's (except `og-keep`).
*
* The page stays painted the same throughout: the scoped form and the shadow form render alike, and
* each host is restored in one task. It must run before anything reads the markup — before an island
* snapshots or hydrates, before Kit starts, before a web-component runtime upgrades a host. So the
* handle inlines it at the end of the document's body (`restore.toString()`: this function is
* self-contained, no imports, no outer names), and the runtime calls it on a hole / lake answer before
* insertion and on an incoming page before a router swap.
*
* A host that already has a shadow root when it is reached was upgraded first — the restore came
* too late. It is left as served and reported (`ogygia:restore-late` on the host), never restored into
* a root the component's own constructor made (that tree would render twice).
*/
function restore(root) {
	const doc = root.ownerDocument ?? root;
	const head = document.head;
	const W = window;
	const sheets = W.__og_sheets ??= /* @__PURE__ */ new Map();
	const esc = (s) => typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.split("\\").join("\\\\").split("\"").join("\\\"");
	const live = doc === document;
	let restored = 0;
	/**
	* A KIT-HYDRATED page (csr=true) is hydrated by Kit's own start, which ogygia does not run — so
	* the island hydrate's put-back of a component's class tokens (runtime/host-classes.ts) never
	* runs there. Instead each restored custom element is watched once: Kit's hydrate writes its
	* `class` whole, to exactly Svelte's tokens; the first write that leaves exactly those gets back
	* every token it dropped (the component's, the render's `sc-*`), read from the value just before
	* that write. A component only ever adds and removes its own tokens, so no later state of the
	* host equals Svelte's alone. One observer for all of them; a host leaves the watch at that
	* write, and the observer goes when the last one has.
	*/
	const watch_classes = live && document.querySelector("meta[name=\"ogygia-csr\"][content=\"true\"]") !== null;
	const watch = (el) => {
		let w = W.__og_class_watch;
		if (!w) {
			const hosts = /* @__PURE__ */ new Set();
			const mo = new MutationObserver((records) => {
				for (let i = 0; i < records.length; i++) {
					const host = records[i].target;
					if (!hosts.has(host)) continue;
					let now;
					for (let j = i + 1; j < records.length && now === void 0; j++) if (records[j].target === host) now = records[j].oldValue;
					if (now === void 0) now = host.getAttribute("class");
					if ((now ?? "") !== host.__og_svelte_class) continue;
					hosts.delete(host);
					const own = new Set((now ?? "").split(" "));
					for (const t of (records[i].oldValue ?? "").split(" ")) if (t && !own.has(t)) host.classList.add(t);
				}
				if (hosts.size === 0) {
					mo.disconnect();
					W.__og_class_watch = void 0;
				}
			});
			w = W.__og_class_watch = {
				mo,
				hosts
			};
		}
		w.hosts.add(el);
		w.mo.observe(el, {
			attributes: true,
			attributeFilter: ["class"],
			attributeOldValue: true
		});
	};
	if (root !== document && root.querySelectorAll) for (const el of Array.from(root.querySelectorAll("[data-og-head]"))) {
		const key = el.getAttribute("data-og-head");
		if (head.querySelector(`[data-og-head="${esc(key)}"]`)) el.remove();
		else head.appendChild(el);
	}
	const sheet_for = (key) => {
		const have = sheets.get(key);
		if (have) return have;
		const sel = `template[data-og-head="${esc(key)}"]`;
		const tpl = doc !== document && doc.head?.querySelector(sel) || head.querySelector(sel);
		if (!tpl) return null;
		const css = tpl.content.textContent ?? "";
		let sheet = null;
		try {
			sheet = new CSSStyleSheet();
			sheet.replaceSync(css);
		} catch {
			sheet = null;
		}
		const made = {
			sheet,
			css
		};
		sheets.set(key, made);
		return made;
	};
	/** Attributes back to Svelte's. A custom element's `class` has two owners — Svelte, and the
	*  component, which may put state on its own host — so there it becomes Svelte's tokens PLUS the
	*  ones the render added, and Svelte's are recorded on the element (`__og_svelte_class`): the
	*  island's hydrate puts the component's back after Svelte writes `class` whole
	*  (runtime/host-classes.ts). Unless the render kept `class` as its own (`og-keep`). */
	const reset = (el) => {
		const r = el.getAttribute("og-r");
		const custom = el.localName.indexOf("-") !== -1 && (" " + (el.getAttribute("og-keep") ?? "") + " ").indexOf(" class ") === -1;
		let svelte_class;
		if (r) try {
			const diff = JSON.parse(r);
			for (const name in diff) {
				const v = diff[name];
				if (custom && name === "class") {
					svelte_class = v;
					const own = new Set((v ?? "").split(" "));
					let theirs = "";
					for (const t of Array.from(el.classList)) if (!own.has(t)) theirs += " " + t;
					const merged = ((v ?? "") + theirs).trim();
					if (merged) el.setAttribute("class", merged);
					else el.removeAttribute("class");
				} else if (v === null) el.removeAttribute(name);
				else el.setAttribute(name, v);
			}
		} catch {}
		if (custom) {
			el.__og_svelte_class = svelte_class === void 0 ? el.getAttribute("class") ?? "" : svelte_class ?? "";
			if (watch_classes) watch(el);
		}
		el.removeAttribute("og-r");
	};
	/** A mark's original text (`<!--og-c K.i t "…"-->`, `<!--og-t K.n "…"-->`), or undefined. */
	const original = (data) => {
		const q = data.indexOf(" \"");
		if (q === -1) return void 0;
		try {
			return JSON.parse(data.slice(q + 1));
		} catch {
			return;
		}
	};
	/** Put back the text after a text mark (trimmed, or dropped: then a new node), then drop the mark. */
	const fix_text = (mark) => {
		const was = original(mark.data);
		if (was !== void 0) {
			const next = mark.nextSibling;
			if (next && next.nodeType === 3) next.data = was;
			else mark.parentNode.insertBefore(doc.createTextNode(was), next);
		}
		const node = mark.nextSibling;
		mark.remove();
		return node;
	};
	const comments = (under, prefix) => {
		const out = [];
		const walk = doc.createTreeWalker(under, 128);
		for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.data.startsWith(prefix)) out.push(n);
		return out;
	};
	const swap_stand_ins = (under) => {
		const list = Array.from(under.querySelectorAll("og-as"));
		for (let x = list.length - 1; x >= 0; x--) {
			const as = list[x];
			const real = doc.createElement(as.getAttribute("tag") || "span");
			for (const a of Array.from(as.attributes)) if (a.name !== "tag") real.setAttribute(a.name, a.value);
			while (as.firstChild) real.appendChild(as.firstChild);
			as.replaceWith(real);
		}
	};
	let check = null;
	const check_el = root.querySelector("script[type=\"application/ogygia-restore-check\"]");
	if (check_el) {
		try {
			check = JSON.parse(check_el.textContent || "{}");
		} catch {
			check = null;
		}
		check_el.remove();
	}
	/** The first difference between Svelte's children and the restored ones (node types, tags, text,
	*  comments, attributes — a web-component host may carry more than Svelte's: `og-keep`), or null. */
	const differ = (want, got, path) => {
		const a = want.childNodes;
		const b = got.childNodes;
		for (let i = 0; i < Math.max(a.length, b.length); i++) {
			const x = a[i];
			const y = b[i];
			const here = `${path} > [${i}]`;
			if (!x || !y) return `${here}: Svelte has ${x ? describe(x) : "nothing"}, the restored markup has ${y ? describe(y) : "nothing"}`;
			if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) return `${here}: Svelte has ${describe(x)}, the restored markup has ${describe(y)}`;
			if (x.nodeType === 3 || x.nodeType === 8) {
				if (x.data !== y.data) return `${here}: Svelte has ${describe(x)}, the restored markup has ${describe(y)}`;
				continue;
			}
			if (x.nodeType !== 1) continue;
			const ex = x;
			const ey = y;
			const custom = ex.localName.indexOf("-") !== -1;
			for (const attr of Array.from(ex.attributes)) {
				if (custom && attr.name === "class" ? within(attr.value, ey.getAttribute("class")) : norm(attr.name, attr.value) === norm(attr.name, ey.getAttribute(attr.name))) continue;
				return `${here} <${ex.localName}>: Svelte has ${attr.name}="${attr.value}", the restored markup has ${ey.hasAttribute(attr.name) ? `"${ey.getAttribute(attr.name)}"` : "none"}`;
			}
			if (!custom) {
				for (const attr of Array.from(ey.attributes)) if (!ex.hasAttribute(attr.name) && norm(attr.name, attr.value) !== null) return `${here} <${ex.localName}>: the restored markup adds ${attr.name}="${attr.value}"`;
			}
			const deeper = differ(x, y, `${here} <${ex.localName}>`);
			if (deeper) return deeper;
		}
		return null;
	};
	/** An attribute as it matters, not as a serializer wrote it: `class` as its set of tokens, `style`
	*  as its declarations, an empty value as absent (Svelte's hydration reads neither; a render's
	*  serializer rewrites both). */
	const norm = (name, value) => {
		if (value === null || value.trim() === "") return name === "class" || name === "style" ? null : value;
		if (name === "class") return value.split(/\s+/).filter(Boolean).sort().join(" ");
		if (name === "style") return value.split(";").map((d) => {
			const c = d.indexOf(":");
			return c === -1 ? d.trim() : `${d.slice(0, c).trim().toLowerCase()}:${d.slice(c + 1).trim().replace(/\s+/g, " ")}`;
		}).filter(Boolean).join(";");
		return value;
	};
	/** Every class token of `want` is in `got`. */
	const within = (want, got) => {
		const have = new Set((got ?? "").split(/\s+/));
		for (const t of want.split(/\s+/)) if (t && !have.has(t)) return false;
		return true;
	};
	const describe = (n) => n.nodeType === 3 ? `the text ${JSON.stringify(n.data)}` : n.nodeType === 8 ? `the comment <!--${n.data}-->` : `<${n.localName}>`;
	const verify = (host, k) => {
		const want = check?.[k];
		if (want === void 0) return;
		const tpl = doc.createElement("template");
		tpl.innerHTML = want;
		const diff = differ(tpl.content, host, `<${host.localName}>`);
		if (!diff) return;
		console.error(`[ogygia] the transform broke hydration markup: ${diff}`);
		host.dispatchEvent(new CustomEvent("ogygia:restore-mismatch", {
			bubbles: true,
			detail: {
				host: host.localName,
				diff
			}
		}));
		log("mismatch", host, diff);
	};
	/** What went wrong, kept for whoever reads it later (the devtools, the profiler's beacon): the
	*  restorer runs while the page parses — before any listener of theirs exists. */
	const log = (kind, host, diff) => {
		const list = W.__og_restore_log ??= [];
		if (list.length >= 50) return;
		const island = host.closest("ogygia-region")?.getAttribute("data-og-fp") ?? void 0;
		list.push({
			kind,
			host: host.localName,
			t: Math.round(performance.now()),
			...diff ? { diff: diff.slice(0, 300) } : {},
			...island ? { island } : {}
		});
	};
	const scopes = [root];
	for (let q = 0; q < scopes.length; q++) {
		const walk = doc.createTreeWalker(scopes[q], 1);
		for (let n = walk.nextNode(); n; n = walk.nextNode()) {
			const sr = n.shadowRoot;
			if (sr && sr.mode === "open") scopes.push(sr);
		}
	}
	for (const scope of scopes) swap_stand_ins(scope);
	const hosts = [];
	for (const scope of scopes) hosts.push(...Array.from(scope.querySelectorAll("[og-h]")));
	for (let x = hosts.length - 1; x >= 0; x--) {
		const host = hosts[x];
		const k = host.getAttribute("og-h");
		const keys = (host.getAttribute("og-shadow") ?? "").split(" ").filter(Boolean);
		if (host.shadowRoot) {
			host.dispatchEvent(new CustomEvent("ogygia:restore-late", {
				bubbles: true,
				detail: { host: k }
			}));
			log("late", host);
			continue;
		}
		const shadow = host.attachShadow({ mode: "open" });
		if (!live) (W.__og_init ??= []).push(shadow);
		const own = [];
		const adoptable = Array.isArray(shadow.adoptedStyleSheets);
		for (const key of keys) {
			const s = sheet_for(key);
			if (!s) continue;
			if (s.sheet && adoptable) own.push(s.sheet);
			else {
				const style = doc.createElement("style");
				style.textContent = s.css;
				shadow.appendChild(style);
			}
		}
		if (own.length) {
			if (live) shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, ...own];
			else {
				shadow.__og_pending = own;
				(W.__og_adopt ??= []).push({
					shadow,
					sheets: own
				});
			}
		}
		const children = [];
		const tag = `${k}.`;
		for (const el of Array.from(host.querySelectorAll("[og-c]"))) {
			const v = el.getAttribute("og-c");
			if (v.startsWith(tag)) children.push({
				i: Number(v.slice(tag.length)),
				node: el
			});
		}
		for (const mark of comments(host, `og-c ${tag}`)) {
			const rest = mark.data.slice(5 + tag.length);
			const i = Number(rest.slice(0, rest.indexOf(" ") === -1 ? rest.length : rest.indexOf(" ")));
			const is_text = rest.indexOf(" t") !== -1;
			const node = is_text ? fix_text(mark) : mark.nextSibling;
			if (!is_text) mark.remove();
			if (node) children.push({
				i,
				node
			});
		}
		children.sort((a, b) => a.i - b.i);
		const mine = new Set(children.map((c) => c.node));
		for (const n of Array.from(host.childNodes)) if (!mine.has(n)) shadow.appendChild(n);
		const made = W.__og_rendered ??= /* @__PURE__ */ new WeakSet();
		for (const c of children) {
			host.appendChild(c.node);
			made.add(c.node);
		}
		for (const c of children) if (c.node.nodeType === 1) {
			const el = c.node;
			reset(el);
			el.removeAttribute("og-c");
		}
		for (const mark of comments(host, `og-t ${tag}`)) fix_text(mark);
		reset(host);
		host.removeAttribute("og-h");
		host.removeAttribute("og-shadow");
		host.removeAttribute("og-keep");
		verify(host, k);
		restored++;
	}
	return restored;
}
/** Adopt the sheets of roots restored outside the page, now that their hosts are in it (after a hole
*  answer's insertion or a router swap, in the same task: no paint in between). Each root is one of
*  three: IN THE PAGE (adopted now); in a fragment not inserted yet (another hole's answer still
*  waiting for its stylesheet: kept for the call after its insertion); or in ANOTHER DOCUMENT — the
*  incoming page's parsed copy, where the swap left what it did not take (a morph kept the live
*  host): dropped. That last one counts as connected (its document is its root), and adopting a page
*  sheet into it throws — which stopped every root after it from getting its sheets. A fragment root
*  still out after 30 s never goes in (a morph took a copy of it, the hole left): dropped. */
function restore_adopt() {
	const W = window;
	const now = performance.now();
	const waiting = (root) => now - (root.__og_out ??= now) < 3e4;
	const where = (root) => root.host.isConnected ? root.host.ownerDocument === document ? "page" : "gone" : waiting(root) ? "later" : "gone";
	const bare = W.__og_init;
	if (bare?.length) {
		const left = [];
		const ce = customElements;
		for (const root of bare) {
			const at = where(root);
			if (at === "later") left.push(root);
			else if (at === "page" && root.customElementRegistry === null) ce.initialize?.(root);
		}
		W.__og_init = left;
	}
	const list = W.__og_adopt;
	if (!list?.length) return;
	const left = [];
	for (const item of list) {
		const at = where(item.shadow);
		if (at === "later") left.push(item);
		else if (at === "page") try {
			item.shadow.adoptedStyleSheets = [...item.shadow.adoptedStyleSheets, ...item.sheets];
		} catch {}
	}
	W.__og_adopt = left;
}
// ../../../core/src/server/rate-limit.ts
var DEFAULT_CAP = 4096;
var RateLimiter = class {
	#buckets = /* @__PURE__ */ new Map();
	#cap;
	#max;
	#windowMs;
	#since_prune = 0;
	constructor(opts) {
		this.#max = opts.max;
		this.#windowMs = opts.windowMs;
		this.#cap = Math.max(1, opts.cap ?? DEFAULT_CAP);
	}
	/** Mark `ip` as most-recently used (Map: delete + set → end of iteration order). */
	#touch(ip, b) {
		this.#buckets.delete(ip);
		this.#buckets.set(ip, b);
	}
	#evict_lru() {
		while (this.#buckets.size > this.#cap) {
			const oldest = this.#buckets.keys().next().value;
			if (oldest === void 0) return;
			this.#buckets.delete(oldest);
		}
	}
	#maybe_prune(now) {
		this.#since_prune++;
		if (this.#since_prune >= 64) {
			this.#since_prune = 0;
			for (const [k, v] of this.#buckets) if (now - v.t >= this.#windowMs) this.#buckets.delete(k);
		}
		this.#evict_lru();
	}
	/** @returns true if this IP is over budget (request should 429). */
	limited(ip) {
		if (this.#max <= 0) return false;
		const now = Date.now();
		const b = this.#buckets.get(ip);
		if (!b || now - b.t >= this.#windowMs) {
			this.#buckets.set(ip, {
				n: 1,
				t: now
			});
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
	get size() {
		return this.#buckets.size;
	}
	clear() {
		this.#buckets.clear();
		this.#since_prune = 0;
	}
};
// ../../../core/src/server/page-seed.ts
/** Serialize a Kit `page` snapshot for a single document-level ogygia side-channel. */
var PageSeed = class {
	/**
	* Public page slice for islands. url/params/route/status are always plain and MUST survive;
	* data/form/error may carry a non-serializable leaf (function/store/class) — that ONE field is
	* dropped, never the whole seed. Promises should already be resolved by the handle
	* (`resolve_promises`) before this. See INVARIANTS.md · PAGE-SEED.
	*
	* `json`: the caller proved the whole slice JSON-exact (seed-refs.ts `analyze`) — then the seed
	* goes out as native `JSON.stringify` output (an order of magnitude cheaper than devalue on a
	* CMS tree), escaped once for the `<script>`. devalue output needs no escape (it writes `<`).
	*/
	static serialize(page_ref, stringify_fn = stringify$1, json = false) {
		try {
			const base = {
				url: page_ref.url?.href,
				params: page_ref.params,
				route: page_ref.route,
				status: page_ref.status
			};
			const full = {
				...base,
				data: page_ref.data,
				form: page_ref.form ?? null,
				error: page_ref.error ?? null
			};
			if (json) try {
				return {
					text: escape_script_text(JSON.stringify(full)),
					json: true
				};
			} catch {}
			let raw;
			try {
				raw = stringify_fn(full);
			} catch {
				const safe = { ...base };
				for (const key of [
					"data",
					"form",
					"error"
				]) try {
					stringify_fn(full[key]);
					safe[key] = full[key];
				} catch {}
				raw = stringify_fn(safe);
			}
			return {
				text: raw,
				json: false
			};
		} catch {
			return null;
		}
	}
};
// ../../../core/src/page-defer.ts
/**
* Shared constants for streaming a load `Promise` in `$page.data` into an island on a csr=false page.
*
* Kit lets `load` return a Promise at any level of `data` and STREAMS its resolution to the client
* (render the shell with `{#await}` pending, then flush `<script>` chunks that settle it). A csr=false
* page has no hydration, so Kit's own stream is dead there — but an ISLAND has a client. We mirror
* Kit's shape with our OWN registry: the page seed carries a DEFER MARKER for each pending promise
* (a real pending Promise on the client), and streamed resolve `<script>`s settle them live.
*
* Constants only — safe to import from both the server (staging/serialization) and the client
* (registry/reviver), with no code crossing the boundary.
*/
/** devalue reducer/reviver name for a deferred-promise leaf in the page seed. The encoded payload is
*  the promise's integer id (assigned in walk order). */
var PAGE_DEFER_KEY = "OgygiaDefer";
/** devalue reducer/reviver name for an already-SETTLED promise leaf — used on the non-navigate
*  (SPA/router) path, which can't run streamed scripts, so each promise is awaited server-side and
*  revived as a resolved/rejected Promise at parse time. Keeps `page.data.x` a Promise on BOTH paths
*  (matches Kit) and lets a rejection show `{#await …:catch}` without ever crashing the render. */
var PAGE_SETTLED_KEY = "OgygiaSettled";
/** Global the streamed resolve `<script>`s call: `__ogygia_page_resolve(id, ok, encoded)` where
*  `encoded` is the devalue-stringified resolved value (or the error). Installed by an inline
*  bootstrap in the first body chunk so it exists BEFORE any resolve script runs. */
var PAGE_DEFER_GLOBAL = "__ogygia_page_resolve";
/** Inline bootstrap the handle emits in the body (before the resolve scripts, which stream after
*  `</body>`): defines the resolve global, queuing calls into the shared registry until the runtime
*  installs the live parser. Each call stamps when it arrived (`t[id]`, ms from the navigation): the
*  devtools Page tab names the streamed `page.data` key that held the document open. Emitted as a classic `<script>` so it runs during parse, before any
*  streamed resolve script. Kept in sync with the runtime's `install_page_defer` registry shape. */
var PAGE_DEFER_BOOTSTRAP = `(function(){var K=Symbol.for('ogygia.page-defer'),r=globalThis[K]||(globalThis[K]={});r.q=r.q||[];globalThis.${PAGE_DEFER_GLOBAL}=function(i,o,e){(r.t||(r.t={}))[i]=performance.now();if(r.live)r.live(i,o,e);else r.q.push([i,o,e]);};})();`;
// ../../../core/src/server/page-stream.ts
/**
* Server side of streaming `$page.data` promises into islands (see `../page-defer.ts` for the why).
*
* `stage_deferred` walks the captured page `data`/`form`, swaps every promise for a serializable
* DEFER MARKER, and hands back the promise-free clone plus the promises to await. The clone goes into
* the page seed (each marker becomes a real pending Promise on the client); as each promise settles we
* stream a `<script>__ogygia_page_resolve(id, ok, encoded)<\/script>` chunk that resolves it live.
*/
var MAX_DEPTH = 64;
/** A THENABLE, not just a native Promise — Kit wraps streamed load promises, so `instanceof Promise`
*  would miss them. Anything with a callable `.then` we can await. */
var is_thenable = (v) => !!v && (typeof v === "object" || typeof v === "function") && typeof v.then === "function";
/** Serializable stand-in for a pending promise leaf (streaming path). Encodes to its id. */
var DeferRef = class {
	id;
	constructor(id) {
		this.id = id;
	}
};
/** Serializable stand-in for an already-settled promise leaf (non-navigate path). Encodes to
*  `[ok, value]`; the client revives it as a resolved/rejected Promise. */
var SettledRef = class {
	ok;
	value;
	constructor(ok, value) {
		this.ok = ok;
		this.value = value;
	}
};
var defer_reducer = { [PAGE_DEFER_KEY]: (v) => v instanceof DeferRef ? [v.id] : void 0 };
var page_seed_reducers = {
	[PAGE_DEFER_KEY]: (v) => v instanceof DeferRef ? [v.id] : void 0,
	[PAGE_SETTLED_KEY]: (v) => v instanceof SettledRef ? [v.ok, v.value] : void 0
};
/**
* Replace every promise in `value` with a {@link DeferRef}, returning the promise-free clone plus the
* deferred promises (id + promise to await). Plain objects/arrays are cloned; class instances and
* primitives pass through untouched. Ids continue from `start_id` so `data` and `form` share one id
* space across the whole seed. Bounded depth guards a pathological structure.
*/
function stage_deferred(value, start_id = 0) {
	const deferred = [];
	let id = start_id;
	const walk = (v, depth) => {
		if (is_thenable(v)) {
			const ref = new DeferRef(id++);
			deferred.push({
				id: ref.id,
				promise: v
			});
			return ref;
		}
		if (depth > MAX_DEPTH) return v;
		if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
		if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
			const out = {};
			for (const k in v) out[k] = walk(v[k], depth + 1);
			return out;
		}
		return v;
	};
	return {
		staged: walk(value, 0),
		deferred,
		next_id: id
	};
}
/**
* Non-navigate (SPA/router) fallback: deep-await every promise in `value`, wrapping each ORIGINAL
* promise position in a {@link SettledRef} (resolved OR rejected — a rejection is caught, never
* thrown, so the render can't crash). Nested promises inside a resolved value are settled too. The
* client revives each SettledRef as a resolved/rejected Promise, so `page.data.x` stays a Promise on
* this path exactly as on the streaming path, and `{#await …:catch}` works.
*/
async function settle_deferred(value, depth = 0) {
	if (is_thenable(value)) try {
		return new SettledRef(true, await settle_deferred(await value, depth + 1));
	} catch (err) {
		return new SettledRef(false, normalize_error(err));
	}
	if (depth > MAX_DEPTH) return value;
	if (Array.isArray(value)) return Promise.all(value.map((x) => settle_deferred(x, depth + 1)));
	if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
		const out = {};
		await Promise.all(Object.keys(value).map(async (k) => {
			out[k] = await settle_deferred(value[k], depth + 1);
		}));
		return out;
	}
	return value;
}
/**
* The streamed resolve `<script>` body for one settled promise. The value is encoded WITH
* {@link defer_reducer} so a re-staged value carrying nested DeferRef markers (a promise that resolved
* to a value containing further promises) serializes — the client revives those as fresh pending
* promises that later resolve scripts settle, exactly like Kit's recursive deferral. `ok=false` carries
* a normalized `{ message }` (matches the page seed's error shape) so a rejected non-serializable value
* can't blow up the stream. `<` is escaped so the payload can't break out of the `<script>`.
*/
function resolve_script(global_name, id, settled, reducers = defer_reducer) {
	let ok = settled.ok;
	let encoded;
	try {
		encoded = stringify$1(ok ? settled.value : normalize_error(settled.value), reducers);
	} catch {
		encoded = stringify$1({ message: "ogygia: streamed value is not serializable" });
		ok = false;
	}
	const json = escape_script_text(JSON.stringify(encoded));
	return `<script>${global_name}(${id},${ok},${json})<\/script>`;
}
function normalize_error(err) {
	if (err instanceof Error) return { message: err.message };
	if (err && typeof err === "object" && "message" in err) return { message: String(err.message) };
	return { message: String(err) };
}
// ../../../core/src/server/remote-seed-gate.ts
/**
* REMOTE SEED ONLY WHEN REACHABLE — the handle's per-remote decision when it builds the
* `application/ogygia-remote` seed: does any region rendered on this page have client code that
* can call this remote? The seed exists so a hydrating island that re-runs the same query resolves
* it from the document (zero-flash, no re-fetch). A remote no island on the page imports — a lake
* or a page script awaiting a query for its own server render — has no such reader, and its
* result is pure download weight (a CMS footer entry: 12.5 KB, measured).
*
* `wanted` is the union of every rendered region's `islandRemotes(entry)` (Region.svelte →
* page-seed-registry → the request bag): Kit id-hashes, the prefix of a remote's `internals.id`
* (`${hash}/${name}`). `null` = some region answered fail-open ("may call anything": a promise `of`,
* an entry the build handoff does not know, dev) → every remote seeds, exactly as before the gate.
* Pure, so it is unit-tested on its own.
*/
function remote_seed_wanted(remote_id, wanted) {
	if (wanted === null) return true;
	const slash = remote_id.indexOf("/");
	if (slash === -1) return true;
	return wanted.has(remote_id.slice(0, slash));
}
/**
* Mirror Kit's OWN seed bucketing (server/remote.js) over the side-channel — Kit only serializes
* remote data inline when csr===true, so on csr=false pages the handle does it here. Buckets every
* implicit remote by type: q(query) / p(prerender) / l(query.live) / f(form). Seeding PRERENDER
* remotes (not only queries) is the fix for the async-island FOUC: a prerender remote awaited inside
* an island otherwise re-fetches on hydrate, so the component re-renders and Svelte RE-MOUNTS the
* subtree — a frame of unstyled DOM. With the seed in `prerender_responses`, the client resolves it
* synchronously and never re-fetches. Keys use `create_remote_key`, exactly like Kit's client.
*
* Skips, in order: a PRIVATE remote (no id — must never be serialized), a remote NO REGION'S
* CLIENT CAN CALL (`wanted`, above), an ERRORED or still-PENDING result (the client fetches it
* itself; an entry without `v` would hydrate as `undefined`), and a value carrying a BAKED region
* (`skip_value`: SSR HTML in the ticket — a page body from a `doc`-style remote is a page-sized
* RENDER the page already rendered; seeding it ships the body twice, ~130 KB/page measured).
*
* Pure over what it is handed (the implicit map, the request's memo of results, the two
* predicates); the handle serializes what comes back. Unit-tested across every permutation.
*/
async function collect_remote_seed(implicit, wanted, opts) {
	const data = {
		q: {},
		p: {},
		l: {},
		f: {}
	};
	for (const [internals, record] of implicit) {
		if (!internals.id) continue;
		if (!remote_seed_wanted(internals.id, wanted)) continue;
		const type = internals.type;
		const bucket = type === "query_live" ? "l" : type[0];
		if (bucket !== "q" && bucket !== "p" && bucket !== "l" && bucket !== "f") continue;
		for (const payload in record) {
			const remote_key = type === "form" ? payload : opts.key(internals.id, payload);
			const promise = opts.memo?.(internals)?.[payload] ?? record[payload]();
			let resolved = true;
			await Promise.race([Promise.resolve(promise).then((v) => {
				if (resolved && !opts.skip_value?.(v)) data[bucket][remote_key] = { v };
			}, () => {}), Promise.resolve().then(() => {
				resolved = false;
			})]);
		}
	}
	return data;
}
// ../../../core/src/server/dead-kit-resolves.ts
/**
* Drop Kit's streamed resolve scripts from a document with no Kit client (csr=false). A load that
* returns promises makes Kit stream `<script>__sveltekit_x.resolve(…)<\/script>` chunks after the
* document; they call a global only Kit's client bootstrap defines, so on a csr=false page each one
* throws. (When an island reads the page, `stream_page_deferred` replaces the whole tail instead.)
*
* Only a chunk that STARTS with `<script` is decoded and looked at — the document and every other
* chunk (late regions included) pass untouched: no copy, no scan of a big page.
*/
var SCRIPT_BYTES = [
	60,
	115,
	99,
	114,
	105,
	112,
	116
];
function drop_dead_kit_resolves(response) {
	const body = response.body;
	if (!body) return response;
	const decoder = new TextDecoder();
	const out = body.pipeThrough(new TransformStream({ transform(chunk, controller) {
		let starts = chunk.length >= SCRIPT_BYTES.length;
		for (let i = 0; starts && i < SCRIPT_BYTES.length; i++) if (chunk[i] !== SCRIPT_BYTES[i]) starts = false;
		if (starts && chunk.length < 1 << 20) {
			const text = decoder.decode(chunk);
			if (text.includes("__sveltekit_") && text.includes(".resolve(")) return;
		}
		controller.enqueue(chunk);
	} }));
	return new Response(out, {
		status: response.status,
		statusText: response.statusText,
		headers: new Headers(response.headers)
	});
}
// ../../../core/src/document.ts
/**
* `document()` — the document a region stands in.
*
* ogygia's one primitive is the region: component + props with rendering and waking rules. Every
* region so far has lived inside a document that Kit happened to serve. `document()` is the other
* half: given a region value, mint the COMPLETE ogygia document around it — doctype, head
* (`<svelte:head>` content, scoped-CSS links, the runtime bootstrap), body (the region's HTML,
* `<ogygia-region>` shells, props sidecars) — returned as a `Response` you can serve from anywhere:
* a `handle` in hooks, a `+server.ts` endpoint, the profiler. No URL, no routing, no "page"
* semantics — where it's served is the caller's business.
*
* It renders through `<Region of={…}>` inside the live request (Kit's `getRequestEvent()` ALS), so
* ALL the per-request machinery regions already have simply applies: `claim_region_css` links each
* scoped stylesheet once, props sidecars ride next to their shells, islands inside wake on their own
* schedules, and the emitted markup is a standard ogygia page — the SPA router body-swaps into and
* out of it like any Kit-served page.
*
* Deliberately NOT the app's `app.html`: that template belongs to Kit's build and does not exist at
* runtime. The shell here is ogygia's own, minimal one — extra head content goes through
* `<svelte:head>` in the components or the `head` option.
*
* Server-only (it renders): call it from a handle / endpoint / server module.
*/
var TITLE_TAG_RE = /<title[\s>]/i;
/** The `page` object Kit's server `$app/state` answers from (Kit's `props.page` shape), built from
*  the caller's seed when the router passed one, else from the live request (URL, status) with
*  empty data — so `page.url`/`page.status` are always true and `page.data` never throws on any
*  ogygia-rendered document. Also RECORDED into the request's page snapshot, so the nested island
*  renders under this document rebuild the same context (see server/kit-context.ts). */
function kit_page_context(options) {
	const s = options.pageState;
	const store = try_get_request_store();
	const href = s?.url?.href ?? store?.event?.url?.href;
	const page = {
		url: href ? new URL(href) : void 0,
		params: s?.params ?? {},
		route: s?.route ?? { id: null },
		status: s?.status ?? options.status ?? 200,
		data: s?.data ?? {},
		form: s?.form ?? null,
		error: s?.error ?? null,
		state: {}
	};
	record_page({
		url: href ? { href } : void 0,
		params: page.params,
		route: page.route,
		status: page.status,
		data: page.data,
		form: page.form,
		error: page.error
	}, false, []);
	return page;
}
/**
* Render a region into a complete ogygia document and return it as a `Response`.
*
* ```ts
* import { document } from 'ogygia/server';
* import { region } from 'ogygia';
*
* return document(region(Dashboard, { stats }), { title: 'ogygia profiler' });
* ```
*/
async function document$1(of, options = {}) {
	open_ask_scope();
	const r = await render(Region, {
		props: { of: await of },
		context: kit_render_context$1(kit_page_context(options))
	});
	const head = [];
	head.push(r.head);
	if (options.head) head.push(options.head);
	const head_so_far = () => head.join("");
	if (options.title && !TITLE_TAG_RE.test(head_so_far())) head.push(`<title>${escape_text(options.title)}</title>`);
	if (!page_declares_router_meta(head_so_far())) head.push(`<meta name="ogygia-router" content="vt">`);
	if (!page_declares_runtime_script(head_so_far())) head.push(runtime_bootstrap());
	const ask = options.pageState ? read_seed_ask() : void 0;
	if (options.pageState && (!ask || ask.wanted)) {
		const s = options.pageState;
		const data = ask ? shape_page_data(s.data, ask.keys) : s.data;
		const payload = PageSeed.serialize({
			url: s.url,
			params: s.params,
			route: s.route,
			status: s.status,
			data,
			form: s.form,
			error: s.error
		}, (v) => stringify$1(v, page_seed_reducers), analyze$1(data).json && analyze$1(s.form ?? null).json && analyze$1(s.error ?? null).json);
		if (payload) {
			const format = payload.json ? ` ${WIRE_FORMAT_ATTR}="${WIRE_FORMAT_JSON}"` : "";
			head.push(`<script type="application/ogygia-page" data-ogygia-page${format}>${payload.text}<\/script>`);
		}
	}
	const html = `<!doctype html>\n<html lang="${escape_text(options.lang ?? "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` + runtime_first(head.join(""), null) + `</head><body>${r.body}</body></html>`;
	const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
	if (!current_facts()?.storable) headers.set("cache-control", "no-store");
	if (options.headers) for (const [k, v] of new Headers(options.headers)) headers.set(k, v);
	return new Response(html, {
		status: options.status ?? 200,
		headers
	});
}
// ../../../core/src/hooks.ts
/**
* SvelteKit server `handle` for signed region holes (`defer` / remount:`swr`).
*
* Serves `GET <base>/__ogygia__?id=…&props=…&exp=…&sig=…` by verifying the region MAC,
* rendering the region component server-side (cookies, remote functions, and `await` work),
* and returning HTML for the client runtime to swap in.
*
* Composable with `sequence()` — intercepts only the region endpoint path; otherwise
* calls `resolve(event)`. Also injects the document-level page seed used by islands.
*
* @example
* ```ts
* // src/hooks.server.ts
* import { ogygiaHandle } from 'ogygia/hooks';
* import { sequence } from '@sveltejs/kit/hooks';
* export const handle = sequence(ogygiaHandle(), myOtherHandle);
* ```
*
* @packageDocumentation
*/
/** Hard cap on rendered region HTML (bytes). */
var MAX_REGION_BODY = 2e6;
var DEVTOOLS_LAZY = false;
var bags = /* @__PURE__ */ new WeakMap();
/** This request's bag, or `undefined` outside a Kit page request (a hole endpoint, a remote-function
*  call, a render with no Kit store around it). */
function bag_of() {
	const request = try_get_request_store()?.event?.request;
	return request ? bags.get(request) : void 0;
}
var doc_asks = /* @__PURE__ */ new WeakMap();
var request_of = () => try_get_request_store()?.event?.request;
set_ask_scope_opener(() => {
	const request = request_of();
	if (request && !bags.has(request) && !doc_asks.has(request)) doc_asks.set(request, {
		wanted: false,
		keys: null
	});
});
set_seed_ask_reader(() => {
	const bag = bag_of();
	if (bag) return {
		wanted: bag.seed_wanted,
		keys: bag.seed_keys
	};
	const request = request_of();
	const d = request ? doc_asks.get(request) : void 0;
	return d ? {
		wanted: d.wanted,
		keys: d.keys
	} : void 0;
});
set_page_recorder((snapshot, seed, remotes, entry) => {
	const event = try_get_request_store()?.event;
	if (event && note_render_page_ask(event, seed)) return;
	const bag = bag_of();
	if (!bag) {
		const request = request_of();
		const d = request ? doc_asks.get(request) : void 0;
		if (d && seed !== false) {
			d.wanted = true;
			d.keys = merge_seed_ask(d.keys, seed);
		}
		return;
	}
	bag.page = {
		...bag.page,
		...snapshot
	};
	if (seed !== false) {
		bag.seed_wanted = true;
		bag.seed_keys = merge_seed_ask(bag.seed_keys, seed);
	}
	if (bag.seed_asks && entry && seed !== false) bag.seed_asks.set(entry, seed);
	if (remotes === null) bag.remotes_wanted = null;
	else if (bag.remotes_wanted) for (const h of remotes) bag.remotes_wanted.add(h);
});
set_tail_reader(() => bag_of()?.tail ?? null);
set_measure_memo_reader(() => bag_of()?.measure_memo ?? null);
configure_render_page({ warn: null });
set_kit_event_reader(() => try_get_request_store()?.event ?? null);
/** Does this hole's server tree read `page.data` (the build's answer; unknown in dev → yes). */
var hole_reads_page_data = (id) => island_reads_page_data === null || island_reads_page_data[id] !== false;
set_render_page_port({
	ready(reads_data) {
		const store = try_get_request_store();
		return prepare_render_page(store?.event, store?.state?.transport, reads_data);
	},
	tail() {
		const store = try_get_request_store();
		return render_page_facts_script(store?.event, store?.state?.transport);
	},
	version(hole_id) {
		if (!hole_reads_page_data(hole_id)) return "";
		const v = render_page_version(try_get_request_store()?.event, bag_of()?.page ?? void 0);
		return v ? "&pv=" + v : "";
	}
});
set_kit_page_reader(() => {
	const bag = bag_of();
	return render_page(bag ? bag.page ?? {} : void 0, try_get_request_store()?.event);
});
set_late_scope_opener(() => {
	const bag = bag_of();
	if (bag) bag.late_open = true;
});
set_late_recorder((promise) => {
	const bag = bag_of();
	if (!bag?.late_open) return null;
	const id = `r${bag.late_next++}`;
	(bag.late ??= []).push({
		id,
		promise
	});
	return id;
});
set_late_taker(() => {
	const bag = bag_of();
	if (!bag?.late?.length) return null;
	const list = bag.late;
	bag.late = null;
	return list;
});
set_current_request(() => try_get_request_store()?.event?.request);
set_source_recorder((tag) => {
	current_facts()?.sources?.push(tag);
});
set_page_route_options(route_options);
var plugins = start_plugins(plugins$1, {
	sign: (message) => sign(signing_key().secret, message),
	verify: (message, signature) => verify(signing_key().secret, message, signature)
});
/** Cap on a batch POST body before `request.json()` buffers it. 32 endpoints × ~8.5kB (props cap
*  8192 + URL overhead) ≈ 270kB; 512kB leaves margin. Rejected up front via `content-length`. */
var MAX_BATCH_BODY = 524288;
/** Abort waiting on slow region SSR (work may continue — see INVARIANTS · RENDER-TIMEOUT). */
var RENDER_TIMEOUT_MS = 1e4;
/** Process-local cap on concurrent region SSR (M1 CPU amp under valid MAC). */
var render_gate = new ConcurrencyGate(4);
/** The per-plugin contexts of an app with no plugins (shared: never written to). */
var NO_CTXS = [];
/**
* Anti-framing + MIME + Referrer on every region response.
* Referrer-Policy strips capability query strings from third-party asset requests (H6).
*/
var REGION_FRAME_HEADERS = {
	"X-Frame-Options": "DENY",
	"Content-Security-Policy": "frame-ancestors 'none'",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer"
};
function region_response(body, init) {
	return new Response(body, {
		status: init.status,
		headers: {
			...REGION_FRAME_HEADERS,
			...init.headers
		}
	});
}
/**
* Every refused region request: a 403 that says why (`x-ogygia-deny`) and which key answered
* (`x-ogygia-key`, the fingerprint a capability carries as `&k=`). Neither is an oracle: every
* reason past `sig` is reached only with a capability this key signed (an unknown id still never
* tells from a bad MAC, SEC-01), and the fingerprint is an HMAC of a constant.
*/
function region_denied(why) {
	return region_response("Forbidden", {
		status: 403,
		headers: {
			"x-ogygia-deny": why,
			"x-ogygia-key": signing_key().fp
		}
	});
}
/** A capability minted under another key than this deployment's (its `&k=` fingerprint). One
*  without `k` (minted before capabilities named their key) is left to the MAC. */
function foreign_key(k) {
	return k !== null && k !== signing_key().fp;
}
function capability_of(params) {
	return {
		id: params.get("id") ?? "",
		render: params.get("r") ?? "",
		payload: params.get("props") ?? "",
		exp: params.get("exp") ?? "",
		ttl: params.get("ttl") ?? "",
		sig: params.get("sig") ?? "",
		k: params.get("k")
	};
}
/**
* The server entry that answers a verified capability: its own id when this build has it, else an
* entry of this build rendering the same component (its signed render identity) — the capability
* came from another build: an older cached page, another deployment, a changed schedule or salt.
* Null when this build renders neither: the component is gone, moved or renamed.
*/
function capability_target(cap) {
	if (Object.hasOwn(island_url, cap.id)) return cap.id;
	if (cap.render !== "" && Object.hasOwn(render_island, cap.render)) return render_island[cap.render];
	return null;
}
/**
* Decode a request pathname without throwing on malformed percent-encoding (SEC-05).
* @returns decoded path, or null if the encoding is invalid
*/
function decode_pathname(pathname) {
	try {
		return decodeURIComponent(pathname);
	} catch {
		return null;
	}
}
/** Resolve a rate-limit key; fail closed (null) when the adapter cannot identify the client.
* Never trust X-Forwarded-For / spoofable proxy headers — adapters must provide getClientAddress(). */
function client_ip(event) {
	try {
		return event.getClientAddress();
	} catch {
		return null;
	}
}
/**
* Stylesheet `<link>`s a server-picked region needs so a page that never imported the component
* still styles the fetched HTML (the whole point of a held region — the page can't know which
* component the server will choose). Tagged `data-ogygia-region-css` so the client runtime HOISTS
* them into `<head>`: a body `<link>` wouldn't load inside a `<template>` batch parcel, and a head
* link loads once and is deduped across regions. Empty for a plain island (its CSS is already in the
* page's own stylesheet) or before a build (`islandCss` reads the build-time handoff).
*/
function region_css_links(id) {
	const url = island_url[id];
	if (!url) return "";
	let out = "";
	for (const href of islandCss(url)) out += region_css_tag(href, kit_asset(href));
	return out;
}
/**
* Wrap a payload as an `application/ogygia-*` side-channel `<script>` the runtime reads. The
* `payload` MUST be `<`-safe already: devalue output is by construction (it writes `<`), a
* JSON payload goes through `escape_script_text` first — so this only builds the tag. One spot for
* the side-channel shape (page / remote / ctx / devtools).
*/
function emit_ogygia_script(subtype, escaped_payload, marker = "") {
	return `<script type="application/ogygia-${subtype}"${marker ? " " + marker : ""}>${escaped_payload}<\/script>`;
}
/** Stamped into the head of a csr=true document: the runtime reads it (`kit_hydrates_page`)
*  instead of scanning the page's inline scripts for Kit's bootstrap. */
var CSR_META = "<meta name=\"ogygia-csr\" content=\"true\">";
var CSR_FALSE_META = "<meta name=\"ogygia-csr\" content=\"false\">";
/** the og.$ factory script, per manifest object (the build's, the same every request) */
var fnm_script_cache = /* @__PURE__ */ new WeakMap();
/** A document fetched by ogygia's router (runtime/router-nav.ts `nav_headers`: a navigation or a
*  prefetch) — morphed into the live page rather than loaded as one. */
function router_fetched(event) {
	return event.request.headers.get("x-ogygia-spa") !== null;
}
var NO_TRANSPORT = {};
var seed_codec_cache = /* @__PURE__ */ new WeakMap();
/** The seed's devalue reducers — the app's transport encoders merged with the defer markers — and a
*  stringify bound to them, made once per transport object (Kit hands the same one every request). */
function seed_codecs(transport) {
	const key = transport ?? NO_TRANSPORT;
	let hit = seed_codec_cache.get(key);
	if (!hit) {
		const seed_reducers = {
			...Object.fromEntries(Object.entries(transport ?? {}).map(([name, codec]) => [name, codec.encode])),
			...page_seed_reducers
		};
		hit = {
			seed_reducers,
			seed_stringify: ((v) => stringify$1(v, seed_reducers))
		};
		seed_codec_cache.set(key, hit);
	}
	return hit;
}
/** `</body>` as bytes (ASCII: the same in every UTF-8 document). */
var BODY_CLOSE_BYTES = [
	60,
	47,
	98,
	111,
	100,
	121,
	62
];
/** Does `</body>` end in `chunk` — searched backwards from its end, where it sits — or straddle the
*  boundary with the previous chunk's last bytes (`carry`, at most 6)? No decode. */
function has_body_close(carry, chunk) {
	const at_bytes = (buf, i) => {
		for (let k = 0; k < 7; k++) if (buf[i + k] !== BODY_CLOSE_BYTES[k]) return false;
		return true;
	};
	for (let i = chunk.lastIndexOf(60); i !== -1; i = i === 0 ? -1 : chunk.lastIndexOf(60, i - 1)) if (at_bytes(chunk, i)) return true;
	if (!carry.length) return false;
	const seam = new Uint8Array(carry.length + Math.min(6, chunk.length));
	seam.set(carry);
	seam.set(chunk.subarray(0, seam.length - carry.length), carry.length);
	for (let i = 0; i + 7 <= seam.length; i++) if (at_bytes(seam, i)) return true;
	return false;
}
function csr_page_of(html, body_end, event, bag) {
	return event?.route?.id != null ? bag?.page?.error != null ? error_route_is_csr_true(event.route.id) : route_is_csr_true(event.route.id) : body_end !== -1 && html_has_kit_bootstrap(html, body_end);
}
/** The restorer, inline (runtime/restore.ts — self-contained, so its source runs as is): restores the
*  document now, and stays as `__og_restore` / `__og_restore_adopt` for hole answers and router swaps. */
var RESTORER_SCRIPT = `<script data-og-restore>(function(){var r=${restore.toString()};window.__og_restore=r;window.__og_restore_adopt=${restore_adopt.toString()};r(document)})()<\/script>`;
var OgygiaHandle = class {
	#endpoint;
	#speculation_rules;
	/** The app's server transform (documents and region answers) — see OgygiaHandleOptions. */
	#transform;
	render_rate;
	probe_rate;
	constructor(options = {}) {
		this.#transform = options.transform;
		configure_islands_endpoint(options.endpoint);
		this.#endpoint = islands_endpoint$1();
		this.#speculation_rules = "";
		this.render_rate = new RateLimiter({
			max: rateLimit.max,
			windowMs: rateLimit.windowMs
		});
		/** Cheap pre-HMAC probe budget — forged traffic pays this, not full render quota (HMAC-CPU-DOS). */
		this.probe_rate = new RateLimiter({
			max: Math.max(rateLimit.max * 5, 120),
			windowMs: rateLimit.windowMs
		});
	}
	handle = around(plugins, (input) => this.#core(input));
	#core = async ({ event, resolve }) => {
		const path = decode_pathname(event.url.pathname);
		if (path === null) return new Response("Bad Request", { status: 400 });
		const facts = facts_of$1(event.request);
		if (plugins.length === 0) return this.#route(event, resolve, path, NO_CTXS, facts);
		const ctxs = request_contexts(plugins, event, path, facts, (endpoint) => this.#render_hole(endpoint, event));
		try {
			for (let i = 0; i < plugins.length; i++) {
				const answer = await plugins[i].def.request?.(ctxs[i]);
				if (answer) return answer;
			}
			return await this.#route(event, resolve, path, ctxs, facts);
		} finally {
			for (let i = 0; i < plugins.length; i++) try {
				plugins[i].def.done?.(ctxs[i]);
			} catch {}
		}
	};
	/** One signed hole rendered in place with THIS request's event (a plugin's `ctx.renderHole`:
	*  the stored-page stitch). Null keeps the fallback: a refused capability, a failed render, or
	*  an answer that asks to keep it. */
	async #render_hole(endpoint, event) {
		const out = await this.#render_capability(endpoint, event);
		return out && out.html !== "<!--ogygia:keep-fallback-->" ? out.html : null;
	}
	async #route(event, resolve, path, ctxs, facts) {
		if (!path.endsWith(this.#endpoint)) {
			if (event.isDataRequest && event.request.headers.has("x-ogygia-page-facts")) {
				const res = await resolve(event);
				try {
					res.headers.set(PAGE_FACTS_ROUTE_HEADER, encodeURIComponent(JSON.stringify({
						id: event.route.id,
						params: event.params
					})));
				} catch {}
				return res;
			}
			facts.private = DEVTOOLS_LAZY;
			facts.answerForm = !!this.#transform && router_fetched(event);
			const store = try_get_request_store();
			const bag = {
				ctx: /* @__PURE__ */ new Map(),
				page: null,
				seed_wanted: false,
				seed_keys: null,
				seed_asks: null,
				remotes_wanted: /* @__PURE__ */ new Set(),
				tail: new DocumentTail(),
				measure_memo: /* @__PURE__ */ new Map(),
				deferred: null,
				defer_next_id: 0,
				late: null,
				late_next: 0,
				late_open: false,
				seed_reducers: null,
				facts
			};
			bags.set(event.request, bag);
			for (let i = 0; i < ctxs.length; i++) {
				const answer = await plugins[i].def.page?.(ctxs[i]);
				if (answer) return answer;
			}
			const set_headers = event.setHeaders;
			event.setHeaders = (headers) => {
				set_headers(headers);
				for (const key in headers) if (key.toLowerCase() === "cache-control") note_cache_control(event.request, headers[key]);
			};
			const response = await resolve(event, { transformPageChunk: async ({ html }) => this.inject_client_seeds(this.#transform ? await this.#transform_document(html, event, bag) : html, store?.state, event, bag) });
			if (this.#transform && (response.headers.get("content-type") ?? "").includes("text/html")) try {
				response.headers.append("vary", "x-ogygia-spa");
			} catch {}
			if (bag.deferred && bag.deferred.length) facts.streamed = true;
			let out = response;
			for (let i = 0; i < ctxs.length; i++) out = await plugins[i].def.response?.(ctxs[i], out) ?? out;
			if (out !== response) return out;
			if (bag.deferred && bag.deferred.length) return this.stream_page_deferred(response, bag.deferred, bag.defer_next_id, bag.seed_reducers ?? void 0);
			if (!bag.kit_client && !response.headers.has("content-length") && (response.headers.get("content-type") ?? "").includes("text/html")) return drop_dead_kit_resolves(response);
			return response;
		}
		if (event.request.method.toUpperCase() === "POST") return this.render_batch(event);
		return this.render_region(event);
	}
	/**
	* Batch frame stream (client navigation, single-flight). POST body: a JSON `string[]` of signed
	* region endpoints — the calls the client needs. Renders them in parallel and flushes each as a
	* `<template data-ogygia-slot="sig">…</template>` frame the moment IT settles (out of order); a
	* done sentinel ends it. One response, many frames. Every call carries its own MAC so there's no
	* extra auth; same-origin + per-IP budget mirror the single-region path.
	*/
	async render_batch(event) {
		const MAX_BATCH = 32;
		if (event.request.headers.get("sec-fetch-site") === "cross-site") return region_denied("cross-site");
		const ip = client_ip(event);
		if (!ip) return region_response("Too Many Requests", { status: 429 });
		if (this.probe_rate.limited(ip) || this.render_rate.limited(ip)) return region_response("Too Many Requests", { status: 429 });
		const content_length = Number(event.request.headers.get("content-length"));
		if (Number.isFinite(content_length) && content_length > MAX_BATCH_BODY) return region_response("Payload Too Large", { status: 413 });
		let parsed;
		try {
			parsed = await event.request.json();
		} catch {
			return region_response("Bad Request", { status: 400 });
		}
		if (!Array.isArray(parsed) || parsed.length === 0) return region_response("Bad Request", { status: 400 });
		const calls = parsed.filter((e) => typeof e === "string").slice(0, MAX_BATCH);
		const render = (endpoint) => this.#render_capability(endpoint, event, true);
		const encoder = new TextEncoder();
		return region_response(new ReadableStream({ async start(controller) {
			await Promise.all(calls.map(async (endpoint) => {
				const out = await render(endpoint).catch(() => null);
				const parcel = out ? build_parcel(out.slot, out.html) : null;
				if (parcel) controller.enqueue(encoder.encode(parcel));
			}));
			controller.enqueue(encoder.encode(done_parcel()));
			controller.close();
		} }), {
			status: 200,
			headers: {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
				"x-accel-buffering": "no"
			}
		});
	}
	/**
	* THE APP'S TRANSFORM ON A DOCUMENT (server/reversible.ts): the chunk carrying `</head>` (the
	* document; a streamed tail chunk passes untouched) is marked, handed to the transform, settled.
	* Then the head gets the transform's `data-og-head` assets (deduped) and, when the parser would have
	* restructured a tag, the stand-ins' sheet; the body gets the restorer — inline, before `</body>`,
	* so it runs before any island wakes, before Kit starts, and before a deferred module upgrades a
	* host. It also stays on the page as a global for the runtime's hole answers and router swaps.
	*/
	async #transform_document(html, event, bag) {
		if (html.indexOf("</head>") === -1) return html;
		const csr = csr_page_of(html, html.lastIndexOf("</body>"), event, bag);
		const answer = router_fetched(event);
		const marked = mark(html, "document", csr, answer);
		const out = await this.#transform(marked ? marked.html : html, {
			kind: "document",
			csr,
			event
		});
		const s = marked ? settle(out, marked.record, { dev: false }) : null;
		let first_load = false;
		if (marked && !answer) {
			for (const h of marked.record.hosts.values()) if (!h.planned) first_load = true;
		}
		bag.transform_head = (s?.head.join("") ?? "") + (s?.stand_ins ? `<style data-og-stand-ins>${STAND_IN_CSS}</style>` : "") + (first_load ? "<meta name=\"ogygia-first-load\">" : "");
		bag.transform_body = (s?.check ? check_script(s.check) : "") + RESTORER_SCRIPT;
		return s ? s.html : out;
	}
	/** THE APP'S TRANSFORM ON A REGION ANSWER: marked, transformed, settled. The runtime restores it
	*  before insertion (and hoists its `data-og-head` assets), so no stand-in sheet is needed. */
	async #transform_region(html, event) {
		const marked = mark(html, "region", false);
		const out = await this.#transform(marked ? marked.html : html, {
			kind: "region",
			csr: false,
			event
		});
		if (!marked) return out;
		const s = settle(out, marked.record, { dev: false });
		return s.check ? s.html + check_script(s.check) : s.html;
	}
	/**
	* Document-level side-channels: one page snapshot + optional remote query seed.
	* Skips Kit-booted (csr=true) pages which serialize remotes themselves.
	*/
	async inject_client_seeds(html, state, event, bag) {
		performance.now();
		const spans = locate(html);
		const head = spans.head_end === -1 ? null : html.slice(0, spans.head_end);
		const csr_page = csr_page_of(html, spans.body_end, event, bag);
		if (csr_page && bag) bag.kit_client = true;
		if (csr_page) {
			let head_inject = "";
			if (head !== null) head_inject = CSR_META;
			if (head !== null && bag?.transform_head) head_inject = bag.transform_head + head_inject;
			const tail = spans.body_end !== -1 && bag ? (bag.transform_body ?? "") + bag.tail.render(null) : "";
			if (head === null && !tail) return html;
			const ordered = head === null ? null : runtime_first(head, null);
			return assemble(html, spans, ordered === head ? null : ordered, head_inject, tail);
		}
		let head_out = null;
		let head_inject = head !== null ? CSR_FALSE_META : "";
		if (head !== null) {
			const deduped = dedupe_head_links(head);
			if (deduped !== head) head_out = deduped;
			const probe = head_out ?? head;
			if (!page_declares_router_meta(probe)) head_inject += `<meta name="ogygia-router" content="vt">`;
			const ordered = runtime_first(probe, !page_declares_runtime_script(probe) ? runtime_bootstrap(kit_asset) : null);
			if (ordered !== probe) head_out = ordered;
		}
		if (head !== null && bag?.transform_head) head_inject = bag.transform_head + head_inject;
		if (spans.body_end === -1) return assemble(html, spans, head_out, head_inject, "");
		const rendered = !!bag && bag.page !== null;
		const scripts = bag?.transform_body ? [bag.transform_body] : [];
		if (!rendered) {
			this.append_devtools_seed(scripts, bag);
			return assemble(html, spans, head_out, head_inject, scripts.join(""));
		}
		const page_snap = bag.page;
		const seed_wanted = bag.seed_wanted;
		const detail = request_stats_detailed();
		const tail_html = bag.tail.render(seed_wanted ? index_seed(page_snap.data) : null, detail);
		let seed_keys = bag.seed_keys;
		if (seed_wanted && seed_keys !== "all" && seed_keys !== null) for (const k of index_seed(page_snap.data).touched) seed_keys.add(k);
		const shaped_data = shape_page_data(page_snap.data, seed_keys);
		let seed_data = shaped_data;
		let seed_form = page_snap.form;
		const { seed_reducers, seed_stringify } = seed_codecs(state?.transport);
		const data_shape = analyze$1(shaped_data);
		const form_shape = analyze$1(page_snap.form ?? null);
		const has_pending = data_shape.thenable || form_shape.thenable;
		if (has_pending) mark_per_visitor(bag.facts, "streamed load (promise in page data)");
		const can_stream = event?.request.headers.get("sec-fetch-mode") === "navigate";
		if (has_pending && can_stream && seed_wanted) {
			const staged_data = stage_deferred(shaped_data, 0);
			const staged_form = stage_deferred(page_snap.form, staged_data.next_id);
			seed_data = staged_data.staged;
			seed_form = staged_form.staged;
			bag.deferred = [...staged_data.deferred, ...staged_form.deferred];
			bag.defer_next_id = staged_form.next_id;
			bag.seed_reducers = seed_reducers;
			scripts.push(`<script>${PAGE_DEFER_BOOTSTRAP}<\/script>`);
		} else if (has_pending && seed_wanted) {
			seed_data = await settle_deferred(shaped_data);
			seed_form = await settle_deferred(page_snap.form);
		}
		if (tail_html) scripts.push(tail_html);
		const page_payload = event && seed_wanted ? PageSeed.serialize({
			url: event.url,
			params: event.params,
			route: event.route,
			status: page_snap.status ?? 200,
			data: seed_data,
			form: seed_form,
			error: page_snap.error
		}, seed_stringify, !has_pending && data_shape.json && form_shape.json && analyze$1(page_snap.error ?? null).json) : null;
		if (page_payload) scripts.push(emit_ogygia_script("page", page_payload.text, "data-ogygia-page" + (page_payload.json ? ` ${WIRE_FORMAT_ATTR}="${WIRE_FORMAT_JSON}"` : "")));
		if (state?.remote?.implicit) {
			const remote_script = await this.build_remote_seed_script(state, bag.remotes_wanted);
			if (remote_script) {
				scripts.push(remote_script);
				remote_script.length;
			}
		}
		const fnm = fnManifest();
		if (fnm) {
			let fnm_script = fnm_script_cache.get(fnm);
			if (fnm_script === void 0) {
				fnm_script = `<script data-ogygia-fnm>globalThis.__OG_FNM=Object.assign(globalThis.__OG_FNM||{},{${Object.entries(fnm).map(([tag, src]) => `${JSON.stringify(tag)}:(${src})`).join(",")}});<\/script>`;
				fnm_script_cache.set(fnm, fnm_script);
			}
			scripts.push(fnm_script);
			fnm_script.length;
		}
		const provided = bag?.ctx;
		if (provided?.size) {
			const payload = serialize_provided_context(provided);
			if (payload) {
				scripts.push(emit_ogygia_script("ctx", payload, PAGE_CTX_MARKER));
				payload.length;
			}
		}
		this.append_devtools_seed(scripts, bag);
		const out = assemble(html, spans, head_out, head_inject, scripts.join(""));
		return out;
	}
	/**
	* THE SEED EXPLAINER: per top-level `page.data` key, its size and why it ships — an island's
	* client code reads it (the build's per-entry keys), a sidecar points into it (seed refs), or
	* some island reads the page whole and everything ships. Profiler detail only.
	*/
	explain_seed(data, seed_keys, bag) {
		const rows = bag.tail.island_rows() ?? [];
		const names = /* @__PURE__ */ new Map();
		for (const row of rows) if (row.name && !names.has(row.entry)) names.set(row.entry, row.name);
		const name_of = (entry) => names.get(entry) ?? entry;
		const add = (m, k, v) => (m.get(k) ?? m.set(k, /* @__PURE__ */ new Set()).get(k)).add(v);
		const whole = /* @__PURE__ */ new Set();
		const readers = /* @__PURE__ */ new Map();
		for (const [entry, ask] of bag.seed_asks ?? []) if (ask === "all") whole.add(name_of(entry));
		else if (ask !== false) for (const k of ask) add(readers, k, name_of(entry));
		const referenced = /* @__PURE__ */ new Map();
		for (const row of rows) for (const k of row.ref_keys) add(referenced, k, name_of(row.entry));
		const whole_by = [...whole];
		const keys = [];
		if (data && typeof data === "object" && !Array.isArray(data)) for (const key of Object.keys(data)) {
			const shipped = seed_keys === "all" || seed_keys !== null && seed_keys.has(key);
			const read = [...readers.get(key) ?? []];
			const refd = [...referenced.get(key) ?? []];
			keys.push({
				key,
				bytes: analyze$1(data[key]).bytes,
				readers: read,
				referenced_by: refd,
				shipped,
				reason: !shipped ? null : read.length ? "read" : refd.length ? "referenced" : whole_by.length ? "whole" : "read"
			});
		}
		keys.sort((a, b) => b.bytes - a.bytes);
		return {
			keys,
			whole_by
		};
	}
	/** DEVTOOLS: drain this request's server-realm events (region renders, capability mints, seeds)
	*  into an `application/ogygia-devtools` side-channel the client bus ingests — one stream, both
	*  realms, correlated by fingerprint. Appended LAST so the seed.injected events are included. */
	append_devtools_seed(scripts, bag) {}
	/**
	* Stream the captured `$page.data` promises into islands (csr=false, real browser load). The
	* document — carrying the pending seed + resolve-global bootstrap — is already built by `resolve`;
	* here we (1) forward it, (2) DRAIN Kit's own dead csr=false resolve tail so its
	* `__sveltekit_<hash> is not defined` never reaches the browser, and (3) emit one
	* `<script>__ogygia_page_resolve(id, ok, value)<\/script>` per promise AS IT SETTLES — completion
	* order, non-blocking. Each island's `{#await page.data.x}` flips pending → resolved live.
	*/
	stream_page_deferred(response, deferred, initial_next_id, reducers) {
		const source = response.body;
		if (!source) return response;
		const reader = source.getReader();
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				let carry = /* @__PURE__ */ new Uint8Array(0);
				try {
					for (;;) {
						const { value, done } = await reader.read();
						if (done) break;
						controller.enqueue(value);
						if (has_body_close(carry, value)) break;
						carry = value.length >= 6 ? value.subarray(value.length - 6) : value;
					}
				} catch {}
				(async () => {
					try {
						for (;;) {
							const { done } = await reader.read();
							if (done) break;
						}
					} catch {}
				})();
				let pending = deferred.length;
				let next_id = initial_next_id;
				let closed = false;
				const maybe_close = () => {
					if (pending === 0 && !closed) {
						closed = true;
						try {
							controller.close();
						} catch {}
					}
				};
				const push = (id, ok, value) => {
					try {
						controller.enqueue(encoder.encode(resolve_script(PAGE_DEFER_GLOBAL, id, {
							ok,
							value
						}, reducers)));
					} catch {}
				};
				const stream_one = (id, promise) => {
					Promise.resolve(promise).then((value) => {
						const { staged, deferred: nested, next_id: after } = stage_deferred(value, next_id);
						next_id = after;
						push(id, true, staged);
						pending += nested.length;
						for (const n of nested) stream_one(n.id, n.promise);
						pending -= 1;
						maybe_close();
					}, (error) => {
						push(id, false, error);
						pending -= 1;
						maybe_close();
					});
				};
				for (const { id, promise } of deferred) stream_one(id, promise);
				maybe_close();
			},
			cancel() {
				reader.cancel().catch(() => {});
			}
		});
		const headers = new Headers(response.headers);
		headers.delete("content-length");
		return new Response(stream, {
			status: response.status,
			statusText: response.statusText,
			headers
		});
	}
	/**
	* True when a remote's resolved value (deep) contains a region carrying baked SSR HTML — a
	* page-sized render, not seed data (see the skip in {@link build_remote_seed_script}). Depth-capped:
	* a region ticket sits shallow in any sane payload (a DocView's `entry.body` is 2 levels deep).
	*/
	has_baked_region(value, depth = 0) {
		if (depth > 6 || value === null || typeof value !== "object") return false;
		const r = value;
		if (r[REGION_BRAND] === true && typeof r.html === "string") return true;
		if (Array.isArray(value)) return value.some((x) => this.has_baked_region(x, depth + 1));
		for (const k in r) if (this.has_baked_region(r[k], depth + 1)) return true;
		return false;
	}
	async build_remote_seed_script(state, wanted = null) {
		const implicit = state.remote?.implicit;
		if (!implicit) return null;
		const data = await collect_remote_seed(implicit, wanted, {
			memo: (internals) => state.remote.data?.get(internals),
			skip_value: (v) => this.has_baked_region(v),
			key: create_remote_key
		});
		if (!Object.values(data).some((b) => Object.keys(b).length > 0)) return null;
		const transport = state.transport || {};
		const reducers = Object.fromEntries(Object.entries(transport).map(([name, codec]) => [name, codec.encode]));
		return emit_ogygia_script("remote", stringify$1(data, reducers));
	}
	/**
	* `render()` the island under the concurrency gate + timeout. Returns the HTML body, or `null`
	* if the render threw or timed out. Shared by the endpoint ({@link render_region}) and the
	* batch path ({@link #render_capability}).
	*/
	async #render_component(load, props, cache, report, timing, base, reads_page_data = false) {
		const render_body = async () => {
			const mod = await load();
			const rendered = render(mod.default, {
				props,
				context: kit_render_context$1()
			});
			return await Promise.race([Promise.resolve(rendered).then((out) => {
				const body = out.body;
				if (body === "<!--ogygia:keep-fallback-->") return body;
				return hole_head(out.head, base) + body + kit_page_facts_tail();
			}), new Promise((_, rej) => setTimeout(() => rej(/* @__PURE__ */ new Error("region render timeout")), RENDER_TIMEOUT_MS))]);
		};
		try {
			return await cached_render(async () => {
				await kit_page_ready(reads_page_data);
				if (!timing) return render_gate.run(render_body);
				const asked = performance.now();
				return render_gate.run(async () => {
					const entered = performance.now();
					timing.queue_ms = entered - asked;
					try {
						return await render_body();
					} finally {
						timing.render_ms = performance.now() - entered;
					}
				});
			}, cache, Date.now(), report);
		} catch (e) {
			if (is_keep_fallback(e)) return KEEP_FALLBACK_HTML;
			return null;
		}
	}
	/** A cached hole's memo key: the call and the visitor's session, and — when its tree reads
	*  `page.data` — the page it renders for (one page's facts never answer another page's hole). */
	#hole_cache_key(id, payload, event, reads_page_data) {
		const session = this.#region_session(event);
		return render_cache_key(id, payload, reads_page_data ? session + "\n" + page_url_of(event).href : session);
	}
	/** The session cookie value sealed into a region capability (empty when no `sessionCookie` is
	*  configured) — the same read the MAC verify uses, and the per-user part of the render-cache key. */
	#region_session(event) {
		return "";
	}
	/**
	* Every check a capability passes BEFORE any HMAC (P5-HMAC-CPU), in order: charset/length (ids
	* are 12-hex from the transform; `ttl` is signed, but charset-gated here so a forged value never
	* reaches a response header), expiry (a renewal instead needs one inside the renew window: a URL
	* that has not expired never renews), and the signing key it names. Null when it passes, else why
	* it is refused.
	*/
	#capability_precheck(cap, renewal = false) {
		if (!is_region_id(cap.id) || cap.render !== "" && !is_region_id(cap.render) || cap.payload.length > 8192 || !is_region_ttl(cap.ttl)) return "shape";
		const now = Math.floor(Date.now() / 1e3);
		if (renewal) {
			if (!renewable_expiry(cap.exp, now, 691200)) return "renew-window";
		} else {
			const exp = Number(cap.exp);
			if (!Number.isFinite(exp) || exp < now) return "expired";
		}
		if (foreign_key(cap.k)) return "foreign-key";
		return null;
	}
	/**
	* RENEWAL (server/shared-cache.ts): re-sign an EXPIRED capability this app minted for an
	* anonymous hole — the rescue for a hole on a document a cache kept longer than the hole's
	* capability. Refused (null) unless the visitor carries no session and the MAC over the ORIGINAL
	* tuple verifies with an empty session: nothing session-bound is ever renewed, and only a URL the
	* app itself put in public HTML can be. The caller has already gated shape + the renew window
	* and charged the probe budget. Returns the fresh `exp` + `sig`.
	*/
	#renew_capability(cap, event) {
		if (this.#region_session(event) !== "") return null;
		const { secret } = signing_key();
		if (!verify(secret, region_mac_message(cap.id, cap.exp, cap.payload, "", cap.ttl, cap.render), cap.sig)) return null;
		const exp = String(capability_expiry$1(Math.floor(Date.now() / 1e3), regionTtl));
		return {
			...cap,
			exp,
			sig: sign(secret, region_mac_message(cap.id, exp, cap.payload, "", cap.ttl, cap.render)),
			k: signing_key().fp
		};
	}
	/** THE auth check: session-bound region MAC verify (its render identity inside, when it has one). */
	#verify_region_mac(cap, event) {
		return verify(signing_key().secret, region_mac_message(cap.id, cap.exp, cap.payload, "", cap.ttl, cap.render), cap.sig);
	}
	/** Eval the island module (registers transportable codecs the reviver needs on a cold-start defer),
	*  then decode + revive the props payload. Null on parse failure or a non-object/array result. */
	async #decode_region_props(payload, load) {
		let props;
		try {
			await load();
			register_wire_kind$1();
			register_store_kind$1();
			register_snippet_kind$1();
			register_fn_kind$1();
			register_derived_kind$1();
			props = parse(B64Url.decode(payload), { [REF_WIRE_KEY$1]: ref_reviver(false) });
		} catch (e) {
			return null;
		}
		if (props === null || typeof props !== "object" || Array.isArray(props)) return null;
		return props;
	}
	/**
	* Batch (single-flight navigation): verify a hole's OWN signed capability URL and render it in-process. Same
	* trust boundary as the endpoint (verify the MAC before touching the manifest), but every failure —
	* bad/expired MAC, unknown id, non-serializable props, render error, oversize — resolves to
	* `null` so the hole silently falls back to a client fetch. Never throws.
	*/
	async #render_capability(endpoint, event, batch = false) {
		const q = endpoint.indexOf("?");
		if (q === -1) return null;
		const cap = capability_of(new URLSearchParams(endpoint.slice(q + 1)));
		const { id, payload, sig } = cap;
		if (this.#capability_precheck(cap)) return null;
		if (!this.#verify_region_mac(cap, event)) return null;
		const target = capability_target(cap);
		if (target === null) return null;
		const load = (await load_islands()).islands[target];
		if (typeof load !== "function") return null;
		const props = await this.#decode_region_props(payload, load);
		if (!props) return null;
		const ttl = Number(cap.ttl) || 0;
		const reads_page_data = hole_reads_page_data(target);
		const cache = ttl > 0 ? {
			key: this.#hole_cache_key(target, payload, event, reads_page_data),
			ttl
		} : void 0;
		const body = await this.#render_component(load, props, cache, void 0, void 0, event.url, reads_page_data);
		if (body === null || body.length > MAX_REGION_BODY) return null;
		if (body === "<!--ogygia:keep-fallback-->") return {
			slot: sig,
			html: KEEP_FALLBACK_HTML
		};
		let html = absolutize_hole_html(region_css_links(target) + body, event.url);
		if (batch && this.#transform) html = await this.#transform_region(html, event);
		return {
			slot: sig,
			html
		};
	}
	/**
	* Verify the region MAC, then render. Unknown ids and bad MACs both return 403 so the
	* existence of a region id is not an oracle (SEC-01). Expiry is part of the MAC message.
	*
	* Ordering: length/exp → probe rate (pre-HMAC) → verify → render rate → render.
	* Probe stops forged CPU amplification; render budget is only charged after a valid MAC.
	* A renewal (`&renew=1`) swaps the first three for its own: shape + renew window → probe →
	* anonymous-only re-verify of the original tuple + re-sign; then the same render rate + render.
	*/
	async render_region(event) {
		const method = event.request.method.toUpperCase();
		if (method !== "GET" && method !== "HEAD") return region_response("Method Not Allowed", {
			status: 405,
			headers: { allow: "GET, HEAD" }
		});
		if (event.request.headers.get("sec-fetch-site") === "cross-site") return region_denied("cross-site");
		const url = event.url;
		const ip = client_ip(event);
		if (!ip) return region_response("Too Many Requests", { status: 429 });
		let cap = capability_of(url.searchParams);
		const { id, payload } = cap;
		const ttl_raw = cap.ttl;
		let renewed = null;
		const renewal = url.searchParams.get("renew") === "1";
		const refused = this.#capability_precheck(cap, renewal);
		if (refused) return region_denied(refused);
		if (this.probe_rate.limited(ip)) return region_response("Too Many Requests", { status: 429 });
		if (renewal) {
			const fresh = this.#renew_capability(cap, event);
			if (!fresh) return region_denied(this.#region_session(event) !== "" ? "renew-session" : "sig");
			cap = fresh;
			renewed = `${url.pathname}?id=${encodeURIComponent(id)}${cap.render ? `&r=${cap.render}` : ""}&props=${payload}&exp=${cap.exp}${ttl_raw ? `&ttl=${ttl_raw}` : ""}&sig=${cap.sig}&k=${cap.k}`;
		} else if (!this.#verify_region_mac(cap, event)) return region_denied("sig");
		const cache_control = ttl_raw && !renewed ? `private, max-age=${Number(ttl_raw)}` : "no-store";
		/** The fresh capability rides every successful answer to a renewal (the 204 too). */
		const renew_headers = renewed ? { "x-ogygia-capability": renewed } : {};
		if (this.render_rate.limited(ip)) return region_response("Too Many Requests", { status: 429 });
		const target = capability_target(cap);
		if (target === null) return region_denied("unknown-id");
		const load = (await load_islands()).islands[target];
		if (typeof load !== "function") return region_denied("unknown-id");
		const props = await this.#decode_region_props(payload, load);
		if (!props) return region_denied("props");
		const ttl = Number(ttl_raw) || 0;
		const reads_page_data = hole_reads_page_data(target);
		const cache = ttl > 0 ? {
			key: this.#hole_cache_key(target, payload, event, reads_page_data),
			ttl
		} : void 0;
		const timing = {};
		let outcome = "none";
		const body = await this.#render_component(load, props, cache, (o) => outcome = o, timing, event.url, reads_page_data);
		record_hole_stats(event.request, {
			kind: "hole",
			id,
			cache: outcome,
			ttl,
			...timing.queue_ms !== void 0 ? { queue_ms: Math.round(timing.queue_ms * 10) / 10 } : {},
			...island_name?.[target] ? { name: island_name[target] } : {},
			p: hole_copy_key(payload)
		});
		const server_timing = timing.queue_ms !== void 0 && event.cookies.get("og_profiler_beacon") === "1" ? { "server-timing": `og-queue;dur=${timing.queue_ms.toFixed(1)}, og-render;dur=${(timing.render_ms ?? 0).toFixed(1)}` } : {};
		if (body === null) return region_response("Region render failed", { status: 500 });
		if (body === "<!--ogygia:keep-fallback-->") return region_response(null, {
			status: 204,
			headers: renewed ? {
				"cache-control": "no-store",
				...renew_headers
			} : void 0
		});
		if (body.length > MAX_REGION_BODY) return region_denied("oversize");
		let html = absolutize_hole_html(region_css_links(target) + body, event.url);
		if (this.#transform) html = await this.#transform_region(html, event);
		if (method === "HEAD") return region_response(null, {
			status: 200,
			headers: {
				"content-type": "text/html; charset=utf-8",
				"content-length": String(new TextEncoder().encode(html).byteLength),
				"cache-control": cache_control,
				...renew_headers
			}
		});
		return region_response(html, {
			status: 200,
			headers: {
				"content-type": "text/html; charset=utf-8",
				"cache-control": cache_control,
				...renew_headers,
				...server_timing
			}
		});
	}
};
function handle$1(options = {}) {
	const instance = new OgygiaHandle(options);
	return (args) => instance.handle(args);
}
// ../../../core/src/plugin/css.ts
/**
* `ogygia/plugin/css` — the CSS of components a programmatic router renders (see the server-router-css
* notes + compiler/link/router-css.ts). Such a page's component is a VALUE, not a Kit route, so nothing
* file-derived links its scoped `<style>` / plain `.css` imports. The build registers every component a
* page module (`b.pageModules()`) can reach in a runtime registry (`virtual:ogygia/router-css`); this
* turns the components ONE render places into the `<link>` / `<style>` head tags `document()` hoists,
* deduped against the request's held-region links.
*
* Its own subpath: the generated registry is a virtual module, so it stays out of `ogygia/plugin` (every
* plugin's server realm) — and it is imported on the first call, never at module load.
*/
var STYLE_CLOSE_G = /<\/style/gi;
var rcss_ready;
function registry_ready() {
	if (rcss_ready === void 0) try {
		rcss_ready = import('../chunks/router-css.js-BmGTjIWW.js').catch(() => null);
	} catch {
		rcss_ready = null;
	}
	return rcss_ready;
}
/** Head tags for the components ONE render places (a layout chain + its page or error component):
*  each component's whole-tree CSS, linked once per request. */
async function componentCssHead(components) {
	const ready = registry_ready();
	ready && await ready;
	const entries = components.flatMap((c) => router_css_of(c));
	if (!entries.length) return "";
	const keys = entries.map((e) => e.key);
	let fresh = new Set(claim_region_css(keys));
	if (fresh.size === 0 && keys.length) try {
		if (claim_region_css(["\0og-rcss-probe"]).length === 0) fresh = new Set(keys);
	} catch {
		fresh = new Set(keys);
	}
	let head = "";
	for (const e of entries) {
		if (!fresh.has(e.key)) continue;
		fresh.delete(e.key);
		if (e.href) head += `<link rel="stylesheet" href="${e.href}" data-ogygia-region-css>`;
		else if (e.css) head += `<style data-ogygia-rcss>${e.css.replace(STYLE_CLOSE_G, "<\\/style")}</style>`;
	}
	return head;
}
// virtual:ogygia/island/7f1c68f7462f.svelte
function _f1c68f7462f($$renderer, $$props) {
	let { Fallback, data } = $$props;
	if (Fallback) {
		$$renderer.push("<!--[-->");
		Fallback($$renderer, { data });
		$$renderer.push("<!--]-->");
	} else {
		$$renderer.push("<!--[!-->");
		$$renderer.push("<!--]-->");
	}
}
// ../../../router/src/LayoutChain.svelte
function LayoutChain($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* Renders a route's layout chain around its page. `chain` is the layout components from OUTERMOST to
		* innermost (app shell → section shell → …); each is an inert component that renders `{@render
		* children()}` and may read `data` (the cascaded load data at that level). At the bottom the PAGE
		* COMPONENT is rendered AS MARKUP (`<Page {...props} />`), not as a held region — so any import-
		* attribute mark on it (`with { wake }`, `with { render: 'deferred' }`, `with { region: 'raw' }`,
		* `with { keep }`) emits its shell exactly as it would at any other usage site. That is what makes
		* page-level interactivity/deferral work: the router is a normal placement site for the component.
		*
		* `fallback` (a deferred page's loading placeholder) is provided as the component's reserved
		* `ogygiaFallback` snippet — the router is the deferred page's use site, so it supplies the slot a
		* deferred component would otherwise get from its `{#snippet ogygiaFallback()}` child.
		*
		* Server-rendered inside document(); the layouts and the page are real regions, so islands inside
		* them wake and their CSS rides the response.
		*/
		let { chain, component: Page, props, data, fallback: Fallback } = $$props;
		function nest($$renderer, i) {
			if (i < chain.length) {
				$$renderer.push("<!--[0-->");
				const Layout = chain[i];
				if (Layout) {
					$$renderer.push("<!--[-->");
					Layout($$renderer, {
						data,
						children: ($$renderer) => {
							nest($$renderer, i + 1);
						},
						$$slots: { default: true }
					});
					$$renderer.push("<!--]-->");
				} else {
					$$renderer.push("<!--[!-->");
					$$renderer.push("<!--]-->");
				}
			} else if (Fallback) {
				$$renderer.push("<!--[1-->");
				if (Page) {
					$$renderer.push("<!--[-->");
					Page($$renderer, spread_props([{ ogygiaFallback: og_portable(__og_native_ogygiaFallback_0, _f1c68f7462f, {
						Fallback,
						data
					}, "/_app/immutable/og-region.7f1c68f7462f.js") }, props]));
					$$renderer.push("<!--]-->");
				} else {
					$$renderer.push("<!--[!-->");
					$$renderer.push("<!--]-->");
				}
			} else {
				$$renderer.push("<!--[-1-->");
				if (Page) {
					$$renderer.push("<!--[-->");
					Page($$renderer, spread_props([props]));
					$$renderer.push("<!--]-->");
				} else {
					$$renderer.push("<!--[!-->");
					$$renderer.push("<!--]-->");
				}
			}
			$$renderer.push(`<!--]-->`);
		}
		function __og_native_ogygiaFallback_0($$renderer) {
			if (Fallback) {
				$$renderer.push("<!--[-->");
				Fallback($$renderer, { data });
				$$renderer.push("<!--]-->");
			} else {
				$$renderer.push("<!--[!-->");
				$$renderer.push("<!--]-->");
			}
		}
		nest($$renderer, 0);
	});
}
// ../../../router/src/RawHtml.svelte
function RawHtml($$renderer, $$props) {
	/**
	* The page component behind an html view (a resolver that answered `{ __oghtml, html }`, a mounted
	* document): the html is finished, this just drops it in. Static: ships as HTML, no client JS.
	*/
	let { html: html$1 } = $$props;
	$$renderer.push(`${html(html$1)}`);
}
// ../../../router/src/match.ts
var REGEX_SPECIAL_G = /[.*+?^${}()|[\]\\]/g;
var escape_re = (s) => s.replace(REGEX_SPECIAL_G, "\\$&");
var REST = /^\[\.\.\.([a-zA-Z_$][\w$]*)\]$/;
var OPTIONAL = /^\[\[([a-zA-Z_$][\w$]*)\]\]$/;
/** strips valid `[param]` groups so any leftover bracket flags a malformed segment */
var STRIP_PARAMS = /\[[a-zA-Z_$][\w$]*\]/g;
/**
* Compile a pattern into a regex + its param specs + a specificity score. Throws on an obviously
* malformed pattern (a rest segment that isn't last) — a loud build-time-ish error beats a route
* that silently never matches.
*/
var INNER_PARAM = /\[([a-zA-Z_$][\w$]*)\]/g;
function compile(pattern) {
	if (!pattern.startsWith("/")) throw new Error(`[@ogygia/router] route pattern must start with "/": ${JSON.stringify(pattern)}`);
	const segs = pattern.split("/").filter((s) => s !== "");
	const params = [];
	const digits = [];
	let rx = "";
	segs.forEach((seg, i) => {
		let m;
		if (m = seg.match(REST)) {
			if (i !== segs.length - 1) throw new Error(`[@ogygia/router] a [...rest] segment must be last: ${JSON.stringify(pattern)}`);
			params.push({
				name: m[1],
				rest: true
			});
			rx += "(?:/(.*))?";
			digits.push(0);
		} else if (m = seg.match(OPTIONAL)) {
			params.push({
				name: m[1],
				optional: true
			});
			rx += "(?:/([^/]+))?";
			digits.push(1);
		} else {
			let inner = "/";
			let has_static = false;
			let has_param = false;
			let last = 0;
			INNER_PARAM.lastIndex = 0;
			let g;
			while (g = INNER_PARAM.exec(seg)) {
				const pre = seg.slice(last, g.index);
				if (pre) {
					inner += escape_re(pre);
					has_static = true;
				}
				inner += "([^/]+)";
				params.push({ name: g[1] });
				has_param = true;
				last = INNER_PARAM.lastIndex;
			}
			const tail = seg.slice(last);
			if (tail) {
				inner += escape_re(tail);
				has_static = true;
			}
			const leftover = seg.replace(STRIP_PARAMS, "");
			if (leftover.includes("[") || leftover.includes("]") || !has_static && !has_param) throw new Error(`[@ogygia/router] malformed segment ${JSON.stringify(seg)} in ${pattern}`);
			rx += inner;
			digits.push(!has_param ? 4 : has_static ? 3 : 2);
		}
	});
	if (rx === "") rx = "/?";
	const regex = new RegExp("^" + rx + "/?$");
	const trailing_rest = params.length > 0 && params[params.length - 1].rest === true;
	const eff = trailing_rest ? digits.slice(0, -1) : digits;
	let score = 0;
	for (const d of eff) score = score * 5 + d;
	score = score * 64 + eff.length;
	if (trailing_rest) score -= 1;
	return {
		pattern,
		regex,
		params,
		score
	};
}
/** Compile a whole table's keys and sort most-specific-first, so the first match wins. */
function compile_all(patterns) {
	return patterns.map(compile).sort((a, b) => b.score - a.score);
}
/** Match one compiled pattern against a pathname. Returns params, or null if it doesn't match. */
function match_one(c, pathname) {
	const m = c.regex.exec(pathname);
	if (!m) return null;
	const params = {};
	c.params.forEach((spec, i) => {
		const raw = m[i + 1];
		if (spec.rest) params[spec.name] = raw == null ? "" : safe_decode(raw);
		else if (spec.optional) params[spec.name] = raw == null ? void 0 : safe_decode(raw);
		else params[spec.name] = safe_decode(raw);
	});
	return {
		pattern: c.pattern,
		params
	};
}
/** Fill a pattern's `[param]` / `[...rest]` tokens from a params record (URL-encoded). Shared by
*  `href()` (router) and the typed `api()` client — one token grammar, one filler. */
var fill_token = /\[(\.\.\.)?\[?([a-zA-Z_$][\w$]*)\]?\]/g;
function fill(pattern, params) {
	return pattern.replace(fill_token, (_m, _rest, name) => {
		const val = params[name];
		return val == null ? "" : encodeURIComponent(String(val));
	});
}
/** First (most-specific) match in a pre-sorted list, or null. */
function match_path(sorted, pathname) {
	for (const c of sorted) {
		const hit = match_one(c, pathname);
		if (hit) return hit;
	}
	return null;
}
function safe_decode(s) {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}
// ../../../router/src/respond.ts
/**
* Router v2 control-flow values: the throwable `redirect()` / `error()` (Kit's exact idiom — thrown
* from loads, actions, and handlers) and the returnable `fail()` (Kit's action-validation shape),
* plus the small Response helpers the dispatcher shares. See internal/notes/router-v2.md.
*/
var REDIRECT = Symbol.for("ogygia.router.redirect");
var HTTP_ERROR = Symbol.for("ogygia.router.error");
var ACTION_FAILURE = Symbol.for("ogygia.router.fail");
/** Throw an HTTP error from a load / action / handler — Kit's `error(404, 'Not found')`, verbatim.
*  On a page branch the nearest error boundary renders it; on an endpoint it becomes JSON. */
function error(status, message) {
	throw {
		[HTTP_ERROR]: true,
		status,
		message: message
	};
}
var is_redirect = (x) => typeof x === "object" && x !== null && REDIRECT in x;
var is_http_error = (x) => typeof x === "object" && x !== null && HTTP_ERROR in x;
var is_action_failure = (x) => typeof x === "object" && x !== null && ACTION_FAILURE in x;
function json_response(data, init) {
	return new Response(JSON.stringify(data), {
		...init,
		headers: {
			"content-type": "application/json",
			"cache-control": "no-store",
			...init?.headers
		}
	});
}
function redirect_response(status, location) {
	return new Response(null, {
		status,
		headers: {
			location,
			"cache-control": "no-store"
		}
	});
}
/** An endpoint/miss return → a Response: Response passes through; null/undefined → 204; else JSON. */
function finalize(out) {
	if (out instanceof Response) return out;
	if (out == null) return new Response(null, { status: 204 });
	return json_response(out);
}
function not_found() {
	return new Response("Not found", { status: 404 });
}
function method_not_allowed(allow) {
	return new Response("Method not allowed", {
		status: 405,
		headers: { allow: allow.join(", ") }
	});
}
function options_response(allow) {
	return new Response(null, {
		status: 204,
		headers: { allow: allow.join(", ") }
	});
}
// ../../../router/src/ctx.ts
/** Signature-bound claims attached by the federation handle after verification (fragment federation). */
var CLAIMS = Symbol.for("ogygia.claims.v1");
function make_ctx(params, url, request, event, href, routeId, visitor_resolver) {
	const search = {};
	for (const [k, v] of url.searchParams) if (!(k in search)) search[k] = v;
	const collected_headers = /* @__PURE__ */ new Map();
	let visitor_memo;
	let visitor_resolved = false;
	const ctx = {
		collected_headers,
		get visitor() {
			if (!visitor_resolved) {
				visitor_resolved = true;
				visitor_memo = request[CLAIMS] ?? visitor_resolver?.(ctx);
			}
			return visitor_memo;
		},
		params,
		search,
		input: void 0,
		url,
		request,
		route: { id: routeId },
		fetch: event?.fetch ?? fetch,
		cookies: event?.cookies,
		locals: event?.locals,
		setHeaders: (headers) => {
			for (const [k, v] of Object.entries(headers)) collected_headers.set(k.toLowerCase(), v);
			event?.setHeaders?.(headers);
		},
		platform: event?.platform,
		getClientAddress: event?.getClientAddress,
		event,
		json: (data, init) => json_response(data, init),
		redirect: (location, status = 303) => redirect_response(status, location),
		text: (body, init) => new Response(body, {
			...init,
			headers: {
				"content-type": "text/plain; charset=utf-8",
				...init?.headers
			}
		}),
		href,
		state: {}
	};
	return ctx;
}
// ../../../router/src/define.ts
function memo_of(c) {
	const holder = c;
	return holder.__ogloads ??= /* @__PURE__ */ new Map();
}
function load(a, b) {
	const pattern = typeof a === "string" ? a : void 0;
	const run = typeof a === "string" ? b : a;
	const fn = ((c) => {
		const memo = memo_of(c);
		let p = memo.get(fn);
		if (!p) {
			p = Promise.resolve(run(c));
			memo.set(fn, p);
		}
		return p;
	});
	fn.__ogload = true;
	fn.pattern = pattern;
	fn.run = run;
	return fn;
}
function action(a, b) {
	const pattern = typeof a === "string" ? a : void 0;
	const run = typeof a === "string" ? b : a;
	const fn = ((c) => run(c));
	fn.__ogaction = true;
	fn.pattern = pattern;
	return fn;
}
/** Normalize a bare function to a memoized LoadDef; a `load()` wrapper passes through. */
function to_load(input) {
	if (!input) return void 0;
	if (input.__ogload) return input;
	return load(input);
}
/** Normalize a bare function to an ActionDef; an `action()` wrapper passes through. */
function to_action(input) {
	if (input.__ogaction) return input;
	return action(input);
}
/** `page(Component)` / `page(Component, { params?, search?, load?, actions? })`. The second arg mirrors
*  +page.server.ts; `params`/`search` are input schemas (typed into `c` + `$infer`), `load`/`actions`
*  are behaviors (wrappers or bare typed functions — see {@link Load} / {@link Action}). The
*  component slot also takes a `flag.pick()`, a {@link PageSlotResolver}, or a streamed-page
*  generator ({@link StreamSlot}). */
function page(component, server) {
	const actions = server?.actions ? Object.fromEntries(Object.entries(server.actions).map(([k, v]) => [k, to_action(v)])) : void 0;
	return {
		__ogkind: "page",
		component,
		load: to_load(server?.load),
		actions,
		params_schema: server?.params,
		search_schema: server?.search,
		entries: server?.entries,
		freeze: server?.freeze,
		layouts: []
	};
}
/** `layout(name, Component, { load?, error?, freeze? })` — a named table→table wrapper. Applying it PREPENDS
*  this layout to every entry's chain and returns a table with the SAME KEYS, so `...admin({...})`
*  spreads the tagged entries into the parent (a wrapped table nested in another accumulates the
*  chain — Kit's nested layouts). `load` may be a `load()` wrapper or a bare typed fn. The name keys
*  the layout's `{ data, children }` type as `App['(name)']`; duplicate names are a build error. */
function layout(name, component, opts) {
	const def = {
		__ogkind: "layout",
		name,
		component,
		load: to_load(opts?.load),
		error: opts?.error,
		freeze: opts?.freeze
	};
	const fn = ((table) => {
		const out = {};
		for (const key in table) {
			const entry = table[key];
			out[key] = is_page(entry) ? {
				...entry,
				layouts: [def, ...entry.layouts]
			} : entry;
		}
		return out;
	});
	fn.__oglayout = def;
	return fn;
}
var VERBS = [
	"GET",
	"DELETE",
	"HEAD",
	"OPTIONS",
	"POST",
	"PUT",
	"PATCH"
];
var is_page = (d) => d.__ogkind === "page";
/** Compile an `{ GET, POST, … }` endpoint object into the dispatcher's method map — a bare handler,
*  or a `GET(...)`/`POST(...)` wrapper (unwrapped to its handler + optional body schema). */
function compile_endpoint(ep) {
	const methods = /* @__PURE__ */ new Map();
	for (const verb of VERBS) {
		const v = ep[verb];
		if (v == null) continue;
		if (v.__ogverb) {
			const e = v;
			methods.set(verb, {
				handler: e.handler,
				bodySchema: e.bodySchema
			});
		} else methods.set(verb, { handler: v });
	}
	return {
		__ogkind: "endpoint",
		methods
	};
}
/** Bake ANY yielded value to html: a string passes through, an inline region carries its html,
*  a component/held region AWAITS into its bake (island shells + prefixed CSS links included —
*  the same path federated widgets take). */
async function bake_yield(v) {
	if (typeof v === "string") return v;
	if (v && typeof v === "object") {
		const o = v;
		if (typeof o.then === "function") return bake_yield(await v);
		const html = o.html ?? o.props?.html;
		if (html != null) return String(html);
		if (o.kind != null) throw new Error("[@ogygia/router] a yielded region did not bake — mark its import (`with { region: 'raw' }` or a wake) so the component has an identity + client leg.");
	}
	throw new Error("[@ogygia/router] a streamed page must yield regions (region(C, props) / og_html_region(html)) or html strings.");
}
/** Is this page slot an async-generator function? (Svelte components are plain functions —
*  never async generators — so this discriminator needs no brand.) */
function is_stream_slot(v) {
	return Object.prototype.toString.call(v) === "[object AsyncGeneratorFunction]";
}
var HEAD_CLOSE_RE = /<\/head>/i;
var NO_TRANSFORM_RE = /no-transform/i;
/** Adapt a page GENERATOR's remaining yields into page-slot chunks (bake included). */
async function* page_slot_chunks(rest) {
	for (;;) {
		const n = await rest.next();
		if (n.done) return;
		yield {
			slot: "pg",
			html: await bake_yield(n.value)
		};
	}
}
function stream_document(full_html, res, rest, error_slot = "pg") {
	const with_boot = full_html.replace(HEAD_CLOSE_RE, LATE_BOOT_SCRIPT + "</head>");
	const cut = with_boot.lastIndexOf("</body>");
	const head_part = cut === -1 ? with_boot : with_boot.slice(0, cut);
	const tail_part = cut === -1 ? "" : with_boot.slice(cut);
	const enc = new TextEncoder();
	const body = new ReadableStream({ async start(controller) {
		controller.enqueue(enc.encode(head_part));
		try {
			for (;;) {
				const n = await rest.next();
				if (n.done) break;
				controller.enqueue(enc.encode(late_chunk(n.value.slot, n.value.html)));
			}
		} catch (e) {
			controller.enqueue(enc.encode(late_chunk(error_slot, error_card_html(e))));
		}
		controller.enqueue(enc.encode(tail_part));
		controller.close();
	} });
	const headers = new Headers(res.headers);
	headers.delete("content-length");
	const cc = headers.get("cache-control");
	if (!cc) headers.set("cache-control", "no-transform");
	else if (!NO_TRANSFORM_RE.test(cc)) headers.set("cache-control", `${cc}, no-transform`);
	return new Response(body, {
		status: res.status,
		headers
	});
}
/** The in-slot failure card (message escaped) — a stream must never end broken or empty. */
function error_card_html(e) {
	const msg = e instanceof Error ? e.message : String(e);
	return `<div data-og-late-error style="border:1px dashed #dc2626;border-radius:8px;padding:1rem;color:#dc2626">This section failed to load. ${escape_text(msg)}</div>`;
}
/** Drain registered LATE REGIONS (`<Region of={promise}>` holes) in COMPLETION order — the slot
*  that resolves first streams first. A rejection becomes that slot's error card; the others are
*  unaffected (per-slot isolation, the same law as mounts). */
async function* late_region_chunks(list) {
	const pending = new Map(list.map(({ id, promise }) => [id, promise.then(async (v) => ({
		id,
		html: await bake_yield(v)
	}), (e) => ({
		id,
		html: error_card_html(e)
	}))]));
	while (pending.size) {
		const { id, html } = await Promise.race(pending.values());
		pending.delete(id);
		yield {
			slot: id,
			html
		};
	}
}
/** Interleave chunk sources by READINESS (a page generator + the late-region pool run together;
*  whichever has a chunk ready streams next). Ends when every source ends. */
async function* merge_chunks(...sources) {
	const nexts = new Map(sources.map((s, i) => [i, s.next().then((r) => ({
		i,
		r
	}))]));
	while (nexts.size) {
		const { i, r } = await Promise.race(nexts.values());
		if (r.done) nexts.delete(i);
		else {
			nexts.set(i, sources[i].next().then((res) => ({
				i,
				r: res
			})));
			yield r.value;
		}
	}
}
// ../../../router/src/router.ts
var HEAD_AS_GET = (m) => m === "HEAD" ? "GET" : m;
var LAST_SLASH_RE = /\/$/;
function routes(typed, opts = {}) {
	const table = typed;
	const base = (opts.base ?? "").replace(LAST_SLASH_RE, "");
	const slash = opts.slash ?? "ignore";
	const root_load = to_load(opts.load);
	const seen_layout = /* @__PURE__ */ new Map();
	for (const key in table) {
		const def = table[key];
		if (is_page(def)) for (const l of def.layouts) {
			const prev = seen_layout.get(l.name);
			if (prev && prev !== l.component) throw new Error(`[@ogygia/router] two different layouts share the name ${JSON.stringify(l.name)} — names must be unique (they key App['(name)']).`);
			seen_layout.set(l.name, l.component);
		}
	}
	const leaves = Object.keys(table).map((pattern) => {
		const raw = table[pattern];
		const gate = raw.__ogwhen;
		return {
			pattern,
			def: is_page(raw) ? raw : compile_endpoint(raw),
			...gate ? { when: gate } : {}
		};
	});
	const compiled = compile_all(leaves.map((l) => l.pattern));
	const by_pattern = new Map(leaves.map((l) => [l.pattern, l]));
	const option_of = (leaf, option) => {
		if (option !== "freeze" || !is_page(leaf.def)) return null;
		if (leaf.def.freeze !== void 0) return leaf.def.freeze;
		for (let i = leaf.def.layouts.length - 1; i >= 0; i--) {
			const f = leaf.def.layouts[i].freeze;
			if (f !== void 0) return f;
		}
		return opts.freeze ?? null;
	};
	register_route_options(base + "|" + leaves.map((l) => l.pattern).join(","), (pathname, option) => {
		let path = pathname;
		if (base) {
			if (path === base) path = "/";
			else if (path.startsWith(base + "/")) path = path.slice(base.length);
			else return void 0;
		}
		path = canonical_slash(path, slash) ?? path;
		const hit = match_path(compiled, path);
		return hit ? option_of(by_pattern.get(hit.pattern), option) : void 0;
	});
	const href_fn = (pattern, params) => base + fill(pattern, params ?? {});
	async function dispatch(request, event) {
		const url = new URL(request.url);
		let path = url.pathname;
		if (base) {
			if (path === base) path = "/";
			else if (path.startsWith(base + "/")) path = path.slice(base.length);
			else return null;
		}
		const canon = canonical_slash(path, slash);
		if (canon) return new Response(null, {
			status: 308,
			headers: { location: base + canon + url.search }
		});
		const hit = match_path(compiled, path);
		const unmatched = async () => {
			if (base && opts.miss) {
				const ctx = make_ctx({}, url, request, event, href_fn, "", opts.visitor);
				try {
					return finalize(await opts.miss(ctx));
				} catch (thrown) {
					if (is_redirect(thrown)) return redirect_response(thrown.status, thrown.location);
					if (is_http_error(thrown)) return json_response({
						error: thrown.message,
						status: thrown.status
					}, { status: thrown.status });
					throw thrown;
				}
			}
			if (base && opts.error && (request.method === "GET" || request.method === "HEAD")) {
				if ((request.headers.get("accept") ?? "").includes("text/html")) {
					const ctx = make_ctx({}, url, request, event, href_fn, "", opts.visitor);
					return document$1(region(LayoutChain, {
						chain: [],
						component: opts.error,
						props: {
							status: 404,
							error: { message: "Not found" },
							data: {},
							params: {}
						},
						data: {}
					}), {
						status: 404,
						head: await componentCssHead([opts.error]),
						pageState: {
							url: ctx.url,
							params: {},
							route: { id: null },
							status: 404,
							data: {},
							error: { message: "Not found" }
						}
					});
				}
			}
			if (base) return not_found();
			return null;
		};
		if (!hit) return unmatched();
		const leaf = by_pattern.get(hit.pattern);
		const ctx = make_ctx(hit.params, url, request, event, href_fn, hit.pattern, opts.visitor);
		if (opts.flags) for (const f of opts.flags) f(ctx);
		if (leaf.when && !leaf.when(ctx)) return unmatched();
		const with_collected = (res) => {
			if (ctx.collected_headers?.size) {
				for (const [k, v] of ctx.collected_headers) if (!res.headers.has(k)) res.headers.set(k, v);
			}
			return res;
		};
		try {
			if (root_load) {
				const rl = await root_load(ctx);
				if (rl instanceof Response) return with_collected(rl);
			}
			if (leaf.def.__ogkind === "endpoint") return with_collected(await run_endpoint(leaf.def, ctx, request.method));
			return with_collected(await render_page(leaf.def, ctx, request.method, url));
		} catch (thrown) {
			return with_collected(await handle_thrown(thrown, leaf.def, ctx));
		}
	}
	async function render_page(node, ctx, method, url) {
		const m = HEAD_AS_GET(method);
		if (node.params_schema) {
			const v = await validate(node.params_schema, ctx.params);
			if (v.issues) return not_found();
			ctx.params = v.value;
		}
		if (node.search_schema) {
			const v = await validate(node.search_schema, ctx.search);
			if (v.issues) return json_response({
				error: "Invalid query",
				issues: v.issues
			}, { status: 400 });
			ctx.search = v.value;
		}
		let form;
		let status = 200;
		if (m === "POST") {
			const act = pick_action(node, url);
			if (!act) return method_not_allowed(page_allow(node));
			const out = await act(ctx);
			if (out instanceof Response) return out;
			if (is_action_failure(out)) {
				form = out.data;
				status = out.status;
			} else form = out ?? void 0;
		} else if (m !== "GET") {
			if (method === "OPTIONS") return options_response(page_allow(node));
			return method_not_allowed(page_allow(node));
		}
		const load_defs = [
			root_load,
			...node.layouts.map((l) => l.load),
			node.load
		];
		const results = await Promise.all(load_defs.map((l) => l ? l(ctx) : void 0));
		const data = {};
		for (const r of results) {
			if (r instanceof Response) return r;
			if (r && typeof r === "object") Object.assign(data, r);
		}
		const chain = node.layouts.map((l) => l.component);
		let gen_rest = null;
		let gen_first_html = null;
		if (is_stream_slot(node.component)) {
			const it = node.component(ctx, data);
			const first = await it.next();
			if (first.done) error(500, "a streamed page must yield at least one region");
			if (m === "GET" && method !== "HEAD") {
				gen_first_html = await bake_yield(first.value);
				gen_rest = it;
			} else {
				let last = first.value;
				for (;;) {
					const n = await it.next();
					if (n.done) break;
					last = n.value;
				}
				gen_first_html = await bake_yield(last);
			}
		}
		const resolved = gen_first_html !== null ? {
			__oghtml: true,
			html: late_slot("pg", gen_first_html)
		} : typeof node.component === "object" && node.component !== null && "__ogpick" in node.component ? node.component.__ogpick(ctx, data) : node.component;
		const html_view = typeof resolved === "object" && resolved !== null && "__oghtml" in resolved ? resolved : null;
		const page_component = html_view ? RawHtml : resolved;
		if (html_view?.status && html_view.status >= 400) status = html_view.status;
		const of = region(LayoutChain, {
			chain,
			component: page_component,
			props: html_view ? { html: html_view.html } : {
				data,
				form,
				params: ctx.params
			},
			data,
			fallback: node.fallback
		});
		const css_head = await componentCssHead(html_view ? chain : [...chain, page_component]) + (html_view ? (html_view.title ? `<title>${escape_text(html_view.title)}</title>` : "") + (html_view.css?.join("") ?? "") + (html_view.head ?? "") : "");
		if (m === "GET") open_late_scope();
		const res = await document$1(of, {
			status,
			head: css_head,
			pageState: {
				url: ctx.url,
				params: ctx.params,
				route: { id: ctx.route.id || null },
				status,
				data,
				form
			}
		});
		if (method === "HEAD") return new Response(null, res);
		const late = take_late_regions();
		const chunk_src = gen_rest && late?.length ? merge_chunks(page_slot_chunks(gen_rest), late_region_chunks(late)) : gen_rest ? page_slot_chunks(gen_rest) : late?.length ? late_region_chunks(late) : null;
		if (chunk_src && m === "GET") return stream_document(await res.text(), res, chunk_src);
		return res;
	}
	async function handle_thrown(thrown, def, ctx) {
		if (is_redirect(thrown)) return redirect_response(thrown.status, thrown.location);
		if (is_action_failure(thrown)) return json_response(thrown.data, { status: thrown.status });
		if (!is_http_error(thrown)) throw thrown;
		const { status, message } = thrown;
		if (def.__ogkind === "endpoint") return json_response({
			error: message,
			status
		}, { status });
		const pnode = def;
		const load_defs = [
			root_load,
			...pnode.layouts.map((l) => l.load),
			pnode.load
		];
		const settled = await Promise.allSettled(load_defs.map(async (l) => l ? await l(ctx) : void 0));
		let failing = settled.length;
		for (let i = 0; i < settled.length; i++) if (settled[i].status === "rejected") {
			failing = i;
			break;
		}
		const renderable = failing === 0 ? 0 : Math.min(failing - 1, pnode.layouts.length);
		const data = {};
		for (const s of settled) if (s.status === "fulfilled" && s.value && typeof s.value === "object" && !(s.value instanceof Response)) Object.assign(data, s.value);
		let boundary = -1;
		for (let i = renderable - 1; i >= 0; i--) if (pnode.layouts[i].error) {
			boundary = i;
			break;
		}
		const err_component = boundary >= 0 ? pnode.layouts[boundary].error : opts.error;
		if (!err_component) return json_response({
			error: message,
			status
		}, { status });
		const chrome = (boundary >= 0 ? pnode.layouts.slice(0, boundary + 1) : []).map((l) => l.component);
		return document$1(region(LayoutChain, {
			chain: chrome,
			component: err_component,
			props: {
				status,
				error: { message },
				data,
				params: ctx.params
			},
			data
		}), {
			status,
			head: await componentCssHead([...chrome, err_component]),
			pageState: {
				url: ctx.url,
				params: ctx.params,
				route: { id: ctx.route.id || null },
				status,
				data,
				error: { message }
			}
		});
	}
	return {
		__ogrouter: true,
		fetch: dispatch,
		handle: async ({ event, resolve }) => {
			return await dispatch(event.request, event) ?? resolve(event);
		},
		href: ((pattern, params) => href_fn(pattern, params)),
		async entries() {
			const out = [];
			for (const leaf of leaves) {
				if (!is_page(leaf.def)) continue;
				if (!leaf.pattern.includes("[")) {
					out.push({ path: base + leaf.pattern });
					continue;
				}
				const list = leaf.def.entries ? await leaf.def.entries() : null;
				if (list) for (const params of list) out.push({ path: base + fill(leaf.pattern, params) });
			}
			return out;
		},
		get $infer() {
			throw new Error("router.$infer is a type-only phantom — read `typeof app.$infer`.");
		}
	};
}
async function run_endpoint(node, ctx, method) {
	const m = HEAD_AS_GET(method);
	const allow = [...node.methods.keys()];
	if (method === "OPTIONS" && !node.methods.has("OPTIONS")) return options_response(allow);
	const e = node.methods.get(m);
	if (!e) return method_not_allowed(allow);
	if (e.bodySchema) {
		let body = void 0;
		if ((ctx.request.headers.get("content-type") ?? "").includes("application/json")) try {
			body = await ctx.request.clone().json();
		} catch {
			return json_response({ error: "Invalid JSON body" }, { status: 400 });
		}
		const v = await validate(e.bodySchema, body);
		if (v.issues) return json_response({
			error: "Invalid body",
			issues: v.issues
		}, { status: 400 });
		ctx.input = v.value;
	}
	return finalize(await e.handler(ctx));
}
/** Run a Standard Schema; issues normalized to `{ message, path }[]`. */
async function validate(schema, input) {
	const r = await schema["~standard"].validate(input);
	if (r.issues) return { issues: r.issues.map((i) => ({
		message: i.message,
		path: i.path
	})) };
	return { value: r.value };
}
var TRAILING_SLASH = /\/+$/;
function canonical_slash(path, mode) {
	if (mode === "ignore" || path === "/") return null;
	const has = path.endsWith("/");
	if (mode === "never" && has) return path.replace(TRAILING_SLASH, "") || "/";
	if (mode === "always" && !has) return path + "/";
	return null;
}
function pick_action(node, url) {
	const actions = node.actions;
	if (!actions) return void 0;
	for (const key of url.searchParams.keys()) if (key.startsWith("/")) {
		const named = actions[key.slice(1)];
		if (named) return named;
	}
	return actions.default;
}
function page_allow(node) {
	const a = ["GET", "HEAD"];
	if (node.actions && Object.keys(node.actions).length) a.push("POST");
	return a;
}
// src/hooks.server.ts
var edge = [];
if (private_env.EDGE_AKAMAI_URL) edge.push(akamai({
	host: "akab-emulated.purge.akamaiapis.net",
	clientToken: "emu-client-token",
	clientSecret: "emu-client-secret",
	accessToken: "emu-access-token",
	site: private_env.EDGE_SITE_URL || "http://127.0.0.1:3073",
	baseUrl: private_env.EDGE_AKAMAI_URL
}));
if (private_env.EDGE_CF_URL) edge.push(cloudfront({
	distributionId: "EMULATED123",
	accessKeyId: "AKIAEMULATED",
	secretAccessKey: "emulated-secret",
	baseUrl: private_env.EDGE_CF_URL
}));
if (edge.length) freeze.configure({ edge });
var app = routes({
	...layout("r", Shell, { freeze: true })({
		"/r/frozen": page(Frozen),
		"/r/off": page(Off, { freeze: false })
	}),
	"/r/plain": page(Plain)
});
var handle = sequence(handle$1(), app.handle);

export { handle };
//# sourceMappingURL=hooks.server.js-CTk5DOTg.js.map
