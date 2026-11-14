import { parse_sidecar_text, parse_wire_text } from './wire-format.ts';
import { page_state, set_page, reset_page, type PageSnapshot } from '../shims/page-store.svelte.ts';
import { kit_bridge } from '../shims/kit-bridge.ts';
import { install_page_defer, page_defer_revivers } from './page-defer.ts';
import { transport_decoders } from './app-transport.ts';
import { capture_region_ids } from './region-ids.ts';
import { kit_page_thread } from './kit-page-thread.svelte.ts';
import { boot_link, slots } from './slots.ts';
import { warn } from '../messages/lazy.ts';
import { PAGE_SEED_SELECTOR } from '../page-seed-selector.ts';
import { OGYGIA_PAGE_UNSHIPPED } from '../wire-markup.ts';

const session = () => boot_link().runtime_session;
const server_channel = (doc: Document, selector: string) =>
	boot_link().server_channel(doc, selector);

const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;
const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);

export { PAGE_SEED_SELECTOR };
const REMOTE_SEED_SELECTOR = 'script[type="application/ogygia-remote"]';

export { parse_sidecar_text };

/**
 * The PAGE feature (link/runtime-entry.ts, hydrate phase): what island code sees of its page — the
 * page seed behind `$app/state` / `$app/stores`, the seed references in island props, and, on a
 * Kit-hydrated document, the wait for Kit's own page. Installed only when island code can reach
 * Kit's world (the driver's island-closure walk, failing open on anything it cannot follow): an app
 * whose islands never read their page gets no seed from the server and ships none of this.
 */
export function install(): void {
	slots.page = { seed_page_once, seed_data_of, kit_page_thread };
}
type PageSeed = Partial<Omit<PageSnapshot, 'url'> & { url: string | URL }>;

let parses = 0;
/** Test seam: how many page-seed scripts were parsed since boot (one per document is the law). */
export function seed_parse_count(): number {
	return parses;
}

function parse_page_seed(el: Element): PageSeed | null {
	parses++;
	try {
		install_page_defer(transport_decoders);
		const raw = capture_region_ids(
			el.ownerDocument,
			() => parse_sidecar_text(el, page_defer_revivers(transport_decoders)) as PageSeed
		);
		if (slots.nav && !DEVTOOLS) el.textContent = '';
		if (RULES) watch_unshipped(raw, el.getAttribute(OGYGIA_PAGE_UNSHIPPED));
		return raw;
	} catch (e) {
		if (import.meta.env.DEV) warn('page_payload_unreadable', { what: 'seed' }, e);
		return null;
	}
}

function watch_unshipped(raw: PageSeed | null, attr: string | null): void {
	if (!raw || !attr || raw.data === null || typeof raw.data !== 'object') return;
	let left: Set<string>;
	try {
		left = new Set(JSON.parse(attr) as string[]);
		// oxlint-disable-next-line ogygia/no-silent-failures -- the attribute is ours; one that does not parse names nothing to watch
	} catch {
		return;
	}
	raw.data = new Proxy(raw.data as Record<string, unknown>, {
		get(target, key, receiver) {
			if (typeof key === 'string' && left.has(key) && !(key in target))
				(globalThis as { __og_unshipped_read?: (key: string) => void }).__og_unshipped_read?.(key);
			return Reflect.get(target, key, receiver);
		}
	});
}

function apply_page_seed(raw: PageSeed | null): void {
	if (!raw) return;
	let url: URL | undefined;
	if (raw.url instanceof URL) url = raw.url;
	else if (typeof raw.url === 'string') {
		try {
			url = new URL(raw.url);
			// oxlint-disable-next-line ogygia/no-silent-failures -- the server writes `url.href`; only a hand-made seed lands here
		} catch {
			url = undefined;
		}
	}
	set_page({ ...raw, url });
}

const foreign_seeds = new WeakMap<Document, PageSeed | null>();

/**
 * The parsed seed of a document that is NOT the live one (a navigation's incoming document): parsed
 * on first ask, remembered on the document. The router asks in its preflight (off the view
 * transition's critical path); the soft-invalidate and any kept island's props absorb reuse it.
 */
export function page_seed_of(doc: Document): PageSeed | null {
	const hit = foreign_seeds.get(doc);
	if (hit !== undefined) return hit;
	const el = server_channel(doc, PAGE_SEED_SELECTOR);
	const seed = el ? parse_page_seed(el) : null;
	foreign_seeds.set(doc, seed);
	return seed;
}

/**
 * The `data` a seed reference resolves against: the live page store for the live document (seeded
 * on first ask), the once-parsed seed for a foreign one. `undefined` when the document has no seed.
 */
export function seed_data_of(doc: Document): unknown {
	if (typeof document !== 'undefined' && doc === document) {
		seed_page_once();
		return page_state.data;
	}
	return page_seed_of(doc)?.data;
}

function apply_remote_seed_text(text: string | null | undefined): void {
	if (!text) return;
	slots.remoteSeeds?.seed_query_responses(text);
}

/** Document-level page seed (one script from ogygiaHandle) — once per document; then any page facts
 *  an answer brought since. Every hydrate calls it, before the island reads `page`. */
export function seed_page_once(): void {
	if (!session().page_seeded) {
		session().mark_page_seeded();
		if (typeof document === 'undefined') return;
		const el = server_channel(document, PAGE_SEED_SELECTOR);
		if (el) apply_page_seed(parse_page_seed(el));
	}
	if (session().visit.facts.length) absorb_page_facts();
}

function absorb_page_facts(): void {
	boot_link().with_devalue(
		() => merge_page_facts(),
		(error) => warn('page_payload_unreadable', { what: 'facts' }, error)
	);
}

function merge_page_facts(): void {
	const queued = session().visit.facts.splice(0);
	let merged: Record<string, unknown> | null = null;
	for (const text of queued) {
		let facts: Record<string, unknown>;
		try {
			facts = parse_wire_text(text, false, transport_decoders) as Record<string, unknown>;
		} catch (e) {
			if (import.meta.env.DEV) warn('page_payload_unreadable', { what: 'facts' }, e);
			continue;
		}
		if (!facts || typeof facts !== 'object') continue;
		merged = merged ? Object.assign(merged, facts) : { ...facts };
	}
	if (!merged) return;
	const kit = kit_bridge();
	if (kit) {
		if (import.meta.env.DEV) {
			const data = (kit.page.data ?? {}) as Record<string, unknown>;
			const older = Object.keys(merged).filter(
				(k) => data[k] !== merged![k] && JSON.stringify(data[k]) !== JSON.stringify(merged![k])
			);
			if (older.length) warn('region_newer_page_data', { keys: older.join(', ') });
		}
		return;
	}
	set_page({
		url: page_state.url,
		params: page_state.params,
		route: page_state.route,
		status: page_state.status,
		data: { ...page_state.data, ...merged },
		form: page_state.form,
		error: page_state.error,
		state: page_state.state
	});
}

/**
 * Soft invalidate: refresh document-level page + remote **seeds** from a fetched HTML document
 * without replacing `<body>`, remounting islands, or clearing live query/live instance maps. The
 * router runs it on every navigation (before the body morph — seeds first, DOM second) and
 * `invalidateAll` runs it alone, so Kit remote `form()` success does not view-transition wipe live
 * island state. It is the ONLY seed writer on a navigation and marks the document seeded, so the
 * next island to wake never re-parses. Does **not** auto-refresh live queries — callers that need
 * that use `.refresh()`, or `submit().updates(q)` with server `requested(q).refreshAll()`.
 */
export function apply_soft_invalidate_doc(doc: Document): void {
	if (typeof document === 'undefined') return;
	slots.remoteSeeds?.clear_remote_seeds();
	apply_remote_seed_text(server_channel(doc, REMOTE_SEED_SELECTOR)?.textContent);
	session().mark_remote_seeded();
	apply_page_seed(page_seed_of(doc));
	session().mark_page_seeded();
}

/**
 * Reset per-document session + SSR remote seeds before a new body connects.
 *
 * Do **not** release `query_map` / `live_query_map` entries here — old islands are still mounted,
 * and Kit's LiveQueryProxy throws if its cache entry vanishes mid-render. The release happens in
 * {@link finish_spa_document} after the swap.
 *
 * `next`: the visit of the page going in, made by its navigation (runtime/session.ts `PageVisit`):
 * from here on it is the page's, and the visit of the page going out ends.
 */
export function prepare_spa_document(next?: import('./session.ts').PageVisit): void {
	session().reset(next);
	slots.remoteSeeds?.clear_remote_seeds();
	reset_page();
}

/**
 * After the body swap: departed islands have disconnected, kept ones are still in the page, new
 * ones have only queued their hydrate. Release the Kit query/live instances only departed islands
 * held, so the next page builds fresh ones (a LiveQuery's `#start` is `once`) while a kept island's
 * keep running (#817, e2e/live-query-kept.spec.ts).
 */
export function finish_spa_document(): void {
	slots.remoteSeeds?.release_remote_instances();
}
