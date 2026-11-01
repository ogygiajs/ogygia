import { h as stringify$1 } from './shared.js-B7aDE0fO.js';
import { i as is_word, e as escape_script_text } from './late-region-registry.js-DXI715J1.js';

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
		if (is_word(s.charCodeAt(i - 1)) || s.charCodeAt(i + n) !== 61) continue;
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
		if (is_word(head.charCodeAt(lt + 5))) {
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

export { PAGE_DEFER_BOOTSTRAP as P, stage_deferred as a, settle_deferred as b, PageSeed as c, dedupe_head_links as d, page_declares_router_meta as e, page_seed_reducers as f, resolve_script as g, PAGE_DEFER_GLOBAL as h, route_option as i, set_page_route_options as j, register_route_options as k, merge_seed_ask as m, page_declares_runtime_script as p, runtime_first as r, shape_page_data as s };
//# sourceMappingURL=page-stream.js-B3RTH9ol.js.map
