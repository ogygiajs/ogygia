import { s as source_tag_of } from './source.js-A6N0KW6W.js';

/** Normalize a prefix filter: leading slash enforced, trailing slash stripped (except root). */
function normalize_prefix(prefix) {
	let p = prefix.startsWith("/") ? prefix : "/" + prefix;
	while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
	return p;
}
/** The key prefix a normalized prefix's SUBTREE shares: `/fr/fr` → `/fr/fr/` (never `/fr/fright`),
*  and the root `/` → `/` itself (every key; `'/' + '/'` would match nothing). */
function subtree_prefix(normalized) {
	return normalized.endsWith("/") ? normalized : normalized + "/";
}
/** The depth-capped prefix list for a pathname — the edge tag vocabulary for this response. */
function prefix_tags(pathname) {
	const segs = pathname.split("/").filter(Boolean);
	const out = [];
	for (let i = 1; i <= Math.min(segs.length, 3); i++) out.push("/" + segs.slice(0, i).join("/"));
	return out;
}
// ../../../core/src/server/sized-lru.ts
var SizedLru = class {
	#entries = /* @__PURE__ */ new Map();
	#bytes = 0;
	max_bytes;
	max_entries;
	constructor(max_bytes, max_entries) {
		this.max_bytes = max_bytes;
		this.max_entries = max_entries;
	}
	/** The live value for `key` (an LRU touch), or `null` on a miss or past `expires`. */
	get(key, now) {
		const e = this.#entries.get(key);
		if (e === void 0) return null;
		if (now >= e.expires) {
			this.delete(key);
			return null;
		}
		this.#entries.delete(key);
		this.#entries.set(key, e);
		return e.value;
	}
	has(key) {
		return this.#entries.has(key);
	}
	/** Store `value` (`bytes` big, live until `expires`), evicting the least recently used entries
	*  to make room. A value larger than the whole budget is not stored. */
	set(key, value, bytes, expires) {
		this.delete(key);
		if (bytes > this.max_bytes) return;
		while (this.#entries.size > 0 && (this.#bytes + bytes > this.max_bytes || this.#entries.size >= this.max_entries)) {
			const oldest = this.#entries.keys().next().value;
			this.delete(oldest);
		}
		this.#entries.set(key, {
			value,
			bytes,
			expires
		});
		this.#bytes += bytes;
	}
	delete(key) {
		const e = this.#entries.get(key);
		if (e === void 0) return false;
		this.#entries.delete(key);
		this.#bytes -= e.bytes;
		return true;
	}
	/** Every live key (insertion order — least recently used first). */
	keys() {
		return this.#entries.keys();
	}
	/** Drop everything past `expires` (harness counts want live entries only). */
	sweep(now) {
		for (const [key, e] of this.#entries) if (now >= e.expires) this.delete(key);
	}
	clear() {
		this.#entries.clear();
		this.#bytes = 0;
	}
	get size() {
		return this.#entries.size;
	}
	get bytes() {
		return this.#bytes;
	}
};
// ../../src/memory-store.ts
/** Resident budget for stored pages (a stored page can be multi-MB; a count alone bounds nothing). */
var DEFAULT_MAX_BYTES = 67108864;
var DEFAULT_MAX_ENTRIES = 1e3;
/** What an entry costs to keep: a page is its HTML; a redirect is a few dozen bytes. */
var entry_bytes = (entry) => entry.kind === "page" ? entry.html.length : 64;
function memory_store(max_entries = DEFAULT_MAX_ENTRIES, max_bytes = DEFAULT_MAX_BYTES) {
	const entries = new SizedLru(max_bytes, max_entries);
	const tag_index = /* @__PURE__ */ new Map();
	return {
		async get(key) {
			return entries.get(key, Date.now());
		},
		async put(key, entry, options) {
			entries.set(key, entry, entry_bytes(entry), Date.now() + options.ttl * 1e3);
			for (const tag of options.tags ?? []) {
				let set = tag_index.get(tag);
				if (!set) tag_index.set(tag, set = /* @__PURE__ */ new Set());
				set.add(key);
			}
		},
		async evict(key) {
			entries.delete(key);
		},
		async evictWhere({ prefix }) {
			const p = normalize_prefix(prefix);
			const subtree = subtree_prefix(p);
			for (const key of entries.keys()) if (key === p || key.startsWith(subtree)) entries.delete(key);
		},
		async evictByTag(tag) {
			const set = tag_index.get(tag);
			if (!set) return [];
			tag_index.delete(tag);
			const evicted = [];
			for (const key of set) if (entries.delete(key)) evicted.push(key);
			return evicted;
		},
		async size() {
			entries.sweep(Date.now());
			return entries.size;
		}
	};
}
// ../../src/app.ts
var slot$1 = globalThis[Symbol.for("ogygia.postrender.app.v1")] ??= { app: null };
function set_postrender_app(app) {
	slot$1.app = app;
}
function postrender_app() {
	return slot$1.app;
}
// ../../src/registry.ts
var slot = globalThis[Symbol.for("ogygia.postrender.v1")] ??= {
	installed: null,
	handled: /* @__PURE__ */ new WeakMap(),
	fallback: null
};
/** A server event into the current request's devtools stream (a no-op unless devtools is on). */
function record(event) {
	postrender_app()?.devtools(event);
}
var warned_replica_blindspot = false;
/** `postrender.handle(options)`'s first half: make these settings this server's runtime. */
function install(options) {
	const edges = [...options.edge ?? []];
	if (edges.length && !options.store && !warned_replica_blindspot) {
		warned_replica_blindspot = true;
		console.warn("[ogygia] postrender: edge adapters are configured but the store is the per-instance memory default — invalidations cannot reach other replicas. Use a shared store (valkey / upstash / cloudflareKv) in multi-instance deploys.");
	}
	const runtime = {
		store: options.store ?? memory_store(),
		edges
	};
	slot.installed = runtime;
	return runtime;
}
/** The handle's per-request half: this request came through it, with these settings. */
function mark_handled(event, runtime) {
	slot.handled.set(event.request, runtime);
}
/** The runtime of the `postrender.handle()` that saw this request first, or null. */
function handled_runtime(event) {
	return slot.handled.get(event.request) ?? null;
}
/** The latest `postrender.handle()` made in this process, or null when hooks.server.ts has none. */
function installed_runtime() {
	return slot.installed;
}
/** This server's runtime: its handle's, else the memory default. */
function current_runtime() {
	return slot.installed ?? (slot.fallback ??= {
		store: memory_store(),
		edges: []
	});
}
function notify_thaw(tags) {
	postrender_app()?.notify.invalidated(tags);
}
/** Evict every stored page carrying ANY of `tags` (origin + every edge). The receiving half of a
*  thaw notice; also what `invalidate(fn, args)` does for one receipt tag. */
async function invalidate_tags(tags, runtime = current_runtime()) {
	const { store, edges } = runtime;
	const evict_by_tag = store.evictByTag?.bind(store);
	if (!evict_by_tag) {
		console.warn("[ogygia] postrender: the configured store has no evictByTag — tag invalidation needs it (memory/valkey/upstash/cloudflareKv all provide it).");
		return [];
	}
	const keys = /* @__PURE__ */ new Set();
	for (const tag of tags) try {
		for (const key of await evict_by_tag(tag)) keys.add(key);
	} catch (e) {
		console.warn(`[ogygia] postrender.invalidate(tags): the store failed to evict tag ${tag} (evictByTag); its pages stay stored until they expire —`, e);
	}
	const jobs = [];
	for (const key of keys) for (const edge of edges) jobs.push(edge_job(edge, (e) => e.purgeUrl(key)));
	await settle_all("invalidate(tags)", jobs);
	return [...keys];
}
async function store_get(runtime, key) {
	try {
		return await runtime.store.get(key);
	} catch {
		return null;
	}
}
async function store_put(runtime, key, entry, options) {
	try {
		await runtime.store.put(key, entry, options);
	} catch {}
}
var inflight = /* @__PURE__ */ new Map();
function join_flight(key) {
	return inflight.get(key) ?? null;
}
function begin_flight(key) {
	let settle;
	const flight = new Promise((res) => {
		settle = res;
	});
	inflight.set(key, flight);
	return (outcome) => {
		inflight.delete(key);
		settle(outcome);
	};
}
/** A call as a promise, a synchronous throw included. */
var attempt = (call) => Promise.resolve().then(call);
var store_job = (op, call) => ({
	what: `the store failed to ${op}`,
	run: attempt(call)
});
var edge_job = (edge, call) => ({
	what: `the purge at edge "${edge.name}" failed`,
	run: attempt(() => call(edge))
});
async function settle_all(label, jobs) {
	(await Promise.allSettled(jobs.map((job) => job.run))).forEach((r, i) => {
		if (r.status === "rejected") console.warn(`[ogygia] postrender.${label}: ${jobs[i].what} —`, r.reason);
	});
}
/**
* Evict everywhere — two shapes:
*   `invalidate('/fr/fr/solar/')`         exact URL (the v1 keying law: publish payloads carry it)
*   `invalidate(loadContent, [args])`     og.source PRECISION: the reverse index answers which
*                                         stored pages consumed `(source, args)` — those exact
*                                         URLs are evicted at origin AND purged at every edge.
* Reaches the store and edges `postrender.handle()` was given in hooks.server.ts.
*/
async function invalidate(target, args) {
	if (typeof target === "string") {
		record({
			domain: "server",
			name: "server.postrender",
			op: "invalidate",
			url: target
		});
		const { store, edges } = current_runtime();
		const jobs = [store_job(`evict ${target}`, () => store.evict(target))];
		for (const edge of edges) jobs.push(edge_job(edge, (e) => e.purgeUrl(target)));
		await settle_all("invalidate", jobs);
		notify_thaw([`p:${target}`]);
		return;
	}
	const tag = source_tag_of(target, args ?? []);
	if (!tag) throw new Error("[ogygia] postrender.invalidate(fn, args): the function is not a declared source — wrap its definition: `export const fn = import.meta.og.source(async (…) => …)`.");
	await invalidate_tags([tag]);
	notify_thaw([tag]);
}
/** Bulk eviction by URL subtree — `{ prefix: '/fr/fr/' }` is a locale nuke, `{ prefix: '/docs' }`
*  a section nuke. One origin scan + one purge per edge (Akamai: prefix tag; CloudFront: wildcard;
*  Cloudflare: prefix purge). */
async function invalidateWhere(filter) {
	const prefix = normalize_prefix(filter.prefix);
	record({
		domain: "server",
		name: "server.postrender",
		op: "invalidate-where",
		url: prefix
	});
	const { store, edges } = current_runtime();
	const jobs = [store_job(`evict prefix ${prefix}`, () => store.evictWhere({ prefix }))];
	for (const edge of edges) jobs.push(edge_job(edge, (e) => e.purgeWhere({ prefix })));
	await settle_all("invalidateWhere", jobs);
	notify_thaw("all");
}
/** Action self-evict: a successful non-GET on a page URL evicts that URL (origin only — the
*  edge copy follows via its s-maxage or the app's explicit invalidate; fire-and-forget). */
function self_evict(runtime, pathname) {
	record({
		domain: "server",
		name: "server.postrender",
		op: "self-evict",
		url: pathname
	});
	runtime.store.evict(pathname).catch(() => {});
}
// ../../src/handle.ts
var warned_unlisted = false;
function handle(options = {}) {
	const runtime = install(options);
	return ({ event, resolve }) => {
		mark_handled(event, runtime);
		if (!postrender_app() && !warned_unlisted) {
			warned_unlisted = true;
			console.warn("[@ogygia/postrender] postrender.handle() runs, but `postrender()` is not listed in vite.config, so no page is stored. Add it: `plugins: [ogygia(), postrender(), sveltekit()]` (from '@ogygia/postrender/vite').");
		}
		return resolve(event);
	};
}
// ../../src/index.ts
/**
* `@ogygia/postrender` — pages stored at request time. SERVER ONLY.
*
* Prerender renders a page at build time; postrender renders it on its first request, stores it
* whole, and serves the stored bytes until an invalidation clears it.
*
* ```ts
* // vite.config: the switch (+ serializable policy)
* import { postrender } from '@ogygia/postrender/vite';
* plugins: [ogygia(), postrender(), sveltekit()]
*
* // hooks.server.ts: the live store and CDN edges, BEFORE ogygia's handle
* import { postrender, valkey, akamai } from '@ogygia/postrender';
* export const handle = sequence(
*   postrender.handle({ store: valkey(client), edge: [akamai(creds)] }),
*   ogygia.handle()
* );
*
* // a route opts out in Kit's own config: export const config = { postrender: false };
*
* // anywhere server-side (CMS publish webhook):
* await postrender.invalidate('/fr/fr/solar/');            // exact URL
* await postrender.invalidate(loadContent, [args]);        // og.source reverse index
* await postrender.invalidateWhere({ prefix: '/fr/fr/' }); // subtree nuke
* ```
*/
var postrender = {
	handle,
	invalidate,
	invalidateWhere
};

export { SizedLru as S, prefix_tags as a, store_get as b, current_runtime as c, begin_flight as d, set_postrender_app as e, store_put as f, installed_runtime as g, handled_runtime as h, invalidate_tags as i, join_flight as j, normalize_prefix as n, postrender as p, self_evict as s };
//# sourceMappingURL=src.js-BoORAn95.js.map
