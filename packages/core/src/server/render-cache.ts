import { flights, STALE } from '@ogygia/machine';
import type { Reads } from '../plugin/reads.ts';
import { trace_reads } from './read-trace.ts';

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 500;
const ENTRY_SHARE = Math.floor(MAX_BYTES / MAX_ENTRIES);

/** What a region render is made from: the region, its props, the visitor's session seal, (when
 *  its tree reads `page.data`) the page it renders for, whether it renders inside an island (a
 *  hole that wakes, #906: its regions take another branch), and any bounded flag variants read. */
export type RenderKey = {
	id: string;
	payload: string;
	session: string;
	page: string | null;
	nested: boolean;
	variants: string;
};

type Ask = RenderKey & {
	render_body: (signal: AbortSignal) => string | null | Promise<string | null>;
	ttl: number;
};

/** A render, and the first thing it read that its key does not cover (null: it is the same render
 *  for every call of its key). */
export type TracedRender = {
	html: string | null;
	unkeyed_read: string | null;
	variants?: ReadonlyArray<readonly [string, string]>;
};

/** What `reads` holds that `key` does not cover: a per-visitor read in an anonymous render (a session
 *  in the key names the visitor, so the render is that visitor's alone), `page.data` in a render
 *  keyed without its page, or bounded flag variants in an unkeyed render. */
export function unkeyed_read(reads: Reads, key: RenderKey): string | null {
	if (reads.perVisitor !== null && key.session === '') return reads.perVisitor;
	if (reads.pageData && key.page === null) return 'page.data';
	if (reads.variants.length > 0 && key.session === '' && key.variants === '') {
		return `flag:${reads.variants[0][0]}`;
	}
	return null;
}

type VariantTrie = { flag: string; arms: Map<string, VariantTrie | string> };
const variant_tries = new Map<string, VariantTrie>();
const MAX_VARIANT_TRIES = 500;
const MAX_TRIE_ARMS = 16;

function base_key_of(key: RenderKey): string {
	return `${key.id}\0${key.payload}\0${key.session}\0${key.page ?? ''}\0${key.nested ? '1' : '0'}`;
}

function format_variants(variants: ReadonlyArray<readonly [string, string]>): string {
	return variants.map(([k, v]) => `${k}=${v}`).join('&');
}

function insert_trie(
	base_id: string,
	path: ReadonlyArray<readonly [string, string]>,
	leaf: string
): void {
	if (path.length === 0) return;
	let root = variant_tries.get(base_id);
	if (!root) {
		if (variant_tries.size >= MAX_VARIANT_TRIES) {
			const oldest = variant_tries.keys().next().value;
			if (oldest !== undefined) variant_tries.delete(oldest);
		}
		root = { flag: path[0][0], arms: new Map() };
		variant_tries.set(base_id, root);
	}
	let node: VariantTrie = root;
	for (let i = 0; i < path.length; i++) {
		const [flag_name, variant] = path[i];
		if (node.flag !== flag_name) return;
		if (i === path.length - 1) {
			if (node.arms.size < MAX_TRIE_ARMS) node.arms.set(variant, leaf);
			return;
		}
		let next = node.arms.get(variant);
		if (!next || typeof next === 'string') {
			if (node.arms.size >= MAX_TRIE_ARMS) return;
			next = { flag: path[i + 1][0], arms: new Map() };
			node.arms.set(variant, next);
		}
		node = next;
	}
}

async function resolve_trie(
	base_id: string,
	evaluate_flag: (name: string) => string | undefined | Promise<string | undefined>
): Promise<string | null> {
	let node: VariantTrie | string | undefined = variant_tries.get(base_id);
	while (node && typeof node !== 'string') {
		const val = await evaluate_flag(node.flag);
		if (val === undefined) return null;
		node = node.arms.get(val);
	}
	return typeof node === 'string' ? node : null;
}

const renders = flights.keyed<Ask>()({
	name: 'render cache',
	key: ['id', 'payload', 'session', 'page', 'nested', 'variants'],
	ignore: {
		render_body: 'the render of the key: the same region, props, visitor, page and nesting',
		ttl: 'how long the HTML stays, not what is rendered'
	},
	run: async (ask, signal): Promise<TracedRender> => {
		const { reads, value } = trace_reads(() => ask.render_body(signal));
		const html = await value;
		return {
			html,
			unkeyed_read: unkeyed_read(reads, ask),
			...(reads.variants.length > 0 ? { variants: reads.variants } : {})
		};
	},
	// (a null render, a failure folded to null, is shared while it flies and never kept; nor is one
	// that read what its key does not cover: rule_kept_unkeyed_read)
	keep: (r, ask) => (r.html === null || r.unkeyed_read !== null ? 0 : ask.ttl * 1000),
	max: MAX_BYTES,
	weigh: (r) => Math.max(r.html?.length ?? 0, ENTRY_SHARE)
});

/** Cache key for a region render — id + props payload + session seal (+ the page, for a tree that
 *  reads `page.data`, and any bounded flag variants). `exp`/`sig` (which rotate per mint) and `ttl`
 *  (a cache-window declaration, not a render input) are DELIBERATELY excluded so two renders of
 *  the same region+props+user hit; session is INCLUDED so users never cross. Each part is its own
 *  key field, so two calls whose parts differ never share an entry, whatever the parts hold. */
export function render_cache_key(
	id: string,
	payload: string,
	session: string,
	page: string | null = null,
	nested = false,
	variants = ''
): RenderKey {
	return { id, payload, session, page, nested, variants };
}

/** Test/ops hook: the HTML kept for `key` now, or null. */
export function render_cache_get(key: RenderKey): string | null {
	const seen = renders.peek(key);
	return seen?.kind === 'kept' ? seen.answer.html : null;
}

/** Test/ops hook: drop everything, the flights in progress too (what they render is not kept, and
 *  the calls waiting on them render afresh). */
export function render_cache_clear(): void {
	variant_tries.clear();
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
	signal?: AbortSignal,
	evaluate_flag?: (name: string) => string | undefined | Promise<string | undefined>
): Promise<string | null> {
	if (cache === undefined || cache.ttl <= 0) {
		const body = await render_body(signal);
		report?.('none');
		return body;
	}
	const base_id = base_key_of(cache.key);
	if (evaluate_flag && cache.key.variants === '' && variant_tries.has(base_id)) {
		const resolved = await resolve_trie(base_id, evaluate_flag);
		if (resolved !== null) {
			let hit_outcome: 'miss' | 'hit' = 'hit';
			const hit_ask: Ask = {
				...cache.key,
				variants: resolved,
				render_body: (render_signal) => {
					hit_outcome = 'miss';
					return render_body(render_signal);
				},
				ttl: cache.ttl
			};
			const hit = await renders.get(hit_ask, { signal });
			if (hit !== STALE && hit.unkeyed_read === null) {
				report?.(hit.html === null ? 'none' : hit_outcome);
				return hit.html;
			}
		}
	}
	// (the flight runs the render of the call that opened it: this one, when its own render ran)
	let outcome: 'miss' | 'hit' = 'hit';
	const ask: Ask = {
		...cache.key,
		render_body: (render_signal) => {
			outcome = 'miss';
			return render_body(render_signal);
		},
		ttl: cache.ttl
	};
	for (;;) {
		outcome = 'hit';
		let r: TracedRender | typeof STALE;
		try {
			r = await renders.get(ask, { signal });
		} catch (error) {
			report?.('none');
			throw error;
		}
		if (r !== STALE) {
			// Another visitor's render (it read what the key does not cover, a flag say): this call
			// renders its own, kept by nobody unless it only read bounded variants.
			if (r.unkeyed_read !== null) {
				if (
					outcome === 'miss' &&
					r.html !== null &&
					r.variants &&
					r.variants.length > 0 &&
					evaluate_flag
				) {
					const vkey = format_variants(r.variants);
					insert_trie(base_id, r.variants, vkey);
					await renders.get({ ...ask, variants: vkey, render_body: () => r.html }, { signal });
					report?.('miss');
					return r.html;
				}
				if (outcome === 'hit') {
					const { reads, value } = trace_reads(() => render_body(signal));
					const body = await value;
					if (
						body !== null &&
						reads.perVisitor === null &&
						reads.variants.length > 0 &&
						evaluate_flag
					) {
						const vkey = format_variants(reads.variants);
						insert_trie(base_id, reads.variants, vkey);
						await renders.get({ ...ask, variants: vkey, render_body: () => body }, { signal });
						report?.('miss');
						return body;
					}
					report?.('none');
					return body;
				}
			}
			report?.(r.html === null || r.unkeyed_read !== null ? 'none' : outcome);
			return r.html;
		}
		if (signal?.aborted) throw signal.reason;
	}
}
