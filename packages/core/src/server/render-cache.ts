import { flights, STALE } from '@ogygia/machine';
import type { Reads } from '../plugin/reads.ts';
import { trace_reads } from './read-trace.ts';

const MAX_BYTES = 64 * 1024 * 1024;
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
 * render in a concurrency gate + timeout, the inline path renders directly), then caches for `ttl`
 * seconds. `cache` is `undefined` or `ttl <= 0` for a dynamic hole: every call renders, nothing is
 * shared or kept.
 *
 * The key holds the visitor's session seal, so a render is never served to another visitor. The
 * cache is bounded: 64 MB of HTML and 500 entries (each weighs at least its share of the bytes),
 * least recently used first out. A null render is shared while it flies and never kept.
 *
 * One render per key in flight (#244): a call for a key that is rendering joins that render. A
 * render that fails fails every call that joined it, and is not kept. Each call joins with its own
 * `signal`: a call whose request leaves (#245) leaves the render, which goes on for the calls still
 * waiting on it and stops only once every one has left; the render is handed the flight's signal.
 * A {@link render_cache_clear} while a call waits makes it render again (or join the call that got
 * there first).
 *
 * @param report told what happened: `hit` (served without rendering: the memo, or the render in
 *   flight it joined), `miss` (rendered and stored), `none` (not cached, or the render failed).
 * @param signal aborts when this call's request has gone: it leaves the render, and gives up with
 *   the signal's reason.
 */
export async function cached_render(
	render_body: (signal?: AbortSignal) => string | null | Promise<string | null>,
	cache: { key: RenderKey; ttl: number } | undefined,
	report?: (outcome: 'hit' | 'miss' | 'none') => void,
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
	}
}
