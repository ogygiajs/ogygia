import { s as source_tag_of } from './source.js-B4t88Kxi.js';

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
/** Resident budget for frozen pages (a stored page can be multi-MB; a count alone bounds nothing). */
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
var current = null;
function set_freeze_app(app) {
	current = app;
}
function freeze_app() {
	return current;
}
// ../../src/registry.ts
/** A server event into the current request's devtools stream (a no-op unless devtools is on). */
function record(event) {
	freeze_app()?.devtools(event);
}
var store = null;
var edges = [];
function current_store() {
	return store ??= memory_store();
}
var warned_replica_blindspot = false;
/** `freeze.configure({ store, edge })` — hooks.server.ts, before the first request. */
function configure(config) {
	if (config.store) store = config.store;
	if (config.edge) edges = [...config.edge];
	if (edges.length && !config.store && !store && !warned_replica_blindspot) {
		warned_replica_blindspot = true;
		console.warn("[ogygia] freeze: edge adapters are configured but the store is the per-instance memory default — invalidations cannot reach other replicas. Use a shared store (valkey / upstash / cloudflareKv) in multi-instance deploys.");
	}
}
function notify_thaw(tags) {
	freeze_app()?.notify.invalidated(tags);
}
/** Evict every stored page carrying ANY of `tags` (origin + every edge). The receiving half of a
*  thaw notice; also what `invalidate(fn, args)` does for one receipt tag. */
async function invalidate_tags(tags) {
	const store = current_store();
	const evict_by_tag = store.evictByTag?.bind(store);
	if (!evict_by_tag) {
		console.warn("[ogygia] freeze: the configured store has no evictByTag — tag invalidation needs it (memory/valkey/upstash/cloudflareKv all provide it).");
		return [];
	}
	const keys = /* @__PURE__ */ new Set();
	for (const tag of tags) for (const key of await evict_by_tag(tag)) keys.add(key);
	const jobs = [];
	for (const key of keys) for (const edge of edges) jobs.push(edge.purgeUrl(key));
	await settle_all("invalidate(tags)", jobs);
	return [...keys];
}
function current_edges() {
	return edges;
}
async function freeze_get(key) {
	try {
		return await current_store().get(key);
	} catch {
		return null;
	}
}
async function freeze_put(key, entry, options) {
	try {
		await current_store().put(key, entry, options);
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
async function settle_all(label, jobs) {
	const results = await Promise.allSettled(jobs);
	for (const r of results) if (r.status === "rejected") console.warn(`[ogygia] freeze.${label}: an edge purge failed —`, r.reason);
}
/**
* Evict everywhere — two shapes:
*   `invalidate('/fr/fr/solar/')`         exact URL (the v1 keying law: publish payloads carry it)
*   `invalidate(loadContent, [args])`     og.source PRECISION: the reverse index answers which
*                                         stored pages consumed `(source, args)` — those exact
*                                         URLs are evicted at origin AND purged at every edge.
*/
async function invalidate(target, args) {
	if (typeof target === "string") {
		record({
			domain: "server",
			name: "server.freeze",
			op: "invalidate",
			url: target
		});
		const jobs = [current_store().evict(target)];
		for (const edge of edges) jobs.push(edge.purgeUrl(target));
		await settle_all("invalidate", jobs);
		notify_thaw([`p:${target}`]);
		return;
	}
	const tag = source_tag_of(target, args ?? []);
	if (!tag) throw new Error("[ogygia] freeze.invalidate(fn, args): the function is not a declared source — wrap its definition: `export const fn = import.meta.og.source(async (…) => …)`.");
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
		name: "server.freeze",
		op: "invalidate-where",
		url: prefix
	});
	const jobs = [current_store().evictWhere({ prefix })];
	for (const edge of edges) jobs.push(edge.purgeWhere({ prefix }));
	await settle_all("invalidateWhere", jobs);
	notify_thaw("all");
}
/** Action self-evict: a successful non-GET on a page URL evicts that URL (origin only — the
*  edge copy follows via its s-maxage or the app's explicit invalidate; fire-and-forget). */
function self_evict(pathname) {
	record({
		domain: "server",
		name: "server.freeze",
		op: "self-evict",
		url: pathname
	});
	current_store().evict(pathname).catch(() => {});
}
// ../../src/index.ts
/**
* `@ogygia/freeze` — frozen pages (render-on-write). SERVER ONLY.
*
* ```ts
* // vite.config: the switch (+ serializable policy)
* import { freeze } from '@ogygia/freeze/vite';
* plugins: [ogygia(), freeze(), sveltekit()]
*
* // hooks.server.ts: live objects, only for tier 2/3
* import { freeze, valkey, upstash, akamai, cloudfront } from '@ogygia/freeze';
* freeze.configure({ store: valkey(client), edge: [akamai(creds), cloudfront(cfg)] });
*
* // anywhere server-side (CMS publish webhook):
* await freeze.invalidate('/fr/fr/solar/');            // exact URL
* await freeze.invalidate(loadContent, [args]);        // og.source reverse index
* await freeze.invalidateWhere({ prefix: '/fr/fr/' }); // subtree nuke
* ```
*/
var freeze = {
	configure,
	invalidate,
	invalidateWhere
};

export { SizedLru as S, freeze_get as a, begin_flight as b, current_store as c, freeze_put as d, current_edges as e, freeze as f, set_freeze_app as g, invalidate_tags as i, join_flight as j, normalize_prefix as n, prefix_tags as p, self_evict as s };
//# sourceMappingURL=src.js-BillxaDL.js.map
