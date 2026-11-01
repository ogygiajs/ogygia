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
import type {
	PostrenderEntry,
	PostrenderPutOptions,
	PostrenderStore,
	PostrenderHandleOptions,
	EdgeAdapter
} from './types.ts';
import { memory_store } from './memory-store.ts';
import { normalize_prefix } from './key.ts';
import type { DevtoolsEventInput } from '@ogygia/core/plugin';
import { sourceTag } from '@ogygia/core/plugin/utils';
import { postrender_app } from './app.ts';

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

let warned_replica_blindspot = false;

/** `postrender.handle(options)`'s first half: make these settings this server's runtime. */
export function install(options: PostrenderHandleOptions): Runtime {
	const edges = [...(options.edge ?? [])];
	// Edges without a SHARED store: each replica keeps its own memory LRU, so an invalidation
	// evicts THIS instance + purges the CDN, while sibling replicas keep serving their stale
	// copy to the CDN's refills. Say it once — multi-instance deploys want valkey/upstash/KV.
	if (edges.length && !options.store && !warned_replica_blindspot) {
		warned_replica_blindspot = true;
		console.warn(
			'[ogygia] postrender: edge adapters are configured but the store is the per-instance ' +
				'memory default — invalidations cannot reach other replicas. Use a shared store ' +
				'(valkey / upstash / cloudflareKv) in multi-instance deploys.'
		);
	}
	const runtime: Runtime = { store: options.store ?? memory_store(), edges };
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
	return slot.installed ?? (slot.fallback ??= { store: memory_store(), edges: [] });
}

/** Harness/test escape hatch: no handle made, a fresh memory default. */
export function reset_for_tests(): void {
	slot.installed = null;
	slot.handled = new WeakMap();
	slot.fallback = null;
	warned_replica_blindspot = false;
}

// ── cross-app thaw (federation) ──────────────────────────────────────────────────────────────
// Every invalidation that can be expressed as TAGS is announced through the shared `invalidated`
// hook; a `federate()` implements it and tells the peers that baked this app's fragments (see
// internal/notes/federation.md §4). Fire-and-forget: a peer that is down never fails a publish.
function notify_thaw(tags: string[] | 'all'): void {
	void postrender_app()?.notify.invalidated(tags);
}

/** Evict every stored page carrying ANY of `tags` (origin + every edge). The receiving half of a
 *  thaw notice; also what `invalidate(fn, args)` does for one receipt tag. */
export async function invalidate_tags(
	tags: readonly string[],
	runtime: Runtime = current_runtime()
): Promise<string[]> {
	const { store, edges } = runtime;
	const evict_by_tag = store.evictByTag?.bind(store);
	if (!evict_by_tag) {
		console.warn(
			'[ogygia] postrender: the configured store has no evictByTag — tag invalidation needs it ' +
				'(memory/valkey/upstash/cloudflareKv all provide it).'
		);
		return [];
	}
	// A tag the store fails to evict is reported and skipped: the other tags still evict, and every
	// page they named is still purged at the edges.
	const keys = new Set<string>();
	for (const tag of tags) {
		try {
			for (const key of await evict_by_tag(tag)) keys.add(key);
		} catch (e) {
			console.warn(
				`[ogygia] postrender.invalidate(tags): the store failed to evict tag ${tag} (evictByTag); ` +
					'its pages stay stored until they expire —',
				e
			);
		}
	}
	const jobs: Job[] = [];
	for (const key of keys)
		for (const edge of edges) jobs.push(edge_job(edge, (e) => e.purgeUrl(key)));
	await settle_all('invalidate(tags)', jobs);
	return [...keys];
}

// ── read/write (hooks-facing; store failures NEVER fail a request) ─────────────────────────────

export async function store_get(runtime: Runtime, key: string): Promise<PostrenderEntry | null> {
	try {
		return await runtime.store.get(key);
	} catch {
		return null;
	}
}

export async function store_put(
	runtime: Runtime,
	key: string,
	entry: PostrenderEntry,
	options: PostrenderPutOptions
): Promise<void> {
	try {
		await runtime.store.put(key, entry, options);
	} catch {
		/* a broken store must never 500 a render */
	}
}

// ── single-flight ──────────────────────────────────────────────────────────────────────────────
// The stampede law (the harness DEFINES it): N concurrent cold requests for an ELIGIBLE page =
// ONE render. The first request registers its flight; joiners await the outcome. `stored: null`
// means the flight rendered but the page proved ineligible — joiners then render themselves
// (correct: ineligible pages are per-request by definition).

export type FlightOutcome = { stored: PostrenderEntry | null };
const inflight = new Map<string, Promise<FlightOutcome>>();

export function join_flight(key: string): Promise<FlightOutcome> | null {
	return inflight.get(key) ?? null;
}

export function begin_flight(key: string): (outcome: FlightOutcome) => void {
	let settle!: (outcome: FlightOutcome) => void;
	const flight = new Promise<FlightOutcome>((res) => {
		settle = res;
	});
	inflight.set(key, flight);
	return (outcome) => {
		inflight.delete(key);
		settle(outcome);
	};
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
			console.warn(`[ogygia] postrender.${label}: ${jobs[i].what} —`, r.reason);
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
		throw new Error(
			'[ogygia] postrender.invalidate(fn, args): the function is not a declared source — ' +
				'wrap its definition: `export const fn = import.meta.og.source(async (…) => …)`.'
		);
	}
	await invalidate_tags([tag]);
	// peers file the pages that baked a fragment which read this source under `r:<me>:<tag>`
	notify_thaw([tag]);
}

/** Bulk eviction by URL subtree — `{ prefix: '/fr/fr/' }` is a locale nuke, `{ prefix: '/docs' }`
 *  a section nuke. One origin scan + one purge per edge (Akamai: prefix tag; CloudFront: wildcard;
 *  Cloudflare: prefix purge). */
export async function invalidateWhere(filter: { prefix: string }): Promise<void> {
	const prefix = normalize_prefix(filter.prefix);
	record({ domain: 'server', name: 'server.postrender', op: 'invalidate-where', url: prefix });
	const { store, edges } = current_runtime();
	const jobs = [store_job(`evict prefix ${prefix}`, () => store.evictWhere({ prefix }))];
	for (const edge of edges) jobs.push(edge_job(edge, (e) => e.purgeWhere({ prefix })));
	await settle_all('invalidateWhere', jobs);
	// a subtree nuke has no per-page receipts to name — peers thaw EVERYTHING they baked from
	// this app (the safe over-approximation; `{ prefix: '/' }` is also the manual deploy thaw)
	notify_thaw('all');
}

/** Action self-evict: a successful non-GET on a page URL evicts that URL (origin only — the
 *  edge copy follows via its s-maxage or the app's explicit invalidate; fire-and-forget). */
export function self_evict(runtime: Runtime, pathname: string): void {
	record({ domain: 'server', name: 'server.postrender', op: 'self-evict', url: pathname });
	void runtime.store.evict(pathname).catch(() => {});
}
