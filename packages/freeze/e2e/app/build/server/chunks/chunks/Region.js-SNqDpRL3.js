import './async.js-BHxnfxQk.js';
import { V as writable, W as get, r as render, X as derived$1, z as getAllContexts, y as getContext, v as setContext, u as run, Y as head, Z as spread_props, _ as attr, $ as html, N as derived, a0 as save } from './server.js-BBF-BCcH.js';
import { c as createRawSnippet, u as unmount, h as hydrate, m as mount } from './internal2.js-2Pg1NhOR.js';
import { h as stringify$1 } from './shared.js-iXTe6R8-.js';
import { i as islandDeps, e as entryLocation, a as islandCssInline, b as islandReadsPage, c as islandPageKeys, d as islandRemotes, f as islandInteractivity, g as islandCss, h as contentCss } from './island-deps.js-DRCEB_nS.js';
import './exports.js-C-11U8cd.js';
import { f as fnv1a$1, a as fnv1a32, b as fingerprint_of, h as hole_copy_of } from './hash.js-C-SlWFdQ.js';
import { d as building } from './internal.js-NlsCutcl.js';
import { a as asset, r as resolve$1 } from './paths.js-DM9UWvpx.js';
import './remote.js-CcSc56f7.js';
import { A as getRequestEvent } from './utils.js-Ca9I6N5J.js';
import { p as page } from './state2.js-CxjaPru1.js';
import { createHmac, timingSafeEqual, hkdfSync, createHash } from 'node:crypto';

// ../../../core/src/escape.ts
/**
* The ONE canonical side-channel escape. A devalue/JSON payload emitted inside a `<script>` must not
* be able to break out of it — escaping `<` neutralizes `<\/script>`, `<script`, and `<!--`. Every seed
* / marker serializer (page seed, remote seed, context markers, streamed resolve scripts) routes its
* payload through here, so the escape lives in exactly one auditable place.
*/
function escape_script_text(s) {
	return s.replaceAll("<", "\\u003C");
}
/**
* An attribute value for a double-quoted attribute: `&`, `"`, `<` escaped. One pass; a value with
* none of them (nearly every href) comes back as itself, no copy.
*/
function escape_attr(s) {
	if (s.indexOf("&") === -1 && s.indexOf("\"") === -1 && s.indexOf("<") === -1) return s;
	return s.replace(AMP_G, "&amp;").replace(QUOT_G, "&quot;").replace(LT_G, "&lt;");
}
/** `&` only (a URL into an attribute: its query's separators). No copy without one. */
function escape_amp(s) {
	return s.indexOf("&") === -1 ? s : s.replaceAll("&", "&amp;");
}
/** `&` and `"` only (a value re-emitted into a double-quoted attribute exactly as it was, `<` kept). */
function escape_amp_quot(s) {
	if (s.indexOf("&") === -1 && s.indexOf("\"") === -1) return s;
	return s.replace(AMP_G, "&amp;").replace(QUOT_G, "&quot;");
}
/** Text content: `&`, `<`, `>` escaped. Text with none of them comes back as itself, no copy. */
function escape_text(s) {
	if (s.indexOf("&") === -1 && s.indexOf("<") === -1 && s.indexOf(">") === -1) return s;
	return s.replace(AMP_G, "&amp;").replace(LT_G, "&lt;").replace(GT_G, "&gt;");
}
var AMP_G = /&/g;
var QUOT_G = /"/g;
var LT_G = /</g;
var GT_G = />/g;
// ../../../core/src/server/kit-context.ts
/**
* Kit's request context for ogygia's OWN server render roots.
*
* Kit's server `$app/state` answers `page.*` from `getContext('__request__').page` — a Svelte
* context Kit's page render sets on ITS root. Every `svelte/server` `render()` ogygia starts is a
* fresh root with no such context: the routeless document (`document()`), the inline island render
* (`region.ts`), the deferred-region endpoint, snippet bodies. A component reading `page.data`
* during SSR under any of them crashed with "reading 'page' of undefined". Every such root now
* passes `kit_render_context()`, which rebuilds Kit's shape from the per-request page snapshot
* (Region.svelte records it; the handle keeps it in the request bag) or, absent that, from the
* live request via the reader hooks.ts installs.
*
* Isomorphic and dependency-free by design: `region.ts` is in the client graph, so nothing here may
* import Kit's server internals. The reader rides ONE `globalThis` + `Symbol.for` slot — the
* PAGE-STATE-SINGLETON law (dist entries can double-evaluate a module).
*/
var KIT_REQUEST_CONTEXT$1 = "__request__";
/** Kit's `$app/stores` server side reads `getContext('__svelte__')` — `{ page, navigating, updated }`
*  stores Kit's page render sets on ITS root (`render.js`). Same gap as `__request__`: a component
*  using the (deprecated, still everywhere) `$page` store crashed under every ogygia render root. */
var KIT_STORES_CONTEXT$1 = "__svelte__";
var SLOT$1 = Symbol.for("ogygia.kit-context");
var slots$1 = globalThis[SLOT$1] ??= {
	reader: null,
	event_reader: null
};
/** hooks.ts installs the request-scoped reader (page snapshot + live event). */
function set_kit_page_reader(fn) {
	slots$1.reader = fn;
}
/** hooks.ts installs the live `RequestEvent` reader — what `requestEvent()` (public, isomorphic)
*  hands a server island: `locals`, `cookies`, `url`, `request` of the request rendering it. */
function set_kit_event_reader(fn) {
	slots$1.event_reader = fn;
}
/** hooks.ts installs the render-page port: in a request rendering for a page it is not (a hole, a
*  remote call), that page is looked up once (server/page-facts.ts) so the reader answers from it,
*  and an answer carries the facts its islands read. */
function set_render_page_port(port) {
	slots$1.render_page = port;
}
/**
* Await before an async render root starts: the page this render belongs to, ready for the reader.
* Inside a page request, on the client, or for a render that reads no `page.data`: nothing to wait for
* (`undefined`, no microtask).
*/
function kit_page_ready(reads_data = null) {
	return slots$1.render_page?.ready(reads_data);
}
/** Append to a render root's HTML: the page facts its islands read, when it rendered for a page. */
function kit_page_facts_tail() {
	return slots$1.render_page?.tail() ?? "";
}
/** Append to a minted hole endpoint: its page version (server/render-page.ts), or `''`. */
function kit_page_version(hole_id) {
	return slots$1.render_page?.version(hole_id) ?? "";
}
/** The live event the installed reader answers (null off-request / on the client). */
function kit_request_event() {
	return slots$1.event_reader?.() ?? null;
}
/** A page no component can crash on: what a render outside any request sees (tests, tools). */
function empty_kit_page$1() {
	return {
		url: void 0,
		params: {},
		route: { id: null },
		status: 200,
		data: {},
		form: null,
		error: null,
		state: {}
	};
}
/** A frozen server-side store: the value is known for the whole render, nothing ever changes it
*  (Kit's own page render uses `writable`s it never writes after start). Hand-rolled so this
*  module stays dependency-free for the client graph. */
function frozen_store$1(value) {
	return { subscribe(fn) {
		fn(value);
		return () => {};
	} };
}
/** Kit's `__svelte__` context shape: what `getStores()` in `$app/stores` destructures. */
function kit_stores_context$1(page) {
	return {
		page: frozen_store$1(page),
		navigating: frozen_store$1(null),
		updated: {
			...frozen_store$1(false),
			check: async () => false
		}
	};
}
/** The `context` option for a `svelte/server` `render()` ogygia starts. An explicit `page` (the
*  document root, built from the router's seed) wins; else the request reader; else empty. Both
*  of Kit's contexts ride along: `__request__` for `$app/state`, `__svelte__` for `$app/stores`.
*  The `__request__` entry also carries the live `event` (Kit's own render sets `{ page }` only)
*  — the channel `requestEvent()` reads, so a server island can see its request without importing
*  `$app/server` (which Kit's client guard rejects the moment a csr=true page shares the layout). */
function kit_render_context$1(page, event) {
	const resolved = page ?? slots$1.reader?.() ?? empty_kit_page$1();
	const live = slots$1.event_reader?.() ?? null;
	return /* @__PURE__ */ new Map([[KIT_REQUEST_CONTEXT$1, {
		page: resolved,
		event: live
	}], [KIT_STORES_CONTEXT$1, kit_stores_context$1(resolved)]]);
}
// \0virtual:ogygia/runtime-url
var runtime_url_default = "/_app/immutable/og-runtime.381f90123eb5-f03d70b1.js";
// ../../../core/src/holes-record.ts
/**
* The holes record's script type — ONE constant shared by the server (document-tail.ts writes the
* record) and the runtime (hole-facts.ts reads it), kept import-free so the runtime bundle never
* reaches into server code for a string.
*/
var HOLES_SCRIPT_TYPE = "application/ogygia-holes";
// ../../../core/src/island-graph.ts
/**
* THE ISLAND GRAPH — which chunks each island's code needs, as DATA the page carries, never as
* `<link rel="modulepreload">` tags.
*
* An island entry's own `import()` finds its chunks only after it downloads and parses: a waterfall.
* A modulepreload per chunk removes the waterfall, but a hint in the HTML fetches the moment the
* parser meets it — before the page has painted, and for islands that may never wake. So the server
* writes the graph as data (this format), and the runtime inserts the preload links itself when an
* island WAKES (runtime/island-graph-preload.ts): after the wake gate, for exactly that island, beside
* its `import()`. Its whole graph downloads in parallel the moment it may start; nothing lands in
* the paint window; an island that never wakes downloads nothing.
*
* Wire shape (one inert JSON script): `{"h":[href,…],"e":{"<entry>":[i,…]},"s":{"<entry>":src}}` —
* every chunk href once, each entry (the region's `entry` attribute, as emitted: its IDENTITY)
* listing the indexes of the chunks it needs. Twenty islands sharing Svelte's client runtime name
* its chunk once. `s` (optional): the LOCATION of an entry no element on the page carries — a
* portable snippet's live entry, imported by its identity — so the runtime loads the content-hashed
* file (runtime/region-endpoint-url.ts `note_entry_location`); an element carries its own (`src`).
*
* Universal leaf: the server encodes (server/document-tail.ts), the boot decodes.
*/
/** The attribute that marks a graph script (the runtime finds every one on the page by it). */
var ISLAND_GRAPH_ATTR = "data-ogygia-graph";
/** Encode entry → chunk hrefs (and identity → location, when any) as the wire shape (JSON text,
*  not yet script-escaped). */
function encode_island_graph(graph, locations) {
	const h = [];
	const index = /* @__PURE__ */ new Map();
	const e = {};
	for (const [entry, hrefs] of graph) {
		const ids = [];
		for (const href of hrefs) {
			let i = index.get(href);
			if (i === void 0) {
				i = h.length;
				h.push(href);
				index.set(href, i);
			}
			ids.push(i);
		}
		e[entry] = ids;
	}
	if (!locations?.size) return JSON.stringify({
		h,
		e
	});
	return JSON.stringify({
		h,
		e,
		s: Object.fromEntries(locations)
	});
}
/** Decode a graph script's `s`: entry identity → location, as written (unresolved). */
function decode_island_locations(text) {
	const out = /* @__PURE__ */ new Map();
	let wire;
	try {
		wire = JSON.parse(text);
	} catch {
		return out;
	}
	if (!wire || !wire.s || typeof wire.s !== "object") return out;
	for (const [entry, src] of Object.entries(wire.s)) if (typeof src === "string") out.set(entry, src);
	return out;
}
/** Decode a graph script's text: entry → chunk hrefs, as written (unresolved). Malformed → empty. */
function decode_island_graph(text) {
	const out = /* @__PURE__ */ new Map();
	let wire;
	try {
		wire = JSON.parse(text);
	} catch {
		return out;
	}
	if (!wire || !Array.isArray(wire.h) || !wire.e || typeof wire.e !== "object") return out;
	for (const entry of Object.keys(wire.e)) {
		const ids = wire.e[entry];
		if (!Array.isArray(ids)) continue;
		const hrefs = [];
		for (const i of ids) {
			const href = wire.h[i];
			if (typeof href === "string") hrefs.push(href);
		}
		out.set(entry, hrefs);
	}
	return out;
}
// ../../../core/src/ref-watch.ts
/** id → callbacks. One per realm (a second bundle evaluating this module shares it). */
var WATCHERS_KEY = Symbol.for("ogygia.hub.watchers");
function watchers() {
	const g = globalThis;
	return g[WATCHERS_KEY] ??= /* @__PURE__ */ new Map();
}
/**
* Notify watchers that fresh data settled for `id`. Called by resolve's live-merge path AND
* directly by subsystems that push a value in (a region frame landing, a streamed promise
* resolving) — those pass the settled value; resolve's path passes the merged live instance.
* A throwing watcher never blocks the others.
*/
function notify(id, live) {
	notify_now(id, live);
}
function notify_now(id, live) {
	const set = watchers().get(id);
	if (set === void 0) return;
	for (const cb of Array.from(set)) try {
		cb(live);
	} catch {}
}
/** How many watchers are registered for `id` — lets a subsystem that owns lifecycle around a
*  hub id (fetch dedupe, eviction TTL) make refcount decisions without a parallel subscriber set. */
function watcher_count(id) {
	return watchers().get(id)?.size ?? 0;
}
// ../../../core/src/ref.ts
var REGISTRY_KEY$7 = Symbol.for("ogygia.hub");
function registry$1() {
	const g = globalThis;
	return g[REGISTRY_KEY$7] ??= {
		kinds: /* @__PURE__ */ new Map(),
		order: [],
		ids: /* @__PURE__ */ new WeakMap(),
		instances: /* @__PURE__ */ new Map([["page", /* @__PURE__ */ new Map()], ["session", /* @__PURE__ */ new Map()]]),
		instance_kind: /* @__PURE__ */ new WeakMap(),
		scope_disposers: /* @__PURE__ */ new Map(),
		keep_owner: /* @__PURE__ */ new Map()
	};
}
/** Register a kind. Idempotent by discriminator — a re-registration (second bundle evaluating
*  the same module) keeps the FIRST, so identity state never forks. */
function register_kind$1(kind) {
	const reg = registry$1();
	if (reg.kinds.has(kind.k)) return;
	reg.kinds.set(kind.k, kind);
	reg.order.push(kind);
}
function mint_id$1() {
	const c = globalThis.crypto;
	if (c?.randomUUID) return c.randomUUID();
	return "r" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
/**
* Mint: live value → Ref, or undefined to fall through to devalue's normal handling.
* `only` restricts the dispatch to named kinds — a seam may deliberately exclude a family
* (the drop-in context path excludes snippets so a stray function THROWS instead of being
* silently mis-read as one). Same instance → same id, always.
*/
function mint$1(value, only) {
	if (value === null || typeof value !== "object" && typeof value !== "function") return void 0;
	const reg = registry$1();
	for (const kind of reg.order) {
		if (only && !only.has(kind.k)) continue;
		if (!kind.match(value)) continue;
		const { t, d } = kind.encode(value);
		let i = reg.ids.get(value);
		if (i === void 0) {
			i = kind.stable_id?.(d) ?? mint_id$1();
			reg.ids.set(value, i);
		}
		const ref = {
			k: kind.k,
			i,
			d
		};
		if (t !== void 0) ref.t = t;
		return ref;
	}
}
/**
* Resolve: Ref → live value.
*
* Second arg is a {@link Scope} (or a legacy boolean shim: `true` ⇒ 'page', `false` ⇒ 'request').
* 'page'/'session' (browser) memoize by id — decoding the same ref twice returns the SAME instance
* (the liveness mechanism), and a kind-named ref reunites with the session bucket across
* navigations (the kind's `merge` reconciles fresh server data in; default kept-wins). 'request'
* (server, defer/streaming renders) always decodes fresh: memoizing across requests would leak one
* user's state into another's HTML.
*/
function resolve(ref, scope_or_remember) {
	const reg = registry$1();
	const kind = reg.kinds.get(ref.k);
	if (kind === void 0) throw new Error(`[ogygia] cannot resolve a "${ref.k}" ref: no such kind is registered on this side. The module that registers it must be imported as a VALUE in this bundle.`);
	const instance = kind.decode(ref);
	return instance;
}
/** Devalue custom-type name for hub refs on the wire (the ONE key every seam will converge on). */
var REF_WIRE_KEY$1 = "OgygiaRef";
/** Devalue reducer for a seam. `only` deliberately restricts which families may cross there. */
function ref_reducer$1(only) {
	return (value) => mint$1(value, only);
}
/** Devalue reviver for a seam. Browser passes `remember: true`; the server must pass `false`. */
function ref_reviver(remember) {
	return (ref) => resolve(ref);
}
// ../../../core/src/server/endpoint.ts
var DEFAULT_ISLANDS_ENDPOINT = "/__ogygia__";
/**
* THE ISLANDS ENDPOINT — one path for everything that names it: the handle answers on it, every
* capability is minted against it, a render knows it is serving a hole by it, the profiler counts
* its requests by it. `handle({ endpoint })` sets it as the app's hooks load, before any render
* (Kit loads the server hooks before it renders anything, prerender included). It used to move only
* the handler: pages still minted `/__ogygia__?…`, and behind a proxy that forwards only the app's
* own prefixes every hole was empty.
*
* Process-wide on `globalThis`, not module state: this file can load under two module ids in one
* server (the plugin points the mint at the package's built file while an app's hooks import it from
* a linked package's source), and a module variable set by the handle was then never read by the mint.
*/
var ENDPOINT_KEY$1 = Symbol.for("ogygia.islands-endpoint");
var endpoint_slot$1 = globalThis;
/** The islands endpoint path (without the app's base: matched by suffix, minted through `resolve`). */
function islands_endpoint$1() {
	return endpoint_slot$1[ENDPOINT_KEY$1] ?? "/__ogygia__";
}
/** Set by the handle (`handle({ endpoint })`); the default when none is given. */
function configure_islands_endpoint(path) {
	endpoint_slot$1[ENDPOINT_KEY$1] = !path ? DEFAULT_ISLANDS_ENDPOINT : path.startsWith("/") ? path : "/" + path;
}
/** Max b64url props blob accepted by the region handle (and refused at mint time). */
var MAX_REGION_PROPS_LEN$1 = 8192;
/**
* Capability TTL for PRERENDERED pages (10 years — effectively the life of the deploy). A static
* file lives on the CDN indefinitely, so an aging capability would strand every hole on it after
* `ttl` (real PPR would silently die in an hour). Safe: the capability's props are already
* baked into the public static HTML, and the mint seals an EMPTY session at prerender — signing
* that same public tuple for longer reveals nothing new. Redeploy survival additionally needs a
* stable `OGYGIA_SECRET` (the default per-build key rotates; ServerIsland warns at build).
*/
var PRERENDER_REGION_TTL_SEC$1 = 31536e4;
/**
* WHEN a capability minted now expires — aligned to a window, not `now + ttl`.
*
* Every render of the same hole (same id, props, session) in the same window mints the SAME
* `exp`, hence the SAME signature and URL: the hole's HTML is byte-identical across requests. That
* is what lets anything keyed on the page's bytes hit — a host app's post-render component cache,
* a CDN or freeze store comparing documents, an ETag. With `now + ttl` every request minted a new
* URL and a header block wrapping five holes was re-processed on every request (measured: seconds
* of server time per page on a Lambda-class host).
*
* The window is half the TTL: `exp` is the end of the window after the current one, so a
* capability is always valid for at least `ttl / 2` and at most `ttl` (harvested URLs still age
* out on the same order); consecutive windows overlap by construction, so a page rendered at the
* end of a window and fetched a moment later still verifies.
*/
function capability_expiry$1(now_sec, ttl_sec) {
	const half = Math.max(1, Math.floor(ttl_sec / 2));
	return (Math.floor(now_sec / half) + 2) * half;
}
/** {@link REGION_ID_RE}: exactly 12 lowercase hex chars. */
function is_region_id(s) {
	return is_lower_hex$1(s, 12);
}
/** {@link REGION_TTL_RE}: empty, or 1–7 ASCII digits. */
function is_region_ttl(s) {
	if (s.length > 7) return false;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c < 48 || c > 57) return false;
	}
	return true;
}
/** Exactly `n` chars of `[0-9a-f]`. */
function is_lower_hex$1(s, n) {
	if (s.length !== n) return false;
	for (let i = 0; i < n; i++) {
		const c = s.charCodeAt(i);
		if (!(c >= 48 && c <= 57 || c >= 97 && c <= 102)) return false;
	}
	return true;
}
// ../../../core/src/portable-form.ts
/**
* THE PORTABLE FORM of a live region snippet — swapped in only where the snippet CROSSES.
*
* A `{#snippet}` handed to a component that may carry it into an island is branded at its definition
* site (region-snippet.ts `og_portable`), but it stays the snippet as written: rendered where it is
* written it runs in place, in the host's tree — the host's context, its scoped CSS, and any island
* inside it a plain page island. Only a boundary needs the other shape: the body compiled to its own
* entry, rendered in isolation on the server and hydrated alone on the client. That shape rides on the
* snippet as `__ogPortable`, and the ONE thing that knows a value is crossing — the code preparing an
* island's props (or a server-picked region's) for its render and its wire — swaps it in here, so the
* server markup and the client's revived snippet are the same shape.
*
* Leaf module (no svelte imports): region.ts reaches it on both legs.
*/
/** Where a branded snippet carries its portable form. */
var PORTABLE_FORM = "__ogPortable";
function is_plain$2(v) {
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}
/**
* `value` with every branded snippet in it (at any depth of plain objects and arrays) replaced by its
* portable form. Copy-on-write: returns the SAME object when nothing in it is branded, and never
* mutates the input.
*/
function with_portable_forms(value) {
	return swap(value, /* @__PURE__ */ new WeakSet());
}
function swap(v, seen) {
	if (typeof v === "function") return v["__ogPortable"] ?? v;
	if (!v || typeof v !== "object" || seen.has(v)) return v;
	if (Array.isArray(v)) {
		seen.add(v);
		let out = null;
		for (let i = 0; i < v.length; i++) {
			const next = swap(v[i], seen);
			if (next !== v[i]) (out ??= v.slice())[i] = next;
		}
		return out ?? v;
	}
	if (!is_plain$2(v)) return v;
	seen.add(v);
	let out = null;
	for (const k of Object.keys(v)) {
		const cur = v[k];
		const next = swap(cur, seen);
		if (next !== cur) (out ??= { ...v })[k] = next;
	}
	return out ?? v;
}
// ../../../core/src/seed-refs.ts
/**
* SEED REFERENCES — island props that point into the page seed instead of copying it.
*
* THE DUPLICATION: on a csr=false page the handle ships `page.data` once as the page seed (so
* islands can read `$page`), and every island ships its props as its own sidecar. A CMS page hands
* each block island its slice of the same `page.data` tree, so the same JSON crosses twice —
* measured on one landing page: 674 KB of seed and 481 KB of props, of which 94% were verbatim
* seed subtrees. Twice the bytes, and twice the server-side serialization (the larger part of that
* page's remaining TTFB gap to a plain Kit render).
*
* THE CODEC: when the seed ships, an island's props are serialized RELATIVE to it. Any plain
* object / array in the props that is also a node of `page.data` — by IDENTITY (the app passed the
* same object) or by STRUCTURE (the app cloned it: a JSON round-trip, a spread — CMS SDKs do) — is
* written as `["OgygiaSeedRef", <path>]`, a path from `page.data` to that node. The client revives
* the reference against the ONE parsed seed of its document (the same graph `page.data` reads —
* `runtime/seeds.ts`) and hands the island the seed's own node, by reference: island props are a
* snapshot either way, and the DEV mutation guard warns on a write into them. Largest matching
* ancestor wins, so a block whose whole props object is one seed node becomes one short reference.
*
* WHAT MATCHES: plain objects and arrays whose subtree holds only plain objects, arrays, primitives
* and Dates — no class instances (wired values, stores, snippets keep their own codec), no Maps or
* Sets, no cycles. Small nodes are skipped (`min_bytes`): a reference costs ~30 bytes, so it must
* save more than that.
*
* WHEN: only inside Kit's page pass of THIS document, and only when the seed ships — a reference
* into a seed that never arrives would be a hole in the island's props. The decision is made ONCE
* per request, when the document tail renders (server/props-wire.ts): every island on the page
* gets references then, whichever rendered first. Every other render root (a hole endpoint, a
* baked ticket, a foreign fragment) never references: its props must be self-contained wherever
* the HTML is spliced.
*
* ONE WALK PER NODE PER REQUEST: `measure` visits a node once and remembers what it learned —
* byte estimate, referenceability, JSON-exactness, a streamed promise inside — as ONE NUMBER in a
* memo shared by every root measured in the same request (`set_measure_memo_reader`; the handle
* hands out its request's memo). The seed's `page.data` is walked once; the twenty block islands
* whose props ARE seed nodes cost a lookup each, not a walk each; the shaped seed, the props plans
* and the handle's lane / streaming decisions all read the same memo. Nothing is allocated per
* node beyond the memo entry: no measure object, no cycle stack (the memo's in-progress mark is
* the cycle detector), no path array until a node is actually referenced.
*
* Universal module (no Node imports): the index + reducer run on the server, the resolver on the
* client, and the unit tests exercise both ends against a real devalue round trip.
*/
/** The devalue type tag. */
var SEED_REF_KEY = "OgygiaSeedRef";
/** A node the codec may reference: a plain object or an array (own prototype only). */
function is_plain$1(v) {
	if (v === null || typeof v !== "object") return false;
	if (Array.isArray(v)) return true;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}
var is_thenable$1 = (v) => typeof v?.then === "function";
/** Leaves that a plain deep copy reproduces exactly. */
function is_leaf(v) {
	return v === null || v === void 0 || typeof v === "string" || typeof v === "number" || typeof v === "boolean" || typeof v === "bigint" || v instanceof Date;
}
var leaf_text = (v) => v === void 0 ? "u" : v === null ? "n" : v instanceof Date ? "d" + v.getTime() : typeof v + ":" + String(v);
/**
* Post-order structural hash + byte estimate of a plain subtree. `null` when the subtree is not
* referenceable (a non-plain value inside, or a cycle). Visits each node once per walk; results
* are memoised in `memo` so a graph with shared nodes stays linear.
*/
function hash_subtree(v, memo, on_stack) {
	if (is_leaf(v)) {
		const t = leaf_text(v);
		return {
			hash: t,
			bytes: t.length
		};
	}
	if (!is_plain$1(v)) return null;
	const cached = memo.get(v);
	if (cached !== void 0) return cached;
	if (on_stack.has(v)) return null;
	on_stack.add(v);
	let bytes = 0;
	let acc = Array.isArray(v) ? "A" : "O";
	let ok = true;
	if (Array.isArray(v)) for (const item of v) {
		const h = hash_subtree(item, memo, on_stack);
		if (!h) {
			ok = false;
			break;
		}
		acc += "|" + h.hash;
		bytes += h.bytes + 1;
	}
	else for (const key of Object.keys(v).sort()) {
		const h = hash_subtree(v[key], memo, on_stack);
		if (!h) {
			ok = false;
			break;
		}
		acc += "|" + key + "=" + h.hash;
		bytes += key.length + h.bytes + 3;
	}
	on_stack.delete(v);
	const result = ok ? {
		hash: fnv1a$1(acc),
		bytes
	} : null;
	memo.set(v, result);
	return result;
}
/** Exact structural equality for the shapes `hash_subtree` accepts — the check behind a hash hit. */
function deep_equal_plain(a, b) {
	if (a === b) return true;
	if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
	if (is_leaf(a) || is_leaf(b)) return false;
	if (!is_plain$1(a) || !is_plain$1(b)) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) if (!deep_equal_plain(a[i], b[i])) return false;
		return true;
	}
	const ka = Object.keys(a);
	const kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	for (const k of ka) {
		if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
		if (!deep_equal_plain(a[k], b[k])) return false;
	}
	return true;
}
var F_REF$1 = 1;
var F_JSON$1 = 2;
var F_THENABLE$1 = 4;
var P_OPAQUE$1 = 0;
var P_THENABLE$1 = F_THENABLE$1;
var P_NULLISH_JSON$1 = 35;
var P_UNDEFINED$1 = 33;
var P_NUMBER$1 = 67;
var P_NUMBER_NOJSON$1 = 65;
var P_BIGINT$1 = 65;
var P_DATE$1 = 193;
/** The memo mark of a node whose walk has not finished: meeting it again is a cycle. */
var IN_PROGRESS$1 = -1;
var bytes_of$1 = (p) => (p - (p & 7)) / 8;
function unpack$1(p) {
	return {
		bytes: bytes_of$1(p),
		ref: (p & F_REF$1) !== 0,
		json: (p & F_JSON$1) !== 0,
		thenable: (p & F_THENABLE$1) !== 0
	};
}
/**
* The one walk: measure a value (post-order, memoised per plain node in `memo`). Every child is
* measured even after one disqualifies the parent: a clean sibling deeper in the tree must still
* get its own entry (the index walk reads the memo). Strings never enter the memo. A node already
* in the memo — from this root or from any other root measured with the same memo — is a lookup.
*/
function measure$1(v, memo) {
	switch (typeof v) {
		case "string": return (v.length + 2) * 8 + F_REF$1 + F_JSON$1;
		case "number": return Number.isFinite(v) && !Object.is(v, -0) ? P_NUMBER$1 : P_NUMBER_NOJSON$1;
		case "boolean": return P_NULLISH_JSON$1;
		case "undefined": return P_UNDEFINED$1;
		case "bigint": return P_BIGINT$1;
		case "object": break;
		default: return P_OPAQUE$1;
	}
	if (v === null) return P_NULLISH_JSON$1;
	if (v instanceof Date) return P_DATE$1;
	if (!is_plain$1(v)) return is_thenable$1(v) ? P_THENABLE$1 : P_OPAQUE$1;
	const cached = memo.get(v);
	if (cached !== void 0) return cached === IN_PROGRESS$1 ? P_OPAQUE$1 : cached;
	if (!Array.isArray(v) && Object.getOwnPropertySymbols(v).length > 0) {
		memo.set(v, P_OPAQUE$1);
		return P_OPAQUE$1;
	}
	let bytes = 0;
	let lanes = 3;
	let thenable = 0;
	let marked = false;
	if (Array.isArray(v)) for (let i = 0; i < v.length; i++) {
		const c = v[i];
		if (typeof c === "string") {
			bytes += c.length + 3;
			continue;
		}
		if (!marked && typeof c === "object" && c !== null) {
			memo.set(v, IN_PROGRESS$1);
			marked = true;
		}
		const p = measure$1(c, memo);
		bytes += bytes_of$1(p) + 1;
		lanes &= p;
		thenable |= p & F_THENABLE$1;
	}
	else for (const key in v) {
		const c = v[key];
		if (typeof c === "string") {
			bytes += c.length + key.length + 5;
			continue;
		}
		if (c === void 0) {
			bytes += key.length + 4;
			continue;
		}
		if (!marked && typeof c === "object" && c !== null) {
			memo.set(v, IN_PROGRESS$1);
			marked = true;
		}
		const p = measure$1(c, memo);
		bytes += bytes_of$1(p) + key.length + 3;
		lanes &= p;
		thenable |= p & F_THENABLE$1;
	}
	const result = bytes * 8 + (lanes & 3) + thenable;
	memo.set(v, result);
	return result;
}
var memo_reader$1 = null;
/** Server (`hooks.ts`) installs a request-scoped reader: every root measured during one request
*  shares one memo, so a subtree reached from two roots (the seed and an island's props) is walked
*  once. `null` uninstalls; off-request (a hole endpoint, a test) each root gets its own memo. */
function set_measure_memo_reader(fn) {
	memo_reader$1 = fn;
}
var analysis_cache$1 = /* @__PURE__ */ new WeakMap();
/** The walk, cached per plain root object: the seed's `page.data` is measured once per request
*  however many islands, lanes and decisions ask; a props object once per island — and against
*  the request's shared memo, so a props object that is a seed node costs a lookup. */
function analysis$1(value) {
	if (!is_plain$1(value)) {
		const memo = /* @__PURE__ */ new Map();
		return {
			root: unpack$1(measure$1(value, memo)),
			memo
		};
	}
	const hit = analysis_cache$1.get(value);
	if (hit) return hit;
	const memo = memo_reader$1?.() ?? /* @__PURE__ */ new Map();
	const a = {
		root: unpack$1(measure$1(value, memo)),
		memo
	};
	analysis_cache$1.set(value, a);
	return a;
}
/** What one walk says about a value (see {@link Measure}). */
function analyze$1(value) {
	return analysis$1(value).root;
}
/**
* WHY a tree is not JSON-exact: the path of the first leaf that disqualifies it, with what it
* is — `config.updated (Date)`, `rows[3].price (NaN)`, `facets (Map)`, `meta (class Foo)`. A
* separate walk on purpose (the measuring walk carries no paths); the handle runs it only for a
* tree that left the JSON lane and only while the profiler records. `null` for a JSON tree.
*/
function json_culprit(value, max_depth = 64) {
	const seen = /* @__PURE__ */ new Set();
	const why = (v) => {
		switch (typeof v) {
			case "string":
			case "boolean": return null;
			case "number": return Number.isFinite(v) ? Object.is(v, -0) ? "-0" : null : Number.isNaN(v) ? "NaN" : "Infinity";
			case "undefined": return "undefined";
			case "bigint": return "bigint";
			case "function": return "function";
			case "symbol": return "symbol";
			default: return null;
		}
	};
	const walk = (v, path, depth) => {
		const leaf = why(v);
		if (leaf) return `${path || "(root)"} (${leaf})`;
		if (v === null || typeof v !== "object") return null;
		if (v instanceof Date) return `${path || "(root)"} (Date)`;
		if (v instanceof Map) return `${path || "(root)"} (Map)`;
		if (v instanceof Set) return `${path || "(root)"} (Set)`;
		if (typeof v.then === "function") return `${path || "(root)"} (Promise)`;
		if (!is_plain$1(v)) {
			const name = Object.getPrototypeOf(v)?.constructor?.name;
			return `${path || "(root)"} (class ${name || "instance"})`;
		}
		if (seen.has(v)) return `${path || "(root)"} (cycle)`;
		if (depth > max_depth) return null;
		seen.add(v);
		if (Array.isArray(v)) for (let i = 0; i < v.length; i++) {
			if (v[i] === void 0) return `${path}[${i}] (undefined in array)`;
			const r = walk(v[i], `${path}[${i}]`, depth + 1);
			if (r) return r;
		}
		else {
			if (Object.getOwnPropertySymbols(v).length > 0) return `${path || "(root)"} (symbol-branded)`;
			for (const key in v) {
				const c = v[key];
				if (c === void 0) continue;
				const r = walk(c, path ? `${path}.${key}` : key, depth + 1);
				if (r) return r;
			}
		}
		seen.delete(v);
		return null;
	};
	return walk(value, "", 0);
}
function path_of(at) {
	if (at.path !== null) return at.path;
	const path = at.parent === null ? [] : [...path_of(at.parent), at.key];
	at.path = path;
	return path;
}
var EMPTY_NODES = [];
var EMPTY_INDEX = {
	by_identity: {
		get: () => void 0,
		has: () => false
	},
	candidates: () => EMPTY_NODES,
	hash_of: () => null,
	size: 0,
	touched: /* @__PURE__ */ new Set()
};
var index_cache = /* @__PURE__ */ new WeakMap();
/**
* Index the seed's `data` for referencing: every referenceable node at or above `min_bytes`, by
* identity now and by structural hash on demand (first occurrence wins — the shortest path is not
* guaranteed, the first in key order is, which is deterministic). Cached per `data` object: one
* index per request, however many islands ask. It reads the one measuring walk (`analyze`) and
* prunes: a node below `min_bytes` cannot hold a child at or above it (a child is never larger
* than its parent), so its subtree is skipped BEFORE anything is materialised — on a CMS tree that
* is most of the nodes.
*/
function index_seed(data, min_bytes = 96) {
	if (!is_plain$1(data)) return {
		...EMPTY_INDEX,
		touched: /* @__PURE__ */ new Set()
	};
	const hit = index_cache.get(data);
	if (hit) return hit;
	const memo = analysis$1(data).memo;
	const at = /* @__PURE__ */ new WeakMap();
	const nodes = [];
	const seen = /* @__PURE__ */ new Set();
	const enter = (c) => {
		if (!is_plain$1(c) || seen.has(c)) return false;
		const p = memo.get(c);
		return p !== void 0 && bytes_of$1(p) >= min_bytes;
	};
	const visit = (v, here) => {
		seen.add(v);
		if (memo.get(v) & F_REF$1) {
			at.set(v, here);
			nodes.push(v);
		}
		if (Array.isArray(v)) for (let i = 0; i < v.length; i++) {
			const c = v[i];
			if (enter(c)) visit(c, {
				parent: here,
				key: i,
				path: null
			});
		}
		else for (const key in v) {
			const c = v[key];
			if (enter(c)) visit(c, {
				parent: here,
				key,
				path: null
			});
		}
	};
	if (enter(data)) visit(data, {
		parent: null,
		key: "",
		path: []
	});
	let by_bytes = null;
	const buckets = () => {
		if (by_bytes === null) {
			by_bytes = /* @__PURE__ */ new Map();
			for (const n of nodes) {
				const b = bytes_of$1(memo.get(n));
				const bucket = by_bytes.get(b);
				if (bucket) bucket.push(n);
				else by_bytes.set(b, [n]);
			}
		}
		return by_bytes;
	};
	const hash_memo = /* @__PURE__ */ new Map();
	const index = {
		by_identity: {
			get: (node) => {
				const here = at.get(node);
				return here === void 0 ? void 0 : path_of(here);
			},
			has: (node) => at.has(node)
		},
		candidates: (b) => buckets().get(b) ?? EMPTY_NODES,
		hash_of: (node) => hash_subtree(node, hash_memo, /* @__PURE__ */ new Set())?.hash ?? null,
		size: nodes.length,
		touched: /* @__PURE__ */ new Set()
	};
	index_cache.set(data, index);
	return index;
}
/**
* Plan one island's references: walk the props once, top-down, largest matching ancestor first —
* identity first (a pointer lookup per node, no hashing), then structure (hash + exact comparison,
* only for a large plain node the seed does not own, and only against the seed nodes of exactly the
* same byte size — usually none, or one). Nodes under a matched ancestor are never visited (they
* ride inside the reference), and neither is anything under a node below `min_bytes` (no child
* of it can be referenced). The props' own measures come from the request memo, so the plan adds
* no walk of its own beyond the pointer lookups.
*/
function plan_seed_refs(index, props, min_bytes = 96) {
	const matched = /* @__PURE__ */ new WeakMap();
	const keys = /* @__PURE__ */ new Set();
	let count = 0;
	if (index.size > 0) {
		const memo = analysis$1(props).memo;
		const hashed = /* @__PURE__ */ new Map();
		const seen = /* @__PURE__ */ new Set();
		const hit = (v, path) => {
			matched.set(v, path);
			index.touched.add(String(path[0]));
			keys.add(String(path[0]));
			count++;
		};
		const visit = (v) => {
			if (!is_plain$1(v) || seen.has(v)) return;
			seen.add(v);
			const by_id = index.by_identity.get(v);
			if (by_id) return hit(v, by_id);
			const p = memo.get(v) ?? measure$1(v, memo);
			const bytes = bytes_of$1(p);
			if (bytes < min_bytes) return;
			if (p & F_REF$1) {
				const cands = index.candidates(bytes);
				if (cands.length) {
					const h = hash_subtree(v, hashed, /* @__PURE__ */ new Set())?.hash ?? null;
					const cand = h ? cands.find((c) => index.hash_of(c) === h) : void 0;
					if (cand && deep_equal_plain(cand, v)) return hit(v, index.by_identity.get(cand));
				}
			}
			if (Array.isArray(v)) for (const item of v) visit(item);
			else for (const key in v) visit(v[key]);
		};
		visit(props);
	}
	return {
		reducer: (value) => value === null || typeof value !== "object" ? void 0 : matched.get(value),
		count,
		keys
	};
}
// ../../../core/src/runtime/entry-locations.ts
/**
* ENTRY IDENTITY → LOCATION, the browser's half (server/entry-location.ts is the server's).
*
* An island's `entry` is its IDENTITY: the stable URL every key uses (the island graph, the
* fingerprint, the devtools' names). The file to import is its LOCATION — content-hashed, so an
* `immutable` cache never serves a stale one. The server writes it beside the identity: the region
* element's `src`, and the island graph's `s` map for an entry no element carries (a portable
* snippet's). Every loader resolves through `island_module_url` (region-endpoint-url.ts), which asks
* here first: the location once one is known, else the identity (the dev server, or a page from
* before hashing — whose stable name is a shim that reaches the current build).
*/
/** absolute identity → absolute location */
var locations$1 = /* @__PURE__ */ new Map();
var fallback_reporter$1 = null;
/** Resolved URLs by base + url: every wake, warm and graph read asks again for the same few
*  entries, and each ask was a `new URL()` parse (bounded: cleared past a few thousand). */
var resolved_urls$1 = /* @__PURE__ */ new Map();
function absolute$1(url, base) {
	const b = location.href;
	const key = b + "\n" + url;
	const hit = resolved_urls$1.get(key);
	if (hit !== void 0) return hit;
	let out;
	try {
		out = new URL(url, b).href;
	} catch {
		out = url;
	}
	if (resolved_urls$1.size > 4e3) resolved_urls$1.clear();
	resolved_urls$1.set(key, out);
	return out;
}
/** The known location of an entry, or undefined. */
function entry_location$1(entry, base) {
	return locations$1.size ? locations$1.get(absolute$1(entry)) : void 0;
}
/**
* The identity itself, past every cache: what a load falls back to when its location failed (a page
* a cache kept outlived the build that made it, and that build's files are gone). The stable name
* is a shim of the CURRENT build's file; the query makes the browser fetch it fresh rather than the
* copy an `immutable` cache may hold. Null when no location was known (nothing to fall back to).
*/
function fresh_identity_url$1(entry, base) {
	if (!entry_location$1(entry)) return null;
	const identity = absolute$1(entry);
	return identity + (identity.includes("?") ? "&" : "?") + "og-fresh=" + Date.now().toString(36);
}
/**
* Import an entry: its location when known, else `url` (what the caller resolved for the identity);
* the location failing, once, the identity fetched fresh — so an island on a page that outlived its
* build still wakes, on the current code. No location known → the error stands.
*/
function import_entry$1(entry, url = entry_location$1(entry) ?? entry) {
	const loaded = import(
		/* @vite-ignore */
		url
);
	const fresh = fresh_identity_url$1(entry);
	if (!fresh) return loaded;
	return loaded.catch(() => {
		const retry = import(
			/* @vite-ignore */
			fresh
);
		const report = (recovered) => fallback_reporter$1?.({
			entry,
			src: url,
			recovered
		});
		retry.then(() => report(true), () => report(false));
		return retry;
	});
}
// ../../../core/src/region-snippet.ts
/**
* Region snippets — the snippet shape of a region. "Everything that crosses an island boundary is a
* region; components and snippets are its two shapes; static freezes, live wakes."
*
* A snippet handed to a component is a function, so it can't cross an island boundary directly (devalue
* can't stringify a function). A region snippet is a real Svelte snippet — same-graph `{@render}`
* renders it inline — that also carries a serializable DESCRIPTOR and knows how to REVIVE on the far
* side. One primitive, two modes:
*
*  - **live** — the compiler, at a snippet's DEFINITION site, compiles its body into an island ENTRY
*    and constructs a live region snippet (`{ m:'live', e, p }`). It renders the entry inline on the
*    server and HYDRATES it on the client, so the markup comes alive. This is the former "portable
*    snippet" path, unchanged in behavior, now expressed as the live mode of this one primitive.
*  - **static** — a PLAIN snippet reaching a boundary is FROZEN to its server-rendered HTML
*    (`{ m:'static', h }`). The client adopts that HTML byte-for-byte; nothing re-runs. No compiler
*    involvement, so it survives wrappers, re-exports, and a consumer swapping in their own component.
*    Correct for markdown content (prose, code): static, never reactive.
*
* The boundary law lives in ONE place — {@link reduce_region_snippet}: a branded region snippet crosses
* as its descriptor; a bare snippet is captured static; a parameterized snippet that can't be frozen
* throws, loudly. Revival is its single inverse, {@link revive_region_snippet}. `createRawSnippet` is
* isomorphic (server calls `render`, client calls `setup`), so one factory serves both legs of both
* modes with no manual environment branch.
*/
/**
* A hand-written SERVER component that renders a bare snippet: svelte has no public API to
* stringify a snippet, but a server component is just `($$renderer, $$props) => void` and a server
* snippet is `($$renderer) => void` — so the component simply invokes the snippet. Hand-written
* (not a `.svelte` file) so this module stays importable from plain node (endpoints, tests)
* without a svelte compiler in the loader.
*/
var RenderSnippet$1 = (($$renderer, $$props) => {
	$$props.s($$renderer);
});
var WRAP_OPEN$1 = "<ogygia-snippet style=\"display:contents\">";
var WRAP_CLOSE$1 = "</ogygia-snippet>";
var STATIC_OPEN$1 = "<ogygia-snippet data-og-static style=\"display:contents\">";
var host_context$1 = () => {
	try {
		return getAllContexts();
	} catch {
		return null;
	}
};
/** context.ts `isInLiveSnippet` reads it: a hole in the body stays deferred (Region.svelte). */
var LIVE_SNIPPET_KEY$2 = Symbol.for("ogygia.live-snippet");
var with_host$1 = (context, host) => {
	if (host) for (const [k, v] of host) context.set(k, v);
	context.set(LIVE_SNIPPET_KEY$2, true);
	return context;
};
/** Where a live snippet's pending hydrate waits on its host region: a global key, as the runtime
*  bundle and each island-entry bundle carry their own copy of this module (runtime/core.ts reads it). */
var SNIPPET_BOOTS$1 = Symbol.for("ogygia.snippet-boots");
/** The host region is awake only once its snippets are: it signals `data-hydrated` after them. */
function hold_host$1(el, booted) {
	const host = el.closest("ogygia-region");
	if (host && !host.hasAttribute("data-hydrated")) (host[SNIPPET_BOOTS$1] ??= []).push(booted);
}
/**
* The ONE factory. Build a region snippet from its descriptor (+ the live entry when we're at its
* definition site and it's in the same bundle). Handles both modes and both legs.
*/
function make$1(desc, live_entry = null) {
	if (desc.m === "slot") {
		const h = slot_marker_open$1(desc.id) + SLOT_MARKER_CLOSE$1;
		const slot_snip = createRawSnippet(() => ({
			render: () => h,
			setup: () => {}
		}));
		slot_snip.__ogRegion = desc;
		return slot_snip;
	}
	if (desc.m === "live") {
		const thread_head = (r, head) => {
			if (head && typeof r.head === "function") r.head((child) => child.push(head));
		};
		const dev_css_link = "";
		const server_snip = ((renderer, ...args) => {
			const props = args.length ? {
				...desc.p,
				__ogArgs: args
			} : desc.p;
			const host = host_context$1();
			if (!!live_entry && renderer?.global?.mode === "async" && typeof renderer.child === "function") renderer.child(async (r) => {
				const out = await render(live_entry, {
					props,
					context: with_host$1(kit_render_context$1(), host)
				});
				thread_head(r, (out.head || "") + dev_css_link);
				r.push(WRAP_OPEN$1 + out.body + WRAP_CLOSE$1);
			});
			else {
				const out = live_entry ? render(live_entry, {
					props,
					context: with_host$1(kit_render_context$1(), host)
				}) : {
					head: "",
					body: ""
				};
				thread_head(renderer, (out.head || "") + dev_css_link);
				renderer.push(WRAP_OPEN$1 + out.body + WRAP_CLOSE$1);
			}
		});
		server_snip.__ogRegion = desc;
		return server_snip;
	}
	const snip = createRawSnippet((...params) => {
		const host = host_context$1();
		const live_props = () => desc.m === "live" ? params.length ? {
			...desc.p,
			__ogArgs: params.map((g) => g())
		} : desc.p : {};
		return {
			render: () => {
				if (desc.m === "static") return STATIC_OPEN$1 + desc.h + WRAP_CLOSE$1;
				return WRAP_OPEN$1 + (!live_entry ? "" : render(live_entry, {
					props: live_props(),
					context: with_host$1(kit_render_context$1(), host)
				}).body) + WRAP_CLOSE$1;
			},
			setup: (el) => {
				if (desc.m === "static") return;
				let app;
				let dead = false;
				const boot = (Comp) => {
					if (!dead) app = hydrate(Comp, {
						props: live_props(),
						context: with_host$1(/* @__PURE__ */ new Map(), host)
					});
				};
				if (live_entry) boot(live_entry);
				else hold_host$1(el, import_entry$1(desc.e).then((m) => boot(m.default)));
				return () => {
					dead = true;
					if (app) unmount();
				};
			}
		};
	});
	snip.__ogRegion = desc;
	return snip;
}
/** Freeze a plain snippet to a static region snippet by SSR-rendering it once (SERVER only). A snippet
*  that needs parameters can't be frozen — surface that as the actionable boundary error. `label` names
*  the island prop when known, so a plain function passed by mistake points at the right prop. */
function capture_static$1(snippet, label) {
	let body;
	try {
		body = render(RenderSnippet$1, {
			props: { s: snippet },
			context: kit_render_context$1()
		}).body;
	} catch (e) {
		const where = label ? `prop \`${label}\`` : "a function prop";
		throw new Error(`[ogygia] ${where} is a function that can't cross the island boundary — ${e instanceof Error ? e.message : String(e)}. Island props must be SERIALIZABLE; a function crosses only as a Svelte snippet that freezes to HTML, and this one didn't. Usually one of:\n  • it's a PLAIN function (an event handler / callback) — those can't cross into an island; pass serializable data as props and keep the behavior inside the island component;\n  • it's a snippet WITH PARAMETERS — declare it as a {#snippet} so it crosses LIVE, or pass its data as props;\n  • it's children containing a NESTED island — keep those out of frozen children for now.`);
	}
	return make$1({
		m: "static",
		h: body
	});
}
/**
* Definition-site factory (compiler-emitted). Brands the snippet AS WRITTEN (`native`) — it keeps
* rendering in place, in the host's tree: the host's context, its scoped CSS, a nested island as a plain
* page island — with the descriptor (`__ogRegion`, what crosses the wire) and its PORTABLE form: the
* body compiled to `Entry`, rendered in isolation on the server and hydrated alone on the client. Only a
* boundary swaps the portable form in (portable-form.ts, via {@link prepare_region_props}), so the server
* markup and the client's revived snippet agree. `Entry` is `null` in a client bundle (the far side
* imports it by url). The native function is branded in place (not wrapped), so its identity — what a
* `{@render}` keys on — is stable across re-evaluations of the prop.
*/
function og_portable(native, Entry, props, url) {
	const desc = {
		m: "live",
		e: url,
		p: props
	};
	const snip = native;
	snip.__ogRegion = desc;
	let portable = null;
	Object.defineProperty(snip, PORTABLE_FORM, {
		configurable: true,
		enumerable: false,
		get: () => portable ??= make$1(desc, Entry)
	});
	return snip;
}
/** Lift a parameterless snippet, or a raw `{ render, setup?, captures? }`, into a region snippet. */
function region_snippet(input) {
	if (typeof input === "function" && true) return capture_static$1(input);
	if (typeof input === "function") throw new Error("[ogygia] region_snippet(fn) freezes a snippet by server-rendering it — call it during SSR, not on the client. Pass a raw { render, setup } region snippet for client-constructed regions.");
	const caps = input.captures ?? [];
	const snip = createRawSnippet(() => ({
		render: () => WRAP_OPEN$1 + input.render(...caps) + WRAP_CLOSE$1,
		setup: input.setup ? (el) => void input.setup(el, ...caps) : () => {}
	}));
	snip.__ogRegion = {
		m: "static",
		h: input.render(...caps)
	};
	return snip;
}
/**
* Prepare an island's props for crossing: freeze each BARE snippet prop to a single-rooted static
* region snippet, so the SAME value renders the island body AND serializes — the body HTML and the
* revived client snippet then agree byte-for-byte, and hydration adopts cleanly. Server-only (uses SSR
* capture). A branded (live) snippet, at any depth, is swapped for its PORTABLE form; non-snippet values
* pass through untouched. Returns the original object when nothing changed (no needless copy).
*/
function prepare_region_props(input) {
	if (analyze$1(input).json) return input;
	const props = with_portable_forms(input);
	let out = null;
	for (const k in props) {
		const v = props[k];
		if (typeof v === "function" && !v.__ogRegion && v[Symbol.for("ogygia.fn")] === void 0) (out ??= { ...props })[k] = capture_static$1(v, k);
	}
	return out ?? props;
}
/** The SSR marker that fences an island's in-place children so the client can adopt exactly that range.
*  `display:contents` keeps it layout-neutral. */
function slot_marker_open$1(id) {
	return `<ogygia-slot data-og-slot="${id}" style="display:contents">`;
}
var SLOT_MARKER_CLOSE$1 = "</ogygia-slot>";
/**
* Slot marker ids: PER REQUEST, so two renders of the same page mint the same ids and the HTML is
* byte-identical across requests (a host's post-render cache, a freeze store, an ETag all key on
* the bytes; a process-wide counter made every page differ from its previous render). Page-unique
* within one SSR pass is all the id must be — it fences a marker to its payload pointer. A hole
* response is spliced INTO a page that has its own sequence, so an endpoint render prefixes its
* ids with its region id and can never collide with the page's. Off-request (a test, a tool, the
* client) the process counter stands in. The request comes through the kit-context reader the
* handle installs (no Vite virtual here — this module is imported by plain-Node consumers too).
*
* COUNTED PER `key` (the island's entry): with async SSR, regions start in the order their data
* arrives, so ONE counter for the page gave an island in an async branch a different number on each
* request (and every island after it). Per entry, an island's id moves only against another copy of
* the SAME island that started in a different order — rare, and still page-unique.
*/
var slot_seq_by_request = /* @__PURE__ */ new WeakMap();
var _slot_seq = 0;
function next_slot_id(key = "") {
	const event = kit_request_event();
	if (event && typeof event === "object") {
		let seq = slot_seq_by_request.get(event);
		if (!seq) {
			const url = event.url;
			const hole = url?.pathname.endsWith(islands_endpoint$1()) ? (url.searchParams.get("id") ?? "").slice(0, 6) : "";
			slot_seq_by_request.set(event, seq = {
				prefix: hole ? hole + "-" : "",
				n: /* @__PURE__ */ new Map()
			});
		}
		let c = seq.n.get(key);
		if (!c) seq.n.set(key, c = {
			n: 0,
			tag: key ? fnv1a32(key).toString(36) + "-" : ""
		});
		return "og" + seq.prefix + c.tag + (++c.n).toString(36);
	}
	_slot_seq = _slot_seq + 1 & 2147483647;
	return "og" + _slot_seq.toString(36);
}
/** The serialize-only stand-in for in-place children: a branded value the codec reduces to a `slot`
*  descriptor. Never rendered (the server body renders the real children); on the client it revives to a
*  snippet that ADOPTS the marked DOM range. */
function slot_pointer(id) {
	const snip = (() => {});
	snip.__ogRegion = {
		m: "slot",
		id
	};
	return snip;
}
/** The hub kind: a snippet is a renderable Ref ("a snippet is a region", now literal). A branded
*  region snippet crosses as its descriptor; a bare snippet FREEZES at the boundary (server-only —
*  the BROWSER guard also keeps `capture_static` → `svelte/server` DCE-able out of client bundles);
*  a bare function on the CLIENT falls through (never claimed — it can't freeze there). */
/** Explicit registration — called at module scope AND from live-transport's install():
*  a bare side-effect import gets tree-shaken (the package marks JS side-effect-free),
*  which silently un-registers the kind in client bundles. A CALLED import cannot be dropped. */
function register_snippet_kind$1() {
	register_kind$1({
		k: "snippet",
		match(value) {
			if (typeof value !== "function") return false;
			if (value.__ogRegion) return true;
			if (value[Symbol.for("ogygia.fn")] !== void 0) return false;
			return true;
		},
		encode(value) {
			const branded = value.__ogRegion;
			if (branded) return { d: branded };
			return { d: capture_static$1(value).__ogRegion };
		},
		decode(ref) {
			return make$1(ref.d);
		},
		stable_id: snippet_stable_id$1
	});
}
/**
* A snippet's ref id from its descriptor: decode reads only `d` and a revived snippet holds no state,
* so equal descriptors are the same snippet — and a render names it the same every time (a random id
* here changed the fingerprint and the bytes of every island with children, on every request).
*  - `slot`: its slot id, already page-unique and stable (next_slot_id);
*  - `static`: a hash of its frozen HTML;
*  - `live`: a hash of its entry and props — only when the props are JSON-exact (seed-refs `analyze`,
*    the JSON lane's own rule): `JSON.stringify` turns a Map, a Set, a Date or a class instance into
*    something that two different values share, and those must not share a revived snippet.
*    Anything else keeps a random id.
*/
function snippet_stable_id$1(d) {
	const desc = d;
	if (desc.m === "slot") return "slot:" + desc.id;
	if (desc.m === "static") return "s" + fnv1a$1(desc.h);
	if (desc.m === "live" && analyze$1(desc.p).json) return "l" + fnv1a$1(desc.e + "\0" + JSON.stringify(desc.p));
}
// ../../../core/src/store-transport.ts
/**
* Transportable stores — the hub's STORE kind.
*
* A Svelte store is a live object (closure + methods), so devalue rejects it and a
* `setContext('cart', store)` silently died at the island boundary. This kind lets a
* subscribe-shaped value cross the same way `[import.meta.og.wire]` classes do: the CURRENT
* VALUE travels as data, the CODE comes from a module on the other side, and hub identity
* makes it live — every encode of one store mints ONE id, and the browser resolves by id,
* so five islands reading the same context key share one client store. `set` in island A
* repaints `$store` in island B.
*
* Two tiers:
*  - REGISTERED FACTORY (`__register_store_factory(tag, factory)`): decode calls
*    `factory(seed)` from the registered module, so custom methods (`add`, `reset`,
*    `useLocalStorage`, …) are REBUILT, not serialized. A store is branded with its factory
*    tag via `mark_store` (hand-written today, compiler-emitted later).
*  - GENERIC (`svelte:writable`): any unbranded subscribe-shaped value. Decode is a plain
*    `writable(seed)` — value + set/update/subscribe survive; bespoke methods do not (the
*    boundary classifier warns, naming them).
*
* Identity, reunification, per-request server isolation: the hub's (see ref.ts).
*/
/** Brand on an `og_derived` store: the RECIPE (sources + formula) it was made from. */
var DERIVED_BRAND$1 = Symbol.for("ogygia.derived");
/** Generic tag: decode with a bare `writable(seed)`. */
var GENERIC_TAG$1 = "svelte:writable";
/** Brand carrying a factory tag on a store object (non-enumerable, set by `mark_store`). */
var STORE_TAG$1 = Symbol.for("ogygia.store.tag");
var REGISTRY_KEY$6 = Symbol.for("ogygia.stores");
function store_registry$1() {
	const g = globalThis;
	return g[REGISTRY_KEY$6] ??= { factories: /* @__PURE__ */ new Map() };
}
/** Subscribe-shaped, NOT a `[ogygia.wire]` class instance (wire kind), and NOT an `og_derived`
*  (the derived kind carries its recipe — the store kind would freeze it to a seed). */
function is_store$1(value) {
	if (value === null || typeof value !== "object") return false;
	if (typeof value.subscribe !== "function") return false;
	if (value[DERIVED_BRAND$1] !== void 0) return false;
	const cls = value.constructor;
	if (typeof cls === "function" && cls[wire$1]) return false;
	return true;
}
/** For warnings: `null` is an object to typeof, and the distinction matters at this seam. */
var type_of$1 = (v) => v === null ? "null" : typeof v;
/** The hub kind: subscribe-shaped values. The moment of crossing is the value snapshot. */
function register_store_kind$1() {
	register_kind$1({
		k: "store",
		match: is_store$1,
		encode(value) {
			return {
				t: value[STORE_TAG$1] ?? GENERIC_TAG$1,
				d: get(value)
			};
		},
		decode(ref) {
			const t = ref.t ?? GENERIC_TAG$1;
			const factory = t === GENERIC_TAG$1 ? void 0 : store_registry$1().factories.get(t);
			if (t !== GENERIC_TAG$1 && factory === void 0) {
				if (typeof console !== "undefined") console.warn(`[ogygia] store "${t}": factory not loaded in this bundle — degraded to a plain writable (custom methods unavailable). Import the factory's module in the island (or its graph) so \`__register_store_factory\` runs there.`);
				return writable(ref.d);
			}
			const built = factory ? factory(ref.d) : writable(ref.d);
			if (built === null || typeof built !== "object") {
				if (typeof console !== "undefined") console.warn(`[ogygia] store "${t}": factory returned ${type_of$1(built)} while rebuilding — degraded to a plain writable (custom methods unavailable). A store factory must return a store on every call; move environment guards inside the factory body.`);
				return writable(ref.d);
			}
			return built;
		}
	});
}
/**
* A `derived` that CROSSES boundaries ALIVE — resumability for the reactive graph.
*
* Svelte's `derived` is a live computation: sources + a formula. The value can serialize; the
* computation can't — so a plain derived crosses as a FROZEN seed (the classifier warns). This
* primitive remembers its RECIPE, and the recipe is made of exactly the two things the seam
* already carries: sources are STORES (they reunify to one live instance per island page) and
* the formula is a FUNCTION (mark it with `import.meta.og.$` so it travels as a fn ref).
*
* ```ts
* const doubled = og_derived(tally, import.meta.og.$((n) => n * 2));
* ```
*
* Locally it IS `svelte/store`'s derived — same laziness, same semantics. At a boundary the
* derived kind ships `{ sources, formula, seed }`; the island decodes by re-deriving against
* the REUNIFIED sources with the REBOUND formula: bump the source in any island and every
* island's derived follows. The seed rides along only for exactness of the first paint.
*
* An UNMARKED formula still works same-tree, but the derived then can't cross (the fn ref
* can't be built) — the boundary explains this at the seam rather than freezing silently.
*/
function og_derived$1(sources, fn, initial) {
	const single = !Array.isArray(sources);
	const store = derived$1(sources, fn, initial);
	Object.defineProperty(store, DERIVED_BRAND$1, {
		value: {
			s: single ? [sources] : sources,
			f: fn,
			single
		},
		enumerable: false
	});
	return store;
}
/** The hub kind: an `og_derived` recipe. Sources and formula are shipped as NESTED refs (devalue
*  recursion runs the reducer over `d`'s contents), so by decode time they are already LIVE —
*  sources reunified, formula rebound — and re-deriving is one call. */
function register_derived_kind$1() {
	register_kind$1({
		k: "derived",
		match(value) {
			return value !== null && typeof value === "object" && value[DERIVED_BRAND$1] !== void 0;
		},
		encode(value) {
			const r = value[DERIVED_BRAND$1];
			return { d: {
				s: r.s,
				f: r.f,
				single: r.single,
				seed: get(value)
			} };
		},
		decode(ref) {
			const d = ref.d;
			if (typeof d.f !== "function") throw new Error("[ogygia] cannot resume og_derived: its formula did not cross — mark it with import.meta.og.$ at the og_derived call site so it travels as a fn ref.");
			return og_derived$1(d.single ? d.s[0] : d.s, d.f, d.seed);
		}
	});
}
// ../../../core/src/fn-transport.ts
/**
* Transportable functions — the hub's FN kind (the runtime half of `import.meta.og.$`).
*
* A closure can never serialize — there is no runtime API for a function's captured scope.
* What CAN cross is a QRL-style handle: WHERE the code lives (a build tag) plus WHAT it
* closed over (bound captures, as data). The compiler half (a later phase) hoists a marked
* closure to a generated module at build time:
*
* ```ts
* // source:                         setContext('fmt', import.meta.og.$((n) => `${n * rate}`));
* // generated module (tagged):      export const $0 = (rate) => (n) => `${n * rate}`;
* //                                 __register_fn('routes/+layout#$0', $0);
* // call site rewrites to:          setContext('fmt', fn_handle('routes/+layout#$0', [rate]));
* ```
*
* This module is the machinery both halves share: the factory registry, the branded live
* handle (`fn_handle` — callable on the SERVER leg too, where the factory module is loaded),
* and the kind. Decode = look the tag up, `factory(...bound)` → the live closure. Captures
* are themselves refs-or-data, so a bound capture may be a store/wire instance that reunites.
*
* IDENTITY: functions are deliberately NEVER memoized by the hub (`resolve` only remembers
* objects). Each consumer rebinds its own closure — stateless until called, exactly like
* snippets. Anything stateful a function closes over should be a store/wire capture, which
* DOES reunite; then every rebound copy sees the same live state.
*/
/** Brand on a live handle: carries `{ t, d }` so encode is a field read, not an analysis. */
var FN_BRAND$1 = Symbol.for("ogygia.fn");
var REGISTRY_KEY$5 = Symbol.for("ogygia.fns");
function fn_registry$1() {
	const g = globalThis;
	return g[REGISTRY_KEY$5] ??= { factories: /* @__PURE__ */ new Map() };
}
/** The hub kind: a branded hoisted function. Bare functions are NEVER claimed (the snippet kind
*  owns SSR-freezable snippets; an unmarked function at a boundary must keep failing loudly). */
function register_fn_kind$1() {
	register_kind$1({
		k: "fn",
		match(value) {
			return typeof value === "function" && value[FN_BRAND$1] !== void 0;
		},
		encode(value) {
			const brand = value[FN_BRAND$1];
			return {
				t: brand.t,
				d: {
					b: brand.d,
					...brand.s ? { s: brand.s } : {}
				}
			};
		},
		decode(ref) {
			const payload = ref.d ?? {};
			let factory = fn_registry$1().factories.get(ref.t);
			if (factory === void 0) {
				const from_page = globalThis.__OG_FNM?.[ref.t];
				if (typeof from_page === "function") {
					factory = from_page;
					fn_registry$1().factories.set(ref.t, factory);
				}
			}
			if (factory === void 0 && typeof payload.s === "string") {
				factory = (0, eval)(`(${payload.s})`);
				fn_registry$1().factories.set(ref.t, factory);
			}
			if (factory === void 0) throw new Error(`[ogygia] cannot revive fn "${ref.t}": its factory is not loaded on this side and the payload carries no source. The island must import the generated module as a VALUE so \`__register_fn\` runs in its bundle (or the fn manifest must be in the runtime).`);
			const bound = Array.isArray(payload.b) ? payload.b : [];
			const live = factory(...bound);
			live[FN_BRAND$1] = {
				t: ref.t,
				d: bound,
				...payload.s ? { s: payload.s } : {}
			};
			return live;
		}
	});
}
// ../../../core/src/live-transport.ts
/** Reserved key for the static codec — what `import.meta.og.wire` rewrites to. `Symbol.for` so it's
*  identical across every bundle. Internal: the public opt-in is the construct, not this symbol. */
var wire$1 = Symbol.for("ogygia.wire");
var REGISTRY_KEY$4 = Symbol.for("ogygia.transportables");
function wire_registry$1() {
	const g = globalThis;
	return g[REGISTRY_KEY$4] ??= {
		classes: /* @__PURE__ */ new Map(),
		tags: /* @__PURE__ */ new WeakMap()
	};
}
function codec_of$1(cls) {
	const raw = cls[wire$1];
	return typeof raw === "function" ? raw.call(cls) : raw;
}
function class_for$1(tag) {
	const cls = tag === void 0 ? void 0 : wire_registry$1().classes.get(tag);
	if (cls === void 0) throw new Error(`[ogygia] cannot revive transportable "${tag}": its class is not loaded on this side. The island must import the class as a VALUE (not \`import type\`) so its codec travels with the island's bundle.`);
	return cls;
}
/** The hub kind: `[og.wire]` class instances. Identity/reunify/Keep live in the hub. */
function register_wire_kind$1() {
	register_kind$1({
		k: "wire",
		match(value) {
			const cls = value.constructor;
			return typeof cls === "function" && !!cls[wire$1];
		},
		encode(value) {
			const cls = value.constructor;
			const tag = wire_registry$1().tags.get(cls);
			if (tag === void 0) throw new Error(`[ogygia] class "${cls.name ?? "?"}" has a [import.meta.og.wire] codec but was never registered. Transportable classes must be declared in a module the ogygia vite plugin transforms (an \`export class\` in your app source, not node_modules or a dynamic eval).`);
			return {
				t: tag,
				d: codec_of$1(cls).encode(value)
			};
		},
		decode(ref) {
			return codec_of$1(class_for$1(ref.t)).decode(ref.d);
		},
		keep_name(ref) {
			const codec = codec_of$1(class_for$1(ref.t));
			return typeof codec.id === "string" ? codec.id : void 0;
		},
		merge(kept, ref) {
			const codec = codec_of$1(class_for$1(ref.t));
			if (typeof codec.merge === "function") codec.merge(kept, codec.decode(ref.d));
		}
	});
}
// ../../../core/src/server/props-wire.ts
/**
* PROPS ON THE WIRE — one plan per island for what its props sidecar says, and how.
*
* Two facts about an island's props decide its sidecar, and both come from ONE walk of the props
* (`analyze`, seed-refs.ts):
*
*  1. THE LANE. A payload that is plain JSON — objects, arrays, strings, finite numbers, booleans,
*     null, nothing else — goes out as `JSON.stringify` output (native, ~10× cheaper than devalue's
*     JavaScript flatten + per-character escape, which was the single hottest thing in a profiled
*     CMS page's render) under `data-og-format="json"`, and the runtime reads it with `JSON.parse`.
*     Anything devalue exists for (a Date, a Map, undefined, a bigint, a wired class, a store, a
*     snippet, an og.$ fn) keeps the devalue lane with the usual reducers.
*
*  2. THE FINGERPRINT INPUT. `data-og-fp` hashes the CANONICAL text — the lane's text WITHOUT seed
*     references. That makes the fingerprint a function of the props alone: the same props give the
*     same fingerprint whether or not the page seed ships, and whichever island rendered first.
*     (Before, an island rendered ahead of the page's first `$page` reader hashed a full copy and one
*     rendered after it hashed the referenced text — two fingerprints for one island.)
*
* The wire text itself is produced LAST, when the document tail renders (server/document-tail.ts):
* by then the request knows whether the seed ships, so `wire(seed)` serializes relative to it when
* a props subtree is a seed node (seed-refs.ts) and falls back to the canonical text otherwise.
* Every island on the page gets references, first island included — the old "islands before the
* first reader ship copies" limitation is gone with the render-time decision.
*
* devalue output is `<`-safe by construction (it writes `<`); the JSON lane goes through
* `escape_script_text` once. Neither is escaped a second time.
*
* Universal module (no Node imports): Region.svelte imports it on both legs; nothing here runs on
* the client.
*/
/** The sidecar attribute naming a non-devalue payload format; absent = devalue. */
var WIRE_FORMAT_ATTR = "data-og-format";
/** The one non-devalue format: plain JSON, read with `JSON.parse`. */
var WIRE_FORMAT_JSON = "json";
/** On a props sidecar: the transportable classes its props carry (tag paths, space-separated) —
*  what the browser loads before it decodes them. */
var WIRE_CLASSES_ATTR = "data-og-wire";
/** Island props cross classes, stores, snippets, og.$ fns and resumable deriveds. */
var PROP_FAMILIES$2 = /* @__PURE__ */ new Set([
	"wire",
	"store",
	"snippet",
	"fn",
	"derived"
]);
var kinds_registered = false;
function register_prop_kinds() {
	if (kinds_registered) return;
	kinds_registered = true;
	register_wire_kind$1();
	register_store_kind$1();
	register_snippet_kind$1();
	register_fn_kind$1();
	register_derived_kind$1();
}
/**
* devalue-serialize an island's props with the prop families' reducers, plus the seed-reference
* reducer when the caller has one. Throws a teaching error on a non-serializable prop.
*/
function stringify_props(value, entry, seed_refs = null, wire_out = null) {
	register_prop_kinds();
	try {
		const reducers = {};
		if (seed_refs) reducers[SEED_REF_KEY] = seed_refs;
		const minted = ref_reducer$1(PROP_FAMILIES$2);
		reducers[REF_WIRE_KEY$1] = wire_out ? (v) => {
			const ref = minted(v);
			if (ref && ref.k === "wire" && typeof ref.t === "string") {
				const hash = ref.t.lastIndexOf("#");
				wire_out.add(hash === -1 ? ref.t : ref.t.slice(0, hash));
			}
			return ref;
		} : minted;
		return stringify$1(value, reducers);
	} catch (e) {
		const detail = e instanceof Error ? e.message : String(e);
		throw new Error(`[ogygia] island "${entry}": a captured prop is not serializable — ${detail}. Captured host values cross the boundary via devalue; functions/Promises cannot, and a class instance only can when the class declares a static [ogygia.wire] codec. Pass a serializable value, add a codec, or move that logic inside the island component.`);
	}
}
/**
* Plan an island's sidecar: lane, canonical text, live snippet entries — and a `wire(seed)` that
* produces the final text once the request knows about the seed (the document tail's render).
* The wire text is produced once per seed: identical islands share one plan, and a tail rendered
* twice against the same index (a test, a re-render) plans and serializes once.
*/
function plan_props_wire(value, entry) {
	const shape = analyze$1(value);
	const refs = {
		count: 0,
		keys: []
	};
	const referenced = (seed) => {
		refs.count = 0;
		refs.keys = [];
		if (seed === null || seed.size === 0) return null;
		const plan = plan_seed_refs(seed, value);
		if (plan.count === 0) return null;
		refs.count = plan.count;
		refs.keys = [...plan.keys].sort();
		return {
			text: stringify_props(value, entry, plan.reducer),
			json: false
		};
	};
	let last_seed;
	let last_text;
	const once = (seed, plain) => {
		if (seed === last_seed) return last_text;
		last_seed = seed;
		return last_text = referenced(seed) ?? plain();
	};
	if (shape.json) {
		const canonical = JSON.stringify(value);
		let escaped = null;
		return {
			canonical,
			json: true,
			live_entries: [],
			wire_modules: [],
			wire: (seed) => once(seed, () => escaped ??= {
				text: escape_script_text(canonical),
				json: true
			}),
			refs,
			culprit: () => null
		};
	}
	const wire_modules = /* @__PURE__ */ new Set();
	const canonical = stringify_props(value, entry, null, wire_modules);
	const plain = {
		text: canonical,
		json: false
	};
	let culprit;
	return {
		canonical,
		json: false,
		live_entries: live_entries_in(canonical),
		wire_modules: [...wire_modules],
		wire: (seed) => once(seed, () => plain),
		refs,
		culprit: () => culprit === void 0 ? culprit = json_culprit(value) : culprit
	};
}
var LIVE_ENTRY_MARK = "/immutable/og-region.";
var LIVE_ENTRY_RE = /^\/[^"\s]+\/immutable\/og-region\.[0-9a-f]+\.js$/;
function live_entries_in(text) {
	const out = [];
	let at = text.indexOf(LIVE_ENTRY_MARK);
	while (at !== -1) {
		const start = text.lastIndexOf("\"", at) + 1;
		const end = text.indexOf("\"", at);
		if (end === -1) break;
		const url = text.slice(start, end);
		if (LIVE_ENTRY_RE.test(url) && !out.includes(url)) out.push(url);
		at = text.indexOf(LIVE_ENTRY_MARK, end);
	}
	return out;
}
/**
* The sidecar `<script>` for one island: keyed by fingerprint when it has one (`data-ogygia-props`
* for the reconciler; in the TAIL also `id`, for an O(1) `getElementById` lookup by the runtime),
* unkeyed otherwise; the format attribute names the JSON lane.
*/
function props_sidecar(fp, w, place = "adjacent", wire_modules = []) {
	return "<script type=\"application/ogygia-props\" data-ogygia-props" + (fp ? `="${fp}"` + (place === "tail" ? ` id="og-props-${fp}"` : "") : "") + (w.json ? ` ${WIRE_FORMAT_ATTR}="${WIRE_FORMAT_JSON}"` : "") + (wire_modules.length ? ` ${WIRE_CLASSES_ATTR}="${wire_modules.join(" ").replaceAll("\"", "&quot;")}"` : "") + ">" + w.text + "<\/script>";
}
// ../../../core/src/server/document-tail.ts
/** The island facts a region hands over with its plan, for the profiler's Islands table. */
/** A short, safe preview of a hole's props for the profiler (`{"forProduct":"P1"}`), so two holes
*  of one component read apart; empty for no props, truncated past 80 chars. */
function props_preview(props, max = 80) {
	if (!props || typeof props !== "object") return "";
	try {
		const s = JSON.stringify(props, (_k, v) => typeof v === "bigint" ? String(v) : v);
		if (!s || s === "{}" || s === "[]") return "";
		return s.length > max ? s.slice(0, max - 1) + "…" : s;
	} catch {
		return "";
	}
}
/**
* THE module-preload hint for one island chunk. EVERY hint is `fetchpriority="low"`: a hint's job
* is discovery (no parse-then-import waterfall), not priority — nothing an island downloads is
* needed for first paint, the server painted the content — so island code must never outrank the
* CSS and the LCP image (Region.svelte has the measured story). Regions hand the tail hrefs, not
* tags: one string per hint, built once here, never parsed back out of markup.
*/
function modulepreload_tag(href) {
	return "<link rel=\"modulepreload\" href=\"" + href + "\" fetchpriority=\"low\">";
}
/**
* The runtime bootstrap: its module script, then a `modulepreload` for each of its static imports
* (the build's handoff — the few chunks the runtime shares with the rest of the app, e.g. Vite's
* preload helper and the modules Kit's client transport also uses). The browser only discovers a
* module's imports after downloading and parsing it; hinted here, they download ALONGSIDE the
* runtime instead of one round trip after it. Normal priority — the runtime cannot run without
* them. `data-ogygia-runtime-dep` keeps them attached to the script when the handle moves it
* (head-presence.ts `runtime_first`).
*/
function runtime_bootstrap_tags(src, deps) {
	let html = "<script type=\"module\" data-ogygia-runtime src=\"" + src + "\"><\/script>";
	for (const dep of deps) html += "<link rel=\"modulepreload\" href=\"" + dep + "\" data-ogygia-runtime-dep>";
	return html;
}
/**
* The island graph (island-graph.ts) as one inert JSON script: entry → the chunks its code needs.
* The runtime turns an entry's list into modulepreload links when that island wakes. Empty map →
* no script.
*/
function island_graph_script(graph, locations) {
	if (graph.size === 0 && !locations?.size) return "";
	return "<script type=\"application/json\" " + ISLAND_GRAPH_ATTR + ">" + escape_script_text(encode_island_graph(graph, locations ?? void 0)) + "<\/script>";
}
/** The holes record (`hole()`), read by runtime/hole-facts.ts. */
var HOLES_SCRIPT_OPEN = `<script type="${HOLES_SCRIPT_TYPE}" data-ogygia-holes>`;
var HOLES_SCRIPT_CLOSE = "<\/script>";
var DocumentTail = class {
	#hints = /* @__PURE__ */ new Set();
	#graph = /* @__PURE__ */ new Map();
	/** entry identity → location, for entries no element carries (a portable snippet's live entry) */
	#locations = /* @__PURE__ */ new Map();
	#props = /* @__PURE__ */ new Map();
	#holes = /* @__PURE__ */ new Map();
	#hole_notes = /* @__PURE__ */ new Map();
	/** per-fingerprint facts of the last `render()` (the profiler's Islands table) */
	#island_rows = null;
	/** Add a region's module-preload hrefs; each href is hinted once (first wins). With `fp`, the
	*  hrefs are also remembered as that island's JS closure. */
	hints(hrefs, fp) {
		for (const href of hrefs) this.#hints.add(href);
		if (fp) {
			const s = this.#props.get(fp);
			if (s && s.hints.length === 0) s.hints = [...hrefs];
		}
	}
	/** The list already recorded for an entry, if any — a second instance of an island reuses it. */
	graph_of(entry) {
		return this.#graph.get(entry);
	}
	/** Record the chunks an island entry's code needs (the island graph — data, not hints: the
	*  runtime preloads them when the island wakes). One list per entry — its identity — (first wins).
	*  With `fp`, the list is also remembered as that island's JS closure for the profiler, led by the
	*  file the island actually loads: `src`, its location (the identity when it has none). */
	graph(entry, hrefs, fp, src) {
		if (!this.#graph.has(entry)) this.#graph.set(entry, hrefs);
		if (fp) {
			const s = this.#props.get(fp);
			if (s && s.hints.length === 0) s.hints = [src || entry, ...hrefs];
		}
	}
	/** Record where an entry no element carries is served from (the graph script's `s`). */
	locate(identity, src) {
		if (!this.#locations.has(identity)) this.#locations.set(identity, src);
	}
	/** Register an island's props sidecar under its fingerprint; identical islands share one (the
	*  count still says how many). `meta` is what the profiler's Islands table shows. */
	props(fp, wire, meta = null) {
		const have = this.#props.get(fp);
		if (have) have.count++;
		else this.#props.set(fp, {
			wire,
			meta,
			count: 1,
			hints: []
		});
	}
	/** Note a deferred hole the page rendered (every document, not only Kit-hydrated ones): its
	*  schedule and cache policy, for the profiler's hole economics. */
	note_hole(id, when, hydrate, ttl, name = "", props = void 0, copy = "") {
		const key = `${id}\0${when}\0${hydrate ?? ""}\0${ttl}`;
		let have = this.#hole_notes.get(key);
		if (have) have.count++;
		else this.#hole_notes.set(key, have = {
			id,
			name,
			props: props_preview(props),
			when,
			hydrate,
			ttl,
			count: 1
		});
		if (copy && (have.copies?.length ?? 0) < 12 && !have.copies?.some((c) => c.p === copy)) (have.copies ??= []).push({
			p: copy,
			props: have.count === 1 ? have.props : props_preview(props)
		});
	}
	/** The holes noted on this page. */
	hole_rows() {
		return [...this.#hole_notes.values()];
	}
	/** The per-island facts of the last `render()` — `null` before it ran. */
	island_rows() {
		return this.#island_rows;
	}
	/**
	* Record a deferred hole's server-minted facts under its identity (`data-og-hole`), for a
	* KIT-HYDRATED document only. Kit can give up hydrating such a document (a component threw, the
	* markup mismatched): Svelte clears Kit's root and mounts it fresh, and every hole is rendered
	* again by the client leg — with no address, since only the server can mint one. The tail sits
	* OUTSIDE Kit's root, so this record survives that rebuild, and the runtime hands each rebuilt
	* hole its address (and a hydrating hole its props sidecar) back by identity — never by
	* position. Identical holes (same id + props → same identity) share one record.
	*/
	hole(identity, endpoint, sidecar) {
		if (identity && endpoint && !this.#holes.has(identity)) this.#holes.set(identity, {
			endpoint,
			sidecar
		});
	}
	get empty() {
		return this.#hints.size === 0 && this.#graph.size === 0 && this.#locations.size === 0 && this.#props.size === 0 && this.#holes.size === 0;
	}
	/** Hint count + graph entry count + sidecar count + hole-record count, for tests and devtools. */
	get size() {
		return {
			hints: this.#hints.size,
			graph: this.#graph.size,
			props: this.#props.size,
			holes: this.#holes.size
		};
	}
	/** The tail's HTML: hints, the island graph, then props (each rendered now, against `seed`), then
	*  the holes record (one script, JSON, `<`-escaped). Empty string when nothing was recorded. With
	*  `detail`, the per-island rows (bytes, lane, references, the devalue culprit) are kept for
	*  the profiler — a little extra work, only while it records. */
	render(seed = null, detail = false) {
		let out = "";
		for (const href of this.#hints) out += modulepreload_tag(href);
		out += island_graph_script(this.#graph, this.#locations);
		const rows = detail ? [] : null;
		for (const [fp, s] of this.#props) {
			const w = s.wire.wire(seed);
			out += props_sidecar(fp, w, "tail", s.wire.wire_modules);
			if (rows) rows.push({
				fp,
				entry: s.meta?.entry ?? "",
				name: s.meta?.name ?? "",
				module_url: s.meta?.module_url ?? "",
				wake: s.meta?.wake ?? "",
				props_bytes: w.text.length,
				canonical_bytes: s.wire.canonical?.length ?? w.text.length,
				...s.wire.canonical !== void 0 && s.wire.canonical.length <= 4096 ? { canonical: s.wire.canonical } : {},
				json: w.json,
				culprit: w.json ? null : s.wire.culprit?.() ?? null,
				refs: s.wire.refs?.count ?? 0,
				ref_keys: [...s.wire.refs?.keys ?? []],
				hints: s.hints,
				interactivity: s.meta?.interactivity ?? null,
				count: s.count
			});
		}
		this.#island_rows = rows;
		if (this.#holes.size) {
			const record = {};
			for (const [identity, facts] of this.#holes) record[identity] = facts;
			out += HOLES_SCRIPT_OPEN + escape_script_text(JSON.stringify(record)) + HOLES_SCRIPT_CLOSE;
		}
		return out;
	}
};
var reader = null;
/** Server (`hooks.ts`) installs a request-scoped reader; `null` uninstalls. */
function set_tail_reader(fn) {
	reader = fn;
}
/** The current request's tail, or `null` when this render has none (client, endpoint, test). */
function document_tail() {
	return reader ? reader() : null;
}
// ../../../core/src/server/entry-location.ts
/**
* ENTRY IDENTITY → LOCATION, on the server. A hydrate island's entry and the runtime each have an
* IDENTITY — the stable URL the compiler bakes (`/<appDir>/immutable/og-region.<iid>.js`, the
* runtime's stable name) and every map keys by — and a LOCATION: the content-hashed file the build
* emitted, the one a browser loads. A stable name served `immutable` would be kept for a year after
* its content changed; a hashed name cannot go stale. The server bundle is built before the client
* bundle, so the location is looked up at render time through the build handoff (`entryLocation`).
*
* No location (the dev server, a handoff from before hashing, an island from another app): the
* identity itself is served — in a build, the stable-name shim that re-exports the current file.
*/
/** The file an entry is loaded from: its content-hashed location, else the identity itself. */
function entry_src(identity) {
	return identity && entryLocation(identity) || identity;
}
/**
* The runtime bootstrap for a document: the runtime's script (its location) and a preload per chunk
* it statically imports, so they download with it. `resolve` applies the base / assets prefix (Kit's
* `asset()`); a routeless document passes none. Empty when no runtime is built.
*/
function runtime_bootstrap(resolve = (url) => url) {
	return runtime_bootstrap_tags(resolve(entry_src(runtime_url_default)), islandDeps(runtime_url_default).map(resolve));
}
// ../../../core/dist/server/endpoint.js
/**
* THE ISLANDS ENDPOINT — one path for everything that names it: the handle answers on it, every
* capability is minted against it, a render knows it is serving a hole by it, the profiler counts
* its requests by it. `handle({ endpoint })` sets it as the app's hooks load, before any render
* (Kit loads the server hooks before it renders anything, prerender included). It used to move only
* the handler: pages still minted `/__ogygia__?…`, and behind a proxy that forwards only the app's
* own prefixes every hole was empty.
*
* Process-wide on `globalThis`, not module state: this file can load under two module ids in one
* server (the plugin points the mint at the package's built file while an app's hooks import it from
* a linked package's source), and a module variable set by the handle was then never read by the mint.
*/
var ENDPOINT_KEY = Symbol.for("ogygia.islands-endpoint");
var endpoint_slot = globalThis;
/** The islands endpoint path (without the app's base: matched by suffix, minted through `resolve`). */
function islands_endpoint() {
	return endpoint_slot[ENDPOINT_KEY] ?? "/__ogygia__";
}
/** Max b64url props blob accepted by the region handle (and refused at mint time). */
var MAX_REGION_PROPS_LEN = 8192;
/**
* Capability TTL for PRERENDERED pages (10 years — effectively the life of the deploy). A static
* file lives on the CDN indefinitely, so an aging capability would strand every hole on it after
* `ttl` (real PPR would silently die in an hour). Safe: the capability's props are already
* baked into the public static HTML, and the mint seals an EMPTY session at prerender — signing
* that same public tuple for longer reveals nothing new. Redeploy survival additionally needs a
* stable `OGYGIA_SECRET` (the default per-build key rotates; ServerIsland warns at build).
*/
var PRERENDER_REGION_TTL_SEC = 31536e4;
/**
* WHEN a capability minted now expires — aligned to a window, not `now + ttl`.
*
* Every render of the same hole (same id, props, session) in the same window mints the SAME
* `exp`, hence the SAME signature and URL: the hole's HTML is byte-identical across requests. That
* is what lets anything keyed on the page's bytes hit — a host app's post-render component cache,
* a CDN or freeze store comparing documents, an ETag. With `now + ttl` every request minted a new
* URL and a header block wrapping five holes was re-processed on every request (measured: seconds
* of server time per page on a Lambda-class host).
*
* The window is half the TTL: `exp` is the end of the window after the current one, so a
* capability is always valid for at least `ttl / 2` and at most `ttl` (harvested URLs still age
* out on the same order); consecutive windows overlap by construction, so a page rendered at the
* end of a window and fetched a moment later still verifies.
*/
function capability_expiry(now_sec, ttl_sec) {
	const half = Math.max(1, Math.floor(ttl_sec / 2));
	return (Math.floor(now_sec / half) + 2) * half;
}
/** Exactly `n` chars of `[0-9a-f]`. */
function is_lower_hex(s, n) {
	if (s.length !== n) return false;
	for (let i = 0; i < n; i++) {
		const c = s.charCodeAt(i);
		if (!(c >= 48 && c <= 57 || c >= 97 && c <= 102)) return false;
	}
	return true;
}
// ../../../core/dist/server/hmac.js
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
		if (typeof sig !== "string" || !is_lower_hex(sig, 64)) return false;
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
Hmac.verify.bind(Hmac);
var region_mac_message = Hmac.region_message.bind(Hmac);
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
// ../../../core/dist/ref.js
var REGISTRY_KEY$3 = Symbol.for("ogygia.hub");
function registry() {
	const g = globalThis;
	return g[REGISTRY_KEY$3] ??= {
		kinds: /* @__PURE__ */ new Map(),
		order: [],
		ids: /* @__PURE__ */ new WeakMap(),
		instances: /* @__PURE__ */ new Map([["page", /* @__PURE__ */ new Map()], ["session", /* @__PURE__ */ new Map()]]),
		instance_kind: /* @__PURE__ */ new WeakMap(),
		scope_disposers: /* @__PURE__ */ new Map(),
		keep_owner: /* @__PURE__ */ new Map()
	};
}
/** Register a kind. Idempotent by discriminator — a re-registration (second bundle evaluating
*  the same module) keeps the FIRST, so identity state never forks. */
function register_kind(kind) {
	const reg = registry();
	if (reg.kinds.has(kind.k)) return;
	reg.kinds.set(kind.k, kind);
	reg.order.push(kind);
}
function mint_id() {
	const c = globalThis.crypto;
	if (c?.randomUUID) return c.randomUUID();
	return "r" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
/**
* Mint: live value → Ref, or undefined to fall through to devalue's normal handling.
* `only` restricts the dispatch to named kinds — a seam may deliberately exclude a family
* (the drop-in context path excludes snippets so a stray function THROWS instead of being
* silently mis-read as one). Same instance → same id, always.
*/
function mint(value, only) {
	if (value === null || typeof value !== "object" && typeof value !== "function") return void 0;
	const reg = registry();
	for (const kind of reg.order) {
		if (only && !only.has(kind.k)) continue;
		if (!kind.match(value)) continue;
		const { t, d } = kind.encode(value);
		let i = reg.ids.get(value);
		if (i === void 0) {
			i = kind.stable_id?.(d) ?? mint_id();
			reg.ids.set(value, i);
		}
		const ref = {
			k: kind.k,
			i,
			d
		};
		if (t !== void 0) ref.t = t;
		return ref;
	}
}
/** Devalue custom-type name for hub refs on the wire (the ONE key every seam will converge on). */
var REF_WIRE_KEY = "OgygiaRef";
/** Devalue reducer for a seam. `only` deliberately restricts which families may cross there. */
function ref_reducer(only) {
	return (value) => mint(value, only);
}
// ../../../core/dist/server/kit-context.js
/**
* Kit's request context for ogygia's OWN server render roots.
*
* Kit's server `$app/state` answers `page.*` from `getContext('__request__').page` — a Svelte
* context Kit's page render sets on ITS root. Every `svelte/server` `render()` ogygia starts is a
* fresh root with no such context: the routeless document (`document()`), the inline island render
* (`region.ts`), the deferred-region endpoint, snippet bodies. A component reading `page.data`
* during SSR under any of them crashed with "reading 'page' of undefined". Every such root now
* passes `kit_render_context()`, which rebuilds Kit's shape from the per-request page snapshot
* (Region.svelte records it; the handle keeps it in the request bag) or, absent that, from the
* live request via the reader hooks.ts installs.
*
* Isomorphic and dependency-free by design: `region.ts` is in the client graph, so nothing here may
* import Kit's server internals. The reader rides ONE `globalThis` + `Symbol.for` slot — the
* PAGE-STATE-SINGLETON law (dist entries can double-evaluate a module).
*/
var KIT_REQUEST_CONTEXT = "__request__";
/** Kit's `$app/stores` server side reads `getContext('__svelte__')` — `{ page, navigating, updated }`
*  stores Kit's page render sets on ITS root (`render.js`). Same gap as `__request__`: a component
*  using the (deprecated, still everywhere) `$page` store crashed under every ogygia render root. */
var KIT_STORES_CONTEXT = "__svelte__";
var SLOT = Symbol.for("ogygia.kit-context");
var slots = globalThis[SLOT] ??= {
	reader: null,
	event_reader: null
};
/** A page no component can crash on: what a render outside any request sees (tests, tools). */
function empty_kit_page() {
	return {
		url: void 0,
		params: {},
		route: { id: null },
		status: 200,
		data: {},
		form: null,
		error: null,
		state: {}
	};
}
/** A frozen server-side store: the value is known for the whole render, nothing ever changes it
*  (Kit's own page render uses `writable`s it never writes after start). Hand-rolled so this
*  module stays dependency-free for the client graph. */
function frozen_store(value) {
	return { subscribe(fn) {
		fn(value);
		return () => {};
	} };
}
/** Kit's `__svelte__` context shape: what `getStores()` in `$app/stores` destructures. */
function kit_stores_context(page) {
	return {
		page: frozen_store(page),
		navigating: frozen_store(null),
		updated: {
			...frozen_store(false),
			check: async () => false
		}
	};
}
/** The `context` option for a `svelte/server` `render()` ogygia starts. An explicit `page` (the
*  document root, built from the router's seed) wins; else the request reader; else empty. Both
*  of Kit's contexts ride along: `__request__` for `$app/state`, `__svelte__` for `$app/stores`.
*  The `__request__` entry also carries the live `event` (Kit's own render sets `{ page }` only)
*  — the channel `requestEvent()` reads, so a server island can see its request without importing
*  `$app/server` (which Kit's client guard rejects the moment a csr=true page shares the layout). */
function kit_render_context(page, event) {
	const resolved = slots.reader?.() ?? empty_kit_page();
	const live = slots.event_reader?.() ?? null;
	return /* @__PURE__ */ new Map([[KIT_REQUEST_CONTEXT, {
		page: resolved,
		event: live
	}], [KIT_STORES_CONTEXT, kit_stores_context(resolved)]]);
}
// ../../../core/dist/runtime/hash.js
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
// ../../../core/dist/seed-refs.js
/** A node the codec may reference: a plain object or an array (own prototype only). */
function is_plain(v) {
	if (v === null || typeof v !== "object") return false;
	if (Array.isArray(v)) return true;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}
var is_thenable = (v) => typeof v?.then === "function";
var F_REF = 1;
var F_JSON = 2;
var F_THENABLE = 4;
var P_OPAQUE = 0;
var P_THENABLE = F_THENABLE;
var P_NULLISH_JSON = 35;
var P_UNDEFINED = 33;
var P_NUMBER = 67;
var P_NUMBER_NOJSON = 65;
var P_BIGINT = 65;
var P_DATE = 193;
/** The memo mark of a node whose walk has not finished: meeting it again is a cycle. */
var IN_PROGRESS = -1;
var bytes_of = (p) => (p - (p & 7)) / 8;
function unpack(p) {
	return {
		bytes: bytes_of(p),
		ref: (p & F_REF) !== 0,
		json: (p & F_JSON) !== 0,
		thenable: (p & F_THENABLE) !== 0
	};
}
/**
* The one walk: measure a value (post-order, memoised per plain node in `memo`). Every child is
* measured even after one disqualifies the parent: a clean sibling deeper in the tree must still
* get its own entry (the index walk reads the memo). Strings never enter the memo. A node already
* in the memo — from this root or from any other root measured with the same memo — is a lookup.
*/
function measure(v, memo) {
	switch (typeof v) {
		case "string": return (v.length + 2) * 8 + F_REF + F_JSON;
		case "number": return Number.isFinite(v) && !Object.is(v, -0) ? P_NUMBER : P_NUMBER_NOJSON;
		case "boolean": return P_NULLISH_JSON;
		case "undefined": return P_UNDEFINED;
		case "bigint": return P_BIGINT;
		case "object": break;
		default: return P_OPAQUE;
	}
	if (v === null) return P_NULLISH_JSON;
	if (v instanceof Date) return P_DATE;
	if (!is_plain(v)) return is_thenable(v) ? P_THENABLE : P_OPAQUE;
	const cached = memo.get(v);
	if (cached !== void 0) return cached === IN_PROGRESS ? P_OPAQUE : cached;
	if (!Array.isArray(v) && Object.getOwnPropertySymbols(v).length > 0) {
		memo.set(v, P_OPAQUE);
		return P_OPAQUE;
	}
	let bytes = 0;
	let lanes = 3;
	let thenable = 0;
	let marked = false;
	if (Array.isArray(v)) for (let i = 0; i < v.length; i++) {
		const c = v[i];
		if (typeof c === "string") {
			bytes += c.length + 3;
			continue;
		}
		if (!marked && typeof c === "object" && c !== null) {
			memo.set(v, IN_PROGRESS);
			marked = true;
		}
		const p = measure(c, memo);
		bytes += bytes_of(p) + 1;
		lanes &= p;
		thenable |= p & F_THENABLE;
	}
	else for (const key in v) {
		const c = v[key];
		if (typeof c === "string") {
			bytes += c.length + key.length + 5;
			continue;
		}
		if (c === void 0) {
			bytes += key.length + 4;
			continue;
		}
		if (!marked && typeof c === "object" && c !== null) {
			memo.set(v, IN_PROGRESS);
			marked = true;
		}
		const p = measure(c, memo);
		bytes += bytes_of(p) + key.length + 3;
		lanes &= p;
		thenable |= p & F_THENABLE;
	}
	const result = bytes * 8 + (lanes & 3) + thenable;
	memo.set(v, result);
	return result;
}
var analysis_cache = /* @__PURE__ */ new WeakMap();
/** The walk, cached per plain root object: the seed's `page.data` is measured once per request
*  however many islands, lanes and decisions ask; a props object once per island — and against
*  the request's shared memo, so a props object that is a seed node costs a lookup. */
function analysis(value) {
	if (!is_plain(value)) {
		const memo = /* @__PURE__ */ new Map();
		return {
			root: unpack(measure(value, memo)),
			memo
		};
	}
	const hit = analysis_cache.get(value);
	if (hit) return hit;
	const memo = /* @__PURE__ */ new Map();
	const a = {
		root: unpack(measure(value, memo)),
		memo
	};
	analysis_cache.set(value, a);
	return a;
}
/** What one walk says about a value (see {@link Measure}). */
function analyze(value) {
	return analysis(value).root;
}
// ../../../core/dist/runtime/entry-locations.js
/**
* ENTRY IDENTITY → LOCATION, the browser's half (server/entry-location.ts is the server's).
*
* An island's `entry` is its IDENTITY: the stable URL every key uses (the island graph, the
* fingerprint, the devtools' names). The file to import is its LOCATION — content-hashed, so an
* `immutable` cache never serves a stale one. The server writes it beside the identity: the region
* element's `src`, and the island graph's `s` map for an entry no element carries (a portable
* snippet's). Every loader resolves through `island_module_url` (region-endpoint-url.ts), which asks
* here first: the location once one is known, else the identity (the dev server, or a page from
* before hashing — whose stable name is a shim that reaches the current build).
*/
/** absolute identity → absolute location */
var locations = /* @__PURE__ */ new Map();
var fallback_reporter = null;
/** Resolved URLs by base + url: every wake, warm and graph read asks again for the same few
*  entries, and each ask was a `new URL()` parse (bounded: cleared past a few thousand). */
var resolved_urls = /* @__PURE__ */ new Map();
function absolute(url, base) {
	const b = location.href;
	const key = b + "\n" + url;
	const hit = resolved_urls.get(key);
	if (hit !== void 0) return hit;
	let out;
	try {
		out = new URL(url, b).href;
	} catch {
		out = url;
	}
	if (resolved_urls.size > 4e3) resolved_urls.clear();
	resolved_urls.set(key, out);
	return out;
}
/** The known location of an entry, or undefined. */
function entry_location(entry, base) {
	return locations.size ? locations.get(absolute(entry)) : void 0;
}
/**
* The identity itself, past every cache: what a load falls back to when its location failed (a page
* a cache kept outlived the build that made it, and that build's files are gone). The stable name
* is a shim of the CURRENT build's file; the query makes the browser fetch it fresh rather than the
* copy an `immutable` cache may hold. Null when no location was known (nothing to fall back to).
*/
function fresh_identity_url(entry, base) {
	if (!entry_location(entry)) return null;
	const identity = absolute(entry);
	return identity + (identity.includes("?") ? "&" : "?") + "og-fresh=" + Date.now().toString(36);
}
/**
* Import an entry: its location when known, else `url` (what the caller resolved for the identity);
* the location failing, once, the identity fetched fresh — so an island on a page that outlived its
* build still wakes, on the current code. No location known → the error stands.
*/
function import_entry(entry, url = entry_location(entry) ?? entry) {
	const loaded = import(
		/* @vite-ignore */
		url
);
	const fresh = fresh_identity_url(entry);
	if (!fresh) return loaded;
	return loaded.catch(() => {
		const retry = import(
			/* @vite-ignore */
			fresh
);
		const report = (recovered) => fallback_reporter?.({
			entry,
			src: url,
			recovered
		});
		retry.then(() => report(true), () => report(false));
		return retry;
	});
}
// ../../../core/dist/region-snippet.js
/**
* Region snippets — the snippet shape of a region. "Everything that crosses an island boundary is a
* region; components and snippets are its two shapes; static freezes, live wakes."
*
* A snippet handed to a component is a function, so it can't cross an island boundary directly (devalue
* can't stringify a function). A region snippet is a real Svelte snippet — same-graph `{@render}`
* renders it inline — that also carries a serializable DESCRIPTOR and knows how to REVIVE on the far
* side. One primitive, two modes:
*
*  - **live** — the compiler, at a snippet's DEFINITION site, compiles its body into an island ENTRY
*    and constructs a live region snippet (`{ m:'live', e, p }`). It renders the entry inline on the
*    server and HYDRATES it on the client, so the markup comes alive. This is the former "portable
*    snippet" path, unchanged in behavior, now expressed as the live mode of this one primitive.
*  - **static** — a PLAIN snippet reaching a boundary is FROZEN to its server-rendered HTML
*    (`{ m:'static', h }`). The client adopts that HTML byte-for-byte; nothing re-runs. No compiler
*    involvement, so it survives wrappers, re-exports, and a consumer swapping in their own component.
*    Correct for markdown content (prose, code): static, never reactive.
*
* The boundary law lives in ONE place — {@link reduce_region_snippet}: a branded region snippet crosses
* as its descriptor; a bare snippet is captured static; a parameterized snippet that can't be frozen
* throws, loudly. Revival is its single inverse, {@link revive_region_snippet}. `createRawSnippet` is
* isomorphic (server calls `render`, client calls `setup`), so one factory serves both legs of both
* modes with no manual environment branch.
*/
/**
* A hand-written SERVER component that renders a bare snippet: svelte has no public API to
* stringify a snippet, but a server component is just `($$renderer, $$props) => void` and a server
* snippet is `($$renderer) => void` — so the component simply invokes the snippet. Hand-written
* (not a `.svelte` file) so this module stays importable from plain node (endpoints, tests)
* without a svelte compiler in the loader.
*/
var RenderSnippet = (($$renderer, $$props) => {
	$$props.s($$renderer);
});
var WRAP_OPEN = "<ogygia-snippet style=\"display:contents\">";
var WRAP_CLOSE = "</ogygia-snippet>";
var STATIC_OPEN = "<ogygia-snippet data-og-static style=\"display:contents\">";
var host_context = () => {
	try {
		return getAllContexts();
	} catch {
		return null;
	}
};
/** context.ts `isInLiveSnippet` reads it: a hole in the body stays deferred (Region.svelte). */
var LIVE_SNIPPET_KEY$1 = Symbol.for("ogygia.live-snippet");
var with_host = (context, host) => {
	if (host) for (const [k, v] of host) context.set(k, v);
	context.set(LIVE_SNIPPET_KEY$1, true);
	return context;
};
/** Where a live snippet's pending hydrate waits on its host region: a global key, as the runtime
*  bundle and each island-entry bundle carry their own copy of this module (runtime/core.ts reads it). */
var SNIPPET_BOOTS = Symbol.for("ogygia.snippet-boots");
/** The host region is awake only once its snippets are: it signals `data-hydrated` after them. */
function hold_host(el, booted) {
	const host = el.closest("ogygia-region");
	if (host && !host.hasAttribute("data-hydrated")) (host[SNIPPET_BOOTS] ??= []).push(booted);
}
/**
* The ONE factory. Build a region snippet from its descriptor (+ the live entry when we're at its
* definition site and it's in the same bundle). Handles both modes and both legs.
*/
function make(desc, live_entry = null) {
	if (desc.m === "slot") {
		const h = slot_marker_open(desc.id) + SLOT_MARKER_CLOSE;
		const slot_snip = createRawSnippet(() => ({
			render: () => h,
			setup: () => {}
		}));
		slot_snip.__ogRegion = desc;
		return slot_snip;
	}
	if (desc.m === "live") {
		const thread_head = (r, head) => {
			if (head && typeof r.head === "function") r.head((child) => child.push(head));
		};
		const dev_css_link = "";
		const server_snip = ((renderer, ...args) => {
			const props = args.length ? {
				...desc.p,
				__ogArgs: args
			} : desc.p;
			const host = host_context();
			if (!!live_entry && renderer?.global?.mode === "async" && typeof renderer.child === "function") renderer.child(async (r) => {
				const out = await render(live_entry, {
					props,
					context: with_host(kit_render_context(), host)
				});
				thread_head(r, (out.head || "") + dev_css_link);
				r.push(WRAP_OPEN + out.body + WRAP_CLOSE);
			});
			else {
				const out = live_entry ? render(live_entry, {
					props,
					context: with_host(kit_render_context(), host)
				}) : {
					head: "",
					body: ""
				};
				thread_head(renderer, (out.head || "") + dev_css_link);
				renderer.push(WRAP_OPEN + out.body + WRAP_CLOSE);
			}
		});
		server_snip.__ogRegion = desc;
		return server_snip;
	}
	const snip = createRawSnippet((...params) => {
		const host = host_context();
		const live_props = () => desc.m === "live" ? params.length ? {
			...desc.p,
			__ogArgs: params.map((g) => g())
		} : desc.p : {};
		return {
			render: () => {
				if (desc.m === "static") return STATIC_OPEN + desc.h + WRAP_CLOSE;
				return WRAP_OPEN + (!live_entry ? "" : render(live_entry, {
					props: live_props(),
					context: with_host(kit_render_context(), host)
				}).body) + WRAP_CLOSE;
			},
			setup: (el) => {
				if (desc.m === "static") return;
				let app;
				let dead = false;
				const boot = (Comp) => {
					if (!dead) app = hydrate(Comp, {
						props: live_props(),
						context: with_host(/* @__PURE__ */ new Map(), host)
					});
				};
				if (live_entry) boot(live_entry);
				else hold_host(el, import_entry(desc.e).then((m) => boot(m.default)));
				return () => {
					dead = true;
					if (app) unmount();
				};
			}
		};
	});
	snip.__ogRegion = desc;
	return snip;
}
/** Freeze a plain snippet to a static region snippet by SSR-rendering it once (SERVER only). A snippet
*  that needs parameters can't be frozen — surface that as the actionable boundary error. `label` names
*  the island prop when known, so a plain function passed by mistake points at the right prop. */
function capture_static(snippet, label) {
	let body;
	try {
		body = render(RenderSnippet, {
			props: { s: snippet },
			context: kit_render_context()
		}).body;
	} catch (e) {
		const where = "a function prop";
		throw new Error(`[ogygia] ${where} is a function that can't cross the island boundary — ${e instanceof Error ? e.message : String(e)}. Island props must be SERIALIZABLE; a function crosses only as a Svelte snippet that freezes to HTML, and this one didn't. Usually one of:\n  • it's a PLAIN function (an event handler / callback) — those can't cross into an island; pass serializable data as props and keep the behavior inside the island component;\n  • it's a snippet WITH PARAMETERS — declare it as a {#snippet} so it crosses LIVE, or pass its data as props;\n  • it's children containing a NESTED island — keep those out of frozen children for now.`);
	}
	return make({
		m: "static",
		h: body
	});
}
/** The SSR marker that fences an island's in-place children so the client can adopt exactly that range.
*  `display:contents` keeps it layout-neutral. */
function slot_marker_open(id) {
	return `<ogygia-slot data-og-slot="${id}" style="display:contents">`;
}
var SLOT_MARKER_CLOSE = "</ogygia-slot>";
/** The hub kind: a snippet is a renderable Ref ("a snippet is a region", now literal). A branded
*  region snippet crosses as its descriptor; a bare snippet FREEZES at the boundary (server-only —
*  the BROWSER guard also keeps `capture_static` → `svelte/server` DCE-able out of client bundles);
*  a bare function on the CLIENT falls through (never claimed — it can't freeze there). */
/** Explicit registration — called at module scope AND from live-transport's install():
*  a bare side-effect import gets tree-shaken (the package marks JS side-effect-free),
*  which silently un-registers the kind in client bundles. A CALLED import cannot be dropped. */
function register_snippet_kind() {
	register_kind({
		k: "snippet",
		match(value) {
			if (typeof value !== "function") return false;
			if (value.__ogRegion) return true;
			if (value[Symbol.for("ogygia.fn")] !== void 0) return false;
			return true;
		},
		encode(value) {
			const branded = value.__ogRegion;
			if (branded) return { d: branded };
			return { d: capture_static(value).__ogRegion };
		},
		decode(ref) {
			return make(ref.d);
		},
		stable_id: snippet_stable_id
	});
}
/**
* A snippet's ref id from its descriptor: decode reads only `d` and a revived snippet holds no state,
* so equal descriptors are the same snippet — and a render names it the same every time (a random id
* here changed the fingerprint and the bytes of every island with children, on every request).
*  - `slot`: its slot id, already page-unique and stable (next_slot_id);
*  - `static`: a hash of its frozen HTML;
*  - `live`: a hash of its entry and props — only when the props are JSON-exact (seed-refs `analyze`,
*    the JSON lane's own rule): `JSON.stringify` turns a Map, a Set, a Date or a class instance into
*    something that two different values share, and those must not share a revived snippet.
*    Anything else keeps a random id.
*/
function snippet_stable_id(d) {
	const desc = d;
	if (desc.m === "slot") return "slot:" + desc.id;
	if (desc.m === "static") return "s" + fnv1a(desc.h);
	if (desc.m === "live" && analyze(desc.p).json) return "l" + fnv1a(desc.e + "\0" + JSON.stringify(desc.p));
}
// ../../../core/dist/store-transport.js
/**
* Transportable stores — the hub's STORE kind.
*
* A Svelte store is a live object (closure + methods), so devalue rejects it and a
* `setContext('cart', store)` silently died at the island boundary. This kind lets a
* subscribe-shaped value cross the same way `[import.meta.og.wire]` classes do: the CURRENT
* VALUE travels as data, the CODE comes from a module on the other side, and hub identity
* makes it live — every encode of one store mints ONE id, and the browser resolves by id,
* so five islands reading the same context key share one client store. `set` in island A
* repaints `$store` in island B.
*
* Two tiers:
*  - REGISTERED FACTORY (`__register_store_factory(tag, factory)`): decode calls
*    `factory(seed)` from the registered module, so custom methods (`add`, `reset`,
*    `useLocalStorage`, …) are REBUILT, not serialized. A store is branded with its factory
*    tag via `mark_store` (hand-written today, compiler-emitted later).
*  - GENERIC (`svelte:writable`): any unbranded subscribe-shaped value. Decode is a plain
*    `writable(seed)` — value + set/update/subscribe survive; bespoke methods do not (the
*    boundary classifier warns, naming them).
*
* Identity, reunification, per-request server isolation: the hub's (see ref.ts).
*/
/** Brand on an `og_derived` store: the RECIPE (sources + formula) it was made from. */
var DERIVED_BRAND = Symbol.for("ogygia.derived");
/** Generic tag: decode with a bare `writable(seed)`. */
var GENERIC_TAG = "svelte:writable";
/** Brand carrying a factory tag on a store object (non-enumerable, set by `mark_store`). */
var STORE_TAG = Symbol.for("ogygia.store.tag");
var REGISTRY_KEY$2 = Symbol.for("ogygia.stores");
function store_registry() {
	const g = globalThis;
	return g[REGISTRY_KEY$2] ??= { factories: /* @__PURE__ */ new Map() };
}
/** Subscribe-shaped, NOT a `[ogygia.wire]` class instance (wire kind), and NOT an `og_derived`
*  (the derived kind carries its recipe — the store kind would freeze it to a seed). */
function is_store(value) {
	if (value === null || typeof value !== "object") return false;
	if (typeof value.subscribe !== "function") return false;
	if (value[DERIVED_BRAND] !== void 0) return false;
	const cls = value.constructor;
	if (typeof cls === "function" && cls[wire]) return false;
	return true;
}
/** For warnings: `null` is an object to typeof, and the distinction matters at this seam. */
var type_of = (v) => v === null ? "null" : typeof v;
/** The hub kind: subscribe-shaped values. The moment of crossing is the value snapshot. */
function register_store_kind() {
	register_kind({
		k: "store",
		match: is_store,
		encode(value) {
			return {
				t: value[STORE_TAG] ?? GENERIC_TAG,
				d: get(value)
			};
		},
		decode(ref) {
			const t = ref.t ?? GENERIC_TAG;
			const factory = t === GENERIC_TAG ? void 0 : store_registry().factories.get(t);
			if (t !== GENERIC_TAG && factory === void 0) {
				if (typeof console !== "undefined") console.warn(`[ogygia] store "${t}": factory not loaded in this bundle — degraded to a plain writable (custom methods unavailable). Import the factory's module in the island (or its graph) so \`__register_store_factory\` runs there.`);
				return writable(ref.d);
			}
			const built = factory ? factory(ref.d) : writable(ref.d);
			if (built === null || typeof built !== "object") {
				if (typeof console !== "undefined") console.warn(`[ogygia] store "${t}": factory returned ${type_of(built)} while rebuilding — degraded to a plain writable (custom methods unavailable). A store factory must return a store on every call; move environment guards inside the factory body.`);
				return writable(ref.d);
			}
			return built;
		}
	});
}
/**
* A `derived` that CROSSES boundaries ALIVE — resumability for the reactive graph.
*
* Svelte's `derived` is a live computation: sources + a formula. The value can serialize; the
* computation can't — so a plain derived crosses as a FROZEN seed (the classifier warns). This
* primitive remembers its RECIPE, and the recipe is made of exactly the two things the seam
* already carries: sources are STORES (they reunify to one live instance per island page) and
* the formula is a FUNCTION (mark it with `import.meta.og.$` so it travels as a fn ref).
*
* ```ts
* const doubled = og_derived(tally, import.meta.og.$((n) => n * 2));
* ```
*
* Locally it IS `svelte/store`'s derived — same laziness, same semantics. At a boundary the
* derived kind ships `{ sources, formula, seed }`; the island decodes by re-deriving against
* the REUNIFIED sources with the REBOUND formula: bump the source in any island and every
* island's derived follows. The seed rides along only for exactness of the first paint.
*
* An UNMARKED formula still works same-tree, but the derived then can't cross (the fn ref
* can't be built) — the boundary explains this at the seam rather than freezing silently.
*/
function og_derived(sources, fn, initial) {
	const single = !Array.isArray(sources);
	const store = derived$1(sources, fn, initial);
	Object.defineProperty(store, DERIVED_BRAND, {
		value: {
			s: single ? [sources] : sources,
			f: fn,
			single
		},
		enumerable: false
	});
	return store;
}
/** The hub kind: an `og_derived` recipe. Sources and formula are shipped as NESTED refs (devalue
*  recursion runs the reducer over `d`'s contents), so by decode time they are already LIVE —
*  sources reunified, formula rebound — and re-deriving is one call. */
function register_derived_kind() {
	register_kind({
		k: "derived",
		match(value) {
			return value !== null && typeof value === "object" && value[DERIVED_BRAND] !== void 0;
		},
		encode(value) {
			const r = value[DERIVED_BRAND];
			return { d: {
				s: r.s,
				f: r.f,
				single: r.single,
				seed: get(value)
			} };
		},
		decode(ref) {
			const d = ref.d;
			if (typeof d.f !== "function") throw new Error("[ogygia] cannot resume og_derived: its formula did not cross — mark it with import.meta.og.$ at the og_derived call site so it travels as a fn ref.");
			return og_derived(d.single ? d.s[0] : d.s, d.f, d.seed);
		}
	});
}
// ../../../core/dist/fn-transport.js
/**
* Transportable functions — the hub's FN kind (the runtime half of `import.meta.og.$`).
*
* A closure can never serialize — there is no runtime API for a function's captured scope.
* What CAN cross is a QRL-style handle: WHERE the code lives (a build tag) plus WHAT it
* closed over (bound captures, as data). The compiler half (a later phase) hoists a marked
* closure to a generated module at build time:
*
* ```ts
* // source:                         setContext('fmt', import.meta.og.$((n) => `${n * rate}`));
* // generated module (tagged):      export const $0 = (rate) => (n) => `${n * rate}`;
* //                                 __register_fn('routes/+layout#$0', $0);
* // call site rewrites to:          setContext('fmt', fn_handle('routes/+layout#$0', [rate]));
* ```
*
* This module is the machinery both halves share: the factory registry, the branded live
* handle (`fn_handle` — callable on the SERVER leg too, where the factory module is loaded),
* and the kind. Decode = look the tag up, `factory(...bound)` → the live closure. Captures
* are themselves refs-or-data, so a bound capture may be a store/wire instance that reunites.
*
* IDENTITY: functions are deliberately NEVER memoized by the hub (`resolve` only remembers
* objects). Each consumer rebinds its own closure — stateless until called, exactly like
* snippets. Anything stateful a function closes over should be a store/wire capture, which
* DOES reunite; then every rebound copy sees the same live state.
*/
/** Brand on a live handle: carries `{ t, d }` so encode is a field read, not an analysis. */
var FN_BRAND = Symbol.for("ogygia.fn");
var REGISTRY_KEY$1 = Symbol.for("ogygia.fns");
function fn_registry() {
	const g = globalThis;
	return g[REGISTRY_KEY$1] ??= { factories: /* @__PURE__ */ new Map() };
}
/** The hub kind: a branded hoisted function. Bare functions are NEVER claimed (the snippet kind
*  owns SSR-freezable snippets; an unmarked function at a boundary must keep failing loudly). */
function register_fn_kind() {
	register_kind({
		k: "fn",
		match(value) {
			return typeof value === "function" && value[FN_BRAND] !== void 0;
		},
		encode(value) {
			const brand = value[FN_BRAND];
			return {
				t: brand.t,
				d: {
					b: brand.d,
					...brand.s ? { s: brand.s } : {}
				}
			};
		},
		decode(ref) {
			const payload = ref.d ?? {};
			let factory = fn_registry().factories.get(ref.t);
			if (factory === void 0) {
				const from_page = globalThis.__OG_FNM?.[ref.t];
				if (typeof from_page === "function") {
					factory = from_page;
					fn_registry().factories.set(ref.t, factory);
				}
			}
			if (factory === void 0 && typeof payload.s === "string") {
				factory = (0, eval)(`(${payload.s})`);
				fn_registry().factories.set(ref.t, factory);
			}
			if (factory === void 0) throw new Error(`[ogygia] cannot revive fn "${ref.t}": its factory is not loaded on this side and the payload carries no source. The island must import the generated module as a VALUE so \`__register_fn\` runs in its bundle (or the fn manifest must be in the runtime).`);
			const bound = Array.isArray(payload.b) ? payload.b : [];
			const live = factory(...bound);
			live[FN_BRAND] = {
				t: ref.t,
				d: bound,
				...payload.s ? { s: payload.s } : {}
			};
			return live;
		}
	});
}
// ../../../core/dist/live-transport.js
/** Reserved key for the static codec — what `import.meta.og.wire` rewrites to. `Symbol.for` so it's
*  identical across every bundle. Internal: the public opt-in is the construct, not this symbol. */
var wire = Symbol.for("ogygia.wire");
var REGISTRY_KEY = Symbol.for("ogygia.transportables");
function wire_registry() {
	const g = globalThis;
	return g[REGISTRY_KEY] ??= {
		classes: /* @__PURE__ */ new Map(),
		tags: /* @__PURE__ */ new WeakMap()
	};
}
function codec_of(cls) {
	const raw = cls[wire];
	return typeof raw === "function" ? raw.call(cls) : raw;
}
function class_for(tag) {
	const cls = tag === void 0 ? void 0 : wire_registry().classes.get(tag);
	if (cls === void 0) throw new Error(`[ogygia] cannot revive transportable "${tag}": its class is not loaded on this side. The island must import the class as a VALUE (not \`import type\`) so its codec travels with the island's bundle.`);
	return cls;
}
/** The hub kind: `[og.wire]` class instances. Identity/reunify/Keep live in the hub. */
function register_wire_kind() {
	register_kind({
		k: "wire",
		match(value) {
			const cls = value.constructor;
			return typeof cls === "function" && !!cls[wire];
		},
		encode(value) {
			const cls = value.constructor;
			const tag = wire_registry().tags.get(cls);
			if (tag === void 0) throw new Error(`[ogygia] class "${cls.name ?? "?"}" has a [import.meta.og.wire] codec but was never registered. Transportable classes must be declared in a module the ogygia vite plugin transforms (an \`export class\` in your app source, not node_modules or a dynamic eval).`);
			return {
				t: tag,
				d: codec_of(cls).encode(value)
			};
		},
		decode(ref) {
			return codec_of(class_for(ref.t)).decode(ref.d);
		},
		keep_name(ref) {
			const codec = codec_of(class_for(ref.t));
			return typeof codec.id === "string" ? codec.id : void 0;
		},
		merge(kept, ref) {
			const codec = codec_of(class_for(ref.t));
			if (typeof codec.merge === "function") codec.merge(kept, codec.decode(ref.d));
		}
	});
}
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
// \0virtual:ogygia/server-manifest
var load_islands = () => import('./server-islands.js-D9C4ExRr.js');
var island_url = {
	"2b59bdc83cb8": "/_app/immutable/og-region.2b59bdc83cb8.js",
	"9d043e785fd3": "/_app/immutable/og-region.9d043e785fd3.js",
	"08f9c48354e4": "/_app/immutable/og-region.08f9c48354e4.js",
	"bee37bffd7cf": "/_app/immutable/og-region.bee37bffd7cf.js"
};
var island_name = {
	"2b59bdc83cb8": "BigHeader",
	"9d043e785fd3": "Hole",
	"08f9c48354e4": "BigHeader",
	"bee37bffd7cf": "BigHeader"
};
var island_render = {
	"2b59bdc83cb8": "fa740c32716f",
	"9d043e785fd3": "bb158b4059a6",
	"08f9c48354e4": "fa740c32716f",
	"bee37bffd7cf": "fa740c32716f"
};
var render_island = {
	"fa740c32716f": "08f9c48354e4",
	"bb158b4059a6": "9d043e785fd3"
};
var island_reads_page_data = (() => {
	try {
		return JSON.parse("{\"2b59bdc83cb8\":false,\"9d043e785fd3\":false,\"08f9c48354e4\":false,\"bee37bffd7cf\":false}");
	} catch {
		return null;
	}
})();
// \0virtual:ogygia/region-ttl
var regionTtl = 3600;
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
	return `${resolve$1(islands_endpoint())}?id=${encodeURIComponent(entry)}${render ? `&r=${render}` : ""}&props=${payload}&exp=${exp}${ttl_param}&sig=${sig}&k=${key.fp}`;
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
/** Kit's `asset()` for a base-less URL ogygia baked (`/_app/immutable/x.js`). */
function kit_asset(file) {
	const call = asset;
	if (!file.startsWith("/")) return call(file);
	return call(file );
}
// ../../../core/src/page-seed-registry.ts
var recorder$1 = null;
/** Server (`hooks.ts`) installs a request-scoped recorder. */
function set_page_recorder(fn) {
	recorder$1 = fn;
}
var ask_reader = null;
/** Server (`hooks.ts`) installs the reader beside the recorder. */
function set_seed_ask_reader(fn) {
	ask_reader = fn;
}
function read_seed_ask() {
	return ask_reader?.();
}
/** Start collecting the regions' asks for a render outside a Kit page (the server router's document,
*  answered before a Kit page bag exists): the next `record_page` calls of this request count, and
*  `read_seed_ask` returns them. A no-op on the client or outside a request. */
var ask_opener = null;
function set_ask_scope_opener(fn) {
	ask_opener = fn;
}
function open_ask_scope() {
	ask_opener?.();
}
/** Region.svelte calls this during SSR with Kit's real page; the client is a no-op. `seed: false`
*  records the snapshot without asking for the client seed (no island on the page reads it);
*  `remotes` names the remote modules this region's client can call (`null` = any). */
function record_page(snapshot, seed = "all", remotes = null, entry = "") {
	recorder$1?.(snapshot, seed, remotes, entry);
}
// ../../../core/src/server/region-css.ts
/**
* THE REGION-CSS TAG — one place that turns a region's CSS href into head markup, for every emitter
* (Region.svelte's island / held dual / content body sheets, the handle's hole-answer sheets).
*
* Two shapes, one channel: under Kit's `inlineStyleThreshold` the build kept the asset's text in
* the island-deps handoff (`islandCssInline`), and the tag is `<style data-ogygia-region-css="href">`
* — no request before first paint; otherwise it is the `<link rel="stylesheet" … data-ogygia-region-css>`
* it always was. Both carry the resolved href as the channel's identity: the runtime hoists either
* from a fetched answer into `<head>` and dedupes them against what the page already has by that
* value, and the router keys a head `<style>` on it across swaps.
*/
/**
* @param href the handoff's public href (the `islandCss()` value — the inline lookup key)
* @param resolved the same href through `asset()` (base / assets applied) — what the tag carries
*/
function region_css_tag(href, resolved) {
	const text = islandCssInline(href);
	if (text !== null) return `<style data-ogygia-region-css="${escape_attr(resolved)}">${text}</style>`;
	if (!is_css_href(href)) return `<link rel="modulepreload" href="${escape_attr(resolved)}" data-ogygia-region-css>`;
	return `<link rel="stylesheet" href="${escape_attr(resolved)}" data-ogygia-region-css>`;
}
/** `….css` or `….css?…` (string search: one per region CSS tag). */
function is_css_href(href) {
	const q = href.indexOf("?");
	return (q === -1 ? href : href.slice(0, q)).endsWith(".css");
}
// \0virtual:ogygia/route-csr
var csr_true_routes = /* @__PURE__ */ new Set(["/spa"]);
var error_csr_true_routes = /* @__PURE__ */ new Set([]);
// ../../../core/src/runtime/concurrency.ts
/**
* Shared concurrency gate — client region fetches (SI-STORM) and server region SSR (M1).
* Caps in-flight work; waiters queue FIFO. Does not cancel running work (see INVARIANTS.md).
*/
var ConcurrencyGate = class {
	#limit;
	#active = 0;
	#wait = [];
	constructor(max) {
		this.#limit = Math.max(1, max);
	}
	async run(fn) {
		if (this.#active >= this.#limit) await new Promise((resolve) => this.#wait.push(resolve));
		this.#active++;
		try {
			return await fn();
		} finally {
			this.#active--;
			this.#wait.shift()?.();
		}
	}
	get active() {
		return this.#active;
	}
};
// ../../../core/src/runtime/kit-boot.ts
/**
* Detect whether a document is a Kit csr=true page (Kit boots and hydrates the tree).
* Must NOT treat ogygia side-channel scripts as evidence — their payloads can reflect
* attacker-controlled URL substrings like `__sveltekit_` (P0).
*/
var KitBoot = class KitBoot {
	static #ASSIGN = /__sveltekit_\w+\s*=/;
	static #SIDECHANNEL = /<script\b[^>]*(?:\bdata-ogygia-(?:props|page|remote)\b|type=["']application\/ogygia-(?:props|page|remote)["'])[^>]*>[\s\S]*?<\/script>/gi;
	static #INLINE = /<script\b(?![^>]*\bsrc=)[^>]*>[^<]*__sveltekit_\w+\s*=/i;
	/**
	* The route fact, when the server stamped it: `<meta name="ogygia-csr" content="true">` on a
	* csr=true document. `null` when the document carries no such meta (an older document, a
	* fragment) — then the inline-script probe below decides.
	*/
	static meta_of(doc) {
		const meta = doc.querySelector("meta[name=\"ogygia-csr\"]");
		return meta ? meta.getAttribute("content") === "true" : null;
	}
	/** Meta first; else ONE probe over the document's inline scripts (side-channel scripts skipped). */
	static document_has(doc = document) {
		const meta = KitBoot.meta_of(doc);
		if (meta !== null) return meta;
		for (const s of doc.querySelectorAll("script:not([src])")) {
			if ((s.getAttribute("type") || "").startsWith("application/ogygia-")) continue;
			if (s.hasAttribute("data-ogygia-props") || s.hasAttribute("data-ogygia-page") || s.hasAttribute("data-ogygia-remote")) continue;
			if (KitBoot.#ASSIGN.test(s.textContent || "")) return true;
		}
		return false;
	}
	/** How far before `end` the string check looks. Kit appends its boot script at the END of the
	*  body (render.js), right before `</body>`, so this window holds it whenever it exists. */
	static #WINDOW = 65536;
	/**
	* Same check over an HTML string, bounded to the last 64 KB before `end` (pass the index of
	* `</body>`; defaults to the end of the string). A 2.6 MB document is never scanned whole: Kit's
	* boot sits at the end of the body, so the window is exact, not a heuristic. The side-channel
	* strip still applies inside the window (P0 above); a side-channel script cut by the window's
	* start cannot false-match either — its payload never carries a literal `<script` (devalue and
	* JSON escape `<`), and `#INLINE` needs one.
	*/
	static html_has(html, end = html.length) {
		const window = html.slice(Math.max(0, end - KitBoot.#WINDOW), end);
		return KitBoot.#INLINE.test(window.replace(KitBoot.#SIDECHANNEL, ""));
	}
};
var html_has_kit_bootstrap = KitBoot.html_has.bind(KitBoot);
// ../../../core/src/context.ts
var NESTED_KEY = Symbol.for("ogygia.nested-island");
/**
* Mark the current subtree's hydration state. `true` = inside a hydrated island (nested islands
* degrade). `false` = a LAKE resets its subtree to "dead", so an island inside the lake self-
* hydrates again (the nearest-boundary rule — DESIGN.md).
*/
function setNested(value = true) {
	setContext(NESTED_KEY, value);
}
/**
* True when an ancestor island wrapper already marked the subtree. `getContext` returns `undefined`
* when no ancestor set it (a top-level island) — that absence is exactly "not nested".
*/
function isNested() {
	return getContext(NESTED_KEY) === true;
}
var LAKE_KEY = Symbol.for("ogygia.lake-subtree");
/** Mark the current subtree as opaque to Kit — a lake's inside (LakeBoundary). */
function setInLake() {
	setContext(LAKE_KEY, true);
}
/** True when the subtree is opaque to Kit (a lake's inside, or a held region's render). */
function isInLake() {
	return getContext(LAKE_KEY) === true;
}
var LIVE_SNIPPET_KEY = Symbol.for("ogygia.live-snippet");
/** Reset the live-snippet mark for the current subtree (an inline island inside a snippet). */
function setInLiveSnippet(value) {
	setContext(LIVE_SNIPPET_KEY, value);
}
/** True inside a live snippet's body (and not under an island it renders inline). */
function isInLiveSnippet() {
	return getContext(LIVE_SNIPPET_KEY) === true;
}
var HOLE_INLINE_KEY = Symbol.for("ogygia.hole-inline");
/** Region.svelte marks the subtree of a server island it is rendering inline (nested). */
function setHoleInline() {
	setContext(HOLE_INLINE_KEY, true);
}
/** Kit `route.id`, GROUP segments (`(app)`) stripped — mirrors the compiler's `normalize_route_id`
*  so both sides match whether or not Kit keeps groups in `route.id`. Root → `/`. */
function normalize_route_id(id) {
	return "/" + id.split("/").filter(Boolean).filter((s) => !(s.startsWith("(") && s.endsWith(")"))).join("/");
}
/**
* Does Kit hydrate THIS WHOLE DOCUMENT? The leaf page's effective csr is the single fact that decides
* it, so a `<Region>` reads it directly — no per-host context cascade. When true, every island (a
* csr=true page's own, a csr=false layout's chrome, a shared component's) degrades to a plain inline
* component that Kit hydrates. Server: the route is in the build-time csr=true set. Client: Kit
* shipped its bootstrap. Same fact on both legs → the inline/island choice can never desync at
* hydrate. (Replaces the old `CSR_TRUE_KEY` marker + `csr=false` reset, which only re-derived this
* number indirectly through the context cascade.)
*/
function documentIsCsrTrue(error_render = false) {
	try {
		const event = getRequestEvent();
		return error_render ? error_route_is_csr_true(event.route?.id) : route_is_csr_true(event.route?.id);
	} catch {
		return false;
	}
}
/** The same fact from a route id in hand (the handle has the event): is this route's leaf page
*  csr=true? A build-time answer — never a scan of the rendered document. */
function route_is_csr_true(id) {
	return id != null && csr_true_routes.has(normalize_route_id(id));
}
/** The ERROR-page twin: does Kit hydrate this route's `+error.svelte`? Kit renders an error page
*  with the layout branch only (the page node — and its `csr = false` — is dropped), so this reads
*  the layouts' answer; a routeless response (no route matched) is the root layout's. */
function error_route_is_csr_true(id) {
	if (id == null) return false;
	return error_csr_true_routes.has(normalize_route_id(id));
}
/** Per-request: only one `data-ogygia-runtime` script should be emitted (the first island). */
var runtime_claimed = /* @__PURE__ */ new WeakMap();
/** Per-request: stylesheet hrefs already linked for held regions rendered in this SSR pass. */
var region_css_claimed = /* @__PURE__ */ new WeakMap();
/** Per-request: island entries already stamped `<meta name="ogygia-kit-island">` in this pass. */
var kit_island_claimed = /* @__PURE__ */ new WeakMap();
/**
* Claim an INLINE-rendered island's entry for this SSR request — true the first time, so the page
* stamps one `<meta name="ogygia-kit-island" content="<entry>">` per rendered island, however many
* instances render. The client wrapper's lazy component module reads the stamp before Kit hydrates
* (emit.ts `lazy_entry_source`): a stamped island's entry is imported, an unstamped one costs
* nothing. Client / no-request → false (nothing to stamp there).
*/
function claim_kit_island(entry) {
	if (!entry) return false;
	try {
		const event = getRequestEvent();
		let seen = kit_island_claimed.get(event);
		if (!seen) kit_island_claimed.set(event, seen = /* @__PURE__ */ new Set());
		if (seen.has(entry)) return false;
		seen.add(entry);
		return true;
	} catch {
		return false;
	}
}
/**
* Claim stylesheet hrefs for this SSR request, returning only the not-yet-claimed ones. A held
* region's component is server-picked, so its CSS is on no page stylesheet (Kit links CSS from the
* route's STATIC import graph — it never reads the rendered page). The region wrapper links it from
* the render pass instead, via `<svelte:head>`; claiming here dedupes so five `Feature` blocks on a
* page link their shared sheet once. Client / no-request → [] (SSR already linked them).
*/
function claim_region_css(hrefs) {
	if (!hrefs.length) return [];
	try {
		const event = getRequestEvent();
		let seen = region_css_claimed.get(event);
		if (!seen) region_css_claimed.set(event, seen = /* @__PURE__ */ new Set());
		const fresh = hrefs.filter((h) => !seen.has(h));
		for (const h of fresh) seen.add(h);
		return fresh;
	} catch {
		return [];
	}
}
/**
* Claim the single runtime-script slot for this SSR request. An island/server placement emits the
* runtime bootstrap so it hydrates even with the router off; when the router is on, the handle
* injects the same script into `<head>` (presence-checked) on pages that have no island to emit it.
* Client / no-request → false (SSR already emitted).
*/
function claimRuntimeEmit() {
	try {
		const event = getRequestEvent();
		if (runtime_claimed.has(event)) return false;
		runtime_claimed.set(event, true);
		return true;
	} catch {
		return false;
	}
}
// ../../../core/src/region-brand.ts
/**
* The brand marking a held-region value (`region()` results / deferred tickets). It lives ALONE, with
* no imports, on purpose: the client transport hook only needs to TEST `value[REGION_BRAND]` to know
* whether to decode a region — and importing that test from `region.js` used to drag the whole
* `region → region-snippet → svelte/server` graph (~20kB) into every client that installs the hook.
* `Symbol.for` so every bundle (server render, client hook, runtime) agrees on one brand.
*/
var REGION_BRAND = Symbol.for("ogygia.region");
// ../../../core/src/server/html-scan.ts
/**
* Small hand-written scans shared by the server's per-request HTML work, each kept only where it
* MEASURED faster (or allocation-lighter) than the regex it replaced — the engine's compiled
* matcher wins plain presence tests, so those stayed regexes (head-presence.ts).
*/
/** `[A-Za-z0-9_]` — the regex `\w` (NaN, past the end, is not). */
function is_word(c) {
	return c >= 97 && c <= 122 || c >= 65 && c <= 90 || c >= 48 && c <= 57 || c === 95;
}
var REGION_CSS_ATTR = "data-ogygia-region-css";
/**
* Every region-CSS tag in `head`, in order, joined: the `<link … data-ogygia-region-css>` form AND the
* inline `<style data-ogygia-region-css="href">…</style>` form a sheet under Kit's
* `inlineStyleThreshold` takes. What an isolated render (a held region's body) must carry forward
* from its head: keeping links only silently unstyled every small sheet.
*/
function region_css_tags(head) {
	let out = "";
	for (let attr = head.indexOf(REGION_CSS_ATTR); attr !== -1; attr = head.indexOf(REGION_CSS_ATTR, attr + 1)) {
		const open = head.lastIndexOf("<", attr);
		if (open === -1) continue;
		if (head.startsWith("<link", open) && !is_word(head.charCodeAt(open + 5))) {
			const end = head.indexOf(">", attr);
			if (end === -1) break;
			out += head.slice(open, end + 1);
			attr = end;
		} else if (head.startsWith("<style", open) && !is_word(head.charCodeAt(open + 6))) {
			const close = head.indexOf("</style>", attr);
			if (close === -1) break;
			out += head.slice(open, close + 8);
			attr = close + 7;
		}
	}
	return out;
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
				const { render } = await import('./server2.js-CpSoEJHi.js');
				await kit_page_ready();
				const context = kit_render_context$1();
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
// ../../../core/src/late-region-registry.ts
var opener = null;
/** Server (`hooks.ts`) installs the request-scoped scope opener. */
function set_late_scope_opener(fn) {
	opener = fn;
}
/**
* ONLY A RENDERER THAT DELIVERS LATE CHUNKS ARMS THEM. The server router's streamed document opens
* this request's late scope before it renders (and drains it after); anywhere else — a Kit page render
* — a promise `of` registers nothing, because nothing would ever fill its slot (a Kit page's header
* sat in an empty slot forever).
*/
function open_late_scope() {
	opener?.();
}
var recorder = null;
/** Server (`hooks.ts`) installs the request-scoped recorder. */
function set_late_recorder(fn) {
	recorder = fn;
}
/** Region.svelte calls this with a promise `of` during SSR. `null` = not armed → no streaming. */
function register_late_region(promise) {
	return recorder ? recorder(promise) : null;
}
var taker = null;
/** Server (`hooks.ts`) installs the request-scoped drain alongside the recorder. */
function set_late_taker(fn) {
	taker = fn;
}
/** The router drains THIS request's registered late regions after the document render (through
*  this seam, never by importing hooks — its `virtual:` imports don't resolve outside Vite).
*  `null` when nothing registered / nothing armed. Draining clears the request's list. */
function take_late_regions() {
	return taker ? taker() : null;
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
			const req = getContext(KIT_REQUEST_CONTEXT$1);
			kit_page_pass = getContext(KIT_PAGE_PASS) === true || !!(req && req.event == null);
			ogygia_root = !kit_page_pass && !!(req && req.event != null);
			if (kit_page_pass && getContext(KIT_PAGE_PASS) !== true) setContext(KIT_PAGE_PASS, true);
			if (req && req.event == null) {
				const event = kit_request_event();
				if (event) setContext(KIT_REQUEST_CONTEXT$1, {
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
			renderer.push(slot_marker_open$1(slot_id));
			SlotBoundary(renderer, { children: island_children() });
			renderer.push(SLOT_MARKER_CLOSE$1);
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

export { open_ask_scope as $, island_url as A, render_island as B, ConcurrencyGate as C, DocumentTail as D, island_reads_page_data as E, region_css_tag as F, kit_asset as G, escape_amp_quot as H, is_lower_hex$1 as I, ISLAND_GRAPH_ATTR as J, decode_island_graph as K, decode_island_locations as L, island_graph_script as M, escape_amp as N, ref_reducer$1 as O, PRERENDER_REGION_TTL_SEC$1 as P, set_kit_event_reader as Q, REGION_BRAND as R, set_render_page_port as S, set_kit_page_reader as T, regionTtl as U, island_name as V, WIRE_FORMAT_ATTR as W, region as X, escape_text as Y, open_late_scope as Z, take_late_regions as _, index_seed as a, Region as a0, read_seed_ask as a1, claim_region_css as a2, record_page as a3, og_portable as a4, set_ask_scope_opener as a5, set_seed_ask_reader as a6, set_page_recorder as a7, set_tail_reader as a8, set_measure_memo_reader as a9, set_late_scope_opener as aa, set_late_recorder as ab, set_late_taker as ac, MAX_REGION_PROPS_LEN$1 as ad, region_css_tags as ae, region_mac_message as af, island_render as ag, analyze$1 as b, configure_islands_endpoint as c, WIRE_FORMAT_JSON as d, is_region_id as e, is_region_ttl as f, register_wire_kind$1 as g, register_store_kind$1 as h, islands_endpoint$1 as i, register_snippet_kind$1 as j, kit_page_ready as k, register_fn_kind$1 as l, register_derived_kind$1 as m, REF_WIRE_KEY$1 as n, ref_reviver as o, load_islands as p, kit_render_context$1 as q, runtime_bootstrap as r, sign as s, kit_page_facts_tail as t, capability_expiry$1 as u, error_route_is_csr_true as v, route_is_csr_true as w, html_has_kit_bootstrap as x, is_word as y, escape_script_text as z };
//# sourceMappingURL=Region.js-SNqDpRL3.js.map
