import './blocks.js-Cfocf_v9.js';
import './async.js-CdyA1ipx.js';
import { S as render, _ as attr, a1 as escape_html, a2 as attr_class, a3 as ensure_array_like, J as getContext, T as derived, a4 as attr_style, a5 as stringify } from './server.js-Cx6qdlSj.js';
import { p as page } from './state.js-PRJNi6S7.js';
import { R as Region } from './Region.js-DspBOxVI.js';
import { B as B64Url, c as current_facts, b as mint_ttl_sec, d as document_shared_lifetime, s as signing_key } from './payload.js-BFR-R8Ce.js';
import { aM as MAX_REGION_PROPS_LEN$1, k as kit_page_ready, u as kit_render_context, H as islandCss, aK as region_css_tags, v as kit_page_facts_tail, o as REF_WIRE_KEY, T as ref_reducer, w as capability_expiry$1, s as sign, ar as region_mac_message, as as island_render, i as islands_endpoint$1, h as register_wire_kind, j as register_store_kind, l as register_snippet_kind, m as register_fn_kind, n as register_derived_kind, Y as regionTtl } from './late-region-registry.js-DFACBCYi.js';
import { r as resolve } from './paths.js-DBACMOFs.js';
import { h as stringify$1 } from './shared.js-B7aDE0fO.js';
import { z as getRequestEvent } from './utils.js-DOLeCbnX.js';

// ../../src/schema.ts
async function parseSchema(schema, data, label) {
	if (!schema) return data;
	if (schema["~standard"]) {
		const result = await schema["~standard"].validate(data);
		if ("issues" in result && result.issues) {
			const msgs = result.issues.map((i) => i.message ?? "invalid").join("; ");
			throw new Error(`[ogygia/content] schema failed for ${label}: ${msgs}`);
		}
		return "value" in result ? result.value : data;
	}
	if (typeof schema.parse === "function") try {
		return schema.parse(data);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new Error(`[ogygia/content] schema failed for ${label}: ${msg}`);
	}
	throw new Error(`[ogygia/content] schema for ${label} is not Standard Schema / parse()-compatible`);
}
// ../../src/collection-base.ts
/**
* Every `Collection` registers here so relations resolve across collections and backlinks invert.
* Build/server-side metadata — not per-request state.
*/
var GRAPH = globalThis[Symbol.for("ogygia.content.graph")] ??= { all: /* @__PURE__ */ new Set() };
/** Back-pointer from a public handle to its underlying `Collection` (relations resolve through it). */
var COLLECTION = Symbol.for("ogygia.content.collection");
/** Resolve a relation value (a handle or a Collection) to its Collection, or undefined. */
function to_collection(value) {
	if (value instanceof Collection) return value;
	if (value && typeof value === "object") {
		const linked = value[COLLECTION];
		if (linked instanceof Collection) return linked;
	}
}
/** A relation frontmatter field is one id (string) or many (string[]). */
function ref_ids(value) {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
	return [];
}
function to_ref(entry) {
	return {
		id: entry.id,
		data: entry.data
	};
}
var Collection = class {
	#opts;
	#source;
	#schema;
	#catalog = /* @__PURE__ */ new Map();
	#visible;
	/** This collection's own handle (for the `relations: (self) => …` callback). */
	#self;
	#relationsDef = {};
	#relationNames = [];
	#relationsResolved = false;
	#startPromise = null;
	#initPromise = null;
	#version = 0;
	#waiters = /* @__PURE__ */ new Set();
	#backlinkIndex = null;
	#backlinkKey = null;
	constructor(opts) {
		if (!opts || opts.loader == null) throw new Error("[ogygia/content] content() requires `loader`");
		if (typeof opts.loader.refs !== "function" || typeof opts.loader.get !== "function") throw new Error("[ogygia/content] `loader` must be a source ({ refs, get }) — use markdown()/json()/blocks()/folder()/glob()");
		this.#opts = opts;
		this.#source = opts.loader;
		this.#schema = opts.schema == null ? [] : Array.isArray(opts.schema) ? opts.schema : [opts.schema];
		this.#visible = opts.filter ?? (() => true);
		GRAPH.all.add(this);
	}
	/** Supply the collection's own handle for the `relations: (self) => …` callback. */
	bindSelf(self) {
		this.#self = self;
	}
	#resolveRelations() {
		if (this.#relationsResolved) return;
		this.#relationsResolved = true;
		if (this.#opts.relations) {
			this.#relationsDef = this.#opts.relations(this.#self);
			this.#relationNames = Object.keys(this.#relationsDef);
		}
	}
	get streaming() {
		return !!this.#source.live;
	}
	get fromIsFunction() {
		return !!this.#source.live || !!this.#source.dynamic;
	}
	/** Directory/section decoration from the source, if it exposes any (`folder()` / a CMS folders API). */
	groups() {
		return this.#source.groups?.() ?? Promise.resolve(/* @__PURE__ */ new Map());
	}
	/** AND-compose a per-remote filter onto collection visibility (narrow only). */
	compose(extra, ctx = {}) {
		return extra ? (e) => this.#visible(e, ctx) && extra(e) : (e) => this.#visible(e, ctx);
	}
	#notify() {
		this.#version += 1;
		for (const wake of this.#waiters) wake();
	}
	snapshot() {
		return [...this.#catalog.values()];
	}
	version() {
		return this.#version;
	}
	async *watchChanges() {
		let seen = this.#version;
		while (true) {
			if (this.#version !== seen) {
				seen = this.#version;
				yield seen;
				continue;
			}
			await new Promise((resolve) => {
				const wake = () => {
					this.#waiters.delete(wake);
					resolve();
				};
				this.#waiters.add(wake);
			});
		}
	}
	/** Validate one source ref into a catalog ref. Schema layers (a genre stack like `fields.post` =
	*  `[page, post_only]`) each validate the ORIGINAL frontmatter and their outputs MERGE left→right —
	*  NOT chained. Chaining would let an early layer that returns only its own fields (e.g. `page`)
	*  strip a field a later layer needs (e.g. `post`'s `date`) before it ever sees it. */
	async #normalizeRef(row, seen) {
		if (!row?.id || typeof row.id !== "string") throw new Error("[ogygia/content] source ref missing string id");
		if (seen) {
			if (seen.has(row.id)) throw new Error(`[ogygia/content] duplicate id '${row.id}'`);
			seen.add(row.id);
		}
		const original = row.data ?? {};
		let data = original;
		if (this.#schema.length) {
			data = {};
			for (const schema of this.#schema) data = {
				...data,
				...await parseSchema(schema, original, `content/${row.id}`)
			};
		}
		return {
			id: row.id,
			data,
			meta: row.meta ?? {},
			...row.order !== void 0 ? { order: row.order } : {},
			...row.filePath !== void 0 ? { filePath: row.filePath } : {}
		};
	}
	/** Materialize the whole source (refs) into the catalog. Re-run on each live change. */
	async #reload() {
		const rows = await this.#source.refs();
		const seen = /* @__PURE__ */ new Set();
		const next = [];
		for (const row of rows) next.push(await this.#normalizeRef(row, seen));
		this.#catalog.clear();
		for (const e of next) this.#catalog.set(e.id, e);
		this.#backlinkIndex = null;
		this.#notify();
	}
	/** Incremental live update: refetch just the changed ids (drop the ones the source no longer has). */
	async #reloadIds(ids) {
		for (const id of ids) {
			const row = await this.#source.get(id);
			if (row) this.#catalog.set(id, await this.#normalizeRef(row));
			else this.#catalog.delete(id);
		}
		this.#backlinkIndex = null;
		this.#notify();
	}
	#init() {
		return this.#initPromise ??= Promise.resolve(this.#source.init?.()).then(() => void 0);
	}
	#start() {
		if (this.#startPromise) return this.#startPromise;
		this.#startPromise = (async () => {
			await this.#init();
			await this.#reload();
			if (this.#source.live) {
				const changes = this.#source.live();
				(async () => {
					try {
						for await (const change of changes) if (Array.isArray(change) && change.every((x) => typeof x === "string")) await this.#reloadIds(change);
						else await this.#reload();
					} catch (err) {
						console.error("[ogygia/content] live source failed:", err);
					}
				})();
			}
		})();
		return this.#startPromise;
	}
	async #loaded() {
		await this.#start();
	}
	async ready() {
		await this.#loaded();
		return this.snapshot();
	}
	relationTargets() {
		this.#resolveRelations();
		const out = {};
		for (const name of this.#relationNames) out[name] = to_collection(this.#relationsDef[name]);
		return out;
	}
	/** Visible ref by id (default context), or null. */
	lookup(id, ctx = {}) {
		const e = this.#catalog.get(id);
		return e && this.#visible(e, ctx) ? e : null;
	}
	visibleRefs(ctx = {}) {
		return this.snapshot().filter((e) => this.#visible(e, ctx));
	}
	async resolveGraph(entry) {
		const rel = {};
		const targets = this.relationTargets();
		for (const name of this.#relationNames) {
			const target = targets[name];
			const field = entry.data[name];
			const many = Array.isArray(field);
			if (!target) {
				rel[name] = many ? [] : null;
				continue;
			}
			await target.#loaded();
			const refs = [];
			for (const id of ref_ids(field)) {
				const e = target.lookup(id);
				if (e) refs.push(to_ref(e));
			}
			rel[name] = many ? refs : refs[0] ?? null;
		}
		return {
			rel,
			backlinks: (await this.#backlinks()).get(entry.id) ?? []
		};
	}
	async #backlinks() {
		const contributors = [];
		for (const src of GRAPH.all) {
			const st = src.relationTargets();
			const names = Object.keys(st).filter((n) => st[n] === this);
			if (names.length) contributors.push({
				src,
				names
			});
		}
		await Promise.all(contributors.map((c) => c.src.#loaded()));
		const key = `${GRAPH.all.size}|` + contributors.map((c) => c.src.version()).join(",");
		if (this.#backlinkKey === key && this.#backlinkIndex) return this.#backlinkIndex;
		const index = /* @__PURE__ */ new Map();
		for (const { src, names } of contributors) for (const se of src.visibleRefs()) {
			const ref = to_ref(se);
			for (const rname of names) for (const id of new Set(ref_ids(se.data[rname]))) {
				const list = index.get(id);
				if (list) list.push(ref);
				else index.set(id, [ref]);
			}
		}
		this.#backlinkKey = key;
		this.#backlinkIndex = index;
		return index;
	}
	#hasGraph() {
		this.#resolveRelations();
		if (this.#relationNames.length > 0) return true;
		for (const src of GRAPH.all) {
			if (src === this) continue;
			const t = src.relationTargets();
			for (const name in t) if (t[name] === this) return true;
		}
		return false;
	}
	async withGraph(entry) {
		if (!this.#hasGraph()) return entry;
		const { rel, backlinks } = await this.resolveGraph(entry);
		return {
			...entry,
			rel,
			backlinks
		};
	}
	/** All visible refs (each graphed) — the corpus as metadata, never bodies. */
	async refs(ctx = {}) {
		return Promise.all((await this.ready()).filter((e) => this.#visible(e, ctx)).map((e) => this.withGraph(e)));
	}
	/** Build a full {@link Entry} (ref + body + source + graph) from a source `get`. */
	async #entryFrom(ref, full, rel, backlinks) {
		return {
			id: ref.id,
			data: ref.data,
			meta: ref.meta,
			...full?.body !== void 0 ? { body: full.body } : {},
			...full?.source !== void 0 ? { source: full.source } : {},
			rel,
			backlinks
		};
	}
	/** Resolve one entry to `{ id, data, meta, body, source, rel, backlinks }`, or `null`. */
	async get(id, ctx = {}) {
		if (!this.#hasGraph()) {
			await this.#init();
			let ref = this.#catalog.get(id) ?? null;
			const full = await this.#source.get(id);
			if (!ref) {
				if (!full) return null;
				ref = await this.#normalizeRef(full);
			}
			if (!this.#visible(ref, ctx)) return null;
			return this.#entryFrom(ref, full, {}, []);
		}
		await this.#loaded();
		const ref = this.lookup(id, ctx);
		if (!ref) return null;
		const [full, graph] = await Promise.all([this.#source.get(id), this.resolveGraph(ref)]);
		return this.#entryFrom(ref, full, graph.rel, graph.backlinks);
	}
};
// ../../src/factory.ts
function content(opts) {
	const c = new Collection(opts);
	const handle = {
		refs: (ctx) => c.refs(ctx),
		get: (id, ctx) => c.get(id, ctx),
		groups: () => c.groups()
	};
	Object.defineProperty(handle, COLLECTION, {
		value: c,
		enumerable: false
	});
	c.bindSelf(handle);
	return handle;
}
// ../../src/site/context.ts
var KEY$1 = Symbol.for("ogygia.content.shell");
function get_shell_context() {
	return getContext(KEY$1);
}
// ../../src/site/components/Sidebar.svelte
function Sidebar($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* The nav tree, rendered. A pure function of `NavTree`: groups nest recursively, leaves link,
		* plain links pass through. Inside `<Shell>` it reads the site from context; standalone it takes
		* `{site}` (or a precomputed `{nav}` — the wrap pattern: transform the data, hand it back).
		* Customize per-item with the `item` snippet; everything else is CSS via `.og-*` hooks.
		*/
		const NON_IDENT_CHARS_G = /[^a-zA-Z0-9_-]+/g;
		let { site, base, nav, item } = $$props;
		const ctx = get_shell_context();
		const the_site = site ?? ctx?.site;
		const the_base = base ?? ctx?.base ?? "";
		/**
		* A stable, unique `view-transition-name` for one nav row. The page cross-fade is a View Transition,
		* so the LIVE sidebar DOM is hidden behind the VT snapshot mid-nav — a JS/CSS slide of the marker
		* wouldn't be visible. Instead the highlight box (a chip carrying `view-transition-name: og-nav-active`)
		* lives behind the ACTIVE row; when the active class moves to the new leaf, the VT captures the chip at
		* the new row and slides it there for us. But a named element paints ABOVE the page snapshot, so a
		* bare chip would cover the labels it passes. Fix: give every row its OWN VT layer (a unique name here,
		* a shared `view-transition-class` in CSS) and force the chip BENEATH them by z-index — so each label
		* stays put in its own layer and the chip glides underneath. Names must be unique per document; the
		* key (href/label) is, so we sanitise it to a valid custom-ident and prefix by row kind.
		*/
		function vt_name(prefix, key) {
			return `${prefix}-${key.replace(NON_IDENT_CHARS_G, "-")}`;
		}
		var fetched, tree, path;
		var $$promises = $$renderer.run([async () => fetched = nav ? [] : the_site ? await the_site.nav({ base: the_base }) : [], () => {
			tree = derived(() => nav ?? fetched);
			path = derived(() => page.url.pathname);
		}]);
		function items($$renderer, list) {
			$$renderer.push(`<ul class="og-nav-list"><!--[-->`);
			const each_array = ensure_array_like(list);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let node = each_array[$$index];
				if (node.kind === "group") {
					$$renderer.push("<!--[0-->");
					$$renderer.push(`<li class="og-nav-group"><span class="og-nav-label"${attr_style(`view-transition-name: ${stringify(vt_name("phg", node.label))}`)}>${escape_html(node.label)}`);
					if (node.badge) {
						$$renderer.push("<!--[0-->");
						$$renderer.push(`<span class="og-badge">${escape_html(node.badge)}</span>`);
					} else $$renderer.push("<!--[-1-->");
					$$renderer.push(`<!--]--></span> `);
					items($$renderer, node.items);
					$$renderer.push(`<!----></li>`);
				} else if (node.kind === "link") {
					$$renderer.push("<!--[1-->");
					$$renderer.push(`<li><a class="og-nav-link og-nav-external"${attr_style(`view-transition-name: ${stringify(vt_name("phx", node.href))}`)}${attr("href", node.href)}>${escape_html(node.label)}</a></li>`);
				} else if (item) {
					$$renderer.push("<!--[2-->");
					$$renderer.push(`<li>`);
					$$renderer.async_block([$$promises[1]], ($$renderer) => {
						item($$renderer, node, path() === node.href);
					});
					$$renderer.push(`</li>`);
				} else {
					$$renderer.push("<!--[-1-->");
					$$renderer.push(`<li>`);
					$$renderer.async([$$promises[1]], ($$renderer) => {
						$$renderer.push(`<a${attr_class("og-nav-link", void 0, { "og-active": path() === node.href })}${attr("aria-current", path() === node.href ? "page" : void 0)}${attr("href", node.href)}${attr_style(`view-transition-name: ${stringify(vt_name("phl", node.href))}`)}>`);
						$$renderer.async_block([$$promises[1]], ($$renderer) => {
							if (path() === node.href) {
								$$renderer.push("<!--[0-->");
								$$renderer.push(`<span class="og-nav-chip" aria-hidden="true"></span>`);
							} else $$renderer.push("<!--[-1-->");
						});
						$$renderer.push(`<!--]--> ${escape_html(node.title)}`);
						if (node.badge) {
							$$renderer.push("<!--[0-->");
							$$renderer.push(`<span class="og-badge">${escape_html(node.badge)}</span>`);
						} else $$renderer.push("<!--[-1-->");
						$$renderer.push(`<!--]--></a>`);
					});
					$$renderer.push(`</li>`);
				}
				$$renderer.push(`<!--]-->`);
			}
			$$renderer.push(`<!--]--></ul>`);
		}
		$$renderer.push(`<nav class="og-sidebar" aria-label="Documentation">`);
		$$renderer.async_block([$$promises[1]], ($$renderer) => {
			items($$renderer, tree());
		});
		$$renderer.push(`</nav>`);
	});
}
// virtual:ogygia/island/aae9982fd301.js
var aae9982fd301_default = Sidebar;
// virtual:ogygia/wrapper/aae9982fd301.svelte
function Aae9982fd301($$renderer, $$props) {
	let { children, $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "island",
		load: true,
		__entry: "/_app/immutable/og-region.aae9982fd301.js",
		__component: aae9982fd301_default,
		__css: Sidebar,
		__props,
		children
	});
}
// ../../../core/src/server/region-props.ts
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
		payload = B64Url.encode(stringify$1(props, { [REF_WIRE_KEY]: ref_reducer(PROP_FAMILIES) }));
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
	const context = kit_render_context();
	context.set(LAKE_SUBTREE_KEY, true);
	const r = await render(component, {
		props,
		context
	});
	let own = "";
	for (const href of islandCss(module_url)) own += "<link rel=\"stylesheet\" href=\"" + href + "\" data-ogygia-region-css>";
	return own + region_css_tags(r.head) + r.body + kit_page_facts_tail();
}
// virtual:ogygia/region/aae9982fd301.js
Object.assign(Aae9982fd301, {
	__ogRegion: "aae9982fd301",
	__module: "/_app/immutable/og-region.aae9982fd301.js",
	__hydrate: "load",
	__component: Sidebar,
	__sign: makeRegionEndpoint,
	__renderHtml: (props) => render_region_html(Sidebar, "/_app/immutable/og-region.aae9982fd301.js", props)
});
// ../../src/site/components/OnThisPage.svelte
function OnThisPage($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* On-this-page headings with scrollspy. Meant to be mounted as an ISLAND (`with { wake: 'load' }`)
		* so it's a real reactive component: it hydrates per page and RE-hydrates after every SPA
		* navigation, so the active marker just works on the new page — no inline `script()`, no dependence
		* on scripts re-running across a body swap.
		*
		* The scrollspy lives in an ATTACHMENT on the list (runs on mount, cleans up on unmount) using
		* `svelte/events` `on()` for the window listeners. It marks the last heading above the fold line as
		* active and slides the rail thumb to it. Customize each row with the `item` snippet (then apply
		* your own active state); `.og-toc*` hooks for CSS.
		*/
		let { headings, title, label = "On this page", scrollspy = true, item } = $$props;
		let active = "";
		const top_href = derived(() => page.url.pathname);
		if (headings.length || title) {
			$$renderer.push("<!--[0-->");
			$$renderer.push(`<nav class="og-toc"${attr("aria-label", label)}><p class="og-toc-label">${escape_html(label)}</p> <ul class="og-toc-list">`);
			if (title) {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<li class="og-toc-item og-toc-d2 og-toc-title"><a${attr_class("og-toc-link", void 0, { "og-active": true })}${attr("href", top_href())}${attr("aria-current", "true")}>${escape_html(title)}</a></li>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> <!--[-->`);
			const each_array = ensure_array_like(headings);
			for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
				let h = each_array[$$index];
				$$renderer.push(`<li${attr_class(`og-toc-item og-toc-d${h.depth}`)}>`);
				if (item) {
					$$renderer.push("<!--[0-->");
					item($$renderer, h);
					$$renderer.push(`<!---->`);
				} else {
					$$renderer.push("<!--[-1-->");
					$$renderer.push(`<a${attr_class("og-toc-link", void 0, { "og-active": h.id === active })}${attr("href", `#${h.id}`)}${attr("aria-current", h.id === active ? "true" : void 0)}>${escape_html(h.text)}</a>`);
				}
				$$renderer.push(`<!--]--></li>`);
			}
			$$renderer.push(`<!--]--></ul></nav>`);
		} else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]-->`);
	});
}
// ../../src/site/components/CodeChrome.svelte
function CodeChrome($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { selector = ".og-body pre" } = $$props;
		$$renderer.push(`<span class="og-code-chrome" aria-hidden="true" hidden=""></span>`);
	});
}
// ../../src/site/components/TabGroupIsland.svelte
function TabGroupIsland($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* The interactive half of TabGroup — an ISLAND (TabGroup wraps it `with { wake: 'load' }`). The tab
		* PANELS arrive as `children` frozen to static server HTML (a region snippet crossed the island
		* boundary), so they never re-render. This island renders ONLY the panels on the server — clean,
		* mismatch-free — then on mount BUILDS the bar from the panels' own `data-label`s and wires the full
		* WCAG tablist keyboard (roving tabindex, arrow wrap, Home/End, MANUAL activation — arrows rove,
		* Space/Enter select). Because the
		* labels come from the panels, hand-authored `<Tab label>` and injected `:::` blocks work identically,
		* with no `labels` prop to thread. Site-wide memory rides {@link ./tab-groups.svelte.ts}.
		*
		* (Bits `Tabs` was tried for the bar, but its SSR/client id generation mismatches when hydrated inside
		* the frozen-children island; the tablist pattern is small and fully verified here.)
		*/
		let { group = "tabs", children } = $$props;
		$$renderer.push(`<div class="og-tabs"${attr("data-group", group)}><div class="og-tabs-panels">`);
		children($$renderer);
		$$renderer.push(`<!----></div></div>`);
	});
}
// virtual:ogygia/island/e2d4c00854d8.js
var e2d4c00854d8_default = TabGroupIsland;
// virtual:ogygia/wrapper/e2d4c00854d8.svelte
function E2d4c00854d8($$renderer, $$props) {
	let { children, $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "island",
		load: true,
		__entry: "/_app/immutable/og-region.e2d4c00854d8.js",
		__component: e2d4c00854d8_default,
		__css: TabGroupIsland,
		__props,
		children
	});
}
// virtual:ogygia/region/e2d4c00854d8.js
Object.assign(E2d4c00854d8, {
	__ogRegion: "e2d4c00854d8",
	__module: "/_app/immutable/og-region.e2d4c00854d8.js",
	__hydrate: "load",
	__component: TabGroupIsland,
	__sign: makeRegionEndpoint,
	__renderHtml: (props) => render_region_html(TabGroupIsland, "/_app/immutable/og-region.e2d4c00854d8.js", props)
});
// virtual:ogygia/island/91e5dfe02f70.js
var _91e5dfe02f70_default = OnThisPage;
// virtual:ogygia/wrapper/91e5dfe02f70.svelte
function _1e5dfe02f70($$renderer, $$props) {
	let { children, $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "island",
		load: true,
		__entry: "/_app/immutable/og-region.91e5dfe02f70.js",
		__component: _91e5dfe02f70_default,
		__css: OnThisPage,
		__props,
		children
	});
}
// virtual:ogygia/region/91e5dfe02f70.js
Object.assign(_1e5dfe02f70, {
	__ogRegion: "91e5dfe02f70",
	__module: "/_app/immutable/og-region.91e5dfe02f70.js",
	__hydrate: "load",
	__component: OnThisPage,
	__sign: makeRegionEndpoint,
	__renderHtml: (props) => render_region_html(OnThisPage, "/_app/immutable/og-region.91e5dfe02f70.js", props)
});
// virtual:ogygia/island/b2cab0a6e4f4.js
var b2cab0a6e4f4_default = CodeChrome;
// virtual:ogygia/wrapper/b2cab0a6e4f4.svelte
function B2cab0a6e4f4($$renderer, $$props) {
	let { children, $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "island",
		load: true,
		__entry: "/_app/immutable/og-region.b2cab0a6e4f4.js",
		__component: b2cab0a6e4f4_default,
		__css: CodeChrome,
		__props,
		children
	});
}
// virtual:ogygia/region/b2cab0a6e4f4.js
Object.assign(B2cab0a6e4f4, {
	__ogRegion: "b2cab0a6e4f4",
	__module: "/_app/immutable/og-region.b2cab0a6e4f4.js",
	__hydrate: "load",
	__component: CodeChrome,
	__sign: makeRegionEndpoint,
	__renderHtml: (props) => render_region_html(CodeChrome, "/_app/immutable/og-region.b2cab0a6e4f4.js", props)
});
// ../../src/site/components/Search.svelte
function Search($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { base, endpoint, query, mode = "dialog", action, placeholder = "Search", limit = 10 } = $$props;
		const ctx = get_shell_context();
		const the_base = base ?? ctx?.base ?? "";
		const search_action = action ?? `${the_base}/search`;
		let $$settled = true;
		let $$inner_renderer;
		function $$render_inner($$renderer) {
			if (mode === "dialog") {
				$$renderer.push("<!--[0-->");
				$$renderer.push(`<a class="og-search-trigger"${attr("href", search_action)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path></svg> <span class="og-search-trigger-label">${escape_html(placeholder)}</span> <kbd class="og-search-kbd">⌘K</kbd></a>`);
			} else $$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]--> `);
			$$renderer.push("<!--[-1-->");
			$$renderer.push(`<!--]-->`);
		}
		do {
			$$settled = true;
			$$inner_renderer = $$renderer.copy();
			$$render_inner($$inner_renderer);
		} while (!$$settled);
		$$renderer.subsume($$inner_renderer);
	});
}
// virtual:ogygia/island/45ff3c073338.js
var _45ff3c073338_default = Search;
// virtual:ogygia/wrapper/45ff3c073338.svelte
function _5ff3c073338($$renderer, $$props) {
	let { children, $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "island",
		idle: true,
		__entry: "/_app/immutable/og-region.45ff3c073338.js",
		__component: _45ff3c073338_default,
		__css: Search,
		__props,
		children
	});
}
// virtual:ogygia/region/45ff3c073338.js
Object.assign(_5ff3c073338, {
	__ogRegion: "45ff3c073338",
	__module: "/_app/immutable/og-region.45ff3c073338.js",
	__hydrate: "idle",
	__component: Search,
	__sign: makeRegionEndpoint,
	__renderHtml: (props) => render_region_html(Search, "/_app/immutable/og-region.45ff3c073338.js", props)
});
// ../../src/site/components/ThemeToggle.svelte
function ThemeToggle($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		/**
		* Theme cycler — system → light → dark → system. Sets `data-theme` on the root element (the
		* theme.css contract) and persists to localStorage.
		*
		* An ISLAND (a shell imports it `with { wake: 'load' }`): the `onclick` handler is wired at hydrate
		* time and re-wired every SPA nav, so it never goes stale. (A one-shot inline `script()` would,
		* since inline scripts don't re-run on a body-swap.)
		*
		* Pair with a no-flash head script that applies the stored theme before first paint (a shell like
		* the Shell includes it; standalone users add it once in their layout):
		* `{@html script((k) => { try { var t = localStorage.getItem(k); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {} }, 'og-theme')}`
		*/
		let { key = "og-theme", label = "Theme" } = $$props;
		$$renderer.push(`<button type="button" class="og-theme-toggle svelte-xtku2n"${attr("aria-label", label)}${attr("title", label)}><svg class="og-tt og-tt-system svelte-xtku2n" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path></svg> <svg class="og-tt og-tt-light svelte-xtku2n" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg> <svg class="og-tt og-tt-dark svelte-xtku2n" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"></path></svg></button>`);
	});
}
// virtual:ogygia/island/6cf8e94863c3.js
var _6cf8e94863c3_default = ThemeToggle;
// virtual:ogygia/wrapper/6cf8e94863c3.svelte
function _cf8e94863c3($$renderer, $$props) {
	let { children, $$slots, $$events, ...__props } = $$props;
	Region($$renderer, {
		__mode: "island",
		load: true,
		__entry: "/_app/immutable/og-region.6cf8e94863c3.js",
		__component: _6cf8e94863c3_default,
		__css: ThemeToggle,
		__props,
		children
	});
}
// virtual:ogygia/region/6cf8e94863c3.js
Object.assign(_cf8e94863c3, {
	__ogRegion: "6cf8e94863c3",
	__module: "/_app/immutable/og-region.6cf8e94863c3.js",
	__hydrate: "load",
	__component: ThemeToggle,
	__sign: makeRegionEndpoint,
	__renderHtml: (props) => render_region_html(ThemeToggle, "/_app/immutable/og-region.6cf8e94863c3.js", props)
});

export { content as c, makeRegionEndpoint as m, render_region_html as r };
//# sourceMappingURL=src.js-CioERKRa.js.map
