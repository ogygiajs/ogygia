/**
 * SvelteKit server `handle` for signed region holes (`defer` / remount:`swr`).
 *
 * Serves `GET <base>/__ogygia__?id=…&props=…&exp=…&sig=…` by verifying the region MAC,
 * rendering the region component server-side (cookies, remote functions, and `await` work),
 * and returning HTML for the client runtime to swap in.
 *
 * Composable with `sequence()` — intercepts only the region endpoint path; otherwise
 * calls `resolve(event)`. Also injects the document-level page seed used by islands.
 *
 * @example
 * ```ts
 * // src/hooks.server.ts
 * import { ogygiaHandle } from 'ogygia/hooks';
 * import { sequence } from '@sveltejs/kit/hooks';
 * export const handle = sequence(ogygiaHandle(), myOtherHandle);
 * ```
 *
 * @packageDocumentation
 */
import { clock, say, slot as shared, STALE } from '@ogygia/machine';
import type { RequestEvent } from '@sveltejs/kit';
import type { Handle } from './kit-handle.ts';
import { KitRequestStore, type RequestState } from './server/kit-request-store.ts';
import { live_event } from './server/live-event.ts';
import { transport as app_transport } from 'ogygia:region';
import {
	HAS,
	region_reads_page_data,
	fn_manifest,
	rate_limit,
	router_enabled,
	view_transitions,
	route_config,
	runtime_url,
	devtools_boot_url,
	server_plugins,
	server_plugin_count,
	handoff_problem
} from 'ogygia:server';
import { dev_hmr_url } from './dev-hmr-url.ts';
import { signing_key, configure_signing_secret } from './server/signing-key.ts';
import { mpaSpeculationRules } from './server/speculation.ts';
import { fn_manifest_script } from './server/fn-manifest-script.ts';
import { set_page_route_config } from './plugin/routes.ts';
import {
	set_kit_page_reader,
	set_kit_event_reader,
	set_render_page_port
} from './server/kit-context.ts';
import { PAGE_FACTS_HEADER, PAGE_FACTS_ROUTE_HEADER } from './server/page-facts.ts';
import {
	configure_render_page,
	note_render_page_ask,
	prepare_render_page,
	render_page,
	render_page_facts_script,
	render_page_version
} from './server/render-page.ts';
import { set_source_recorder } from './source.ts';
import { building, dev } from '$app/env';
import { kit_asset, set_asset_request_reader } from './kit-paths.ts';
import { sign, verify, secret_has_min_entropy, MIN_SECRET_BYTES } from './server/hmac.ts';
import { note_cache_control } from './server/cache-control.ts';
import { app_lifetime, server_delta_on } from './server/region-endpoint.ts';
import { install_server_rules, note_kit_asset, note_region_answer } from './server/rules.ts';
import { ref_names, set_ref_names_reader, type RefNames } from './ref.ts';
import type { RequestContext } from './plugin/index.ts';
import { current_facts, facts_of, set_current_request, type RequestFacts } from './plugin/facts.ts';
import {
	around,
	end_request,
	html_pass,
	request_contexts,
	start_app_plugins
} from './plugin/server.ts';
import type { HtmlPass } from './plugin/index.ts';
import { end_request_scope, own_response, request_scope } from './plugin/request-scope.ts';
import { SnippetRender } from './snippet-render.ts';
import {
	configure_islands_endpoint,
	islands_endpoint,
	is_islands_endpoint
} from './server/endpoint.ts';
import { IslandsEndpoint } from './server/islands-endpoint.ts';
import {
	client_ip,
	over_budget,
	region_denied,
	region_response
} from './server/region-response.ts';
import { F_CONTEXT, F_FRAMES, F_PAGE, F_REMOTE_SEEDS } from './contract/features.ts';
import { HeadTags } from './server/head-presence.ts';
import { page_code_origins } from './server/page-code-origins.ts';
import { assemble, ogygia_script, rope } from './server/document-assembly.ts';
import { env_seed_script } from './server/env-seed.ts';
import {
	remote_seed_script,
	ship_page_seed,
	walk_page_seed,
	type ShippedSeed
} from './server/document-seeds.ts';
import { install_page_context, page_ctx_script } from './server/page-context.ts';
import { error_route_is_csr_true, route_is_csr_true } from './context.ts';
import { early_holes_head, take_early_holes } from './early-holes-head.ts';
import {
	add_early_holes_csp,
	EARLY_CODE_SOURCE,
	EARLY_HOLES_SOURCE,
	with_early_holes_meta_csp
} from './server/early-holes-csp.ts';
import { kit_gate, kit_start_ungated } from './server/kit-gate.ts';
import { merge_seed_ask, type SeedKeys } from './server/seed-shape.ts';
import { html_has_kit_bootstrap, marks_critical } from './server/html-scan.ts';
import { RateLimiter, is_shared_address } from './server/rate-limit.ts';
import { analyze, MeasureMemo, set_measure_memo_reader } from './seed-refs.ts';
import { OGYGIA_DEV_HMR, OGYGIA_DEVTOOLS_BOOT, OGYGIA_SPECULATE } from './wire-markup.ts';
import { body_end, head_end, read_head } from './markup-walk.ts';
import { stream_page_deferred, type Deferred } from './server/page-stream.ts';
import { escape_amp_quot, escape_script_text } from './escape.ts';
import {
	set_ask_scope_opener,
	set_page_recorder,
	set_seed_ask_reader,
	type PageSnapshot
} from './page-seed-registry.ts';
import { DocumentTail, set_tail_reader } from './server/document-tail.ts';
import { runtime_bootstrap } from './server/entry-location.ts';
import {
	set_late_recorder,
	set_late_scope_opener,
	set_late_taker,
	type LateRegion
} from './late-region-registry.ts';
import {
	record_request_stats,
	request_stats_detailed,
	request_stats_wanted,
	type SeedKeyStat
} from './server/request-stats.ts';
import { json_culprit } from './seed-refs.ts';
import type { SeedAsk } from './server/seed-shape.ts';
import { set_server_devtools_recorder } from './events/server-registry.ts';
import { drop_dead_kit_resolves } from './server/dead-kit-resolves.ts';
import {
	DEVTOOLS_SCHEMA_VERSION,
	type DevtoolsEvent,
	type DevtoolsEventInput
} from './contract/events.ts';
import { mark_attr, response_mark } from './server/response-mark.ts';
import { RESPONSE_MARK } from './contract/response-mark.ts';
import {
	DEVTOOLS_COOKIE,
	DEVTOOLS_ON,
	SWITCH_COOKIE_OPTIONS,
	TESTING_COOKIE,
	TESTING_LEAN,
	TESTING_PARAM,
	switch_in_url
} from './contract/switch.ts';
import { mark_personal } from './server/personal-response.ts';
import { OgygiaError, warn } from './messages/server.ts';
import { ERRORS, WARNINGS } from './messages/core.ts';
import { define_messages, dev_or_prerender } from './contract/messages.ts';

(globalThis as unknown as Record<symbol, unknown>)[Symbol.for('ogygia.prerendering')] = building;
(globalThis as unknown as Record<symbol, unknown>)[Symbol.for('ogygia.messages')] ??=
	define_messages(
		import.meta.env?.DEV || import.meta.env?.SSR ? ERRORS : null,
		import.meta.env?.DEV || import.meta.env?.SSR ? WARNINGS : null,
		dev_or_prerender
	);

function devtools_switch(event: RequestEvent): boolean {
	if (building) return false;
	const want = switch_in_url(event.url);
	if (want === null) return event.cookies.get(DEVTOOLS_COOKIE) === DEVTOOLS_ON;
	if (want) event.cookies.set(DEVTOOLS_COOKIE, DEVTOOLS_ON, SWITCH_COOKIE_OPTIONS);
	else event.cookies.delete(DEVTOOLS_COOKIE, { path: '/' });
	return want;
}

const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;
const DEVTOOLS_LAZY =
	typeof __OGYGIA_DEVTOOLS_LAZY__ !== 'undefined' ? __OGYGIA_DEVTOOLS_LAZY__ : false;
const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);
if (RULES) install_server_rules();
const dt_now = clock.mono;

type LateCapture = { regions: LateRegion[]; next: number };
type RequestBag = {
	request: Request;
	page: PageSnapshot | null;
	csp_sources?: string[];
	seed_keys: import('./server/seed-shape.ts').SeedKeys | null;
	seed_asks: Map<string, SeedAsk> | null;
	remotes_wanted: Set<string> | null;
	/** some region on the page imports Kit's `$app/env/public` (KIT-PUBLIC-ENV) */
	env_wanted: boolean;
	tail: DocumentTail;
	measure_memo: MeasureMemo;
	deferred: Deferred[] | null;
	defer_next_id: number;
	late: LateCapture | null;
	seed_reducers: Record<string, (v: unknown) => unknown> | null;
	kit_client?: boolean;
	kit_with_runtime?: boolean;
	transform_head?: string;
	transform_body?: string;
	facts: RequestFacts;
};
const bags = shared<WeakMap<Request, RequestBag>>({
	name: 'ogygia.request-bags',
	version: 1,
	make: () => new WeakMap()
});
function bag_of(): RequestBag | undefined {
	const request = live_event()?.request;
	return request ? bags.get(request) : undefined;
}
if (HAS & F_CONTEXT) install_page_context();
const doc_asks = shared<WeakMap<Request, SeedKeys | null>>({
	name: 'ogygia.document-asks',
	version: 1,
	make: () => new WeakMap()
});
const request_of = () => live_event()?.request;
const ref_names_of = shared<WeakMap<Request, RefNames>>({
	name: 'ogygia.request-ref-names',
	version: 1,
	make: () => new WeakMap()
});
set_ref_names_reader(() => {
	const request = request_of();
	if (!request) return null;
	let names = ref_names_of.get(request);
	if (names === undefined) ref_names_of.set(request, (names = ref_names()));
	return names;
});
set_ask_scope_opener(() => {
	const request = request_of();
	if (request && !bags.has(request) && !doc_asks.has(request)) doc_asks.set(request, null);
});
const doc_env = shared<WeakSet<Request>>({
	name: 'ogygia.document-env-asks',
	version: 1,
	make: () => new WeakSet()
});
set_seed_ask_reader(() => {
	const bag = bag_of();
	if (bag) return { wanted: bag.seed_keys !== null, keys: bag.seed_keys, env: bag.env_wanted };
	const request = request_of();
	if (!request || !doc_asks.has(request)) return undefined;
	const keys = doc_asks.get(request) ?? null;
	return { wanted: keys !== null, keys, env: doc_env.has(request) };
});
set_page_recorder((snapshot, seed, remotes, entry, env) => {
	// a render FOR a page (a hole, a remote call): its islands' asks are the render-page model's —
	// the answer carries those keys of the looked-up page (server/render-page.ts)
	const event = live_event();
	if (event && note_render_page_ask(event, seed)) return;
	const asks = HAS & F_PAGE && seed !== false;
	const bag = bag_of();
	if (!bag) {
		const request = request_of();
		if (request && doc_asks.has(request)) {
			if (asks) doc_asks.set(request, merge_seed_ask(doc_asks.get(request) ?? null, seed));
			if (HAS & F_PAGE && env) doc_env.add(request);
		}
		return;
	}
	if (HAS & F_PAGE && env) bag.env_wanted = true;
	const first = bag.page === null;
	bag.page = { ...bag.page, ...snapshot };
	if (HAS & F_PAGE && first) walk_page_seed(bag.page.data, bag.measure_memo);
	if (asks) bag.seed_keys = merge_seed_ask(bag.seed_keys, seed);
	if (asks && bag.seed_asks && entry) bag.seed_asks.set(entry, seed);
	if (remotes === null) bag.remotes_wanted = null;
	else if (bag.remotes_wanted) for (const h of remotes) bag.remotes_wanted.add(h);
});
set_tail_reader(() => bag_of()?.tail ?? null);
set_measure_memo_reader(() => bag_of()?.measure_memo ?? null);
configure_render_page({ warn: dev ? (m) => console.warn(m) : null });

set_kit_event_reader(live_event);
set_asset_request_reader(() => KitRequestStore.state(), RULES ? note_kit_asset : null);
/** Does this hole's server tree read `page.data` (the build's answer; unknown in dev → yes). */
const hole_reads_page_data = (id: string): boolean =>
	region_reads_page_data === null || region_reads_page_data[id] !== false;
set_render_page_port({
	ready(reads_data) {
		return prepare_render_page(live_event() ?? undefined, app_transport, reads_data);
	},
	tail() {
		return render_page_facts_script(live_event() ?? undefined, app_transport);
	},
	version(hole_id) {
		if (!hole_reads_page_data(hole_id)) return '';
		const v = render_page_version(live_event() ?? undefined, bag_of()?.page ?? undefined);
		return v ? `&pv=${v}` : '';
	}
});
set_kit_page_reader(() => {
	const bag = bag_of();
	return render_page(bag ? (bag.page ?? {}) : undefined, live_event() ?? undefined);
});
SnippetRender.install();
set_late_scope_opener(() => {
	const bag = bag_of();
	if (bag) bag.late ??= { regions: [], next: 0 };
});
set_late_recorder((promise) => {
	const late = bag_of()?.late;
	if (!late) return null;
	const id = `r${late.next++}`;
	late.regions.push({ id, promise });
	return id;
});
set_late_taker(() => {
	const late = bag_of()?.late;
	if (!late?.regions.length) return null;
	const list = late.regions;
	late.regions = [];
	return list;
});
set_current_request(() => live_event()?.request);
set_source_recorder((tag) => {
	current_facts()?.sources?.push(tag);
});
set_page_route_config(route_config);
// PLUGINS (listed beside `ogygia()`): each one's server half, live — its app made, its shared hooks
// registered, its `setup` run — once, when this module loads. A run of this module again (dev) makes
// the plugins of the run before leave first.
// Their `app.sign` / `app.verify` use the region key, read at first use (an env the host fills after
// module eval still counts). Their `app.capability` lives and renews by the app's own hole lifetime,
// and a refused one is answered like a refused region request. Opening one pays the region budgets of
// the handle serving the request (PROBE-THEN-RENDER); a request no handle of ours serves pays a 429.
const hole_budgets = shared<WeakMap<Request, Pick<OgygiaHandle, 'charge_hole'>>>({
	name: 'ogygia.hole-budgets',
	version: 1,
	make: () => new WeakMap()
});
const plugins = start_app_plugins(server_plugins, {
	sign: (message) => sign(signing_key().secret, message),
	verify: (message, signature) => verify(signing_key().secret, message, signature),
	fingerprint: () => signing_key().fp,
	lifetime: app_lifetime,
	deny: region_denied,
	charge(event, step) {
		const served_by = hole_budgets.get(event.request);
		return served_by
			? served_by.charge_hole(event, step)
			: region_response('Too Many Requests', { status: 429 });
	}
});
// DEVTOOLS: per-request event buffers, keyed off the request bag by a side WeakMap so RequestBag stays
// pristine (and free) when devtools is off. GC'd with the bag; never a global ring (which would mix
// concurrent SSR requests). Unreferenced ⇒ tree-shaken when the gate is off.
const dt_buffers = new WeakMap<RequestBag, { events: DevtoolsEvent[]; seq: number }>();
/** The mark of this bag's response, for its head runtime script ('' with no bag: RESPONSE-MARK). */
function mark_of(bag: RequestBag | undefined): string {
	return bag ? response_mark(bag.request) : '';
}
// Stamp the envelope with THIS request's own seq/clock and push into its buffer.
function dt_record(bag: RequestBag | undefined, input: DevtoolsEventInput): void {
	const buf = bag ? dt_buffers.get(bag) : undefined;
	if (!buf) return;
	buf.events.push({
		...input,
		v: DEVTOOLS_SCHEMA_VERSION,
		seq: buf.seq++,
		t: dt_now(),
		realm: 'server'
	} as DevtoolsEvent);
}
// (render seams find their request through the async context; the seed step, which runs in the page
// transform outside it, passes its bag to `dt_record` directly)
if (DEVTOOLS) set_server_devtools_recorder((input) => dt_record(bag_of(), input));

const NO_CTXS: readonly RequestContext<unknown, unknown>[] = [];

function decode_pathname(pathname: string): string | null {
	try {
		return decodeURIComponent(pathname);
		// oxlint-disable-next-line ogygia/no-silent-failures -- the caller answers 400
	} catch {
		return null;
	}
}

const CSR_META = '<meta name="ogygia-csr" content="true">';
const CSR_FALSE_META = '<meta name="ogygia-csr" content="false">';
const fnm_script_cache = new WeakMap<object, string>();

function router_fetched(event: RequestEvent): boolean {
	return event.request.headers.get('x-ogygia-spa') !== null;
}

/**
 * Is this document Kit-hydrated (csr=true)? A build-time ROUTE FACT (context.ts, the PAGE-CSR
 * invariant), never a scan of the document; the bounded string probe covers only a routeless response
 * (`route.id` null), where Kit's boot sits in the last bytes before `</body>`. An ERROR RENDER reads the
 * error twin of the map: Kit renders `+error.svelte` from the layout branch alone (the page's
 * `csr = false` is dropped), and the regions recorded Kit's `page.error` into the bag as they rendered
 * — the same fact Region.svelte decided its own inline/island form on, so the two cannot disagree.
 */
function csr_page_of(
	html: string,
	body_end: number,
	event?: RequestEvent,
	bag?: RequestBag
): boolean {
	if (event?.route?.id == null) return body_end !== -1 && html_has_kit_bootstrap(html, body_end);
	return bag?.page?.error != null
		? error_route_is_csr_true(event.route.id)
		: route_is_csr_true(event.route.id);
}

/** `inner` with the request's owner around it: made before `inner` runs, ended with its response
 *  (or at once when it throws). */
function owned(inner: Handle): Handle {
	return async (input) => {
		const owner = request_scope(input.event.request);
		let response: Response;
		try {
			response = await inner(input);
		} catch (error) {
			end_request_scope(owner);
			throw error;
		}
		return own_response(owner, response, input.event.request);
	};
}

class OgygiaHandle {
	readonly #endpoint: string;
	readonly #speculation_rules: string;
	readonly render_rate: RateLimiter;
	readonly probe_rate: RateLimiter;
	/** a render budget spent by a proxy's address, said once (#894) */
	readonly #shared_address = say({ max: 1 });
	/** The client build's handoff problem, said once while it lasts (production: dev reads none). */
	readonly #handoff_said = say({ max: 2 });
	readonly #islands: IslandsEndpoint | null;
	readonly #unbuilt_said = say({ max: 1 });

	#check_handoff(): void {
		const p = handoff_problem();
		if (!p) {
			this.#handoff_said.ok('missing');
			this.#handoff_said.ok('unreadable');
			return;
		}
		this.#handoff_said.once(p.kind, () =>
			console.error(
				new OgygiaError('island_deps_handoff_missing', {
					kind: p.kind,
					tried: p.tried.join(', '),
					error: p.error ?? ''
				})
			)
		);
	}

	constructor(options: OgygiaHandleOptions = {}) {
		if ('transform' in options) throw new OgygiaError('handle_transform_moved');
		// Stored WITHOUT a base prefix. Getting the app's absolute base path inside a hook has no
		// public, forward-compatible API — `base` from `$app/paths` is deprecated (removed in Kit 3)
		// and `resolve()` is page-relative here — so instead of prefixing the base we match the request
		// pathname by SUFFIX (see `handle`). The endpoint is a clash-safe path, so a suffix match is
		// unambiguous regardless of `paths.base`.
		// ONE path for the handler and every capability minted (server/endpoint.ts): the option moved
		// only the handler once, and every hole on the page asked the old path
		configure_islands_endpoint(options.endpoint);
		this.#endpoint = islands_endpoint();
		// THE SIGNING SECRET, recorded before any render the way the endpoint is: the first mint or
		// verify decides the key (server/signing-key.ts) and finds it there. Held to the floor a
		// production build holds OGYGIA_SECRET to; dev may use short keys.
		if (options.secret?.trim() && !import.meta.env.DEV && !secret_has_min_entropy(options.secret)) {
			throw new OgygiaError('handle_secret_too_short', { min: MIN_SECRET_BYTES });
		}
		configure_signing_secret(options.secret);
		// MPA mode's Speculation Rules leave this endpoint out (one string, built once)
		this.#speculation_rules = router_enabled ? '' : mpaSpeculationRules(this.#endpoint);
		this.render_rate = new RateLimiter({
			max: rate_limit.max,
			windowMs: rate_limit.windowMs
		});
		/** Cheap pre-HMAC probe budget — forged traffic pays this, not full render quota (HMAC-CPU-DOS). */
		this.probe_rate = new RateLimiter({
			max: rate_limit.max <= 0 ? 0 : Math.max(rate_limit.max * 5, 120),
			windowMs: rate_limit.windowMs
		});
		this.#islands =
			HAS & F_FRAMES
				? new IslandsEndpoint({
						probe_rate: this.probe_rate,
						render_rate: this.render_rate,
						render_over: (ip) => this.#render_over(ip),
						pass: (event) => html_pass(plugins, event),
						reads_page_data: hole_reads_page_data
					})
				: null;
	}

	#unbuilt(): Response {
		this.#unbuilt_said.once('endpoint', () =>
			console.error(new OgygiaError('region_endpoint_unbuilt'))
		);
		return region_response('Not Found', { status: 404 });
	}

	/** Charges `ip` one render; true when its budget is spent. A spent budget of an address no visitor
	 *  has is a proxy's, shared by every visitor behind it: said once (server/rate-limit.ts
	 *  `is_shared_address`, #894). */
	#render_over(ip: string): boolean {
		if (!this.render_rate.limited(ip)) return false;
		if (is_shared_address(ip))
			this.#shared_address.once('shared', () => warn('rate_limit_shared_address', { address: ip }));
		return true;
	}

	// The public handle: the plugins' `handle` hooks (a profiler timing the render and serving its UI)
	// nested around the core, first plugin outermost — with zero hooks wiring. None: the core itself.
	// THE REQUEST'S OWNER (plugin/request-scope.ts) is made here, outermost, so every plugin's hook
	// and the core run under it, and ends with the response (its body read or cancelled) or when the
	// visitor leaves, whichever is first.
	readonly #handle: Handle = owned(around(plugins, (input) => this.#core(input)));
	// (whose budgets a plugin's signed hole in this request pays, `charge_hole`; no plugins, no hole)
	handle: Handle =
		plugins.length === 0
			? this.#handle
			: (input) => {
					hole_budgets.set(input.event.request, this);
					return this.#handle(input);
				};

	/** A plugin's signed hole (plugin/capability.ts `open`) pays this handle's region budgets, in
	 *  the region hole's order: `probe` before any HMAC, `render` once the signature checks. */
	charge_hole(event: RequestEvent, step: 'probe' | 'render'): Response | null {
		const ip = client_ip(event);
		// (fail closed, as a region hole does: one shared bucket for unknown addresses is a DoS vector)
		if (!ip) return region_response('Too Many Requests', { status: 429 });
		if (step === 'probe')
			return this.probe_rate.limited(ip) ? over_budget(this.probe_rate, ip) : null;
		return this.#render_over(ip) ? over_budget(this.render_rate, ip) : null;
	}

	#core: Handle = async ({ event, resolve }) => {
		const path = decode_pathname(event.url.pathname);
		if (path === null) {
			return new Response('Bad Request', { status: 400 });
		}
		// PLUGINS (design: internal/notes/packages.md): each one's `request`
		// stage runs HERE, above the endpoint/page split, so page renders, remote-function calls AND
		// the region endpoint (deferred/live holes, the per-visitor leg of a cached page) all see what
		// it set up (flags prime their source here). Its `done` stage runs at the request's end, always
		// (flags drain exposures: the serverless-safe tail). No plugins: straight through, no wrapper.
		if (!import.meta.env.DEV) this.#check_handoff();
		const facts = facts_of(event.request);
		if (plugins.length === 0) return this.#route(event, resolve, path, NO_CTXS, facts);
		const ctxs = request_contexts(plugins, event, path, facts, (endpoint) =>
			this.#render_hole(endpoint, event)
		);
		try {
			for (let i = 0; i < plugins.length; i++) {
				const answer = await plugins[i].def.request?.(ctxs[i]);
				if (answer) return answer;
			}
			return await this.#route(event, resolve, path, ctxs, facts);
		} finally {
			// (an answered, failed or streamed request included; the response never waits for it)
			end_request(plugins, ctxs, event.platform);
		}
	};

	/** One signed hole rendered in place with THIS request's event (a plugin's `ctx.renderHole`:
	 *  the stored-page stitch). Null keeps the fallback: a refused capability, a failed render, or
	 *  an answer that asks to keep it. */
	#render_hole(endpoint: string, event: RequestEvent): Promise<string | null> {
		if (this.#islands) return this.#islands.render_hole(endpoint, event);
		this.#unbuilt();
		return Promise.resolve(null);
	}

	async #route(
		event: RequestEvent,
		resolve: Parameters<Handle>[0]['resolve'],
		path: string,
		ctxs: readonly RequestContext<unknown, unknown>[],
		facts: RequestFacts
	): Promise<Response> {
		// The endpoint's one path under the app's base, the path minted: a page whose path only ends
		// the same is a page (test/islands-endpoint.test.ts)
		if (!is_islands_endpoint(path)) {
			// PAGE FACTS (server/page-facts.ts): a render outside its page looks the page up through
			// Kit's own data request. Nothing renders here: no bag, no store. The answer names the
			// route and params Kit matched, which the data alone does not carry.
			if (HAS & F_FRAMES && event.isDataRequest && event.request.headers.has(PAGE_FACTS_HEADER)) {
				const res = await resolve(event);
				try {
					res.headers.set(
						PAGE_FACTS_ROUTE_HEADER,
						encodeURIComponent(JSON.stringify({ id: event.route.id, params: event.params }))
					);
					// oxlint-disable-next-line ogygia/no-silent-failures -- an immutable response; the render keeps the endpoint's route and params
				} catch {}
				return res;
			}
			// DEVTOOLS for this browser (a BUILD: only one that turned it on — contract/switch.ts). Its
			// page carries its own events, so it is never stored and never shared-cached.
			const devtools_on = DEVTOOLS && (!DEVTOOLS_LAZY || devtools_switch(event));
			// (a prerender has no visitor, and may not read the query)
			const devtools_personal =
				!building && (devtools_on || (DEVTOOLS_LAZY && switch_in_url(event.url) !== null));
			facts.private = devtools_personal;
			// (the app's own pass renders a router-fetched page as an ANSWER — every host planned,
			// `#pass_document` — a form a store keyed by path does not hold)
			const pass = html_pass(plugins, event);
			facts.answerForm = !!pass && router_fetched(event);
			// Flicker fix: on csr=false pages Kit resolves top-level `await query()` calls during
			// SSR (populating the internal request store's `remote.implicit`) but only serializes
			// them into the page when csr===true. We capture the resolved query responses and emit
			// a `<script type="application/ogygia-remote">` side-channel the runtime reads to seed
			// the reused client query cache BEFORE islands hydrate — so no re-fetch, no flash. The
			// store is captured synchronously here (active inside Kit's `with_request_store`); it is
			// the SAME object reference Kit mutates during the render inside `resolve`.
			const kit_state = KitRequestStore.state();
			// Per-request capture bag: `setContext` values + the page snapshot are recorded during the
			// render (the readers above find it through Kit's store) and read back in
			// `inject_client_seeds` via the SAME bag reference passed through as a closure.
			const bag: RequestBag = {
				page: null,
				seed_keys: null,
				seed_asks: request_stats_detailed() ? new Map() : null,
				remotes_wanted: HAS & F_REMOTE_SEEDS ? new Set() : null,
				env_wanted: false,
				tail: new DocumentTail(),
				measure_memo: new MeasureMemo(),
				deferred: null,
				defer_next_id: 0,
				late: null,
				seed_reducers: null,
				facts,
				request: event.request
			};
			// DEVTOOLS: attach a request-scoped event buffer via a side WeakMap (keeps RequestBag — and
			// its cost — untouched when devtools is off; the map + this line DCE out then).
			// (a BUILD with devtools on: only for a browser that turned devtools on — contract/switch.ts —
			// so no other visitor's page carries the side-channel. `?og-devtools=on|off` flips it on this
			// very response, so the page that turned it on is measured from its start)
			// (LEAN TESTING — contract/switch.ts — keeps the HTML what a visitor gets: no event side-channel)
			const lean =
				devtools_on &&
				!building &&
				(event.cookies.get(TESTING_COOKIE) === TESTING_LEAN ||
					event.url.searchParams.get(TESTING_PARAM) === TESTING_LEAN);
			if (devtools_on && !lean) dt_buffers.set(bag, { events: [], seq: 0 });
			// Hang the bag off the request for the rest of it — the render's own Kit store and the
			// streamed tail chunks (late regions, resolve scripts, after `resolve()` returned) all
			// carry this same `Request` and find it.
			bags.set(event.request, bag);
			// PLUGINS, `page` stage: before Kit renders (a stored copy answers here — Kit, loads and
			// Svelte never run; a plugin that may store this render says so in `facts.storable`).
			for (let i = 0; i < ctxs.length; i++) {
				const answer = await plugins[i].def.page?.(ctxs[i]);
				if (answer) return answer;
			}
			// HOLES OUTLIVE A CACHED DOCUMENT: note the `cache-control` a load sets, so a hole minted
			// during this render is signed for as long as shared caches keep the page
			// (server/shared-cache.ts). Loads receive `setHeaders` from THIS event (Kit spreads it into
			// each load's event) and finish before the render mints. A header a handle sets on the
			// Response after `resolve` is invisible here — the runtime's renewal covers that case.
			// (SvelteKit 3 types `setHeaders` as readonly; at runtime it is a plain property Kit
			// reassigns itself after the response, so this wrapper works on 2 and 3 alike)
			if (HAS & F_FRAMES) {
				const set_headers = event.setHeaders;
				(event as { setHeaders: RequestEvent['setHeaders'] }).setHeaders = (headers) => {
					set_headers(headers);
					for (const key in headers)
						if (key.toLowerCase() === 'cache-control')
							note_cache_control(event.request, headers[key]);
				};
			}
			const response = await resolve(event, {
				transformPageChunk: async ({ html, done }) =>
					this.inject_client_seeds(
						pass ? await this.#pass_document(pass, html, done, event, bag) : html,
						kit_state ?? undefined,
						event,
						bag
					)
			});
			if (devtools_personal) mark_personal(response);
			if (bag.csp_sources?.length)
				try {
					add_early_holes_csp(response.headers, bag.csp_sources);
					// oxlint-disable-next-line ogygia/no-silent-failures -- immutable headers: the platform's policy is the app's to allow the script in
				} catch {}
			// with the app's own pass a router-fetched page is rendered as an answer (`#pass_document`):
			// a shared cache must keep the two forms apart
			// and with server-delta navigation, a router-fetched page skips the regions it names
			// (`x-ogygia-known`): never the copy a visitor who asked for the whole page gets
			const delta = server_delta_on();
			if ((pass || delta) && (response.headers.get('content-type') ?? '').includes('text/html'))
				try {
					response.headers.append('vary', delta ? 'x-ogygia-spa, x-ogygia-known' : 'x-ogygia-spa');
					// oxlint-disable-next-line ogygia/no-silent-failures -- immutable headers; the app's platform's headers win
				} catch {}
			// a browser that turned devtools on may sample its main thread (the JS Self-Profiling API needs
			// the document to allow it): the CPU of a page load and of a recorded session. Its own pages only
			if (
				devtools_on &&
				DEVTOOLS_LAZY &&
				(response.headers.get('content-type') ?? '').includes('text/html')
			) {
				try {
					if (!response.headers.has('document-policy'))
						response.headers.set('document-policy', 'js-profiling');
					// the route this page rendered (Kit's id), for `page().route` — a header, so even lean
					// testing's HTML stays a visitor's
					if (event.route?.id)
						response.headers.append(
							'server-timing',
							`og-route;desc=${JSON.stringify(event.route.id)}`
						);
					// oxlint-disable-next-line ogygia/no-silent-failures -- immutable headers; the timing header is left out
				} catch {}
			}
			// PLUGINS, `response` stage (SEQUENTIAL): the page's response before it streams out — each
			// plugin sees the one before it left (a plugin may store it and send its copy instead). A
			// replaced response is final: it goes out as the plugins left it.
			if (bag.deferred && bag.deferred.length) facts.streamed = true;
			let out = response;
			for (let i = 0; i < ctxs.length; i++)
				out = (await plugins[i].def.response?.(ctxs[i], out)) ?? out;
			if (out !== response) return out;
			// Stream captured `$page.data` promises into islands (csr=false, real browser load). The doc
			// — with the pending seed + resolve-global bootstrap — is fully built now (transformPageChunk
			// ran synchronously inside `resolve`); the tail streams a resolve script per promise as it
			// settles. Only set when the request could consume a stream (see `inject_client_seeds`).
			if (HAS & F_PAGE && bag.deferred && bag.deferred.length) {
				return stream_page_deferred(
					request_scope(event.request),
					response,
					bag.deferred,
					bag.defer_next_id,
					bag.seed_reducers ?? undefined,
					event.url.pathname
				);
			}
			// A page with no Kit client (csr=false) whose load returned promises nobody seeds (no
			// island reads the page, or no island at all): Kit still streams its resolve scripts
			// after the document, and each throws `__sveltekit_… is not defined` in the browser.
			// Drop exactly those; everything else (late regions) passes.
			if (
				!bag.kit_client &&
				!response.headers.has('content-length') &&
				(response.headers.get('content-type') ?? '').includes('text/html')
			)
				return drop_dead_kit_resolves(response);
			return response;
		}
		// POST to the endpoint = a BATCH frame stream (client-side navigation, single-flight): render a set
		// of signed region calls and flush each as an out-of-order frame in one response.
		const islands = this.#islands;
		if (!islands) return this.#unbuilt();
		const answer =
			event.request.method.toUpperCase() === 'POST'
				? await islands.render_batch(event)
				: await islands.render_region(event);
		if (RULES) note_region_answer(event.url.pathname, answer);
		return answer;
	}

	async #pass_document(
		pass: HtmlPass,
		html: string,
		done: boolean,
		event: RequestEvent,
		bag: RequestBag
	): Promise<string> {
		const head = head_end(html) !== -1;
		const end = body_end(html);
		const out = await pass.document(html, {
			csr: csr_page_of(html, end, event, bag),
			// (the router morphs a fetched page into the live one: it is rendered as an answer)
			answer: router_fetched(event),
			head,
			body: end !== -1,
			done
		});
		if (out.head) bag.transform_head = out.head;
		if (out.body) bag.transform_body = out.body;
		return out.html;
	}

	/**
	 * Document-level side-channels: one page snapshot + optional remote query seed.
	 * Skips Kit-booted (csr=true) pages which serialize remotes themselves.
	 */
	async inject_client_seeds(
		html: string,
		state: RequestState | undefined,
		event?: RequestEvent,
		bag?: RequestBag
	): Promise<string> {
		// Kit hands one chunk at a time (ONE chunk for a non-streamed page). Two facts about a chunk
		// decide everything below, each found with one bounded scan (server/document-assembly.ts):
		// `</head>` from the front, `</body>` from the back. The chunk is assembled ONCE at the end.
		const t_start = clock.mono();
		const read = read_head(html);
		const spans = { head_end: read.end, body_end: body_end(html) };
		const head = read.end === -1 ? null : html.slice(0, read.end);
		const head_tags = head === null ? null : new HeadTags(head, read);
		// THE EARLY START (early-holes.ts): the requests of this page's `load` holes start during the
		// parse, from one data block and one constant script in the chunk that carries `</head>`. A
		// policy that would block the script gets its hash: a <meta> one here, a header after `resolve`.
		const early =
			!(HAS & F_FRAMES) || head === null || !event ? [] : take_early_holes(event.request);
		const csp_sources: string[] = early.length ? [EARLY_HOLES_SOURCE] : [];
		if (bag && head !== null) bag.csp_sources = csp_sources;
		const early_head = early_holes_head(early);
		const with_early_csp = (h: string): string => with_early_holes_meta_csp(h, csp_sources);

		// csr=true page — Kit serializes its own remotes and hydrates the whole tree; skip seeds. A
		// build-time ROUTE FACT (context.ts, the PAGE-CSR invariant), never a scan of the document;
		// the bounded string probe covers only a routeless response (`route.id` null), where Kit's
		// boot sits in the last bytes before `</body>`. An ERROR RENDER reads the error twin of the
		// map: Kit renders `+error.svelte` from the layout branch alone (the page's `csr = false` is
		// dropped), and the regions recorded Kit's `page.error` into the bag as they rendered — the
		// same fact Region.svelte decided its own inline/island form on, so the two cannot disagree.
		const csr_page = csr_page_of(html, spans.body_end, event, bag);
		// (Kit's client is on the page exactly when the route is Kit-hydrated: the route fact, never a
		// search of the whole document for its bootstrap on every chunk)
		if (csr_page && bag) bag.kit_client = true;
		if (
			!csr_page &&
			head !== null &&
			spans.body_end !== -1 &&
			bag?.tail.wakes_at_load &&
			bag.tail.hole_rows().length === 0 &&
			!marks_critical(html, spans.body_end)
		)
			csp_sources.push(EARLY_CODE_SOURCE);
		if (csr_page) {
			let head_inject = '';
			if (head !== null) {
				// Stamp the fact for the runtime (it boots here only for the regions inside lakes, and
				// reads this meta instead of scanning inline scripts for Kit's bootstrap).
				// The ogygia runtime never mounts the devtools dock here (Kit owns the page). When
				// devtools is compiled in (`devtools_boot_url` is non-empty only then, dev-only), inject a
				// standalone dock boot so the launcher is on EVERY dev page — on this csr=true page it
				// renders a "csr=true — open a csr=false page" notice, since there are no islands here.
				const devtools_boot =
					devtools_boot_url && !head.includes(OGYGIA_DEVTOOLS_BOOT)
						? `<script type="module" ${OGYGIA_DEVTOOLS_BOOT} src="${devtools_boot_url}"></script>`
						: '';
				head_inject = `${CSR_META}${early_head}${devtools_boot}`;
				if (bag) bag.kit_with_runtime = head_tags!.declares_runtime_script();
			}
			// THE TAIL STILL SHIPS. The regions INSIDE A LAKE are ogygia's on this page too (their real
			// `<ogygia-region>` is emitted, the runtime boots for them), and like on any page their props
			// sidecars and preload hints were deferred into the document tail — so the tail goes out
			// before `</body>` here as well, or an island inside a lake hydrates with `undefined`
			// props and dies (a footer's subscription form did). Rendered against NO seed: the page /
			// remote / context seeds stay off a csr=true page — Kit hydrates the tree and serializes
			// its own remotes — and a sidecar written without a seed carries its values whole.
			// THE CONTEXT MARKER is the exception: those islands are separate hydration roots Kit never
			// enters, so the drop-in `setContext` reaches them only through it. It ships when the page
			// has such an island (the runtime is on it); a Kit-only page pays nothing.
			// (the app's transform: its head assets before `</head>`, the restorer first before `</body>`)
			if (head !== null && bag?.transform_head) head_inject = bag.transform_head + head_inject;
			const tail =
				spans.body_end !== -1 && bag
					? (bag.transform_body ?? '') +
						bag.tail.render(null, false, mark_attr(bag.request)) +
						(HAS & F_CONTEXT && bag.kit_with_runtime ? page_ctx_script(bag.request) : '')
					: '';
			if (head === null && !tail) return html;
			// The runtime an island inside a lake emitted goes before the head's JavaScript here too
			// (see the csr=false path below): its regions keep their server markup from the first connect.
			const gate =
				head !== null && spans.body_end !== -1 && bag?.kit_with_runtime
					? kit_gate(html, spans.body_end)
					: null;
			if (gate) csp_sources.push(gate.source);
			else if (
				dev &&
				head !== null &&
				spans.body_end !== -1 &&
				bag?.kit_with_runtime &&
				kit_start_ungated(html, spans.body_end)
			)
				warn('kit_start_ungated', { path: event?.url.pathname ?? '/' });
			const ordered =
				head_tags === null
					? null
					: with_early_csp(
							head_tags.runtime_first(null, page_code_origins(event?.request), mark_of(bag))
						);
			return assemble(
				gate ? gate.html : html,
				gate ? { head_end: spans.head_end, body_end: spans.body_end + gate.delta } : spans,
				ordered === head ? null : ordered,
				head_inject,
				tail
			);
		}

		// ── HEAD (the chunk carrying `</head>`) ──
		// Router (global, opt out with `ogygia({ router: false })`). The handle owns the runtime
		// bootstrap + the `ogygia-router` meta the client router reads per-navigation, so no
		// `<Router/>` component is needed. Every injection is presence-checked, so it composes with
		// what a page already emits:
		//  • an island page already carries `data-ogygia-runtime` (Region emits it) → we skip it, and
		//    only load-only pages get the runtime injected here;
		//  • a page can override view transitions per-route by emitting its own
		//    `<meta name="ogygia-router" content="plain">` — present → we leave it, so the page wins.
		// The runtime URL is base-resolved below via Kit's `asset()` — the same authority Region uses for
		// island pages — so an island-less page under a non-root `base` (or an assets CDN) loads it too.
		//
		// Every presence check matches a REAL element, not the tag's name as TEXT — a page that
		// DOCUMENTS one of these tags in a code block (the changelog does) renders it escaped, which a
		// bare `html.includes('name="ogygia-router"')` false-matches, suppressing the injection. See
		// `head-presence.ts` for why that dropped documented pages to full-page navigation.
		// Every check and the link dedupe run on the HEAD SLICE only: that is where the hints, the
		// sheets and the tags they look for live, so the body is never scanned.
		let head_out: string | null = null;
		// (the route fact for the runtime and the router: a csr=false document says so, and the
		// browser reads one meta instead of probing every inline script for Kit's bootstrap)
		let head_inject = '';
		if (head_tags !== null) {
			// Dedupe the region-emitted modulepreload hints (each island instance emits its own dep
			// block, so shared deps repeat) and the stylesheet links (a layout's real-wrapper island is
			// linked by Kit from the client graph AND by Region.svelte from the render — 16 doubled
			// sheets on one measured page). Same href → one tag; first occurrence wins.
			const probe = head_tags.deduped();
			if (probe !== head_tags) head_out = probe.html;
			// MPA mode (`router: false`): no SPA machinery ships — the browser owns navigation, so the
			// handle injects static Speculation Rules instead. Chromium prerenders likely next pages,
			// Firefox prefetches them, everything else ignores the JSON. Presence-checked so a page
			// authoring its own rules wins; per-link opt-out via `data-ogygia-speculate="off"`.
			const speculation =
				!router_enabled && !probe.declares_speculation_rules()
					? `<script type="speculationrules" ${OGYGIA_SPECULATE}>${this.#speculation_rules}</script>`
					: '';
			const router_meta =
				router_enabled && !probe.declares_router_meta()
					? `<meta name="ogygia-router" content="${view_transitions ? 'vt' : 'plain'}">`
					: '';
			// The runtime bootstrap goes FIRST in `<head>` (head-presence.ts `runtime_first`): the one
			// an island page emitted moves up from Kit's head slot, and an island-less page gets it
			// injected there (router on). Base-resolved the same way Region does — `asset()` is the
			// sole base/assets authority, and every ogygia URL (prod `/${appDir}/…`, dev `/@id/…`) is
			// baked base-LESS — so an island-LESS page under a non-root `base` loads the runtime too.
			const runtime_tag =
				(router_enabled ||
					(!!server_plugin_count && !!event && !!facts_of(event.request).codeOrigins?.length)) &&
				runtime_url &&
				!probe.declares_runtime_script()
					? runtime_bootstrap(kit_asset)
					: null;
			// (with the code origins the plugins and this render named: runtime/code-origins.ts)
			const ordered = with_early_csp(
				probe.runtime_first(runtime_tag, page_code_origins(event?.request), mark_of(bag))
			);
			if (ordered !== probe.html) head_out = ordered;
			// The DEV bridge is NOT gated on the router — it carries `@vite/client`, and Vite's own
			// full-reload recovery must reach EVERY csr=false page. A dep re-optimization rotates the
			// optimizer's browserHash, so a tab loaded under the old hash dynamic-imports island deps
			// (`svelte.js?v=<old>`) that now 404, and every island fails on wake. Kit ships no client
			// bootstrap under csr=false, so nothing else injects the Vite client; gated on the router,
			// an app with `ogygia({ router: false })` (or any island page whose head the router branch
			// skips) kept a poisoned tab after a re-optimize until a manual reload, reporting only
			// "hydration failed". `dev_hmr_url` is empty outside `vite serve`, so this stays dev-only.
			let dev_hmr = '';
			if (dev_hmr_url && !probe.declares_dev_hmr_script()) {
				// The page's sub-app scope (its route id's first segment) for the dev CSS bridge:
				// a changed stylesheet joins this page only when the plugin derives the same scope
				// among its owners — two route-group sub-apps never paint each other in dev.
				const scope = (event?.route.id ?? '').split('/').filter(Boolean)[0] ?? '';
				dev_hmr = `<script type="module" ${OGYGIA_DEV_HMR} src="${kit_asset(dev_hmr_url)}"></script><meta name="ogygia-dev-scope" content="${escape_amp_quot(scope)}">`;
			}
			head_inject = `${CSR_FALSE_META}${early_head}${speculation}${router_meta}${dev_hmr}`;
		}

		// ── BODY (the chunk carrying `</body>`) ──
		// Body-level seeds (page / remote / setContext) go in the FINAL chunk only. Under a streamed
		// render the early chunks have no `</body>` AND no rendered island yet — so the captured page
		// data (Region records it during the island render) isn't ready. Gating here means the seed is
		// built once, after the render, with the real `data`.
		// (the app's transform: its head assets and the stand-ins' sheet, in this same assembly)
		if (head !== null && bag?.transform_head) head_inject = bag.transform_head + head_inject;
		if (spans.body_end === -1) return assemble(html, spans, head_out, head_inject, '');

		// A page on which NO region rendered has no island to feed: no tail, no seed, no remote seed,
		// no fn manifest, no context bridge — it pays nothing below. `bag.page` is recorded by every
		// Region render (islands, holes, lakes, held regions alike), so it is the one fact to read.
		const rendered = !!bag && bag.page !== null;
		// (the app's transform: the dev check and the restorer go first before `</body>`)
		const scripts: string[] = bag?.transform_body ? [bag.transform_body] : [];
		if (!rendered) {
			this.append_devtools_seed(scripts, bag);
			return assemble(html, spans, head_out, head_inject, rope(scripts));
		}

		// Single page seed (PAGE-DUP) — islands read it through the `$app/state` shim. url/params/route
		// come from the RequestEvent (reading `$app/state`'s `page` in a hook throws
		// `lifecycle_outside_component`). data/form/error/status come from the page snapshot
		// Region.svelte records during SSR from Kit's REAL page — the only place the resolved load data
		// is reachable (Kit merges it locally in render.js, never on RequestState). PAGE-SEED-EVENT.
		const page_snap = bag!.page!;
		const detail = request_stats_detailed();
		let seed: ShippedSeed | null = null;
		if (HAS & F_PAGE && bag!.seed_keys !== null) {
			const shipped = await ship_page_seed(bag!, event, detail, scripts);
			if (shipped === STALE) return html;
			seed = shipped;
		}
		const tail_html = seed
			? seed.tail_html
			: bag!.tail.render(
					null,
					detail,
					mark_attr(bag!.request),
					!!bag!.csp_sources?.includes(EARLY_CODE_SOURCE)
				);
		if (!seed) {
			const memo = bag!.measure_memo;
			if (analyze(page_snap.data, memo).thenable || analyze(page_snap.form ?? null, memo).thenable)
				bag!.facts.reads.visitor('streamed load (promise in page data)');
			if (tail_html) scripts.push(tail_html);
		}
		const page_payload = seed?.payload ?? null;
		let remote_seed_bytes = 0;
		let fnm_bytes = 0;
		let ctx_bytes = 0;
		if (page_payload) {
			if (DEVTOOLS)
				dt_record(bag, {
					domain: 'server',
					name: 'server.seed.injected',
					kind: 'page',
					bytes: page_payload.text.length
				});
		}

		if (HAS & F_PAGE && bag!.env_wanted) {
			const env_script = env_seed_script(bag!.request);
			if (env_script) scripts.push(env_script);
		}

		if (HAS & F_REMOTE_SEEDS && state?.remote?.implicit) {
			const remote_script = await remote_seed_script(state, bag!.remotes_wanted, bag!.request);
			if (remote_script) {
				scripts.push(remote_script);
				remote_seed_bytes = remote_script.length;
				if (DEVTOOLS)
					dt_record(bag, {
						domain: 'server',
						name: 'server.seed.injected',
						kind: 'remote',
						bytes: remote_script.length
					});
			}
		}

		// og.$ factories (PROD, CSP-clean): one EXECUTING inline script seeds the tag → factory
		// map before any island hydrates — the fn kind resolves against it with no eval. Emitted
		// only when the client build's handoff carries hoists (dev: the fn-manifest virtual is
		// complete; null here). Executing-inline is the same CSP class as the defer bootstrap.
		const fnm = fn_manifest();
		if (fnm) {
			// (the manifest is the build's: its script is written once, not per request)
			let fnm_script = fnm_script_cache.get(fnm);
			if (fnm_script === undefined) {
				fnm_script = fn_manifest_script(fnm);
				fnm_script_cache.set(fnm, fnm_script);
			}
			scripts.push(fnm_script);
			fnm_bytes = fnm_script.length;
		}

		// Drop-in `setContext` page root — emitted here (final chunk) so every `setContext` has run.
		const ctx_script = HAS & F_CONTEXT ? page_ctx_script(bag?.request) : '';
		if (ctx_script) {
			scripts.push(ctx_script);
			ctx_bytes = ctx_script.length;
		}

		this.append_devtools_seed(scripts, bag);
		// ONE assembly from slices — no `replace` (whose `$$` escape would also corrupt an og.$ factory
		// source carrying a literal `$`), no intermediate copies of the body.
		const out = assemble(html, spans, head_out, head_inject, rope(scripts));
		// OGYGIA'S OWN COST, for the profiler's request log (server/request-stats.ts): what this
		// transform took and what it added. One WeakMap write — and none at all in an app without the
		// profiler (the only reader), so no stats object per request there.
		if (event && request_stats_wanted()) {
			const size = bag!.tail.size;
			record_request_stats(event.request, {
				transform_ms: Math.round((clock.mono() - t_start) * 100) / 100,
				islands: size.props,
				hints: size.hints,
				holes: size.holes,
				seed_bytes: page_payload ? page_payload.text.length : 0,
				remote_seed_bytes,
				tail_bytes: tail_html.length,
				fnm_bytes,
				ctx_bytes,
				seed_json: page_payload?.json ?? false,
				// DETAIL (the profiler is recording): the per-island rows, the seed explainer, the
				// holes. The seed explainer reads the request's shared measure memo — a lookup per key.
				...(detail
					? {
							seed_culprit:
								seed && page_payload && !page_payload.json ? json_culprit(seed.data) : null,
							island_rows: bag!.tail.island_rows() ?? [],
							seed: this.explain_seed(page_snap.data, seed?.keys ?? null, bag!),
							hole_rows: bag!.tail.hole_rows()
						}
					: {})
			});
		}
		return out;
	}

	/**
	 * THE SEED EXPLAINER: per top-level `page.data` key, its size and why it ships — an island's
	 * client code reads it (the build's per-entry keys), a sidecar points into it (seed refs), or
	 * some island reads the page whole and everything ships. Profiler detail only.
	 */
	explain_seed(
		data: unknown,
		seed_keys: import('./server/seed-shape.ts').SeedKeys | null,
		bag: RequestBag
	): { keys: SeedKeyStat[]; whole_by: string[] } {
		// islands by their component name (the tail's rows carry it); an entry no row names keeps
		// its entry (a dev module URL / a built facade) — each named once
		const rows = bag.tail.island_rows() ?? [];
		const names = new Map<string, string>();
		for (const row of rows) if (row.name && !names.has(row.entry)) names.set(row.entry, row.name);
		const name_of = (entry: string) => names.get(entry) ?? entry;
		const add = (m: Map<string, Set<string>>, k: string, v: string) =>
			(m.get(k) ?? m.set(k, new Set()).get(k)!).add(v);
		const whole = new Set<string>();
		const readers = new Map<string, Set<string>>();
		for (const [entry, ask] of bag.seed_asks ?? []) {
			if (ask === 'all') whole.add(name_of(entry));
			else if (ask !== false) for (const k of ask) add(readers, k, name_of(entry));
		}
		const referenced = new Map<string, Set<string>>();
		for (const row of rows) for (const k of row.ref_keys) add(referenced, k, name_of(row.entry));
		const whole_by = [...whole];
		const keys: SeedKeyStat[] = [];
		if (data && typeof data === 'object' && !Array.isArray(data)) {
			for (const key of Object.keys(data as Record<string, unknown>)) {
				const shipped = seed_keys === 'all' || (seed_keys !== null && seed_keys.has(key));
				const read = [...(readers.get(key) ?? [])];
				const refd = [...(referenced.get(key) ?? [])];
				let reason: SeedKeyStat['reason'] = null;
				if (shipped && !read.length && refd.length) reason = 'referenced';
				else if (shipped && !read.length && whole_by.length) reason = 'whole';
				else if (shipped) reason = 'read';
				keys.push({
					key,
					bytes: analyze((data as Record<string, unknown>)[key], bag.measure_memo).bytes,
					readers: read,
					referenced_by: refd,
					shipped,
					reason
				});
			}
		}
		keys.sort((a, b) => b.bytes - a.bytes);
		return { keys, whole_by };
	}

	/** DEVTOOLS: drain this request's server-realm events (region renders, capability mints, seeds)
	 *  into an `application/ogygia-devtools` side-channel the client bus ingests — one stream, both
	 *  realms, correlated by fingerprint. Appended LAST so the seed.injected events are included. */
	append_devtools_seed(scripts: string[], bag: RequestBag | undefined): void {
		const dt_buf = DEVTOOLS && bag ? dt_buffers.get(bag) : undefined;
		if (DEVTOOLS && bag && dt_buf && dt_buf.events.length) {
			scripts.push(
				ogygia_script(
					'devtools',
					escape_script_text(JSON.stringify(dt_buf.events)),
					`${RESPONSE_MARK}="${response_mark(bag.request)}"`
				)
			);
		}
	}
}

/**
 * Options for {@link handle}.
 */
export interface OgygiaHandleOptions {
	/**
	 * Path (relative to Kit `base`) of the islands endpoint: the handle answers on it, and every hole
	 * and live region on a page is minted against it. Default `/__ogygia__`. Must start with `/`.
	 *
	 * It must be a path your deployment forwards to the app (behind a proxy that forwards only known
	 * prefixes, pick one under them, e.g. `/_server/api/__ogygia__`). Not under Kit's `appDir`
	 * (`/_app/…`): Kit answers those itself, before any handle runs.
	 */
	endpoint?: string;
	/**
	 * The secret that signs region capabilities (hole and live-region URLs). Takes precedence over
	 * the `OGYGIA_SECRET` environment variable, for a host whose server process never sees its
	 * runtime env. Pass a build-time private env value:
	 *
	 * ```ts
	 * import { OGYGIA_SECRET } from '$env/static/private';
	 * export const handle = ogygia.handle({ secret: OGYGIA_SECRET });
	 * ```
	 *
	 * An empty or blank value counts as not given (`OGYGIA_SECRET`, then a per-build random key, sign
	 * instead). It signs exactly as the same value in `OGYGIA_SECRET` does, so pages from either
	 * verify on the other. In production it needs ≥16 UTF-8 bytes. Every deployment that serves your
	 * pages or your islands endpoint needs the same secret.
	 */
	secret?: string;
}

/**
 * Build a Kit `handle` that serves signed deferred-region / lake-remount HTML and injects page
 * seeds for island hydration. Server-only.
 *
 * ```ts
 * // src/hooks.server.ts
 * import * as ogygia from 'ogygia/server';
 * export const handle = ogygia.handle();
 * ```
 *
 * @param options - Optional endpoint path override. See {@link OgygiaHandleOptions}.
 * @returns A SvelteKit {@link Handle} suitable for `sequence(ogygia.handle(), …)`.
 */
// Also surfaced here so `import * as ogygia from 'ogygia/server'` has `ogygia.transport` — but the
// actual Kit transport hook must live in the UNIVERSAL hooks (client needs decode), so wire it
// from `'ogygia'` in src/hooks.ts, not here. This module is server-only: the server realm's
// transport, which refuses ogygia values a browser sent (./server/transport.ts).
export { ogygiaServerTransport as transport } from './server/transport.ts';
// `document()` — render a held region into a complete ogygia document (a `Response`). Server-only.
export { document, type DocumentOptions } from './document.ts';
export function handle(options: OgygiaHandleOptions = {}): Handle {
	const instance = new OgygiaHandle(options);
	return (args) => instance.handle(args);
}
