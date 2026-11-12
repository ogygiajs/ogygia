/**
 * The postrender plugin's server half (imported by the build through
 * `ogygia:server/server-plugins`, with the `postrender({ ttl, default })` options).
 *
 * `page`: the read path. A GET, no query string, not prerendering, on a route that opts in: a stored
 * copy answers — Kit, loads and Svelte never run. A concurrent cold miss JOINS the in-flight render
 * (the stampede law: N concurrent requests, ONE render). The first cold request opens the flight,
 * marks the render `facts.storable` (its holes mint prerender-grade, its data-source receipts are
 * kept) and observes it for personalization. The store and edges are the ones the request's
 * `postrender.handle()` carried in (registry.ts) — which must therefore run before this stage.
 *
 * `response`: the write path. The verdict (nothing personal read, nothing streamed, a cacheable
 * 200 or permanent redirect) stores the page and sends the stored copy; a refusal stamps
 * `private, no-store` when the app set nothing. A successful mutation self-evicts its page.
 *
 * In dev nothing is stored or served — HMR truth beats byte reuse — but the verdict still runs and
 * teaches: an eligible page gets `x-ogygia-postrender: would-store`, a refused one a console note.
 */
import { createHash } from 'node:crypto';
import { building, dev, version } from '$app/env';
import {
	defineServer,
	STORED_DOCUMENT_META,
	type RequestContext,
	type ServerPlugin
} from '@ogygia/core/plugin';
import { clock, flights, STALE, type Flights } from '@ogygia/machine';
import {
	current_runtime,
	enter_flight,
	evict_tags,
	handled_runtime,
	installed_runtime,
	retracting,
	self_evict,
	store_call,
	store_get,
	store_render,
	type Flight,
	type Runtime
} from './registry.ts';
import { observe_event, type Observation } from './observe.ts';
import { esi_rewrite, stitch_html, stitch_modes } from './stitch.ts';
import { set_postrender_app } from './app.ts';
import { warn } from './messages.ts';
import type { PostrenderEntry } from './types.ts';

/** The plugin's serializable policy (`postrender({ ttl, default })`, normalized by the factory). */
export interface PostrenderServerOptions {
	/** TTL backstop, seconds (clamped to [1, 86400]). */
	ttl: number;
	/** The app-wide opt-in: true = every eligible page (a route opts OUT with `export const config
	 *  = { postrender: false }`); false = nothing unless a route opts IN. */
	default: boolean;
}

interface State {
	/** the store + edges this request reads and writes (its `postrender.handle()`'s) */
	runtime: Runtime | null;
	/** the stampede flight this request opened, until it settled it (registry.ts: `stale` once a
	 *  publish landed while it rendered, so it is not stored) */
	flight: Flight | null;
	/** the personalization observation (eligible requests only) */
	obs: Observation | null;
	/** the request was eligible to be stored */
	eligible: boolean;
	/** its render is not stored: the request carried the visitor's credentials */
	credentials: boolean;
}

type Ctx = RequestContext<PostrenderServerOptions, State>;

/** The header a response carries to say how postrender answered it. */
const VIA_HEADER = 'x-ogygia-postrender';

/** Kit's boot declares its deferred map ONLY on pages with pending (streamed) load promises —
 *  verified against @sveltejs/kit 2.70 (render.js: `blocks.push('const deferred = new Map();')`). */
const KIT_DEFERRED_BOOT_RE = /const deferred = new Map\(\);/;

/** The build marker key in the store (NUL-prefixed: no page path can collide with it). */
const BUILD_MARKER_KEY = '\0og:build';
/** How long the store keeps the build marker: ten years. It records a fact (the last build this
 *  store saw), not a page, so the pages' TTL backstop must not apply to it: a deploy a month after
 *  the last one still has to find it. */
const BUILD_MARKER_TTL_SEC = 10 * 365 * 24 * 3600;

/** The tag every page carries for the build that stored it: a new build drops the old one's. */
const build_tag = (build: string): string => `b:${build}`;

/** The deploy checks, per store runtime and build: one per boot, shared by the page path and
 *  federation's `lastBuild` ask (whichever asks first moves the marker; both hear one answer). A
 *  failed check is not kept: the next request tries again. */
const deploys = new WeakMap<Runtime, Flights<string, string | undefined>>();

/**
 * A deploy is a write (internal/notes/freeze.md: prerender is the special case where the only write
 * is a deploy). What makes it one is the entry's build label: a page is served only to the build that
 * stored it ({@link servable}), so no build ever serves another's, a rolling deploy's old instances
 * included. This check is the early cleanup beside it: the build the store saw before this one, whose
 * pages are dropped (origin and edges: an edge never asks the label), then the marker moves to this
 * build. The evict goes first, so one that fails leaves the marker where it was and the next request
 * tries again. test/deploy.test.ts (#947).
 */
function deploy_check(runtime: Runtime, build: string): Promise<string | undefined | typeof STALE> {
	let checks = deploys.get(runtime);
	if (!checks) {
		checks = flights({
			run: async (build: string) => {
				const { store } = runtime;
				const marker = await store_call('get', BUILD_MARKER_KEY, () => store.get(BUILD_MARKER_KEY));
				const seen = marker?.kind === 'page' ? marker.html : undefined;
				if (seen !== undefined && seen !== build) {
					const { failed } = await evict_tags([build_tag(seen)], runtime);
					if (failed.length) throw failed[0];
				}
				// written on every check (once per boot), not only on a change: a store that dropped
				// the marker anyway (memory pressure, a custom store that caps the TTL) has it again
				await store_call('put', BUILD_MARKER_KEY, () =>
					store.put(
						BUILD_MARKER_KEY,
						// wall: stored, read by every instance
						{ kind: 'page', html: build, headers: {}, created: clock.wall() },
						{ ttl: BUILD_MARKER_TTL_SEC, tags: [] }
					)
				);
				return seen;
			}
		});
		deploys.set(runtime, checks);
	}
	return checks.get(build);
}

/** A stored entry this build may serve: one it stored itself (another build's, or one with no build,
 *  is a miss: the label is the deploy's truth), within the TTL backstop (an older one is a miss: a
 *  store with native expiry has dropped it already, one without still lets its pages expire; one
 *  with no usable creation time cannot be aged, and is a miss too). */
function servable(entry: PostrenderEntry, ttl: number): boolean {
	if (entry.build !== version) return false;
	// wall: `created` is an epoch time another process may have written
	const now = clock.wall();
	return Number.isFinite(entry.created) && now - entry.created < ttl * 1000;
}

/** The two setup mistakes the read path can see, with the line that fixes each. */
const SEQUENCE_LINE = 'export const handle = sequence(postrender.handle(), ogygia.handle());';
export const MISSING_HANDLE: string =
	'postrender.handle() is not in src/hooks.server.ts, so pages are kept in this process’s memory ' +
	`store. Add it before ogygia's handle: \`${SEQUENCE_LINE}\``;
export const MISORDERED_HANDLE: string =
	'postrender.handle() must run before ogygia.handle() (the stored page is served before anything ' +
	`renders), and this request reached ogygia first. Put it first: \`${SEQUENCE_LINE}\``;

/**
 * The store + edges for this request: what its `postrender.handle()` carried in. Two mistakes are
 * named here, never silent. No handle made at all → the memory default, with one warning. A handle
 * made but not run before ogygia's (it sits after it in the `sequence()`, or outside it) → in dev an
 * error, so it is fixed before it ships; in production one warning, and the server's runtime serves.
 */
function runtime_of(ctx: Ctx): Runtime {
	const handled = handled_runtime(ctx.event);
	if (handled) return handled;
	const installed = installed_runtime();
	if (!installed) {
		ctx.app.warn(MISSING_HANDLE);
		return current_runtime();
	}
	if (dev) throw new Error(`[${ctx.app.name}] ${MISORDERED_HANDLE}`);
	ctx.app.warn(MISORDERED_HANDLE);
	return installed;
}

/** Rebuild a Response from a stored page. `via` rides a debug header the harness asserts on.
 *  With the incoming `request`, a matching validator answers 304 — plain-HTTP conditional
 *  requests (RFC 9110), which is what makes a CDN or browser revalidation of a stored page cost
 *  zero body bytes. Validators live on the ENTRY, never in edge adapters: they are the render's
 *  identity, not a CDN dialect. */
export function postrender_response(
	entry: PostrenderEntry,
	via: 'hit' | 'join' | 'stored',
	request?: Request
): Response {
	if (entry.kind === 'redirect') {
		return new Response(null, {
			status: entry.status,
			headers: { location: entry.location, [VIA_HEADER]: via }
		});
	}
	if (request) {
		const etag = entry.headers.etag;
		const inm = request.headers.get('if-none-match');
		const ims = request.headers.get('if-modified-since');
		const last_modified = entry.headers['last-modified'];
		const etag_match = !!etag && !!inm && inm.split(',').some((t) => t.trim() === etag);
		// If-None-Match wins when present (RFC 9110 §13.1.3); IMS compares against store time.
		const ims_match =
			!inm && !!ims && !!last_modified && Date.parse(ims) >= Date.parse(last_modified);
		if (etag_match || ims_match) {
			const headers: Record<string, string> = { [VIA_HEADER]: via };
			for (const h of ['etag', 'last-modified', 'cache-control'] as const) {
				if (entry.headers[h]) headers[h] = entry.headers[h];
			}
			return new Response(null, { status: 304, headers });
		}
	}
	return new Response(served_html(entry, via), {
		status: 200,
		headers: { ...entry.headers, [VIA_HEADER]: via }
	});
}

/** The stored page as served: copies served FROM the store carry the doc marker so live regions
 *  self-freshen (`stored` = the render that JUST happened — fresh by definition, no marker). The
 *  marker goes in by slicing at the entry's `</head>` (recorded at capture; found once for an
 *  entry written before the field existed) — never a `replace` over a multi-MB page per hit. */
function served_html(entry: Extract<PostrenderEntry, { kind: 'page' }>, via: string): string {
	if (via === 'stored') return entry.html;
	const at = entry.head_end ?? entry.html.indexOf('</head>');
	return at === -1
		? entry.html
		: entry.html.slice(0, at) + STORED_DOCUMENT_META + entry.html.slice(at);
}

/** Serve-time stitching: fill every `stitch` hole in the stored shell with a fresh SERVER render
 *  (`ctx.renderHole` verifies the hole's own signed MAC and renders with THIS request's event, so
 *  the visitor's cookies ride in and the splice is personalized in the first response). FAIL-OPEN
 *  per hole (a null render keeps the fallback + client fetch). hit/join serves still carry the doc
 *  marker first, so live regions inside keep self-freshening. */
async function serve_stitched(
	entry: Extract<PostrenderEntry, { kind: 'page' }>,
	via: 'hit' | 'join' | 'stored',
	ctx: Ctx
): Promise<Response> {
	const html = await stitch_html(served_html(entry, via), (endpoint) => ctx.renderHole(endpoint));
	return new Response(html, {
		status: 200,
		headers: { ...entry.headers, [VIA_HEADER]: via }
	});
}

function serve(
	entry: PostrenderEntry,
	via: 'hit' | 'join',
	ctx: Ctx
): Promise<Response> | Response {
	return entry.kind === 'page' && entry.stitch
		? serve_stitched(entry, via, ctx)
		: postrender_response(entry, via, ctx.event.request);
}

/** The verdict's other word: a REFUSED page gets `private, no-store` when the app set nothing —
 *  per-page proven headers replace blanket CDN rules in both directions. Best-effort (some
 *  platforms hand out immutable headers). */
function stamp_no_store(response: Response): void {
	try {
		if (response.status !== 200) return;
		if (!(response.headers.get('content-type') ?? '').includes('text/html')) return;
		if (response.headers.get('cache-control')) return;
		response.headers.set('cache-control', 'private, no-store');
	} catch {
		// ok: immutable headers; the app's platform's headers win
	}
}

/** DEV teaching leg: the verdict runs but never stores/serves. Eligible → a `would-store`
 *  header to read in the network panel; refused → ONE console note per path naming the read. */
const dev_noted_paths = new Set<string>();
function dev_postrender_note(response: Response, ctx: Ctx, obs: Observation): void {
	const refusal =
		obs.disqualified_by ??
		(obs.wrote_cookie ? 'a cookie write' : null) ??
		(response.status !== 200 ? `status ${response.status}` : null) ??
		(response.headers.has('set-cookie') ? 'a set-cookie response header' : null) ??
		(!(response.headers.get('content-type') ?? '').includes('text/html')
			? 'a non-html response'
			: null) ??
		(ctx.facts.streamed ? 'streamed load promises' : null);
	if (!refusal) {
		try {
			response.headers.set(VIA_HEADER, 'would-store');
		} catch {
			// ok: immutable headers; a dev hint only, the page is unchanged
		}
		return;
	}
	if (dev_noted_paths.has(ctx.path)) return;
	dev_noted_paths.add(ctx.path);
	warn('postrender_stays_per_request', { path: ctx.path, refusal });
}

/** What a capture did: stored an entry (with the Response to send), or refused to. A refusal made
 *  after the body was read carries a Response rebuilt from it: the original's body is spent. */
type Captured =
	| { stored: true; entry: PostrenderEntry; response: Response }
	| { stored: false; response: Response | null };

/** A refusal made before the body was read: the original Response is still whole. */
const REFUSED: Captured = { stored: false, response: null };

/**
 * The write-path verdict + store. Returns the stored entry AND a fresh Response (reading the
 * body consumes the original), or a refusal when the page must stay per-request. Pre-body guards
 * run FIRST so an ineligible response's stream is never consumed.
 */
async function capture(
	response: Response,
	ctx: Ctx,
	runtime: Runtime,
	obs: Observation,
	ttl: number,
	flight: Flight
): Promise<Captured> {
	const { path, facts } = ctx;
	const tags = [...(facts.sources ?? []), build_tag(version)];
	/** Store `entry`, unless an invalidation started while the store was being written to (the
	 *  flight went stale; its evict may have run first): then the entry comes back out, and the
	 *  page stays per-request (no hit is served from it meanwhile, `retracting`). Labeled with this
	 *  build: it is served to this build only ({@link servable}). */
	const put = (entry: PostrenderEntry): Promise<boolean> =>
		store_render(runtime, path, { ...entry, build: version }, { ttl, tags }, flight);
	// Personalization observed (cookie/header/locals/flag read, or a cookie write) → per-request.
	if (obs.disqualified_by || obs.wrote_cookie) return REFUSED;
	// Permanent redirects are the hottest cheap wins (canonical 301s) — store status + location.
	if (response.status === 301 || response.status === 308) {
		const location = response.headers.get('location');
		if (!location) return REFUSED;
		const entry: PostrenderEntry = {
			kind: 'redirect',
			status: response.status,
			location,
			created: clock.wall() // wall: stored, read by every instance
		};
		if (!(await put(entry))) return REFUSED;
		return { stored: true, entry, response };
	}
	if (response.status !== 200) return REFUSED;
	if (response.headers.has('set-cookie')) return REFUSED;
	const content_type = response.headers.get('content-type') ?? '';
	if (!content_type.includes('text/html')) return REFUSED;
	const app_cc = response.headers.get('cache-control') ?? '';
	if (app_cc.includes('private') || app_cc.includes('no-store')) return REFUSED;
	if (facts.streamed) return REFUSED; // streamed page — always per-request
	const html = await response.text();
	/** The page as Kit answered it, again (its body was read above). */
	const answered = (): Response =>
		new Response(html, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers
		});
	// Belt and braces for streamed pages WITHOUT regions (no page snapshot to probe): Kit's boot
	// only declares its deferred-map when the page carries pending promises — buffering such a
	// response bakes ONE settle's inline resolve scripts into the copy. Never store it.
	if (KIT_DEFERRED_BOOT_RE.test(html)) return { stored: false, response: answered() };
	const created = clock.wall(); // wall: stored, read by every instance
	// STITCH holes, two modes (stitch.ts):
	//  - `stitch="serve"` flips the entry's nature: the SHELL stores (renders once), but every
	//    serve is per-visitor (holes re-render + splice at ORIGIN). So: no shared-cache headers, no
	//    edge instructions, no validators — a 304 would skip the re-stitch. Edge policy: BYPASS.
	//    One serve hole taints the whole page (edge holes on it are served-stitched too).
	//  - `stitch="edge"` (only): the page stays a NORMAL edge-cacheable entry — its holes are
	//    rewritten into ESI includes the CDN fills per request (shell from cache, origin renders
	//    one region), and the entry is stamped `Surrogate-Control: content="ESI/1.0"` so an
	//    ESI-capable edge processes them. Validators are minted over the REWRITTEN bytes.
	const modes = stitch_modes(html);
	const has_serve = modes.serve;
	const stored_html = !has_serve && modes.edge ? esi_rewrite(html, path) : html;
	// The verdict's storage instructions: ours first, then each edge's (an edge may grant its own
	// cache-control — later wins). Merged into the STORED entry too, so hits replay them.
	// Validators ride the entry: the etag IS the render's identity, `last-modified` its store
	// time — every later revalidation (CDN prefresh, browser reload) can answer 304.
	const headers: Record<string, string> = has_serve
		? { 'content-type': content_type, 'cache-control': 'private, no-store' }
		: {
				'content-type': content_type,
				'cache-control': `public, s-maxage=${ttl}`,
				etag: `"${createHash('sha256').update(stored_html).digest('hex').slice(0, 32)}"`,
				'last-modified': new Date(created).toUTCString(),
				...(modes.edge ? { 'surrogate-control': 'content="ESI/1.0"' } : {})
			};
	if (!has_serve) {
		for (const edge of runtime.edges) {
			try {
				Object.assign(headers, edge.headers({ url: path, ttl }));
			} catch {
				// ok: an edge adapter never fails a render; the page is stored without that edge's headers, and the edge serves it by its own rules
			}
		}
	}
	const entry: PostrenderEntry = {
		kind: 'page',
		html: stored_html,
		head_end: stored_html.indexOf('</head>'),
		headers,
		created,
		...(has_serve ? { stitch: true } : {})
	};
	if (!(await put(entry))) return { stored: false, response: answered() };
	return { stored: true, entry, response: postrender_response(entry, 'stored') };
}

/** What a route lets postrender store: nothing, pages from requests without the visitor's
 *  credentials (`true`), or also from requests with them (`'with-credentials'`). */
type Storing = false | true | 'with-credentials';

/** This request's value for the `postrender` key of Kit's `config` (the route's, merged from its
 *  layouts), or the app-wide default when no level sets one. */
function opted_in(ctx: Ctx): Storing {
	const declared = ctx.routeConfig('postrender');
	if (typeof declared === 'boolean' || declared === 'with-credentials') return declared;
	if (declared !== undefined)
		ctx.app.warn(
			`\`config.postrender\` must be true, false or 'with-credentials' (got ${JSON.stringify(declared)}); the app-wide default applies.`
		);
	return ctx.options.default;
}

/** The request carries the visitor's credentials: a cookie or an `authorization` header. Read
 *  before the render's reads are watched (they are not the render's). */
function credentialed(request: Request): boolean {
	return request.headers.has('cookie') || request.headers.has('authorization');
}

const server: ServerPlugin<PostrenderServerOptions, State> = defineServer<
	PostrenderServerOptions,
	State
>({
	setup(app) {
		set_postrender_app(app);
	},

	state: () => ({ runtime: null, flight: null, obs: null, eligible: false, credentials: false }),

	async page(ctx) {
		const { event, path, facts, state } = ctx;
		const runtime = (state.runtime = runtime_of(ctx));
		// (a page request only: a remote call carries its page's URL, test/remote-call.test.ts)
		const storing =
			!ctx.forPage &&
			!facts.private &&
			!building &&
			event.request.method.toUpperCase() === 'GET' &&
			event.url.search === '' &&
			!path.endsWith('__data.json') &&
			!facts.answerForm &&
			opted_in(ctx);
		if (!storing) return;
		// A request with the visitor's credentials is answered from the store, but its render is
		// stored only where the route says the page is the same with them: test/plugin.test.ts › "a
		// page rendered for one visitor is never served to another"
		const may_store = storing === 'with-credentials' || !credentialed(event.request);
		state.eligible = true;
		if (dev) {
			// observe only: the verdict teaches in `response`, nothing stores
			state.obs = observe_event(ctx);
			return;
		}
		// a deploy is a write: the entry's build label decides (servable); a boot's first read also
		// starts the old build's pages' early cleanup, which no read waits for
		deploy_check(runtime, version).then(undefined, () => {}); // ok: the store's failure was said; the next request checks again
		const hit = await store_get(runtime, path);
		// (another build's entry, or one past its TTL, is a miss: the render below stores a fresh one
		// over it; so is one a stale render is taking back out, which may be the page from before a
		// publish, #332)
		if (hit && servable(hit, ctx.options.ttl) && !retracting(path)) {
			ctx.app.devtools({ domain: 'server', name: 'server.postrender', op: 'hit', url: path });
			return serve(hit, 'hit', ctx);
		}
		if (!may_store) {
			state.credentials = true;
			ctx.app.devtools({
				domain: 'server',
				name: 'server.postrender',
				op: 'skip',
				url: path,
				reason: 'credentials'
			});
			return;
		}
		let flight = enter_flight(path);
		while ('joined' in flight) {
			const outcome = await flight.joined;
			// An invalidation ended the render it waited on (it may be the page from before the
			// publish): ask again, so the requests let go share one new render.
			if (outcome === STALE) {
				flight = enter_flight(path);
				continue;
			}
			if (outcome.stored) {
				ctx.app.devtools({ domain: 'server', name: 'server.postrender', op: 'join', url: path });
				return serve(outcome.stored, 'join', ctx);
			}
			// The flight proved the page ineligible — render per-request, no new flight
			// (a chain of flights would serialize renders of a page that never stores).
			return;
		}
		// First cold request: open the flight + observe the render for the verdict.
		state.flight = flight.opened;
		state.obs = observe_event(ctx);
		facts.storable = true;
		facts.sources ??= []; // keep the render's data-source receipts: the page's reverse index
	},

	async response(ctx, response) {
		const { event, path, state } = ctx;
		const runtime = state.runtime ?? current_runtime();
		// Action self-evict — a successful mutation on a page URL evicts its stored copy (mirrors
		// Kit's actions-invalidate-loads semantics; origin store only). The response waits for it:
		// the redirect's GET comes right after, and must not get the copy from before (#283).
		if (event.request.method.toUpperCase() !== 'GET' && response.status < 400)
			await self_evict(runtime, path);
		const { flight, obs } = state;
		if (flight && obs) {
			state.flight = null;
			const settle = (stored: PostrenderEntry | null) => flight.settle({ stored });
			// Invalidated while it rendered (the flight went stale): this render may be the page as it
			// was before the publish. It goes to the visitor who asked; nothing stores it, and joiners
			// render the page anew. Stamped no-store like every refusal (when the app set nothing): a
			// CDN's property-wide TTL must not keep the pre-publish page, nor a personalized one that
			// never reached the personalization guards below.
			if (flight.stale) {
				stamp_no_store(response);
				settle(null);
				ctx.app.devtools({
					domain: 'server',
					name: 'server.postrender',
					op: 'skip',
					url: path,
					reason: 'invalidated-while-rendering'
				});
				return;
			}
			// A failed flight ALWAYS settles (joiners in the stampede must never hang), and a store
			// problem never fails the request.
			try {
				const captured = await capture(response, ctx, runtime, obs, ctx.options.ttl, flight);
				settle(captured.stored ? captured.entry : null);
				ctx.app.devtools(
					captured.stored
						? {
								domain: 'server',
								name: 'server.postrender',
								op: 'stored',
								url: path,
								bytes: captured.entry.kind === 'page' ? captured.entry.html.length : 0
							}
						: {
								domain: 'server',
								name: 'server.postrender',
								op: 'skip',
								url: path,
								reason: obs.disqualified_by ?? 'response-ineligible'
							}
				);
				if (captured.stored) {
					return captured.entry.kind === 'page' && captured.entry.stitch
						? await serve_stitched(captured.entry, 'stored', ctx)
						: captured.response;
				}
				// Refused → per-request forever (until inputs change). Stamp `no-store` when the app set
				// nothing: the verdict's word replaces blanket CDN rules in BOTH directions (a personal
				// page must never be edge-cached by a property-wide TTL). A refusal after the body was
				// read sends the page rebuilt from it (the original's body is spent).
				stamp_no_store(captured.response ?? response);
				if (captured.response) return captured.response;
			} catch {
				settle(null);
			}
		} else if (state.credentials) {
			// (rendered for this visitor: no shared cache keeps it either)
			stamp_no_store(response);
		} else if (dev && obs && state.eligible) {
			dev_postrender_note(response, ctx, obs);
		}
	},

	// The request's end, however it ended: a flight it opened and nothing settled (a later plugin
	// answered `page()`, a plugin's `response()` threw, the render threw before the response stage)
	// settles here, so the requests that joined it render the page themselves instead of waiting
	// forever (#194).
	done(ctx) {
		const { state } = ctx;
		if (!state.flight) return;
		state.flight.settle({ stored: null });
		state.flight = null;
	},

	// SHARED HOOK — a peer said these tags are stale (federation's inbound thaw): drop the pages.
	// Never re-announced. A tag the store failed to evict throws, once the rest is evicted: the
	// peer then answers an error and the sender sends the notice again (#287).
	async invalidate(tags) {
		const { failed } = await evict_tags(tags);
		if (failed.length === 1) throw failed[0];
		if (failed.length > 1)
			throw new AggregateError(failed, `${failed.length} tags failed to evict`);
	},

	// SHARED HOOK — deploy thaw: the build the store saw before this one, from the one deploy check
	// the page path runs too (a new build has dropped this app's own pages by the time it answers).
	async lastBuild(build) {
		const seen = await deploy_check(current_runtime(), build);
		// (never dropped: a check is STALE only if its flights were, and these never are)
		return seen === STALE ? undefined : seen;
	}
});
export default server;
