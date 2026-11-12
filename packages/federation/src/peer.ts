/**
 * A peer handle — one transport per remote app (signing, timeout, an SWR document cache whose
 * reads are one flight per key, invalidation by tag), plus the region builders `page()` /
 * `widget()`. The peer is request-agnostic: per-request facts (claims, traceparent) are call
 * arguments, so one instance is shared across requests.
 */
import {
	buggify,
	clock,
	flights,
	net,
	noop,
	STALE,
	timers,
	world,
	type Flights
} from '@ogygia/machine';
import { error, isHttpError as is_http_error } from '@ogygia/router';
import type { RegionValue } from '@ogygia/core';
import { htmlRegion as og_html_region } from '@ogygia/core/plugin';
import {
	current_request_scope,
	next_tag,
	OG_FRAGMENT_FAILED,
	value_at
} from '@ogygia/core/internal/server';
import { decodeText, escapeAttr } from '@ogygia/core/plugin/utils';
import { fed_app } from './app.ts';
import { warn } from './messages.ts';
import {
	absolutize,
	sign_headers,
	child_traceparent,
	FRAGMENT_ROUTES_PATH,
	FRAGMENT_BASE,
	OFF_SITE_PATH_RE,
	fragment_document,
	widget_document,
	type Claims,
	type FragmentDocument,
	type WidgetDocument
} from './wire.ts';
import { hole_url, mint_hole } from './hole.ts';
import type { Peer, PeerConfig, RemoteDials } from './types.ts';

declare const __OGYGIA_RULES__: boolean | undefined;
/** Dev and rules builds (a buggify point); folded out of any other. */
const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);

const HOST_UNSAFE_G = /[^a-zA-Z0-9_-]/g;
/** A region element's tag name, and a cheap test for whether `html` may hold one. */
const REGION = 'ogygia-region';
const REGION_NEEDLE = /<ogygia-region/i;

/** A failed hop, said once with its code: an answer that can't be used (an error status, or not its
 *  JSON document: `federation_peer_answer_invalid`), or no answer at all (`federation_peer_unreachable`).
 *  `status` is what a page read, a post or a hole answers: the peer's own 503 or 504 (busy or down,
 *  worth trying later), 504 for no answer, else a 502. */
class HopFailed extends Error {
	override name = 'HopFailed';
	readonly status: 502 | 503 | 504;
	constructor(what: string, status: number) {
		// (the message is what a visitor's error page may show: no peer name, no URL)
		super(`fragment app ${what}`);
		this.status = status === 503 || status === 504 ? status : 502;
	}
}

/** The status a failed hop answers with, whatever read it: a {@link HopFailed} says its own, an error
 *  a page read already threw keeps its status, and anything else (a request that ended its own
 *  hop) is a 504, as a page read's is. Test: test/hole-peer-failure.test.ts (#937). */
export function hop_failure_status(e: unknown): number {
	if (e instanceof HopFailed || is_http_error(e)) return e.status;
	return 504;
}

/** What a static widget shows when its peer's answer could not be read: the page still renders. */
const FRAGMENT_FAILED = `<div ${OG_FRAGMENT_FAILED} style="border:1px dashed #dc2626;border-radius:8px;padding:1rem;color:#dc2626">This section is temporarily unavailable.</div>`;

/** The one rule for what the document cache keeps, on the first fill and on every refresh: a
 *  successful answer that is not a redirect. */
const cacheable = (doc: FragmentDocument): boolean => !doc.location && doc.status < 400;

/** What a read of path+search+claims asks for. */
interface Read {
	path: string;
	search: string;
	/** The claims, spelled (empty: none). */
	claims_key: string;
	claims: Claims | undefined;
	traceparent: string | undefined;
}

/** A read's answer: the document, with the fragment's source tags so a thaw notice can drop
 *  exactly the stale ones. */
interface Fetched {
	doc: FragmentDocument;
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
	/** The world the peer's documents are made in, one stamp per source tag: a thaw moves the tags it
	 *  names, a mutation or a thaw of everything moves the whole of it. */
	#sources = world.keyed<string>();
	/** The document reads: one flight per key. A successful, non-redirect answer is kept (with a
	 *  ttl), up to `cache.max` of them; a stale one is served while a fresh flight refreshes it. A
	 *  move of the sources drops what it touches: a kept document that carries a moved tag, and a
	 *  fetch out whose answer does once it lands (a thaw cannot tell an answer's tags before then, so
	 *  a fetch for other tags goes on, #294). A caller of a dropped flight reads again. */
	#docs: Flights<Read, Fetched, Pick<Read, 'path' | 'search' | 'claims_key'>>;

	constructor(name: string, cfg: PeerConfig, me: string, sign_key?: string) {
		this.#origins = Array.isArray(cfg.origin) ? cfg.origin : [cfg.origin];
		this.#cfg = cfg;
		this.#sign_key = sign_key;
		this.#timeout = cfg.timeout ?? 5000;
		const ttl = (this.#ttl = cfg.cache?.ttl ?? 0);
		this.#docs = flights.keyed<Read>()({
			name: 'federation peer documents',
			key: ['path', 'search', 'claims_key'],
			ignore: {
				claims: 'claims_key spells them',
				traceparent: 'the trace of the read that started it: how it is traced, not what is read'
			},
			run: (read, signal) => this.#fetch_read(read, signal),
			world: this.#sources,
			touches: (answer) => answer.tags,
			keep: (answer) => (ttl > 0 && cacheable(answer.doc) ? Infinity : 0),
			max: cfg.cache?.max ?? 500
		});
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
		const claims_key = claims ? JSON.stringify(claims) : '';
		const read: Read = { path, search, claims_key, claims, traceparent };
		const key = { path, search, claims_key };
		const docs = this.#docs;
		// the request reading it: once it ends it waits no more, and once every request waiting on
		// a fetch has ended, the fetch is aborted
		const signal = current_request_scope()?.signal;
		for (;;) {
			const seen = docs.peek(key);
			// wall: a flights entry's `at` is a wall timestamp
			if (
				seen?.kind === 'kept' &&
				(clock.wall() - seen.at >= this.#ttl ||
					// (buggify: its ttl just ran out, so it is served stale while a fresh flight runs)
					(RULES && buggify.fires('federation.doc-stale')))
			) {
				// stale: served as it is while one fresh flight refreshes it (an error answer, or a
				// failure, leaves the good copy kept, and the next stale read tries again)
				if (!seen.flying) docs.get(read, { fresh: true }).then(undefined, noop); // ok: the good copy stays served and the next stale read tries again; a read with no copy throws the failure
				return this.#used(seen.answer.doc);
			}
			let answer: Fetched | typeof STALE;
			try {
				answer = await docs.get(read, { signal });
			} catch (e) {
				if (is_http_error(e)) throw e;
				error(504, 'This section is temporarily unavailable.');
			}
			if (answer !== STALE) return this.#used(answer.doc);
			if (signal?.aborted) throw signal.reason;
			// a mutation or a thaw dropped the flight this read joined: what it fetched may be the
			// page from before, so read again
		}
	}

	/** Transport: a mutation document — bypasses and invalidates the cache. A mutation is out from
	 *  its start to its end, and the upstream may answer a read in that span from before it or after
	 *  it: the sources move at both ends, so a read out at its start reads again, and nothing read
	 *  while it was out is kept past its end (#331). */
	async postDoc(
		path: string,
		search: string,
		body: ArrayBuffer,
		content_type: string,
		claims?: Claims,
		traceparent?: string
	): Promise<FragmentDocument> {
		this.#sources.bump();
		try {
			return this.#used(
				await this.#raw_doc(
					path,
					search,
					{ method: 'POST', headers: { 'content-type': content_type, origin: this.origin }, body },
					claims,
					traceparent
				)
			);
		} finally {
			this.#sources.bump();
		}
	}

	/** Transport: a raw widget document. */
	async widgetDoc(
		widget_name: string,
		props: Record<string, string> = {},
		w: { claims?: Claims; traceparent?: string } = {}
	): Promise<WidgetDocument> {
		const origins = this.#origins;
		// (the request asking: its end aborts the fetch)
		const signal = current_request_scope()?.signal;
		let res: Response | undefined;
		let last_err: unknown;
		for (let i = 0; i < origins.length; i++) {
			const u = new URL(FRAGMENT_BASE + widget_name, origins[i]);
			for (const [k, v] of Object.entries(props)) u.searchParams.set(k, v);
			try {
				res = await this.#signed_fetch(u, undefined, w.claims, w.traceparent, signal);
			} catch (e) {
				last_err = e;
				if (signal?.aborted) break;
				continue;
			}
			if (res.status < 500 || i === origins.length - 1) break;
		}
		const doc = await this.#answer(res, 'widget', { error: last_err, signal });
		return { ...doc, html: this.#own_endpoints(doc.html) };
	}

	/** Every hop's answer, read as the JSON document it should be. No answer at all (down,
	 *  unreachable, past the timeout) or one that can't be used (an error status, or a body that does
	 *  not parse, or parses as another shape: a byte changed on the way, a proxy's error page or
	 *  JSON) is said with its code and thrown as a {@link HopFailed}; a hop the asking request ended
	 *  itself throws its own error, unsaid. A page's 404 is a document: the peer's own not-found page.
	 *  test/peer-answer-invalid.test.ts (#929, #931), test/peer-unreachable.test.ts (#933),
	 *  test/property-peer-answer.test.ts (#1103). */
	async #answer<K extends 'page' | 'widget'>(
		res: Response | undefined,
		kind: K,
		none: { error: unknown; signal?: AbortSignal }
	): Promise<K extends 'page' ? FragmentDocument : WidgetDocument> {
		if (!res) {
			if (none.signal?.aborted)
				throw none.error instanceof Error ? none.error : new Error(String(none.error));
			warn('federation_peer_unreachable', { peer: this.name, url: this.origin });
			throw new HopFailed('gave no answer', 504);
		}
		const url = res.url || this.origin;
		if (!res.ok && !(kind === 'page' && res.status === 404)) {
			res.body?.cancel().then(undefined, noop); // ok: the answer is not read, only let go
			const what = `a ${res.status}`;
			warn('federation_peer_answer_invalid', { peer: this.name, url, what });
			throw new HopFailed(`answered ${what}`, res.status);
		}
		const text = await res.text();
		let doc: FragmentDocument | WidgetDocument | null;
		try {
			const parsed: unknown = JSON.parse(text);
			doc = kind === 'page' ? fragment_document(parsed) : widget_document(parsed);
		} catch {
			doc = null; // ok: not JSON is not the document either, said just below
		}
		if (doc === null) {
			const what = 'something that is not its JSON document';
			warn('federation_peer_answer_invalid', { peer: this.name, url, what });
			throw new HopFailed('answered no document', res.status);
		}
		return doc as K extends 'page' ? FragmentDocument : WidgetDocument;
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
		let doc: WidgetDocument;
		try {
			doc = await this.widgetDoc(widget_name, props, { claims: dials.claims });
		} catch (e) {
			// (said already: the page renders, the card stands in the widget's place)
			if (e instanceof HopFailed)
				return { ...og_html_region(FRAGMENT_FAILED), html: FRAGMENT_FAILED };
			throw e;
		}
		return this.#bake_static({ body: doc.html, sources: doc.sources });
	}

	/** Thaw: drop cached documents carrying any of these tags (`'all'` = every entry). */
	drop(tags: ReadonlySet<string> | 'all'): void {
		// (a kept document, or the one a refresh is out beside, that carries a thawed tag goes; a fetch
		// with nothing kept yet goes on, and its answer is judged by its own tags when it lands)
		if (tags === 'all') this.#sources.bump();
		else this.#sources.bump(tags);
	}

	/** A read's fetch: the document, with the source tags it carries. */
	async #fetch_read(read: Read, signal: AbortSignal): Promise<Fetched> {
		const doc = await this.#raw_doc(
			read.path,
			read.search,
			undefined,
			read.claims,
			read.traceparent,
			signal
		);
		return { doc, tags: this.#adopt_tags(doc) };
	}

	#signed_fetch(
		u: URL,
		init: SignedInit | undefined,
		claims?: Claims,
		traceparent?: string,
		signal?: AbortSignal
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
		return net.fetch(u, {
			signal: timers.timeout(this.#timeout, signal),
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
		traceparent?: string,
		signal?: AbortSignal
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
				res = await this.#signed_fetch(u, init, claims, traceparent, signal);
			} catch (e) {
				last_err = e;
				if (signal?.aborted) break;
				continue;
			}
			if (res.status < 500 || i === pool.length - 1) break;
		}
		let doc: FragmentDocument;
		try {
			doc = await this.#answer(res, 'page', { error: last_err, signal });
		} catch (e) {
			if (e instanceof HopFailed) error(e.status, e.message);
			throw e;
		}
		// (an answer read means a response came)
		const answered = res!.url;
		// its runtime's origin becomes a code origin of the page that uses it (#856): only from an
		// answer of this peer's own origins (a redirect elsewhere is not the peer), only http(s)
		const runtime = doc.runtime === undefined ? null : this.#own_url(doc.runtime, answered);
		if (runtime === null) delete doc.runtime;
		return doc;
	}

	/** `url` when the answer came from one of this peer's origins and it is an http(s) URL, else
	 *  null. `answered`: the answer's final URL (after any redirect). */
	#own_url(url: string, answered: string): string | null {
		try {
			if (!this.#origins.some((o) => new URL(o).origin === new URL(answered).origin)) return null;
			const u = new URL(url);
			return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
		} catch {
			return null; // ok: not a URL: no origin to allow
		}
	}

	/** A document this request uses: its runtime's origin joins the request's code origins, so the
	 *  page's runtime loads the peer's islands from where the peer serves them (core
	 *  runtime/code-origins.ts), and its region endpoints become this request's holes. A kept
	 *  document is not changed: each request mints its own. */
	#used(doc: FragmentDocument): FragmentDocument {
		if (doc.runtime) {
			const facts = fed_app()?.current();
			if (facts) (facts.codeOrigins ??= []).push(new URL(doc.runtime).origin);
		}
		const body = this.#own_endpoints(doc.body);
		return body === doc.body ? doc : { ...doc, body };
	}

	/**
	 * `html` as this app serves it: each region endpoint of this peer's own (a server island's hole,
	 * a lake's, on one of its origins) becomes a hole of this app's that forwards there. The browser
	 * asks its page's origin, as for every hole (INVARIANTS.md · HOLE-TRUST), and chooses no part of
	 * it. An endpoint on any other origin stays as it came, and the runtime refuses it.
	 * Test: test/peer-endpoints.test.ts (#910).
	 */
	#own_endpoints(html: string): string {
		if (!REGION_NEEDLE.test(html)) return html;
		let out = '';
		let kept = 0;
		for (let t = next_tag(html, REGION, 0); t !== null; t = next_tag(html, REGION, t.next)) {
			const value = t.attr('endpoint');
			if (!value) continue;
			const at = value_at(html, t, REGION, 'endpoint');
			const target = at === -1 ? null : this.#own_target(decodeText(value));
			if (target === null) continue;
			const url = hole_url({ peer: this.name, kind: 'endpoint', target, search: '' });
			if (!url) continue;
			// (the new value is written in double quotes whatever quoted the old one: `escapeAttr`
			// escapes for those, and a path may hold a `'`)
			const q = html.charCodeAt(at - 1);
			const quoted = q === 34 || q === 39 ? 1 : 0;
			out += `${html.slice(kept, at - quoted)}"${escapeAttr(url)}"`;
			kept = at + value.length + quoted;
		}
		return kept === 0 ? html : out + html.slice(kept);
	}

	/** The path and query `url` names on one of this peer's origins (a relative one, on its first),
	 *  else null. */
	#own_target(url: string): string | null {
		try {
			const u = new URL(url, `${this.origin}/`);
			if (!this.#origins.some((o) => new URL(o).origin === u.origin)) return null;
			return u.pathname + u.search;
		} catch {
			return null; // ok: not a URL: nothing to forward to
		}
	}

	/**
	 * Transport: one of this peer's own region endpoints (`target`, a hole its fragment carried), asked
	 * as the browser would ask it, on this peer's origins only. An expired capability of the peer's is
	 * renewed by the peer, once. The answer as this app serves it (its assets and endpoints pinned like
	 * a fragment's), `204` (keep the fallback), or null when the answer is not the region's (a
	 * redirect, an error status, no answer): the hole says so and the fallback stands.
	 */
	async endpoint(
		target: string,
		traceparent?: string
	): Promise<{ status: 200; html: string } | { status: 204 } | null> {
		if (OFF_SITE_PATH_RE.test(target) || !target.startsWith('/')) return null;
		const signal = current_request_scope()?.signal;
		for (const origin of this.#origins) {
			const u = new URL(target, origin);
			if (u.origin !== new URL(origin).origin) return null;
			const ask = (url: URL) =>
				net.fetch(url, {
					redirect: 'manual',
					signal: timers.timeout(this.#timeout, signal),
					headers: traceparent ? { traceparent } : {}
				});
			let res: Response;
			try {
				res = await ask(u);
				if (res.status === 403 && res.headers.get('x-ogygia-deny') === 'expired') {
					const renewal = new URL(u);
					renewal.searchParams.set('renew', '1');
					res = await ask(renewal);
				}
			} catch {
				if (signal?.aborted) return null;
				continue; // ok: a replica that does not answer: the next is asked
			}
			if (res.status >= 500) continue;
			if (res.status === 204) return { status: 204 };
			if (res.status !== 200) return null;
			return { status: 200, html: this.#own_endpoints(absolutize(await res.text(), u.origin)) };
		}
		return null;
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
