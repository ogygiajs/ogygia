/**
 * postrender — runtime registry: each server's live settings, invalidation fan-out, single-flight.
 *
 * CONFIG SPLIT: `postrender({ ttl, default })` in the vite config's plugins is the SWITCH +
 * serializable policy (handed to the server half as its options); LIVE objects (store clients, purge
 * creds) are the plain argument of `postrender.handle({ store, edge })` in hooks.server.ts, which
 * makes them this server's RUNTIME when the hooks module evaluates (before the first request) and
 * hands that runtime to every request it sees. The server half reads a request's runtime from there;
 * `invalidate()` (a CMS webhook, outside any hook) reads the server's — the latest handle made in this
 * process (dev re-evaluates hooks.server.ts: the new one replaces the old). No handle at all → the
 * memory default, and the server half says so.
 *
 * One global slot: the app's `@ogygia/postrender` import and the server half the build lists can be
 * two module instances (src beside dist), and both must see the same runtime.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { buggify, flights, machine, outbox, policy, say, type Stale } from '@ogygia/machine';
import type {
	PostrenderEntry,
	PostrenderPutOptions,
	PostrenderStore,
	PostrenderHandleOptions,
	EdgeAdapter
} from './types.ts';
import { MemoryStore } from './memory-store.ts';
import { in_subtree, normalize_prefix } from './key.ts';
import type { DevtoolsEventInput } from '@ogygia/core/plugin';
import { sourceTag } from '@ogygia/core/plugin/utils';
import { postrender_app } from './app.ts';
import { OgygiaError, warn } from './messages.ts';

declare const __OGYGIA_RULES__: boolean | undefined;
/** Dev and rules builds (a buggify point); folded out of any other. */
const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);

/** One server's live settings: what its `postrender.handle({ store, edge })` was given. */
export interface Runtime {
	readonly store: PostrenderStore;
	readonly edges: readonly EdgeAdapter[];
}

interface Slot {
	/** the latest `postrender.handle()` made in this process, or null when none was */
	installed: Runtime | null;
	/** the requests a `postrender.handle()` saw first, with its runtime — keyed by the `Request`, not
	 *  the event: Kit's `sequence()` hands each handle its own traced copy of the event, and the
	 *  request is the one object they all share (core's facts key on it too) */
	handled: WeakMap<Request, Runtime>;
	/** the memory store used while no handle exists */
	fallback: Runtime | null;
}
const slot: Slot = ((globalThis as Record<symbol, Slot | undefined>)[
	Symbol.for('ogygia.postrender.v1')
] ??= { installed: null, handled: new WeakMap(), fallback: null });

/** A server event into the current request's devtools stream (a no-op unless devtools is on). */
function record(event: DevtoolsEventInput): void {
	postrender_app()?.devtools(event);
}

/** Said once for the process (a test's reset says it again). */
const replica_blindspot = say({ max: 1 });
const BLINDSPOT = 'postrender_edges_without_shared_store';

/** `postrender.handle(options)`'s first half: make these settings this server's runtime. */
export function install(options: PostrenderHandleOptions): Runtime {
	const edges = [...(options.edge ?? [])];
	// Edges without a SHARED store: each replica keeps its own memory LRU, so an invalidation
	// evicts THIS instance + purges the CDN, while sibling replicas keep serving their stale
	// copy to the CDN's refills. Say it once — multi-instance deploys want valkey/upstash/KV.
	if (edges.length && !options.store)
		replica_blindspot.once(BLINDSPOT, () => warn('postrender_edges_without_shared_store'));
	const runtime: Runtime = { store: options.store ?? new MemoryStore(), edges };
	slot.installed = runtime;
	return runtime;
}

/** The handle's per-request half: this request came through it, with these settings. */
export function mark_handled(event: RequestEvent, runtime: Runtime): void {
	slot.handled.set(event.request, runtime);
}

/** The runtime of the `postrender.handle()` that saw this request first, or null. */
export function handled_runtime(event: RequestEvent): Runtime | null {
	return slot.handled.get(event.request) ?? null;
}

/** The latest `postrender.handle()` made in this process, or null when hooks.server.ts has none. */
export function installed_runtime(): Runtime | null {
	return slot.installed;
}

/** This server's runtime: its handle's, else the memory default. */
export function current_runtime(): Runtime {
	return slot.installed ?? (slot.fallback ??= { store: new MemoryStore(), edges: [] });
}

/** Harness/test escape hatch: no handle made, a fresh memory default. */
export function reset_for_tests(): void {
	slot.installed = null;
	slot.handled = new WeakMap();
	slot.fallback = null;
	replica_blindspot.ok(BLINDSPOT);
	store_health = health_def.create();
	renders.drop(() => true);
	writes.clear();
}

// ── cross-app thaw (federation) ──────────────────────────────────────────────────────────────
// Every invalidation that can be expressed as TAGS is announced through the shared `invalidated`
// hook; a `federate()` implements it and tells the peers that baked this app's fragments (see
// internal/notes/federation.md §4). Fire-and-forget: a peer that is down never fails a publish.
function notify_thaw(tags: string[] | 'all'): void {
	void postrender_app()
		?.notify.invalidated(tags)
		.catch(() => {}); // ok: notify said each failed hook (plugin_hook_failed); a publish never fails on a peer
}

/** Evict every stored page carrying ANY of `tags` (origin + every edge). The receiving half of a
 *  thaw notice; also what `invalidate(fn, args)` does for one receipt tag. */
export async function invalidate_tags(
	tags: readonly string[],
	runtime: Runtime = current_runtime()
): Promise<string[]> {
	return (await evict_tags(tags, runtime)).keys;
}

/** `invalidate_tags`, with what the store failed to evict: the shared hook (a peer's thaw) must not
 *  answer "done" for a tag that is still stored (#287). */
export async function evict_tags(
	tags: readonly string[],
	runtime: Runtime = current_runtime()
): Promise<{ keys: string[]; failed: unknown[] }> {
	stale_flights('all');
	const { store, edges } = runtime;
	const evict_by_tag = store.evictByTag?.bind(store);
	if (!evict_by_tag) {
		warn('postrender_store_no_evict_by_tag');
		return { keys: [], failed: [] };
	}
	// A tag the store fails to evict is reported and skipped: the other tags still evict, and every
	// page they named is still purged at the edges.
	const keys = new Set<string>();
	const failed: unknown[] = [];
	for (const tag of tags) {
		try {
			for (const key of await evict_by_tag(tag)) keys.add(key);
		} catch (e) {
			warn('postrender_tag_evict_failed', { tag }, e);
			failed.push(e);
		}
	}
	const jobs: Job[] = [];
	for (const key of keys)
		for (const edge of edges) jobs.push(edge_job(edge, (e) => e.purgeUrl(key)));
	await settle_all('invalidate(tags)', jobs);
	return { keys: [...keys], failed };
}

// ── read/write (hooks-facing; store failures NEVER fail a request) ─────────────────────────────

// A store down never fails a render, and is said: once per failing streak (postrender_store_failed),
// again only after a store call worked, so an outage does not fill the log.
//
// The store's health is `ok` or `failing`, and every failure is a new `failing` visit: the visit a
// call starts in is its mark. A call that answers ends the streak only when the visit is still that
// one, nothing failed since it started; a slow call that was out when the store went down, and
// answers after, leaves the streak be.
const health_def = machine<{ ok: {}; failing: {} }>()({
	name: 'postrender store',
	initial: 'ok',
	steps: { ok: ['failing'], failing: ['failing', 'ok'] }
});
let store_health = health_def.create();
type Health = typeof store_health.now;

function store_failed(op: string, key: string, error: unknown): void {
	const was = store_health.now.kind;
	store_health.go('failing');
	if (was === 'ok') warn('postrender_store_failed', { op, key }, error);
}

/** A store call that started in `mark` answered: the streak ends, unless a call failed since. */
function store_answered(mark: Health): void {
	if (store_health.now === mark && mark.kind === 'failing') store_health.go('ok');
}

/** `work` against the store: its failure is said and answered `fallback`. */
async function guarded<T>(
	op: string,
	key: string,
	work: () => Promise<T>,
	fallback: T
): Promise<T> {
	const mark = store_health.now;
	try {
		// (buggify: the store is down for this call, a shared store's blip: the page renders fresh
		// and is not kept, and the streak is said once)
		if (RULES && buggify.fires('postrender.store-down')) throw new Error('store down (buggify)');
		const out = await work();
		store_answered(mark);
		return out;
	} catch (error) {
		store_failed(op, key, error);
		return fallback;
	}
}

export function store_get(runtime: Runtime, key: string): Promise<PostrenderEntry | null> {
	return guarded('get', key, () => runtime.store.get(key), null);
}

export function store_put(
	runtime: Runtime,
	key: string,
	entry: PostrenderEntry,
	options: PostrenderPutOptions
): Promise<void> {
	return guarded('put', key, () => runtime.store.put(key, entry, options), undefined);
}

/** A render's write to the store, while it is out: its page, and the render's flight. */
type Write = { key: string; flight: Flight };
const writes = new Set<Write>();

/**
 * Store a render's page. An invalidation that starts while the write is out ends the render's
 * flight (it may have read what the invalidation changes), and its evict may run before the write
 * lands: the page is then taken back out, through the same tried-again evict a post waits for.
 * True when it stays stored.
 *
 * From the moment its flight goes stale until that evict ends, the page is RETRACTING: what the
 * store holds for it may be the page from before the invalidation, so no hit is served from it
 * (#332).
 */
export async function store_render(
	runtime: Runtime,
	key: string,
	entry: PostrenderEntry,
	options: PostrenderPutOptions,
	flight: Flight
): Promise<boolean> {
	const write: Write = { key, flight };
	writes.add(write);
	try {
		await store_put(runtime, key, entry, options);
		if (!flight.stale) return true;
		const mark = store_health.now;
		if (await self_evicts.put({ runtime, key })) store_answered(mark);
		return false;
	} finally {
		writes.delete(write);
	}
}

/** A stale render's page is being taken back out of the store: a hit for it is a miss. */
export function retracting(key: string): boolean {
	for (const w of writes) if (w.key === key && w.flight.stale) return true;
	return false;
}

// ── single-flight ──────────────────────────────────────────────────────────────────────────────
// The stampede law (the harness DEFINES it): N concurrent cold requests for an ELIGIBLE page =
// ONE render. The first request opens the page's flight; joiners await the outcome. `stored: null`
// means the flight rendered but the page proved ineligible — joiners then render themselves
// (correct: ineligible pages are per-request by definition).

export type FlightOutcome = { stored: PostrenderEntry | null };

/**
 * One page's render, opened by the request that renders it: that request settles it exactly once,
 * however it ends (the plugin's `done` settles one nothing else did), with what it stored, or null.
 * An invalidation that would have evicted its page ends it while it renders (`stale`: what it read
 * may be the page from before the publish): it is not stored, and the requests that joined it are
 * let go at once to ask again (#194).
 */
export class Flight {
	readonly key: string;
	readonly outcome: Promise<FlightOutcome>;
	#settle!: (outcome: FlightOutcome) => void;
	#settled = false;
	/** the flight's own signal: it aborts when an invalidation ends the flight */
	#signal: AbortSignal | null = null;

	constructor(key: string) {
		this.key = key;
		this.outcome = new Promise((settle) => (this.#settle = settle));
	}

	/** An invalidation ended it while it rendered. */
	get stale(): boolean {
		return !this.#settled && this.#signal?.aborted === true;
	}

	/** Settle it (once: a second settle does nothing). */
	settle(outcome: FlightOutcome): void {
		if (this.#settled) return;
		this.#settled = true;
		this.#settle(outcome);
	}

	/** The flight's work: its outcome, once its request settles it. */
	_fly(signal: AbortSignal): Promise<FlightOutcome> {
		this.#signal = signal;
		return this.outcome;
	}
}

/** The renders in progress, one per page: nothing is kept (the store keeps what they stored). The
 *  request that opens one holds it until it settles it. */
const renders = flights.keyed<Flight>()({
	name: 'postrender flight',
	key: ['key'],
	ignore: { _fly: 'the request that opens a page render runs it: the others join it' },
	keep: 0,
	run: (flight, signal): Promise<FlightOutcome> => flight._fly(signal)
});

/** The render of `key` in progress: join it (its outcome, `STALE` when an invalidation ended it),
 *  or, with none out, open it (`opened`: this request renders the page, and settles it however it
 *  ends). */
export function enter_flight(
	key: string
): { opened: Flight } | { joined: Promise<FlightOutcome | Stale> } {
	const flight = new Flight(key);
	const opens = renders.peek({ key }) === undefined;
	const outcome = renders.get(flight);
	return opens ? { opened: flight } : { joined: outcome };
}

/** The pages an invalidation evicts: one URL, a prefix's subtree (normalized), or every page (a
 *  tag names pages by what they read, and a render's receipts are not all in until it ends). */
type Evicts = { url: string } | { prefix: string } | 'all';

/** An invalidation is starting: a render still out for a page it evicts may have read what it
 *  changes. It ends the renders whose page it would have evicted, had it been stored; the others go
 *  on and store. */
function stale_flights(evicts: Evicts): void {
	renders.drop(
		({ key }) =>
			evicts === 'all' || ('url' in evicts ? key === evicts.url : in_subtree(key, evicts.prefix))
	);
}

// ── invalidation fan-out ───────────────────────────────────────────────────────────────────────
// Fan-out lives HERE, not in adapters: store evict + allSettled purge across every edge.
// Neither the store nor an edge being down fails the publish: each failure surfaces as a warning
// naming what failed, never a throw.

/** One fan-out call and what it reached (named in the warning when it fails). */
interface Job {
	what: string;
	run: Promise<unknown>;
}

/** A call as a promise, a synchronous throw included. */
const attempt = (call: () => Promise<unknown>): Promise<unknown> => Promise.resolve().then(call);

const store_job = (op: string, call: () => Promise<unknown>): Job => ({
	what: `the store failed to ${op}`,
	run: attempt(call)
});

const edge_job = (edge: EdgeAdapter, call: (edge: EdgeAdapter) => Promise<unknown>): Job => ({
	what: `the purge at edge "${edge.name}" failed`,
	run: attempt(() => call(edge))
});

async function settle_all(label: string, jobs: readonly Job[]): Promise<void> {
	const results = await Promise.allSettled(jobs.map((job) => job.run));
	results.forEach((r, i) => {
		if (r.status === 'rejected')
			warn('postrender_fanout_failed', { label, what: jobs[i].what }, r.reason);
	});
}

/** A function stamped by the `import.meta.og.source` macro (core's data sources). */
type SourceFn = (...args: never[]) => unknown;

/**
 * Evict everywhere — two shapes:
 *   `invalidate('/fr/fr/solar/')`         exact URL (the v1 keying law: publish payloads carry it)
 *   `invalidate(loadContent, [args])`     og.source PRECISION: the reverse index answers which
 *                                         stored pages consumed `(source, args)` — those exact
 *                                         URLs are evicted at origin AND purged at every edge.
 * Reaches the store and edges `postrender.handle()` was given in hooks.server.ts.
 */
export async function invalidate(target: string | SourceFn, args?: unknown[]): Promise<void> {
	if (typeof target === 'string') {
		stale_flights({ url: target });
		record({ domain: 'server', name: 'server.postrender', op: 'invalidate', url: target });
		const { store, edges } = current_runtime();
		const jobs = [store_job(`evict ${target}`, () => store.evict(target))];
		for (const edge of edges) jobs.push(edge_job(edge, (e) => e.purgeUrl(target)));
		await settle_all('invalidate', jobs);
		// peers file the pages that baked THIS route under `p:<me>:<path>` — tell them
		notify_thaw([`p:${target}`]);
		return;
	}
	const tag = sourceTag(target, args ?? []);
	if (!tag) {
		throw new OgygiaError('postrender_invalidate_not_source');
	}
	await invalidate_tags([tag]); // (which stales the flights)
	// peers file the pages that baked a fragment which read this source under `r:<me>:<tag>`
	notify_thaw([tag]);
}

/** Bulk eviction by URL subtree — `{ prefix: '/fr/fr/' }` is a locale nuke, `{ prefix: '/docs' }`
 *  a section nuke. One origin scan + one purge per edge (Akamai: prefix tag; CloudFront: wildcard;
 *  Cloudflare: prefix purge). */
export async function invalidateWhere(filter: { prefix: string }): Promise<void> {
	const prefix = normalize_prefix(filter.prefix);
	stale_flights({ prefix });
	record({ domain: 'server', name: 'server.postrender', op: 'invalidate-where', url: prefix });
	const { store, edges } = current_runtime();
	const jobs = [store_job(`evict prefix ${prefix}`, () => store.evictWhere({ prefix }))];
	for (const edge of edges) jobs.push(edge_job(edge, (e) => e.purgeWhere({ prefix })));
	await settle_all('invalidateWhere', jobs);
	// a subtree nuke has no per-page receipts to name — peers thaw EVERYTHING they baked from
	// this app (the safe over-approximation; `{ prefix: '/' }` is also the manual deploy thaw)
	notify_thaw('all');
}

/** How the origin store is tried again for an evict a response waits for: three quick tries within
 *  2 s. The post's answer waits for it, so a store that is down costs the visitor that, not more. */
const STORE_POLICY = policy({ attempts: 3, backoff: [50, 250], jitter: 0.2, deadline: 2000 });

/** One page's stored copy to take out of one runtime's store. */
type Evict = { runtime: Runtime; key: string };

/** A post's evicts: tried again, kept alive by the platform past the response when the post does
 *  not wait (it does: `self_evict`'s caller), and said with the store's failure when given up. */
const self_evicts = outbox<Evict>({
	name: 'postrender self-evict',
	send: (e) => e.runtime.store.evict(e.key),
	retry: STORE_POLICY,
	giveUp: (e, error) => store_failed('evict', e.key, error),
	waitUntil: (work) => postrender_app()?.keepAlive(work)
});

/** Action self-evict: a successful non-GET on a page URL evicts that URL (origin only — the edge
 *  copy follows via its s-maxage or the app's explicit invalidate). Settles once the store took it
 *  out, or gave up (it never rejects): the response waits for it, so the redirect's GET right after
 *  cannot be answered with the page from before the post (#283). */
export async function self_evict(runtime: Runtime, pathname: string): Promise<void> {
	stale_flights({ url: pathname });
	record({ domain: 'server', name: 'server.postrender', op: 'self-evict', url: pathname });
	const mark = store_health.now;
	if (await self_evicts.put({ runtime, key: pathname })) store_answered(mark);
}
