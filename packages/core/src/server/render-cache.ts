/**
 * Server-side per-region HTML render cache (reconciler R6 — the SSR-compute lever).
 *
 * The deferred/held-region endpoint (`#render_component` in hooks.ts) is the ONE place ogygia
 * renders a region out-of-band as (id + props) → HTML. Today it re-renders fresh every request.
 * When a region opts into a positive `maxAge` (a signed `ttl` on its capability URL), the author
 * has DECLARED its output stable for that window — so memoizing the render for `ttl` seconds turns
 * an expensive region into a one-render-then-serve-cached region across ALL requests. That is the
 * only server-compute win reachable without making the monolithic page render region-granular
 * (which would need the off-limits compiler); a plain inline island never reaches this seam.
 *
 * CORRECTNESS: the cache key includes the SESSION seal, so a per-user (`private, max-age`) render
 * is never served to another user — exactly matching the browser Cache-Control the same `ttl`
 * produces. `ttl <= 0` (the default `no-store` hole) is never cached. Bounded in BYTES (a region
 * render can be up to `MAX_REGION_BODY`, 2 MB) and in entries, TTL-expiring, so it can't grow
 * unbounded across a long-lived server process (server/sized-lru.ts).
 *
 * ONE RENDER PER KEY IN FLIGHT (#244): a miss opens a flight for its key, and every call for that
 * key while it renders joins it instead of rendering again, so a burst of one cached hole takes one
 * render gate slot, not one per request.
 */
import { machine, STALE, type Machine } from '@ogygia/machine';
import { SizedLru } from './sized-lru.ts';

/** Resident budget for cached region HTML. */
const MAX_BYTES = 64 * 1024 * 1024;
/** Max live entries; the least recently used evict past this. */
const MAX_ENTRIES = 500;

const store = new SizedLru<string>(MAX_BYTES, MAX_ENTRIES);

/** Cache key for a region render — id + props payload + session seal. `exp`/`sig` (which rotate per
 *  mint) and `ttl` (a cache-window declaration, not a render input) are DELIBERATELY excluded so
 *  two renders of the same region+props+user hit; session is INCLUDED so users never cross. */
export function render_cache_key(id: string, props_payload: string, session: string): string {
	return id + ' ' + props_payload + ' ' + session;
}

/** Cached HTML for `key`, or null on miss/expiry. A live hit is an LRU touch. */
export function render_cache_get(key: string, now: number): string | null {
	return store.get(key, now);
}

/** Cache `html` for `ttl_sec` seconds. No-op for `ttl_sec <= 0` (dynamic holes are never cached). */
export function render_cache_set(key: string, html: string, ttl_sec: number, now: number): void {
	if (ttl_sec <= 0) return;
	store.set(key, html, html.length, now + ttl_sec * 1000);
}

/** Test/ops hook: drop everything, the flights in progress too (what they render is not stored,
 *  and the next call for their key renders afresh). */
export function render_cache_clear(): void {
	store.clear();
	inflight.clear();
}

/** Test/ops hook: live entries + resident bytes. */
export function render_cache_stats(): { entries: number; bytes: number } {
	return { entries: store.size, bytes: store.bytes };
}

/**
 * THE shared cache-fronted render (G2) — the ONE seam both the deferred-region endpoint
 * (#render_component) and the inline-island page render (Region.svelte) call. A hit returns the
 * memo; a miss renders via `render_body()` (the caller supplies it — the endpoint wraps its render
 * in a concurrency gate + timeout, the inline path renders directly), then caches. `cache` is
 * `undefined`/`ttl<=0` for a dynamic hole → always renders, never stores. `now` injected for tests.
 */
export async function cached_render(
	render_body: () => string | null | Promise<string | null>,
	cache: { key: string; ttl: number } | undefined,
	now: number,
	/** told what happened (`hit` served without rendering: the memo, or the render in flight it
	 *  joined; `miss` rendered + stored; `none` uncached) */
	report?: (outcome: 'hit' | 'miss' | 'none') => void
): Promise<string | null> {
	if (cache === undefined || cache.ttl <= 0) {
		const body = await render_body();
		report?.('none');
		return body;
	}
	const { key } = cache;
	const hit = render_cache_get(key, now);
	if (hit !== null) {
		report?.('hit');
		return hit;
	}
	const joined = inflight.get(key);
	if (joined !== undefined) return join_flight(joined, report);
	const flight = flight_def.create();
	inflight.set(key, flight);
	try {
		const body = await render_body();
		// stored only by the flight still registered for its key (a clear dropped one that began before
		// it, and what that one rendered may be what the clear was for)
		const current = inflight.get(key) === flight;
		if (current && body !== null) {
			render_cache_set(key, body, cache.ttl, now);
			report?.('miss');
		} else report?.('none');
		flight.go('rendered', { html: body });
		return body;
	} catch (error) {
		flight.go('failed', { error });
		throw error;
	} finally {
		// (after the store: a call arriving now finds the memo, never neither)
		if (inflight.get(key) === flight) inflight.delete(key);
	}
}

/**
 * ONE FLIGHT, one machine: rendering, then rendered (stored when it rendered HTML) or failed. The
 * call that opened it renders, every other call for its key waits on it, and only it takes it out
 * of the registry, and only while it is still the one there.
 *
 * A failed flight fails the calls that joined it too, and is not stored: the next call renders
 * afresh. They asked for the same render (same region, props and visitor), so it failed for them as
 * it would have on their own; each trying again in turn would be the burst this stops, on the path
 * that is already failing (a hung upstream would time each of them out, each holding a slot).
 */
type FlightStates = {
	rendering: {};
	rendered: { html: string | null };
	failed: { error: unknown };
};
const flight_steps = { rendering: ['rendered', 'failed'], rendered: [], failed: [] } as const;
const flight_def = machine<FlightStates>()({
	name: 'render cache flight',
	initial: 'rendering',
	steps: flight_steps
});
type Flight = Machine<FlightStates, typeof flight_steps>;

/** The flight rendering each key now. */
const inflight = new Map<string, Flight>();

/** A call for a key already rendering: the flight's answer, or its failure. */
async function join_flight(
	flight: Flight,
	report: ((outcome: 'hit' | 'miss' | 'none') => void) | undefined
): Promise<string | null> {
	const done = await flight.wait('rendered');
	if (done !== STALE) {
		report?.(done.html === null ? 'none' : 'hit');
		return done.html;
	}
	// (`rendered` can no longer come: the flight failed)
	const failed = flight.now;
	report?.('none');
	throw failed.kind === 'failed' ? failed.error : new Error('render cache flight ended');
}
