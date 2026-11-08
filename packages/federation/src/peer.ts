/**
 * A peer handle — one transport per remote app (signing, timeout, SWR document cache, coalescing,
 * generation-safe invalidation), plus the region builders `page()` / `widget()`. Ported from the
 * v1 `client()`; the transport internals are unchanged. The peer is request-agnostic: per-request
 * facts (claims, traceparent) are call arguments, so one instance is shared across requests.
 */
import { error, isHttpError as is_http_error } from '@ogygia/router';
import type { RegionValue } from '@ogygia/core';
import { htmlRegion as og_html_region } from '@ogygia/core/plugin';
import { fed_app } from './app.ts';
import {
	sign_headers,
	child_traceparent,
	FRAGMENT_ROUTES_PATH,
	FRAGMENT_BASE,
	type Claims,
	type FragmentDocument,
	type WidgetDocument
} from './wire.ts';
import { mint_hole } from './hole.ts';
import type { Peer, PeerConfig, RemoteDials } from './types.ts';

const HOST_UNSAFE_G = /[^a-zA-Z0-9_-]/g;

/** The one rule for what the document cache keeps, on the first fill and on every refresh: a
 *  successful answer that is not a redirect. */
const cacheable = (doc: FragmentDocument): boolean => !doc.location && doc.status < 400;

/** path+search+claims → cached document; the entry also carries the fragment's source tags so
 *  a thaw notice can drop exactly the stale ones. */
interface Entry {
	doc: FragmentDocument;
	at: number;
	tags: Set<string>;
}

type SignedInit = RequestInit & { body?: ArrayBuffer };

/**
 * One peer handle. `me` is the federating app's name (the tag prefix a consumed fragment's
 * receipts are filed under); `sign_key` is its private key (undefined = calls go unsigned).
 */
export class PeerHandle implements Peer {
	readonly name: string;
	readonly origin: string;
	readonly label: string;
	#cfg: PeerConfig;
	#sign_key: string | undefined;
	#origins: string[];
	#timeout: number;
	#ttl: number;
	#cache_max: number;
	#cache = new Map<string, Entry>();
	// oxlint-disable-next-line ogygia/no-promise-cache -- not moved yet: a flights drop answers the callers of an in-flight fetch STALE, where a thaw today still hands them its document, and a partial thaw cannot tell an in-flight answer's tags before it lands (#294); the move needs that rule decided first
	#inflight = new Map<string, Promise<FragmentDocument>>();
	// Invalidation generation: an in-flight fetch that STARTED before a mutation/thaw cleared the
	// cache must not repopulate it with stale data when it lands.
	#generation = 0;

	constructor(name: string, cfg: PeerConfig, me: string, sign_key?: string) {
		this.#origins = Array.isArray(cfg.origin) ? cfg.origin : [cfg.origin];
		this.#cfg = cfg;
		this.#sign_key = sign_key;
		this.#timeout = cfg.timeout ?? 5000;
		this.#ttl = cfg.cache?.ttl ?? 0;
		this.#cache_max = cfg.cache?.max ?? 500;
		this.name = name;
		this.origin = this.#origins[0];
		this.label = cfg.label ?? name ?? new URL(this.origin).host.replace(HOST_UNSAFE_G, '-');
	}

	/** Transport (used by `mount()`): the page DOCUMENT for a path (cache/SWR/coalescing). */
	async doc(
		path: string,
		search: string,
		claims?: Claims,
		traceparent?: string
	): Promise<FragmentDocument> {
		const key = path + '?' + search + '\0' + (claims ? JSON.stringify(claims) : '');
		const ttl = this.#ttl;
		const hit = ttl > 0 ? this.#cache.get(key) : undefined;
		if (hit) {
			this.#cache_put(key, hit); // LRU touch
			if (Date.now() - hit.at >= ttl && !this.#inflight.has(key)) {
				const gen = this.#generation;
				const p = this.#raw_doc(path, search, undefined, claims, traceparent).then((doc) => {
					// an error answer never replaces the good copy (the next stale read retries)
					if (gen === this.#generation && cacheable(doc))
						this.#cache_put(key, { doc, at: Date.now(), tags: this.#adopt_tags(doc) });
					return doc;
				});
				this.#track(key, p);
			}
			return hit.doc;
		}
		let p = this.#inflight.get(key);
		if (!p) {
			const gen = this.#generation;
			p = this.#raw_doc(path, search, undefined, claims, traceparent).then((doc) => {
				if (gen === this.#generation && ttl > 0 && cacheable(doc))
					this.#cache_put(key, { doc, at: Date.now(), tags: this.#adopt_tags(doc) });
				return doc;
			});
			this.#track(key, p);
		}
		try {
			return await p;
		} catch (e) {
			if (is_http_error(e)) throw e;
			error(504, 'This section is temporarily unavailable.');
		}
	}

	/** Transport: a mutation document — bypasses and invalidates the cache. */
	async postDoc(
		path: string,
		search: string,
		body: ArrayBuffer,
		content_type: string,
		claims?: Claims,
		traceparent?: string
	): Promise<FragmentDocument> {
		this.#generation++;
		this.#cache.clear();
		this.#inflight.clear();
		return this.#raw_doc(
			path,
			search,
			{ method: 'POST', headers: { 'content-type': content_type, origin: this.origin }, body },
			claims,
			traceparent
		);
	}

	/** Transport: a raw widget document. */
	async widgetDoc(
		widget_name: string,
		props: Record<string, string> = {},
		w: { claims?: Claims; traceparent?: string } = {}
	): Promise<WidgetDocument> {
		const origins = this.#origins;
		let res: Response | undefined;
		let last_err: unknown;
		for (let i = 0; i < origins.length; i++) {
			const u = new URL(FRAGMENT_BASE + widget_name, origins[i]);
			for (const [k, v] of Object.entries(props)) u.searchParams.set(k, v);
			try {
				res = await this.#signed_fetch(u, undefined, w.claims, w.traceparent);
			} catch (e) {
				last_err = e;
				continue;
			}
			if (res.status < 500 || i === origins.length - 1) break;
		}
		if (!res) throw last_err instanceof Error ? last_err : new Error(String(last_err));
		if (!res.ok) throw new Error(`fragment '${widget_name}' answered ${res.status}`);
		return (await res.json()) as WidgetDocument;
	}

	async page(path: string, dials: RemoteDials & { search?: string } = {}): Promise<RegionValue> {
		const search = dials.search ?? '';
		if (dials.render === 'deferred')
			return mint_hole(this.name, 'page', path, search, dials.claims);
		const doc = await this.doc(path, search, dials.claims, child_traceparent().traceparent);
		return this.#bake_static(doc);
	}

	async widget(
		widget_name: string,
		props: Record<string, string> = {},
		dials: RemoteDials = {}
	): Promise<RegionValue> {
		if (dials.render === 'deferred')
			return mint_hole(
				this.name,
				'widget',
				widget_name,
				new URLSearchParams(props).toString(),
				dials.claims
			);
		const doc = await this.widgetDoc(widget_name, props, { claims: dials.claims });
		return this.#bake_static({ body: doc.html, sources: doc.sources });
	}

	/** Thaw: drop cached documents carrying any of these tags (`'all'` = every entry). */
	drop(tags: ReadonlySet<string> | 'all'): void {
		this.#generation++;
		this.#inflight.clear();
		if (tags === 'all') {
			this.#cache.clear();
			return;
		}
		for (const [key, entry] of this.#cache) {
			for (const t of entry.tags) {
				if (tags.has(t)) {
					this.#cache.delete(key);
					break;
				}
			}
		}
	}

	/** `p` is THE request for `key` until it ends; then it leaves, but only if it is still the one
	 *  there (a drop or a mutation may have started a newer one meanwhile: removing that one let the
	 *  next read start yet another upstream fetch, #210). */
	#track(key: string, p: Promise<FragmentDocument>): void {
		this.#inflight.set(key, p);
		const leave = () => {
			if (this.#inflight.get(key) === p) this.#inflight.delete(key);
		};
		p.then(leave, leave);
	}

	#cache_put(key: string, entry: Entry): void {
		const cache = this.#cache;
		if (cache.has(key)) cache.delete(key);
		else if (cache.size >= this.#cache_max) cache.delete(cache.keys().next().value as string);
		cache.set(key, entry);
	}

	#signed_fetch(
		u: URL,
		init: SignedInit | undefined,
		claims?: Claims,
		traceparent?: string
	): Promise<Response> {
		const signed = this.#sign_key
			? sign_headers(
					this.#sign_key,
					init?.method ?? 'GET',
					u,
					init?.body,
					claims,
					this.#cfg.audience
				)
			: {};
		return fetch(u, {
			signal: AbortSignal.timeout(this.#timeout),
			...init,
			headers: {
				...(init?.headers as Record<string, string>),
				...signed,
				...(traceparent ? { traceparent } : {})
			}
		});
	}

	async #raw_doc(
		path: string,
		search: string,
		init?: SignedInit,
		claims?: Claims,
		traceparent?: string
	): Promise<FragmentDocument> {
		const is_read = !init?.method || init.method === 'GET';
		const pool = is_read ? this.#origins : [this.origin]; // mutations never fail over (double-write risk)
		let res: Response | undefined;
		let last_err: unknown;
		for (let i = 0; i < pool.length; i++) {
			const u = new URL(FRAGMENT_ROUTES_PATH, pool[i]);
			u.searchParams.set('path', path);
			if (search) u.searchParams.set('search', search);
			try {
				res = await this.#signed_fetch(u, init, claims, traceparent);
			} catch (e) {
				last_err = e;
				continue;
			}
			if (res.status < 500 || i === pool.length - 1) break;
		}
		if (!res) throw last_err;
		if (!res.ok && res.status !== 404) error(502, `fragment app answered ${res.status}`);
		return (await res.json()) as FragmentDocument;
	}

	/** Prefix a remote fragment's own receipt tags with THIS peer's name, so the consuming page's
	 *  frozen entry files them and a peer's thaw notice matches. `p:<path>` → `p:<peer>:<path>`;
	 *  `s:…`/`r:…` → `r:<peer>:…`; a chain arrives already `via`-prefixed. Always add the blanket
	 *  `a:<peer>` so a deploy thaw (which sends 'all') reaches every page that touched this peer. */
	#adopt_tags(doc: { sources?: string[]; path?: string }): Set<string> {
		const name = this.name;
		const tags = new Set<string>([`a:${name}`]);
		if (doc.path) tags.add(`p:${name}:${doc.path}`);
		for (const t of doc.sources ?? []) tags.add(`r:${name}:${t}`);
		return tags;
	}

	/** Adopt a fetched fragment's receipts into THIS render's freeze capture (so the consuming page
	 *  freezes with tags tying it to the peer), and return its region value. */
	#bake_static(doc: {
		css?: string[];
		head?: string;
		body: string;
		sources?: string[];
		path?: string;
	}): RegionValue {
		// the fragment's data-source receipts join this render's (a store's reverse index, a fragment of
		// our own reporting what it read), when the request is collecting them
		const sources = fed_app()?.current()?.sources;
		if (sources) for (const tag of this.#adopt_tags(doc)) sources.push(tag);
		// css links + head bits ride in the body; Region.svelte / the runtime hoist links to <head>
		const html = (doc.css?.join('') ?? '') + (doc.head ?? '') + doc.body;
		// The top-level `html` field marks this as an AWAITED-inline region: it renders inline via
		// RawHtml (props.html) AND crosses a Kit load's wire as a baked HTML-only ticket (the
		// transport's encode_region packs `html`; without it, it would throw "not awaited").
		return { ...og_html_region(html), html };
	}
}
