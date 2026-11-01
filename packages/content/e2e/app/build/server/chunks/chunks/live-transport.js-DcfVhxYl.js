import { V as writable, W as get, S as render, X as derived$1, K as getAllContexts } from './server.js-Cx6qdlSj.js';
import { c as createRawSnippet, u as unmount, h as hydrate } from './index-server2.js-Dp0Lnfg2.js';

// ../../../core/dist/ref-watch.js
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
/** The live bucket for a scope (never 'request' — that scope is never stored). */
function bucket(reg, scope) {
	let b = reg.instances.get(scope);
	if (b === void 0) reg.instances.set(scope, b = /* @__PURE__ */ new Map());
	return b;
}
/** Memoize an instance in a scope's bucket, recording its kind for later disposal. No MAX_LIVE
*  cap since phase D — the 'page' bucket is emptied by `dispose_scope('page')` on every nav, so
*  it can't creep across the tab's lifetime the way the old unbounded map could. */
function remember_in(reg, scope, key, instance, kind_k) {
	bucket(reg, scope).set(key, instance);
	reg.instance_kind.set(instance, kind_k);
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
	const remember = (typeof scope_or_remember === "boolean" ? scope_or_remember ? "page" : "request" : scope_or_remember) !== "request";
	const reg = registry();
	if (remember) {
		const existing = bucket(reg, "page").get(ref.i);
		if (existing !== void 0) {
			const w = watchers().get(ref.i);
			if (w !== void 0 && w.size > 0) {
				const kind = reg.kinds.get(ref.k);
				if (kind?.merge !== void 0) {
					kind.merge(existing, ref);
					notify(ref.i, existing);
				}
			}
			return existing;
		}
	}
	const kind = reg.kinds.get(ref.k);
	if (kind === void 0) throw new Error(`[ogygia] cannot resolve a "${ref.k}" ref: no such kind is registered on this side. The module that registers it must be imported as a VALUE in this bundle.`);
	if (remember) {
		const name = kind.keep_name?.(ref);
		if (typeof name === "string") {
			const tag = ref.t ?? ref.k;
			const owner = reg.keep_owner.get(name);
			if (owner === void 0) reg.keep_owner.set(name, tag);
			else if (owner !== tag && typeof console !== "undefined") console.error(`[ogygia] two transportables both use continuity id "${name}" ("${owner}" and "${tag}"). A continuity id must be unique per class — rename one, or they will clobber each other in the session Keep.`);
			const kept = bucket(reg, "session").get(name);
			if (kept !== void 0) {
				kind.merge?.(kept, ref);
				remember_in(reg, "page", ref.i, kept, ref.k);
				return kept;
			}
			const instance = kind.decode(ref);
			if (instance !== null && typeof instance === "object") {
				remember_in(reg, "session", name, instance, ref.k);
				remember_in(reg, "page", ref.i, instance, ref.k);
			}
			return instance;
		}
	}
	const instance = kind.decode(ref);
	if (remember && instance !== null && typeof instance === "object") remember_in(reg, "page", ref.i, instance, ref.k);
	return instance;
}
/** Devalue custom-type name for hub refs on the wire (the ONE key every seam will converge on). */
var REF_WIRE_KEY = "OgygiaRef";
/** Devalue reducer for a seam. `only` deliberately restricts which families may cross there. */
function ref_reducer(only) {
	return (value) => mint(value, only);
}
/** Devalue reviver for a seam. Browser passes `remember: true`; the server must pass `false`. */
function ref_reviver(remember) {
	return (ref) => resolve(ref, remember);
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
var LIVE_SNIPPET_KEY = Symbol.for("ogygia.live-snippet");
var with_host = (context, host) => {
	if (host) for (const [k, v] of host) context.set(k, v);
	context.set(LIVE_SNIPPET_KEY, true);
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

export { REF_WIRE_KEY as R, resolve as a, register_wire_kind as b, register_store_kind as c, register_snippet_kind as d, register_fn_kind as e, register_derived_kind as f, ref_reducer as g, register_kind as h, mint as m, notify as n, ref_reviver as r, watcher_count as w };
//# sourceMappingURL=live-transport.js-DcfVhxYl.js.map
