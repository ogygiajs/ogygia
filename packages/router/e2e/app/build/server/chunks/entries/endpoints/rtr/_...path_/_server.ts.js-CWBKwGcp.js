import { b as base } from '../../../../chunks/internal.js-NlsCutcl.js';
import '../../../../chunks/routing.js-BCO6GjuO.js';
import '../../../../chunks/internal2.js-Cq2bWI41.js';
import { y as try_get_request_store } from '../../../../chunks/utils.js-BpLbUY9P.js';
import { m as render, $ as html, Z as spread_props } from '../../../../chunks/server.js-B9P4ExQ-.js';
import { h as stringify$1 } from '../../../../chunks/shared.js-B7aDE0fO.js';
import { a as region, R as Region, m as makeRegionEndpoint, r as render_region_html } from '../../../../chunks/render-region-html.js-DsVhRg6l.js';
import { k as register_route_options, e as page_declares_router_meta, p as page_declares_runtime_script, s as shape_page_data, c as PageSeed, f as page_seed_reducers, r as runtime_first } from '../../../../chunks/page-stream.js-B3RTH9ol.js';
import { a$ as escape_text, b0 as open_late_scope, b1 as take_late_regions, b2 as open_ask_scope, A as kit_render_context, r as runtime_bootstrap, b3 as read_seed_ask, d as analyze, W as WIRE_FORMAT_ATTR, g as WIRE_FORMAT_JSON, P as current_facts, aI as claim_region_css, as as record_page, a_ as og_portable } from '../../../../chunks/late-region-registry.js-DXI715J1.js';
import { r as router_css_of, P as PkgPage, S as Shell, I as Inner, a as StreamRegion, D as Deep, R as Reader, H as Home } from '../../../../chunks/Reader.js-D_7hE2Ka.js';
import '../../../../chunks/async.js-FhULVWAw.js';
import { _ as _5dd73d433864_default$1 } from '../../../../chunks/5dd73d4338642.js-gofFBvbq.js';
import { B as Board } from '../../../../chunks/Board.js-CtV7bU6l.js';
import { S as StreamPayload } from '../../../../chunks/StreamPayload.js-DbfRvHXx.js';
import '../../../../chunks/uneval.js-CHOeF-6t.js';
import '../../../../chunks/index-server2.js-uORi_mEb.js';
import '../../../../chunks/rolldown-runtime.js-CTrrmpyn.js';
import '../../../../chunks/paths.js-DHXamknv.js';
import '../../../../chunks/live-transport.js-BhmTVvjO.js';
import '../../../../chunks/state.js-DXGb76jd.js';
import '../../../../chunks/exports.js-C-11U8cd.js';
import 'node:crypto';
import 'node:fs';
import 'node:path';
import 'node:url';
import '../../../../chunks/416c9c898227.js-BJSsvlt3.js';

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
async function document(of, options = {}) {
	open_ask_scope();
	const r = await render(Region, {
		props: { of: await of },
		context: kit_render_context(kit_page_context(options))
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
		}, (v) => stringify$1(v, page_seed_reducers), analyze(data).json && analyze(s.form ?? null).json && analyze(s.error ?? null).json);
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
		rcss_ready = import('../../../../chunks/router-css.js-DAE9RkrF.js').catch(() => null);
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
// virtual:ogygia/island/e8c252d056e2.svelte
function E8c252d056e2($$renderer, $$props) {
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
// ../../src/LayoutChain.svelte
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
					Page($$renderer, spread_props([{ ogygiaFallback: og_portable(__og_native_ogygiaFallback_0, E8c252d056e2, {
						Fallback,
						data
					}, "/_app/immutable/og-region.e8c252d056e2.js") }, props]));
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
// ../../src/RawHtml.svelte
function RawHtml($$renderer, $$props) {
	/**
	* The page component behind an html view (a resolver that answered `{ __oghtml, html }`, a mounted
	* document): the html is finished, this just drops it in. Static: ships as HTML, no client JS.
	*/
	let { html: html$1 } = $$props;
	$$renderer.push(`${html(html$1)}`);
}
// ../../src/match.ts
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
// ../../src/respond.ts
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
// ../../src/ctx.ts
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
// ../../src/define.ts
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
// ../../src/router.ts
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
					return document(region(LayoutChain, {
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
		const res = await document(of, {
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
		return document(region(LayoutChain, {
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
// virtual:ogygia/wrapper/5dd73d433864.svelte
function _dd73d433864($$renderer, $$props) {
	let { children, $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "island",
		load: true,
		__entry: "/_app/immutable/og-region.5dd73d433864.js",
		__component: _5dd73d433864_default$1,
		__css: Board,
		__props,
		children
	});
}
// virtual:ogygia/region/5dd73d433864.js
Object.assign(_dd73d433864, {
	__ogRegion: "5dd73d433864",
	__module: "/_app/immutable/og-region.5dd73d433864.js",
	__hydrate: "load",
	__component: Board,
	__sign: makeRegionEndpoint,
	__renderHtml: (props) => render_region_html(Board, "/_app/immutable/og-region.5dd73d433864.js", props)
});
var _5dd73d433864_default = _dd73d433864;
// ../island-pkg/src/routes.ts
/**
* THE SCENARIO: distributed routes — a package ships a TABLE FRAGMENT the consumer spreads
* into its own `routes()`. This is a `.ts` in node_modules with a marked import: without the
* package's `ogygia.files` declaration the compiler would skip this file and the mark would be
* silently inert (the exact silent death the declaration mechanism exists to prevent).
*/
var pkg_table = {
	"/pkg": page(PkgPage, { load: () => ({ title: "from repro-island-pkg" }) }),
	"/pkg/board": page(_5dd73d433864_default, { load: () => ({ title: "live board" }) })
};
// virtual:ogygia/region/0db6cba07fe7.js
var _0db6cba07fe7_default = {
	__ogRegion: "0db6cba07fe7",
	__module: "/_app/immutable/og-region.0db6cba07fe7.js",
	__component: StreamPayload,
	__sign: makeRegionEndpoint,
	__renderHtml: (props) => render_region_html(StreamPayload, "/_app/immutable/og-region.0db6cba07fe7.js", props)
};
// src/routes/rtr/[...path]/+server.ts
var shell = layout("shell", Shell, { load: () => ({ who: "ada" }) });
var inner = layout("inner", Inner, { load: () => ({ nav: "sidebar-42" }) });
var app = routes(shell({
	"/": page(Home),
	"/reader": page(Reader, { load: () => ({ big: "x".repeat(2e5) }) }),
	...inner({ "/deep": page(Deep) }),
	"/stream": page(async function* () {
		yield "<div data-stream-skeleton>loading the slow part…</div>";
		await new Promise((r) => setTimeout(r, 150));
		yield region(_0db6cba07fe7_default, { data: { title: "streamed in" } });
	}),
	"/stream-region": page(StreamRegion, { load: () => ({ pending: (async () => {
		await new Promise((r) => setTimeout(r, 150));
		return region(_0db6cba07fe7_default, { data: { title: "late region" } });
	})() }) }),
	...pkg_table,
	"/api/ping": { GET: (c) => c.json({ pong: true }) }
}), { base: `${base}/rtr` });
var GET = async (event) => await app.fetch(event.request, event) ?? new Response("Not found", { status: 404 });

export { GET };
//# sourceMappingURL=_server.ts.js-CWBKwGcp.js.map
