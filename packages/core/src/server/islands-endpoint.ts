/**
 * THE ISLANDS ENDPOINT: a signed region's answer (`GET <base>/__ogygia__?id=…&sig=…`), a batch of
 * them (`POST`, a navigation's single flight), and a plugin's stitch of one hole into a stored page.
 * The handle (../hooks.ts) makes one only where the build's feature word holds the frames feature
 * (a region of the app streams HTML): a build without one carries none of this.
 *
 * @packageDocumentation
 */
import { render } from 'svelte/server';
import { clock } from '@ogygia/machine';
import type { Component } from 'svelte';
import type { RequestEvent } from '@sveltejs/kit';
import * as devalue from 'devalue';
import {
	load_server_regions,
	region_url,
	region_name,
	render_region,
	region_css,
	session_cookie
} from 'ogygia:server';
import { signing_key } from './signing-key.ts';
import { measures } from 'ogygia:server/server-plugins';
import { kit_page_ready, kit_page_facts_tail } from './kit-context.ts';
import { hole_answer_context } from './answer-context.ts';
import { page_url_of } from './render-page.ts';
import { absolutize_hole_html } from './hole-urls.ts';
import { read_capped } from './capped-body.ts';
import { KEEP_FALLBACK_HTML, is_keep_fallback } from '../keep-fallback.ts';
import { kit_asset } from '../kit-paths.ts';
import { region_sign, type RegionClaim } from './hmac.ts';
import { is_region_ttl, is_signed_number, region_verify } from './capability-check.ts';
import { expiry_refusal } from './shared-cache.ts';
import { app_lifetime } from './region-endpoint.ts';
import { create_region_request, type RegionRequest } from './region-request.ts';
import { render_cache_key, cached_render, type RenderKey } from './render-cache.ts';
import { render as render_policy } from '../policies.ts';
import { B64Url } from './payload.ts';
import { REF_WIRE_KEY, ref_reviver } from '../ref.ts';
import { facts_of } from '../plugin/facts.ts';
import { observe_reads } from '../plugin/reads.ts';
import { live_event } from './live-event.ts';
import { request_scope } from '../plugin/request-scope.ts';
import type { HtmlPass } from '../plugin/index.ts';
import { register_wire_kind } from '../live-transport.ts';
import { register_store_kind, register_derived_kind } from '../store-transport.ts';
import { register_snippet_kind } from '../region-snippet.ts';
import { register_fn_kind } from '../fn-transport.ts';
import {
	capability_query,
	islands_endpoint,
	MAX_REGION_PROPS_LEN,
	REGION_CAPABILITY_VERSION,
	is_region_id,
	REGION_EXP_DIGITS
} from './endpoint.ts';
import { batch_stream } from './stream-regions.ts';
import { hole_head } from './hole-graph.ts';
import type { RateLimiter } from './rate-limit.ts';
import {
	ConcurrencyGate,
	REGION_RENDER_CONCURRENCY,
	is_run_timeout
} from '../runtime/concurrency.ts';
import { hole_copy_key } from '../contract/hash.ts';
import { region_css_tag } from './region-css.ts';
import {
	record_hole_stats,
	record_batch_hole_stats,
	has_batch_hole_listener
} from './request-stats.ts';
import { DEVTOOLS_COOKIE, DEVTOOLS_ON } from '../contract/switch.ts';
import { warn } from '../messages/server.ts';
import { ask } from '../plugin/hooks.ts';
import {
	client_ip,
	over_budget,
	region_denied,
	region_response,
	type RegionDeny
} from './region-response.ts';

const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;

const MAX_REGION_BODY = 2_000_000;

const MAX_BATCH_BODY = 512 * 1024;

const say_bad_signature: (id: string) => void = $dev(function say_bad_signature(id: string): void {
	warn('endpoint_bad_signature', { id });
});

/** The abandoned renders already told (one render's timeout reaches every call that joined it). */
const told_abandoned = new WeakSet<Error>();

/** What the endpoint reads of the handle that serves it. */
export interface EndpointHost {
	/** the cheap pre-HMAC budget: forged traffic pays this, not the render budget */
	readonly probe_rate: RateLimiter;
	/** the render budget a valid capability is charged */
	readonly render_rate: RateLimiter;
	/** charges `ip` one render; true when its budget is spent */
	render_over(ip: string): boolean;
	/** the app's own pass over a region's answer, if a plugin has one */
	pass(event: RequestEvent): HtmlPass | undefined;
	/** whether a hole's server tree reads `page.data` */
	reads_page_data(id: string): boolean;
}

function foreign_key(k: string | null): boolean {
	return k !== null && k !== signing_key().fp;
}

interface Capability {
	id: string;
	render: string;
	payload: string;
	exp: string;
	v: string;
	ttl: string;
	wakes: string;
	sig: string;
	k: string | null;
}

function claim_of(cap: Capability, session: string): RegionClaim {
	return {
		id: cap.id,
		payload: cap.payload,
		session,
		ttl: cap.ttl,
		render: cap.render,
		wakes: cap.wakes
	};
}

function capability_of(params: URLSearchParams): Capability {
	return {
		id: params.get('id') ?? '',
		render: params.get('r') ?? '',
		payload: params.get('props') ?? '',
		exp: params.get('exp') ?? '',
		v: params.get('v') ?? '',
		ttl: params.get('ttl') ?? '',
		wakes: params.get('w') ?? '',
		sig: params.get('sig') ?? '',
		k: params.get('k')
	};
}

function capability_target(cap: Capability): string | null {
	if (Object.hasOwn(region_url, cap.id)) return cap.id;
	if (cap.render !== '' && Object.hasOwn(render_region, cap.render))
		return render_region[cap.render];
	return null;
}

function region_css_links(id: string): string {
	const url = region_url[id];
	if (!url) return '';
	let out = '';
	for (const href of region_css(url)) {
		out += region_css_tag(href, kit_asset(href));
	}
	return out;
}

type RegionModule = { default: unknown };
type RegionLoader = () => Promise<RegionModule>;

/** A built server's region modules, kept once they loaded: each `import()` walks Node's module
 *  loader again (a resolve and a module job), three per hole request. A failed load is not kept, so
 *  the next request loads it again; a dev server keeps nothing (an edit replaces the module). */
export class RegionModules {
	#table: Record<string, RegionLoader> | null = null;
	readonly #loaders = new Map<string, RegionLoader>();
	readonly #kept = new Map<string, RegionModule>();

	/** `target`'s loader, or null when the build has no such region. */
	async loader(target: string): Promise<RegionLoader | null> {
		const table = this.#table ?? (await this.#load_table());
		const load = table[target];
		if (typeof load !== 'function') return null;
		if (import.meta.env.DEV) return load;
		let kept_load = this.#loaders.get(target);
		if (kept_load === undefined) {
			kept_load = () => {
				const kept = this.#kept.get(target);
				if (kept !== undefined) return Promise.resolve(kept);
				return load().then((mod) => {
					this.#kept.set(target, mod);
					return mod;
				});
			};
			this.#loaders.set(target, kept_load);
		}
		return kept_load;
	}

	async #load_table(): Promise<Record<string, RegionLoader>> {
		const { regions } = await load_server_regions();
		if (!import.meta.env.DEV) this.#table = regions;
		return regions;
	}
}

/** The islands endpoint of one handle. */
export class IslandsEndpoint {
	/** Process-local cap on concurrent region SSR (M1 CPU amp under valid MAC): one for every
	 *  endpoint of the process, made with the first. */
	static #gate: ConcurrencyGate | null = null;

	readonly #host: EndpointHost;
	readonly #render_gate: ConcurrencyGate;
	readonly #modules = new RegionModules();

	constructor(host: EndpointHost) {
		this.#host = host;
		this.#render_gate = IslandsEndpoint.#gate ??= new ConcurrencyGate(REGION_RENDER_CONCURRENCY);
	}

	/**
	 * Batch frame stream (client navigation, single-flight). POST body: a JSON `string[]` of signed
	 * region endpoints — the calls the client needs. Renders them in parallel and flushes each as a
	 * `<template data-ogygia-slot="sig">…</template>` frame the moment IT settles (out of order); a
	 * done sentinel ends it. One response, many frames. Every call carries its own MAC so there's no
	 * extra auth; same-origin + per-IP budget mirror the single-region path.
	 */
	async render_batch(event: RequestEvent): Promise<Response> {
		const MAX_BATCH = 32;
		if (event.request.headers.get('sec-fetch-site') === 'cross-site')
			return region_denied('cross-site');
		const ip = client_ip(event);
		if (!ip) return region_response('Too Many Requests', { status: 429 });
		// (each hole is charged as its own GET would be, in #render_capability: one budget unit, one
		// render, whichever door it comes in by)
		// A batch is at most MAX_BATCH signed endpoints (~8.5kB each): a body past the cap is refused
		// as soon as it passes it, chunked or not (test/batch-body-cap.test.ts)
		const body = await read_capped(event.request, MAX_BATCH_BODY);
		if (body === 'too large') return region_response('Payload Too Large', { status: 413 });
		if (body === 'unreadable') return region_response('Bad Request', { status: 400 });
		let parsed: unknown;
		try {
			parsed = JSON.parse(new TextDecoder().decode(body));
		} catch {
			return region_response('Bad Request', { status: 400 });
		}
		if (!Array.isArray(parsed) || parsed.length === 0) {
			return region_response('Bad Request', { status: 400 });
		}
		// (one call asked twice is one render: its one parcel answers both)
		const calls = [...new Set(parsed.filter((e): e is string => typeof e === 'string'))].slice(
			0,
			MAX_BATCH
		);
		// (the stream's signal aborts when the visitor leaves: the holes not rendered yet never are)
		const stream = batch_stream(
			calls,
			(endpoint, signal) => this.#render_capability(endpoint, event, true, signal, ip),
			request_scope(event.request)
		);

		return region_response(stream, {
			status: 200,
			headers: {
				'content-type': 'text/html; charset=utf-8',
				'cache-control': 'no-store',
				'x-accel-buffering': 'no'
			}
		});
	}

	/** One signed hole rendered in place with THIS request's event (a plugin's `ctx.renderHole`:
	 *  the stored-page stitch). Null keeps the fallback: a refused capability, a failed render, or
	 *  an answer that asks to keep it. */
	async render_hole(endpoint: string, event: RequestEvent): Promise<string | null> {
		const out = await this.#render_capability(endpoint, event);
		return out && out.html !== KEEP_FALLBACK_HTML ? out.html : null;
	}

	/**
	 * `render()` the island under the concurrency gate + timeout. Returns the HTML body, or `null`
	 * if the render threw or timed out. Shared by the endpoint ({@link render_region}) and the
	 * batch path ({@link #render_capability}).
	 */
	async #render_component(
		/** the hole's region id: its answer's slot ids carry it */
		id: string,
		load: () => Promise<{ default: unknown }>,
		props: Record<string, unknown>,
		/** the hole wakes (its capability's signed `w`): rendered inside an island, as it hydrates */
		wakes: boolean,
		cache?: { key: RenderKey; ttl: number },
		/** the profiler's hole economics: what the cache did for this request */
		report?: (outcome: 'hit' | 'miss' | 'none') => void,
		/** filled when the render ran: its wait for a slot in the gate, and its time in it */
		timing?: { queue_ms?: number; render_ms?: number },
		/** the endpoint request's URL: the answer's island graph is made root-absolute against it */
		base?: URL,
		/** the hole's server tree reads `page.data`: its page is looked up before it renders (a cache
		 *  hit never pays it) */
		reads_page_data = false,
		/** aborts when nobody waits on this render any more (a cancelled batch): one not started
		 *  yet never starts, and never takes a render slot (#245) */
		signal?: AbortSignal
	): Promise<string | null> {
		// R6/G2: the ONE cache-fronted render seam. `cached_render` serves a memo when the hole opted
		// into a positive `maxAge` (key carries the session seal — a per-user render never crosses
		// users); on a miss it runs the render_body below, once for every call of its key in flight
		// (they join it: one slot for a burst, #244). The ENDPOINT wraps its render in the
		// concurrency gate + timeout (the inline-island path, sharing `cached_render`, does not).
		const render_body = async (): Promise<string> => {
			const mod = await load();
			const rendered = render(mod.default as Component<Record<string, unknown>>, {
				props,
				context: hole_answer_context(wakes, id)
			});
			// (with what its islands wrote into the head — their graph and their CSS: the endpoint
			// ships the body only — server/hole-graph.ts)
			const out = await rendered;
			const body = out.body as string;
			if (body === KEEP_FALLBACK_HTML) return body;
			// (and the page facts its islands read: they hydrate against what it rendered from)
			return hole_head(out.head as string, base) + body + kit_page_facts_tail();
		};
		const render_gate = this.#render_gate;
		try {
			return await cached_render(
				// (`render_signal`: this call's own, or a shared render's — aborted once nobody waits)
				async (render_signal) => {
					const gated = { deadline_ms: render_policy.deadline, signal: render_signal };
					// the page first, outside the gate: a render slot is never held while Kit runs the
					// page's loads (and a cache hit never gets here)
					await kit_page_ready(reads_page_data);
					if (!timing) return render_gate.run(render_body, gated);
					// the wait for a slot, and the time in it. A slot is held for the whole render,
					// awaits included: a hole waiting on slow data keeps the next one queued
					const asked = clock.mono();
					return render_gate.run(async () => {
						const entered = clock.mono();
						timing.queue_ms = entered - asked;
						try {
							return await render_body();
						} finally {
							timing.render_ms = clock.mono() - entered;
						}
					}, gated);
				},
				cache,
				report,
				signal,
				(name) => {
					const ev = live_event();
					return ev ? ask.evaluateFlag(ev.request, ev, name) : undefined;
				}
			);
		} catch (e) {
			// `keepFallback()` ends a render on purpose: the page's fallback is right for this
			// visitor. Carried as a marker string so the cache/batch/endpoint seams stay string-typed.
			if (is_keep_fallback(e)) return KEEP_FALLBACK_HTML;
			// nobody waits on it: nothing to say, and nothing to answer
			if (signal?.aborted) return null;
			// The first render abandoned while none was: a production log line too, as renders that
			// outlive their deadline usually await something that hangs. (Said by one call: the calls
			// that joined a cached hole's render get the same error, render_cache.ts)
			if (is_run_timeout(e) && render_gate.abandoned === 1 && !told_abandoned.has(e as Error)) {
				told_abandoned.add(e as Error);
				warn('region_render_abandoned', { ms: render_policy.deadline });
			}
			// The response is an opaque 500 ("Region render failed"); the reason belongs in the
			// server's log, in production as in dev (test/hole-throw-said.test.ts)
			warn('region_render_failed', e);
			return null;
		}
	}

	/** A hole's render cache: none for a `ttl` of 0 (a dynamic hole). A cached hole's memo key is the
	 *  call and the visitor's session, and — when its tree reads `page.data` — the page it renders for
	 *  (one page's facts never answer another page's hole). Its render notes the event's personal
	 *  reads (a cookie, a header, `locals`): one that read them is not kept for others (#434). */
	#hole_cache(
		id: string,
		payload: string,
		wakes: boolean,
		event: RequestEvent,
		ttl: number,
		reads_page_data: boolean
	): { key: RenderKey; ttl: number } | undefined {
		if (ttl <= 0) return undefined;
		const key = render_cache_key(
			id,
			payload,
			this.#region_session(event),
			reads_page_data ? page_url_of(event).href : null,
			wakes
		);
		observe_reads(event, facts_of(event.request).reads);
		return { key, ttl };
	}

	/** The session cookie value sealed into a region capability (empty when no `sessionCookie` is
	 *  configured) — the same read the MAC verify uses, and the per-user part of the render-cache key. */
	#region_session(event: RequestEvent): string {
		return session_cookie ? (event.cookies.get(session_cookie) ?? '') : '';
	}

	// ── Shared capability core ──────────────────────────────────────────────────────────────────
	// The endpoint ({@link render_region}) and the batch path ({@link #render_capability}) MUST verify
	// identically — a one-sided change to the MAC message or the props reviver would weaken auth on one
	// path only. The three security-critical steps live here, once. Each caller keeps its OWN failure
	// shaping (403/500 + rate-limit interleaving vs null→client-fetch), which is where they legitimately
	// differ; only the trust decisions are shared.

	/**
	 * Every check a capability passes BEFORE any HMAC (P5-HMAC-CPU), in order: charset/length (ids
	 * are 12-hex from the transform; `ttl` is signed, but charset-gated here so a forged value never
	 * reaches a response header; `exp` and `ttl` in their one spelling, server/endpoint.ts
	 * `is_signed_number`), expiry (a renewal instead needs one inside the renew window: a URL
	 * that has not expired never renews), and the signing key it names. Null when it passes, else why
	 * it is refused.
	 */
	#capability_precheck(cap: Capability, renewal = false): RegionDeny | null {
		if (
			!is_region_id(cap.id) ||
			(cap.render !== '' && !is_region_id(cap.render)) ||
			cap.payload.length > MAX_REGION_PROPS_LEN ||
			!is_region_ttl(cap.ttl) ||
			!is_signed_number(cap.exp, REGION_EXP_DIGITS) ||
			cap.v !== REGION_CAPABILITY_VERSION ||
			(cap.wakes !== '' && cap.wakes !== '1')
		)
			return 'shape';
		const expiry = expiry_refusal(
			cap.exp,
			Math.floor(clock.wall() / 1000), // wall: against the capability's signed epoch expiry
			renewal,
			app_lifetime.renew_window
		);
		if (expiry) return expiry;
		if (foreign_key(cap.k)) return 'foreign-key';
		return null;
	}

	/**
	 * RENEWAL (server/shared-cache.ts): re-sign an EXPIRED capability this app minted for an
	 * anonymous hole — the rescue for a hole on a document a cache kept longer than the hole's
	 * capability. Refused (null) unless the visitor carries no session and the MAC over the ORIGINAL
	 * tuple verifies with an empty session: nothing session-bound is ever renewed, and only a URL the
	 * app itself put in public HTML can be. The caller has already gated shape + the renew window
	 * and charged the probe budget. Returns the fresh `exp` + `sig`.
	 */
	#renew_capability(cap: Capability, event: RequestEvent): Capability | null {
		if (this.#region_session(event) !== '') return null;
		const key = signing_key();
		const claim = claim_of(cap, '');
		const late = app_lifetime.renew_window;
		if (!region_verify(key.secret, islands_endpoint(), cap.v, cap.exp, claim, cap.sig, late))
			return null;
		const exp = app_lifetime.renewed_expiry();
		return {
			...cap,
			exp: String(exp),
			sig: region_sign(key.secret, islands_endpoint(), exp, claim),
			k: key.fp
		};
	}

	/** THE auth check: the region capability's signature, for this endpoint, sealed to the session
	 *  cookie (if any), with its render identity inside when it has one (server/hmac.ts). */
	#verify_region_mac(cap: Capability, event: RequestEvent): boolean {
		const claim = claim_of(cap, this.#region_session(event));
		return region_verify(signing_key().secret, islands_endpoint(), cap.v, cap.exp, claim, cap.sig);
	}

	/** Eval the island module (registers transportable codecs the reviver needs on a cold-start defer),
	 *  then decode + revive the props payload. Null on parse failure or a non-object/array result. */
	async #decode_region_props(
		payload: string,
		load: () => Promise<unknown>
	): Promise<Record<string, unknown> | null> {
		let props: unknown;
		try {
			await load();
			// universal decode; remember:false — the SERVER never memoizes (per-request isolation)
			register_wire_kind();
			register_store_kind();
			register_snippet_kind();
			register_fn_kind();
			register_derived_kind();
			props = devalue.parse(B64Url.decode(payload), {
				[REF_WIRE_KEY]: ref_reviver(false)
			} as Parameters<typeof devalue.parse>[1]);
		} catch (e) {
			// in production as in dev: reached only with a capability this key signed, and the
			// answer stays opaque (test/hole-props-decode-said.test.ts)
			warn('endpoint_props_decode_failed', e);
			return null;
		}
		if (props === null || typeof props !== 'object' || Array.isArray(props)) return null;
		return props as Record<string, unknown>;
	}

	/**
	 * Batch (single-flight navigation): verify a hole's OWN signed capability URL and render it in-process. Same
	 * trust boundary as the endpoint (verify the MAC before touching the manifest), but every failure —
	 * bad/expired MAC, unknown id, non-serializable props, render error, oversize — resolves to
	 * `null` so the hole silently falls back to a client fetch. Never throws.
	 */
	async #render_capability(
		endpoint: string,
		event: RequestEvent,
		/** A BATCH parcel is the hole's answer: through the app's transform like its own request, and
		 *  logged for the profiler as a hole request. A postrender stitch splices into a stored document
		 *  and stays as it was. */
		batch = false,
		/** the batch's: aborts when its visitor left (nothing more is verified, loaded or rendered) */
		signal?: AbortSignal,
		/** the visitor a batch charges, per hole, as its GET would (PROBE-THEN-RENDER): a probe before
		 *  the MAC, a render after it. Over budget: no parcel, and the hole fetches on its own. A
		 *  postrender stitch (its own stored page, no visitor) is charged nothing. */
		ip?: string
	): Promise<{ slot: string; html: string } | null> {
		const r = create_region_request();
		const parcel = await this.#capability_parcel(r, endpoint, event, batch, signal, ip);
		r.go(parcel === null ? 'refused' : 'sent');
		return parcel;
	}

	/** {@link #render_capability}'s steps, each move taken before its work (server/region-request.ts). */
	async #capability_parcel(
		r: RegionRequest,
		endpoint: string,
		event: RequestEvent,
		batch: boolean,
		signal: AbortSignal | undefined,
		ip: string | undefined
	): Promise<{ slot: string; html: string } | null> {
		const q = endpoint.indexOf('?');
		if (q === -1) return null;
		const cap = capability_of(new URLSearchParams(endpoint.slice(q + 1)));
		const { id, payload, sig } = cap;

		if (this.#capability_precheck(cap) || !r.go('prechecked')) return null;
		if (!r.go('probed') || (ip !== undefined && this.#host.probe_rate.limited(ip))) return null;
		if (!this.#verify_region_mac(cap, event) || !r.go('verified')) return null;
		if (!r.go('charged') || (ip !== undefined && this.#host.render_over(ip))) return null;

		const target = capability_target(cap);
		if (target === null) return null;
		const load = await this.#modules.loader(target);
		if (load === null) return null;

		const props = await this.#decode_region_props(payload, load);
		if (!props) return null;

		const ttl = Number(cap.ttl) || 0;
		const reads_page_data = this.#host.reads_page_data(target);
		const wakes = cap.wakes === '1';
		const cache = this.#hole_cache(target, payload, wakes, event, ttl, reads_page_data);
		// (the profiler logs each batched hole as its own hole request — only when one listens)
		const stats = batch && has_batch_hole_listener();
		const t0 = stats ? clock.mono() : 0;
		const timing: { queue_ms?: number; render_ms?: number } = {};
		let outcome: 'hit' | 'miss' | 'none' = 'none';
		if (!r.go('rendering')) return null;
		const body = await this.#render_component(
			id,
			load,
			props,
			wakes,
			cache,
			stats ? (o) => (outcome = o) : undefined,
			stats ? timing : undefined,
			event.url,
			reads_page_data,
			signal
		);
		if (stats)
			record_batch_hole_stats(event.request, {
				kind: 'hole',
				id,
				cache: outcome,
				ttl,
				...(timing.queue_ms !== undefined
					? { queue_ms: Math.round(timing.queue_ms * 10) / 10 }
					: {}),
				...(region_name?.[target] ? { name: region_name[target] } : {}),
				p: hole_copy_key(payload),
				ms: clock.mono() - t0,
				status: body === null ? 500 : 200
			});
		// (an answer nobody waits on any more is not shaped: the stream drops it)
		if (body === null || body.length > MAX_REGION_BODY || signal?.aborted) return null;
		// "Keep the fallback": the parcel carries the marker alone (no CSS links, nothing to hoist).
		if (body === KEEP_FALLBACK_HTML) return { slot: sig, html: KEEP_FALLBACK_HTML };
		// CSS links ride in the parcel; the client hoists them to <head> (a body/parcel link is inert
		// inside the `<template>` box), so a batched server-island still styles a page that never
		// imported its component. URLs inside are made root-absolute: `asset()` made them relative
		// to THIS request, and the parcel lands in a page at any depth (server/hole-urls.ts).
		let html = absolutize_hole_html(region_css_links(target) + body, event.url);
		// The app's own pass, as on the hole's own answer (render_region): a batched hole is the same
		// answer, and the runtime restores both the same way.
		const pass = batch ? this.#host.pass(event) : undefined;
		if (pass) html = await pass.region(html);
		return { slot: sig, html };
	}

	/**
	 * Verify the region MAC, then render. Unknown ids and bad MACs both return 403 so the
	 * existence of a region id is not an oracle (SEC-01). Expiry is part of the MAC message.
	 *
	 * Ordering: length/exp → probe rate (pre-HMAC) → verify → render rate → render.
	 * Probe stops forged CPU amplification; render budget is only charged after a valid MAC.
	 * A renewal (`&renew=1`) swaps the first three for its own: shape + renew window → probe →
	 * anonymous-only re-verify of the original tuple + re-sign; then the same render rate + render.
	 */
	async render_region(event: RequestEvent): Promise<Response> {
		const r = create_region_request();
		const res = await this.#region_answer(r, event);
		// (a success with no render before it is an illegal move: `sent` is only reached rendering)
		r.go(res.status < 300 ? 'sent' : 'refused');
		return res;
	}

	/** {@link render_region}'s steps, each move taken before its work (server/region-request.ts). */
	async #region_answer(r: RegionRequest, event: RequestEvent): Promise<Response> {
		const method = event.request.method.toUpperCase();
		if (method !== 'GET' && method !== 'HEAD') {
			return region_response('Method Not Allowed', {
				status: 405,
				headers: { allow: 'GET, HEAD' }
			});
		}

		// Harvested capability URLs embedded cross-site (img/script/navigation) — reject when the
		// browser reports cross-site. Missing Sec-Fetch-Site (old clients) is allowed.
		const fetch_site = event.request.headers.get('sec-fetch-site');
		if (fetch_site === 'cross-site') return region_denied('cross-site');

		const url = event.url;
		const ip = client_ip(event);
		if (!ip) {
			// Fail closed — shared 'unknown' bucket was an unfair DoS vector.
			return region_response('Too Many Requests', { status: 429 });
		}

		let cap = capability_of(url.searchParams);
		const { id, payload } = cap;
		const ttl_raw = cap.ttl;
		// RENEWAL: the runtime retries a hole whose capability EXPIRED (its document outlived it in a
		// cache) once with `&renew=1`. The answer carries the fresh capability in
		// `x-ogygia-capability`; the runtime adopts it for the hole's later fetches.
		let renewed: string | null = null;
		const renewal = url.searchParams.get('renew') === '1';

		// Every check before HMAC (P5-HMAC-CPU) — the batch path runs the same one.
		const refused = this.#capability_precheck(cap, renewal);
		if (refused) {
			if (import.meta.env.DEV && refused === 'foreign-key')
				warn('endpoint_foreign_key', { id, key: String(cap.k), own: signing_key().fp });
			return region_denied(refused);
		}
		r.go('prechecked');

		// Pre-HMAC probe — forged floods hit this, not render() (HMAC-CPU-DOS).
		if (!r.go('probed')) return region_response('Too Many Requests', { status: 429 });
		if (this.#host.probe_rate.limited(ip)) return over_budget(this.#host.probe_rate, ip);

		if (renewal) {
			const fresh = this.#renew_capability(cap, event);
			if (!fresh)
				return region_denied(this.#region_session(event) !== '' ? 'renew-session' : 'sig');
			cap = fresh;
			renewed = url.pathname + capability_query(cap, cap.exp, cap.sig, cap.k ?? '');
		} else {
			// Verify (session-bound) before consulting the manifest — bad MAC never distinguishes
			// unknown vs known id.
			if (!this.#verify_region_mac(cap, event)) {
				say_bad_signature(id);
				return region_denied('sig');
			}
		}
		if (!r.go('verified')) return region_denied('sig');

		// Cache policy travels signed in the URL: a positive `ttl` opts this hole into a private browser
		// cache; absent/0 keeps it dynamic (`no-store`). A hole is fresh-per-request by default. A
		// renewed answer is never cached under its ttl: the browser would keep serving it for the OLD
		// (expired) address the runtime is moving off.
		const cache_control = ttl_raw && !renewed ? `private, max-age=${Number(ttl_raw)}` : 'no-store';
		/** The fresh capability rides every successful answer to a renewal (the 204 too). */
		const renew_headers: Record<string, string> = renewed ? { 'x-ogygia-capability': renewed } : {};

		// Valid capability — now charge the per-IP render budget.
		if (!r.go('charged')) return region_response('Too Many Requests', { status: 429 });
		if (this.#host.render_over(ip)) return over_budget(this.#host.render_rate, ip);

		// Its own id, or (minted by another build) an entry of this build rendering its component.
		const target = capability_target(cap);
		if (target === null) {
			if (import.meta.env.DEV)
				warn('endpoint_unknown_id', {
					id,
					component: cap.render || undefined,
					known: Object.keys(region_url).length
				});
			return region_denied('unknown-id');
		}
		const load = await this.#modules.loader(target);
		if (load === null) return region_denied('unknown-id');

		// Same status as bad MAC on any decode failure (STATUS-ORACLE); the reason is only ever
		// reached with a capability this key signed.
		const props = await this.#decode_region_props(payload, load);
		if (!props) return region_denied('props');

		const ttl = Number(ttl_raw) || 0;
		const reads_page_data = this.#host.reads_page_data(target);
		const wakes = cap.wakes === '1';
		const cache = this.#hole_cache(target, payload, wakes, event, ttl, reads_page_data);
		const timing: { queue_ms?: number; render_ms?: number } = {};
		let outcome: 'hit' | 'miss' | 'none' = 'none';
		if (!r.go('rendering')) return region_response('Region render failed', { status: 500 });
		const body = await this.#render_component(
			id,
			load,
			props,
			wakes,
			cache,
			(o) => (outcome = o),
			timing,
			event.url,
			reads_page_data
		);
		// (the profiler's hole economics, with the wait for a render slot: a hole's time on the
		// server is its queue AND its render)
		record_hole_stats(event.request, {
			kind: 'hole',
			id,
			cache: outcome,
			ttl,
			...(timing.queue_ms !== undefined ? { queue_ms: Math.round(timing.queue_ms * 10) / 10 } : {}),
			// (a manifest from an older build has no names: the stub's `undefined`)
			...(region_name?.[target] ? { name: region_name[target] } : {}),
			p: hole_copy_key(payload)
		});
		// the same split for the browser (devtools, the profiler's beacon), as Server-Timing. Only for
		// a browser that measures (dev, the devtools cookie, a visitor a plugin vouches for by its own
		// credentials: the profiler's logged-in user): no other visitor's answer tells how loaded the
		// server is
		const timed =
			timing.queue_ms !== undefined &&
			(import.meta.env.DEV ||
				(DEVTOOLS && event.cookies.get(DEVTOOLS_COOKIE) === DEVTOOLS_ON) ||
				// oxlint-disable-next-line ogygia/no-silent-failures -- a failed hook was said (plugin_hook_failed); unproved is not timed
				(!!measures && (await ask.measures(event).catch(() => undefined)) === true));
		const server_timing: Record<string, string> = timed
			? {
					'server-timing': `og-queue;dur=${timing.queue_ms!.toFixed(1)}, og-render;dur=${(timing.render_ms ?? 0).toFixed(1)}`
				}
			: {};
		if (body === null) {
			return region_response('Region render failed', { status: 500 });
		}
		// `keepFallback()`: no content — the runtime keeps the page's fallback and marks the hole done.
		if (body === KEEP_FALLBACK_HTML)
			// (its hole's own policy, like its answer would carry: a 204 is cacheable by default)
			return region_response(null, {
				status: 204,
				headers: { 'cache-control': cache_control, ...renew_headers }
			});

		if (body.length > MAX_REGION_BODY) return region_denied('oversize');

		// Ship the component's stylesheet links ahead of its HTML (the client hoists them to <head>).
		// Root-absolute URLs inside: the hole's HTML is spliced into a page at any depth — by the
		// runtime, or by a CDN (ESI) — where a `./_app/…` entry would 404 (server/hole-urls.ts).
		let html = absolutize_hole_html(region_css_links(target) + body, event.url);

		// The app's own pass, on the fully assembled answer (the runtime restores what it moved before
		// the answer goes in). Runs on the final body, so HEAD's `content-length` below and the GET
		// body agree.
		const pass = this.#host.pass(event);
		if (pass) html = await pass.region(html);

		if (method === 'HEAD') {
			return region_response(null, {
				status: 200,
				headers: {
					'content-type': 'text/html; charset=utf-8',
					'content-length': String(new TextEncoder().encode(html).byteLength),
					'cache-control': cache_control,
					...renew_headers
				}
			});
		}

		return region_response(html, {
			status: 200,
			headers: {
				'content-type': 'text/html; charset=utf-8',
				// Per-hole policy signed into the URL (see `cache_control` above). A hole is `no-store`
				// (dynamic) unless it opts into caching via its preset's `maxAge`, which mints a positive
				// `ttl` → `private, max-age=ttl`. `private` keeps shared/CDN caches out (responses are
				// cookie-personalized) while still letting THIS browser reuse the response.
				'cache-control': cache_control,
				...renew_headers,
				...server_timing
			}
		});
	}
}
