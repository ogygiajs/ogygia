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
 * produces. Each render runs in its own read set (plugin/reads.ts): one that read what its key does
 * not cover (a flag, a cookie or header, `locals`, for an anonymous visitor; `page.data` with no
 * page in the key) is the asker's alone. It is not kept, and a call that joined it renders its own
 * (#434, rule_kept_unkeyed_read). `ttl <= 0` (the default `no-store` hole) is never cached. Bounded in BYTES (a region
 * render can be up to `MAX_REGION_BODY`, 2 MB) and in entries, TTL-expiring, so it can't grow
 * unbounded across a long-lived server process.
 *
 * ONE RENDER PER KEY IN FLIGHT (#244): the renders are a `flights()`, one flight per key, and every
 * call for that key while it renders joins it instead of rendering again, so a burst of one cached
 * hole takes one render gate slot, not one per request.
 *
 * - A failed render fails the calls that joined it too, and is not kept: the next call renders
 *   afresh. They asked for the same render (same region, props and visitor), so it failed for them
 *   as it would have on their own; each trying again in turn would be the burst this stops, on the
 *   path that is already failing (a hung upstream would time each of them out, each holding a slot).
 * - Each call joins with its own request's signal. A request that leaves (a cancelled batch, #245)
 *   leaves the flight alone: the render goes on, in its place in the render queue, for the calls
 *   still waiting on it, and is stopped only once every one of them has left. The render is handed
 *   the flight's signal, not its opener's.
 */
import { flights, STALE } from '@ogygia/machine';
import type { Reads } from '../plugin/reads.ts';
import { trace_reads } from './read-trace.ts';

/** Resident budget for cached region HTML. */
const MAX_BYTES = 64 * 1024 * 1024;
/** Max live entries: each entry weighs at least its share of the budget, so no more than this many
 *  small renders are kept; the least recently used go first. */
const MAX_ENTRIES = 500;
const ENTRY_SHARE = Math.floor(MAX_BYTES / MAX_ENTRIES);

/** What a region render is made from: the region, its props, the visitor's session seal, (when
 *  its tree reads `page.data`) the page it renders for, and whether it renders inside an island (a
 *  hole that wakes, #906: its regions take another branch). */
export type RenderKey = {
	id: string;
	payload: string;
	session: string;
	page: string | null;
	nested: boolean;
};

/** A render to share: what it is made from, the render itself (the caller's: the endpoint gates
 *  it, the inline path renders directly), and how long its HTML stays (seconds). */
type Ask = RenderKey & {
	render_body: (signal: AbortSignal) => string | null | Promise<string | null>;
	ttl: number;
};

/** A render, and the first thing it read that its key does not cover (null: it is the same render
 *  for every call of its key). */
export type TracedRender = { html: string | null; unkeyed_read: string | null };

/** What `reads` holds that `key` does not cover: a per-visitor read in an anonymous render (a session
 *  in the key names the visitor, so the render is that visitor's alone), or `page.data` in a render
 *  keyed without its page. */
export function unkeyed_read(reads: Reads, key: RenderKey): string | null {
	if (reads.perVisitor !== null && key.session === '') return reads.perVisitor;
	if (reads.pageData && key.page === null) return 'page.data';
	return null;
}

const renders = flights.keyed<Ask>()({
	name: 'render cache',
	key: ['id', 'payload', 'session', 'page', 'nested'],
	ignore: {
		render_body: 'the render of the key: the same region, props, visitor, page and nesting',
		ttl: 'how long the HTML stays, not what is rendered'
	},
	run: async (ask, signal): Promise<TracedRender> => {
		const { reads, value } = trace_reads(() => ask.render_body(signal));
		const html = await value;
		return { html, unkeyed_read: unkeyed_read(reads, ask) };
	},
	// (a null render, a failure folded to null, is shared while it flies and never kept; nor is one
	// that read what its key does not cover: rule_kept_unkeyed_read)
	keep: (r, ask) => (r.html === null || r.unkeyed_read !== null ? 0 : ask.ttl * 1000),
	max: MAX_BYTES,
	weigh: (r) => Math.max(r.html?.length ?? 0, ENTRY_SHARE)
});

/** Cache key for a region render — id + props payload + session seal (+ the page, for a tree that
 *  reads `page.data`). `exp`/`sig` (which rotate per mint) and `ttl` (a cache-window declaration,
 *  not a render input) are DELIBERATELY excluded so two renders of the same region+props+user hit;
 *  session is INCLUDED so users never cross. Each part is its own key field, so two calls whose
 *  parts differ never share an entry, whatever the parts hold. */
export function render_cache_key(
	id: string,
	payload: string,
	session: string,
	page: string | null = null,
	nested = false
): RenderKey {
	return { id, payload, session, page, nested };
}

/** Test/ops hook: the HTML kept for `key` now, or null. */
export function render_cache_get(key: RenderKey): string | null {
	const seen = renders.peek(key);
	return seen?.kind === 'kept' ? seen.answer.html : null;
}

/** Test/ops hook: drop everything, the flights in progress too (what they render is not kept, and
 *  the calls waiting on them render afresh). */
export function render_cache_clear(): void {
	renders.drop(() => true);
}

/**
 * THE shared cache-fronted render (G2) — the ONE seam both the deferred-region endpoint
 * (#render_component) and the inline-island page render (Region.svelte) call. A hit returns the
 * memo; a miss renders via `render_body(signal)` (the caller supplies it — the endpoint wraps its
 * render in a concurrency gate + timeout, the inline path renders directly), then caches. `cache`
 * is `undefined`/`ttl<=0` for a dynamic hole → always renders, never stores.
 */
export async function cached_render(
	render_body: (signal?: AbortSignal) => string | null | Promise<string | null>,
	cache: { key: RenderKey; ttl: number } | undefined,
	/** told what happened (`hit` served without rendering: the memo, or the render in flight it
	 *  joined; `miss` rendered + stored; `none` uncached) */
	report?: (outcome: 'hit' | 'miss' | 'none') => void,
	/** aborts when this call's request has gone: it leaves the render (a render nobody waits on any
	 *  more is stopped), and gives up with the signal's reason */
	signal?: AbortSignal
): Promise<string | null> {
	if (cache === undefined || cache.ttl <= 0) {
		const body = await render_body(signal);
		report?.('none');
		return body;
	}
	// (the flight runs the render of the call that opened it: this one, when its own render ran)
	let mine = false;
	const ask: Ask = {
		...cache.key,
		render_body: (render_signal) => {
			mine = true;
			return render_body(render_signal);
		},
		ttl: cache.ttl
	};
	for (;;) {
		mine = false;
		let r: TracedRender | typeof STALE;
		try {
			r = await renders.get(ask, { signal });
		} catch (error) {
			report?.('none');
			throw error;
		}
		if (r !== STALE) {
			// Another visitor's render (it read what the key does not cover, a flag say): this call
			// renders its own, kept by nobody
			if (r.unkeyed_read !== null && !mine) {
				const body = await render_body(signal);
				report?.('none');
				return body;
			}
			report?.(r.html === null || r.unkeyed_read !== null ? 'none' : mine ? 'miss' : 'hit');
			return r.html;
		}
		if (signal?.aborted) throw signal.reason;
		// a clear dropped the render this call waited on: what it rendered may be what the clear was
		// for, so render it again (or join the call that got there first)
	}
}
