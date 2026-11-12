/**
 * THE PAGE OF A RENDER — one model for every server render ogygia starts
 * (internal/notes/region-page-context.md).
 *
 * A region always belongs to a page. Which page, and where its facts come from, depends on the
 * request the render runs in — three venues, one answer shape (Kit's `page`):
 *
 *  - IN THE PAGE: a Kit page request. Its render recorded the page (Region.svelte, the routeless
 *    document root): that snapshot IS the page, the live event fills what it lacks.
 *  - FOR A PAGE: a request rendering on behalf of a page it is not — the islands endpoint (a hole, a
 *    batch) or a remote function call (a `query` / `command` rendering a region). Its page is the
 *    same-origin `Referer` (the runtime's and Kit's client fetches send the full URL same-origin).
 *    Identity (url) from there; `page.data`, `params`, `route` from Kit's data request for that page,
 *    looked up once per request and only for a render that reads `page.data` (server/page-facts.ts).
 *  - ITS OWN: anything else (no Referer, cross-origin, an ESI subrequest, a `+server.ts`): the
 *    request's own url, params and route; no `page.data`.
 *
 * Nothing here trusts the browser for data: a Referer only names a page; its facts are the server's,
 * for this visitor, now.
 */
import type { RequestEvent } from '@sveltejs/kit';
import * as devalue from 'devalue';
import { flights, STALE, type Scope } from '@ogygia/machine';
import { request_local } from '../plugin/request-scope.ts';
import { open_reads } from '../plugin/reads.ts';
import { renders_for_a_page } from './endpoint.ts';
import type { KitPage } from './kit-context.ts';
import type { PageSnapshot } from '../page-seed-registry.ts';
import { look_up_page, type PageFacts } from './page-facts.ts';
import { merge_seed_ask, shape_page_data, type SeedAsk, type SeedKeys } from './seed-shape.ts';
import { PAGE_FACTS_SCRIPT_TYPE } from '../page-facts-script.ts';
import { line } from '../messages/server.ts';
import { note_hole_page_read } from './rules.ts';
import { bucket32 } from '../contract/hash.ts';

type Transport = Record<
	string,
	{ decode: (v: unknown) => unknown; encode: (v: unknown) => unknown }
>;

let warn: ((message: string) => void) | null = null;

// the server's rules (./rules.ts): dev and OGYGIA_RULES=1 builds only, folds out of any other
const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);

/** Rules only: requests that skipped the page look-up because the build said their tree reads no
 *  `page.data` (the seed-shaping plugin's answer). A read of it there breaks a rule. */
const skipped_look_up = new WeakSet<Request>();

/** Where a dev warning goes (the handle's setting). */
export function configure_render_page(o: { warn: ((message: string) => void) | null }): void {
	warn = o.warn;
}

export { renders_for_a_page };

/** The page a request renders for: the same-origin Referer of a request rendering for a page, else
 *  the request's own url. The page is the render's identity, not a read about the visitor: a
 *  render that sees it is keyed by it, or not kept (test/render-cache-page-identity.test.ts). */
export function page_url_of(event: RequestEvent): URL {
	if (!renders_for_a_page(event)) return event.url;
	// (past the instance's watched `get`, plugin/reads.ts: the render's own read of it still counts)
	const referer = Headers.prototype.get.call(event.request.headers, 'referer');
	if (!referer) return event.url;
	try {
		const page = new URL(referer);
		if (page.origin === event.url.origin) return page;
	} catch {
		// ok: a malformed referer: the request's own URL
	}
	return event.url;
}

/** What one look-up of a request's page reads. */
type LookUp = {
	page: URL;
	fetch: (input: string, init?: RequestInit) => Promise<Response>;
	decoders: Record<string, (v: unknown) => unknown>;
};
/** Why a page-facts look-up's inputs are not its key: a request has one look-up. */
const ONE_PER_REQUEST = 'a request has one look-up';

/**
 * Each request's look-up of its page's facts, a flight of one key the request owns: looked up once
 * per request (a failed one is not kept), its answer the page's facts (null: unavailable), its
 * streamed reader let go when the request ends.
 */
const looked_up = request_local((owner: Scope) =>
	flights.keyed<LookUp>()({
		name: 'page facts',
		// one look-up: the request owns this flights, and its page, fetch and decoders are its own
		key: [],
		ignore: { page: ONE_PER_REQUEST, fetch: ONE_PER_REQUEST, decoders: ONE_PER_REQUEST },
		run: ({ page, fetch, decoders }): Promise<PageFacts | null> =>
			look_up_page(page, fetch, decoders, owner).then((facts) => {
				if (!('miss' in facts)) return facts;
				warn?.(line('outside_page_data_unavailable', { path: page.pathname, miss: facts.miss }));
				return null;
			})
	})
);

/** The answer each request's look-up gave (null: unavailable), held by the request itself: a render
 *  reads what it was answered, not whatever the flight still keeps (#993,
 *  test/render-page-not-kept.test.ts). */
const answered = new WeakMap<Request, PageFacts | null>();

/** The page's facts this request looked up, or undefined. */
function facts_of(request: Request): PageFacts | undefined {
	return answered.get(request) ?? undefined;
}

/**
 * Before an async render root starts: in a request rendering FOR a page, that page's facts, looked
 * up once. `reads_data`: does this render read `page.data` (`null`: unknown here — a remote call
 * looks up, a hole relies on its tree's build answer). The venue is the request's kind, as Kit and
 * the islands endpoint name it — never whether some per-request state happens to exist.
 */
export function prepare_render_page(
	event: RequestEvent | undefined,
	transport: Transport | undefined,
	reads_data: boolean | null
): Promise<void> | void {
	if (!event || !renders_for_a_page(event)) return;
	if (RULES && reads_data === false) skipped_look_up.add(event.request);
	if (!(reads_data ?? (event as { isRemoteRequest?: boolean }).isRemoteRequest === true)) return;
	const page = page_url_of(event);
	if (page === event.url) return;
	const request = event.request;
	if (answered.has(request)) return;
	const decoders: Record<string, (v: unknown) => unknown> = {};
	for (const name in transport ?? {}) decoders[name] = transport![name].decode;
	// (STALE only once the request has ended: the render goes on without the facts)
	return looked_up(request)
		.get({ page, fetch: event.fetch, decoders })
		.then((facts) => {
			if (facts !== STALE) answered.set(request, facts);
		});
}

/**
 * The page a render sees. `snapshot`: what this request's page render recorded, if anything. `null`
 * when there is neither a snapshot nor a request (a render off-request: the caller's empty page).
 */
export function render_page(
	snapshot: PageSnapshot | undefined,
	event: RequestEvent | undefined
): KitPage | null {
	if (!snapshot && !event) return null;
	if (event && renders_for_a_page(event)) {
		// FOR A PAGE: the Referer's page — its looked-up facts, else its url alone
		const facts = facts_of(event.request);
		const url = facts?.url ?? page_url_of(event);
		const data =
			facts && warn
				? watched_data(facts, warn)
				: (facts?.data ??
					(RULES && skipped_look_up.has(event.request) ? unpredicted_data(url.pathname) : {}));
		return {
			// (its page's url: a read of it is in the render's read set too)
			get url() {
				open_reads()?.page();
				return url;
			},
			params: facts?.params ?? {},
			route: facts?.route ?? { id: null },
			status: 200,
			// (one page's data: a read of it is in the render's read set, plugin/reads.ts)
			get data() {
				if (facts) open_reads()?.page();
				return data;
			},
			form: null,
			error: null,
			state: {}
		};
	}
	// IN THE PAGE (its recorded snapshot, the live event filling the rest) or ITS OWN
	const snap: PageSnapshot = snapshot ?? {};
	return {
		url: snap.url?.href ? new URL(snap.url.href) : event?.url,
		params: snap.params ?? event?.params ?? {},
		route: snap.route ?? { id: event?.route.id ?? null },
		status: snap.status ?? 200,
		data: snap.data ?? {},
		form: snap.form ?? null,
		error: snap.error ?? null,
		state: {}
	};
}

/** Reads a component makes without meaning a page key (Svelte, devalue, a thenable check). */
// static: the property names that are never page keys
const NOT_A_KEY = new Set([
	'then',
	'toJSON',
	'constructor',
	'valueOf',
	'toString',
	'$$typeof',
	'nodeType'
]);
const warned_keys = new WeakMap<PageFacts, Set<string>>();

/** Rules only: the empty `page.data` of a render whose look-up the build skipped. A key read from it
 *  is one the build said this tree never reads (`rule_hole_page_read_unpredicted`). */
function unpredicted_data(path: string): Record<string, unknown> {
	return new Proxy({} as Record<string, unknown>, {
		get(target, key, receiver) {
			if (typeof key === 'string' && !NOT_A_KEY.has(key)) note_hole_page_read(path, key);
			return Reflect.get(target, key, receiver);
		}
	});
}

/**
 * DEV: a render for a page reading a `page.data` key the page's server loads did not produce — most
 * often one a UNIVERSAL load (`+page.ts` / `+layout.ts`) makes, which exists only inside a full page
 * render. Said once per key, naming it, instead of rendering `undefined` silently (a header that
 * comes out "signed out" with no error anywhere).
 */
function watched_data(facts: PageFacts, say: (message: string) => void): Record<string, unknown> {
	return new Proxy(facts.data, {
		get(target, key, receiver) {
			if (typeof key === 'string' && !NOT_A_KEY.has(key) && !(key in target)) {
				let seen = warned_keys.get(facts);
				if (!seen) warned_keys.set(facts, (seen = new Set()));
				if (!seen.has(key)) {
					seen.add(key);
					say(line('outside_page_data_key', { path: facts.url.pathname, key }));
				}
			}
			return Reflect.get(target, key, receiver);
		}
	});
}

const versions = new WeakMap<Request, string>();

/**
 * A HOLE'S ADDRESS NAMES ITS PAGE: the call (id + props) and the page facts its tree renders from.
 * A region refreshed after the page's data changed (a locale saved) re-mints its holes with a new
 * version, so each fetches its new answer; a refresh that changed nothing keeps the address and the
 * answer it has. The version of this request's page: its looked-up facts (a render for a page) or
 * its recorded snapshot (in the page) — hashed once per request; `''` when there is no data.
 */
export function render_page_version(
	event: RequestEvent | undefined,
	snapshot: PageSnapshot | undefined
): string {
	if (!event) return '';
	const known = versions.get(event.request);
	if (known !== undefined) return known;
	const data = renders_for_a_page(event) ? facts_of(event.request)?.data : snapshot?.data;
	let v = '';
	if (data && typeof data === 'object') {
		try {
			v = fnv1a(JSON.stringify(data));
		} catch {
			// ok: a value JSON cannot write (a cycle, a bigint): no version, the address is the call alone
		}
	}
	// (no data yet — a hole minted before the page recorded its snapshot — is not remembered)
	if (v) versions.set(event.request, v);
	return v;
}

/** 32-bit FNV-1a, base36: a version tag, not a security boundary (the same tags as before #484). */
// hash: 32 bits on purpose: it only tags a version (a collision costs one missed re-render, never
// wrong content), and a wider tag would re-tag every hole on deploy for no correctness gain
const fnv1a = (text: string): string => bucket32(text).toString(36);

const asks_of = new WeakMap<Request, SeedKeys>();

/**
 * An island rendering FOR a page asks for the `page.data` keys its client reads (Region.svelte's
 * record, the build's answer): kept for the answer's facts. `true` when the request renders for a
 * page — the ask is this model's, never a page render's snapshot.
 */
export function note_render_page_ask(event: RequestEvent, seed: SeedAsk): boolean {
	if (!renders_for_a_page(event)) return false;
	if (seed !== false) {
		const merged = merge_seed_ask(asks_of.get(event.request) ?? null, seed);
		if (merged) asks_of.set(event.request, merged);
	}
	return true;
}

/**
 * ONE PAGE, NOT TWO: what an answer rendered FOR a page carries — the looked-up `page.data` keys its
 * islands read, so they hydrate against the values their HTML was rendered from (the runtime merges
 * them into the page store: seeds.ts). `''` when no island in it reads the page, the page was not
 * looked up, or a value does not serialize (a still-streaming promise).
 */
export function render_page_facts_script(
	event: RequestEvent | undefined,
	transport: Transport | undefined
): string {
	if (!event || !renders_for_a_page(event)) return '';
	const facts = facts_of(event.request);
	const keys = asks_of.get(event.request);
	if (!facts || !keys) return '';
	const encoders: Record<string, (v: unknown) => unknown> = {};
	for (const name in transport ?? {}) encoders[name] = transport![name].encode;
	try {
		// (devalue output is `<`-safe by itself: no second pass for the script element)
		return `<script type="${PAGE_FACTS_SCRIPT_TYPE}">${devalue.stringify(shape_page_data(facts.data, keys), encoders)}</script>`;
	} catch {
		return '';
	}
}
