import { R as REF_WIRE_KEY, r as ref_reviver, a as resolve, m as mint, b as register_wire_kind, c as register_store_kind, d as register_snippet_kind, e as register_fn_kind, f as register_derived_kind, g as ref_reducer, h as register_kind, n as notify, w as watcher_count } from '../chunks/live-transport.js-BhmTVvjO.js';
import '../chunks/server.js-B9P4ExQ-.js';
import '../chunks/uneval.js-CHOeF-6t.js';
import '../chunks/index-server2.js-uORi_mEb.js';
import '../chunks/rolldown-runtime.js-CTrrmpyn.js';

// ../../../core/dist/region-brand.js
/**
* The brand marking a held-region value (`region()` results / deferred tickets). It lives ALONE, with
* no imports, on purpose: the client transport hook only needs to TEST `value[REGION_BRAND]` to know
* whether to decode a region — and importing that test from `region.js` used to drag the whole
* `region → region-snippet → svelte/server` graph (~20kB) into every client that installs the hook.
* `Symbol.for` so every bundle (server render, client hook, runtime) agrees on one brand.
*/
var REGION_BRAND = Symbol.for("ogygia.region");
// ../../../core/dist/frame.js
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
// ../../../core/dist/runtime/frame-store.js
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
// ../../../core/dist/transport.js
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
/** The hub kind: a held/dual/awaited region — the RENDERABLE Ref. `d` is the EncodedRegion.
*  Decode is deliberately un-memoized at the legacy seam (the wrapper below passes ids through
*  raw); hub-memoized region identity arrives with the one-key collapse, where it becomes the
*  foundation for persistent regions (the reconciler resolves by id). */
function register_region_kind() {
	register_kind({
		k: "region",
		match(value) {
			return value[REGION_BRAND] === true;
		},
		encode(value) {
			const packed = encode_region(value);
			if (packed === false) throw new Error("[ogygia] region kind claimed a non-region value");
			return { d: packed };
		},
		decode(ref) {
			return decode_region(ref.d);
		}
	});
}
var REGION_ONLY = /* @__PURE__ */ new Set(["region"]);
/** Every hub family the ONE `OgygiaRef` transport entry carries (hub v2 phase Y — symmetry).
*  Region stays in the list for decode-completeness, but the `Region` entry below is first in
*  object order so regions still ENCODE through it (legacy `EncodedRegion` wire shape kept). */
var ALL_FAMILIES = /* @__PURE__ */ new Set([
	"wire",
	"store",
	"snippet",
	"fn",
	"derived",
	"region"
]);
var all_kinds_ready = false;
var all_families_reducer = null;
function ensure_all_kinds() {
	if (!all_kinds_ready) {
		all_kinds_ready = true;
		register_wire_kind();
		register_store_kind();
		register_snippet_kind();
		register_fn_kind();
		register_derived_kind();
		register_region_kind();
	}
	return all_families_reducer ??= ref_reducer(ALL_FAMILIES);
}
/**
* The SvelteKit `transport` entry (install once in universal hooks). TWO entries, ONE codec
* underneath (hub v2 phase Y): `Region` preserves the legacy region wire shape/tag for
* compatibility; `OgygiaRef` carries EVERY OTHER hub kind through the same `ref_reducer` /
* `ref_reviver` the island seams use — so a universal `load` can put a store, wire class, fn or
* resumable derived in `page.data`, and a remote function can take/return one, all by identity.
* Kit routes remote args + load data through this same `transport`, so the symmetry is total.
* Decode is REQUEST-scoped on the server (no `document`) — client-sent identity never memoizes
* across requests — and PAGE-scoped in the browser (reunification).
*/
var ogygiaTransport = {
	Region: {
		encode(value) {
			if (typeof value !== "object" || value === null) return false;
			if (value[REGION_BRAND] !== true) return false;
			register_region_kind();
			const ref = mint(value, REGION_ONLY);
			if (ref === void 0) return false;
			return {
				...ref.d,
				hi: ref.i
			};
		},
		decode(raw) {
			register_region_kind();
			const remember = typeof document !== "undefined" && typeof raw.hi === "string" && raw.hi.length > 0;
			return resolve({
				k: "region",
				i: raw.hi ?? (raw.i || ""),
				d: raw
			}, remember);
		}
	},
	[REF_WIRE_KEY]: {
		encode(value) {
			if (value === null || typeof value !== "object" && typeof value !== "function") return false;
			return ensure_all_kinds()(value) ?? false;
		},
		decode(ref) {
			ensure_all_kinds();
			return ref_reviver(typeof document !== "undefined")(ref);
		}
	}
};
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
// src/hooks.ts
var transport = { ...ogygiaTransport };

export { transport };
//# sourceMappingURL=hooks.universal.js--Ntnhva-.js.map
