/**
 * Document-scoped runtime session: lake caches, seed flags, kit-page probe, server-island gate, and
 * the page visit. Cleared on SPA body swap via `reset()` so connecting regions never see the previous
 * page.
 */
import { type Scope } from '@ogygia/machine';
import { ConcurrencyGate } from './concurrency.ts';
/** Cached SSR DOM (+ optional SWR endpoint) for `{#if}` remount of hydrate:none regions.
 * Keyed by lake entry id — size is O(unique lakes on the page), not O(toggles).
 * Cleared on SPA body swap via `reset()`. SWR refresh replaces the entry (does not grow). */
export type LakeCacheEntry = {
    frag: Node;
    endpoint: string;
    when: string;
    /** `Date.now()` when this entry was first cached or last successfully revalidated. */
    cachedAt: number;
    /** Client TTL in ms; `0` = no expiry. */
    maxAgeMs: number;
};
/**
 * THE PAGE VISIT: one per page the visitor is on, the document load, then each page a navigation
 * swaps in. It ends when the next page's swap takes over (`RuntimeSession.reset`). What the page
 * holds is its own and goes with it: on `scope`, its listeners, timers, observers and streams (the
 * router's link scan, the batch of its holes, the waits for the sheets its answers bring); in
 * `facts`, what its answers brought for its next hydrate.
 *
 * A navigation makes the visit of the page it brings before its swap (`RuntimeSession.next_visit`):
 * what it starts for that page early, the batch of its holes, is that visit's. A navigation that
 * ends without its swap (called off, taken over, given to the browser) ends that visit, never the
 * page's (./router-nav.ts `navigate`).
 */
export type PageVisit = {
    /** Closed when the visit ends. */
    readonly scope: Scope;
    /** The page facts answers rendered with (server/render-page.ts), queued at the answer seam
     *  (`region_fragment`) for the next hydrate to merge into the page store (seeds.ts). This page's
     *  only: the next page's visit starts with none (#269). */
    readonly facts: string[];
};
/** What one island's hydrate step put in `<head>` ({@link RuntimeSession.mark_head}). */
export interface HeadMark {
    /** The head's elements now that were not its children when the mark was made, in head order. */
    added(): Element[];
    /** Stop noting (a step that ended without a record). */
    stop(): void;
}
export declare class RuntimeSession {
    #private;
    /** Page-owned head nodes (see above). Survives `reset()`: it is the document's, not a page's. */
    readonly page_head: WeakSet<Node>;
    /** Island-owned head ELEMENTS still to watch (pruned when they leave the document). */
    readonly island_head: Set<Element>;
    /** Mark a node this document's page owns (the router / runtime inserted it for the page). */
    claim_page_head(node: Node): void;
    /** At boot: everything already in <head> came from the server — the page owns it. */
    adopt_document_head(): void;
    /**
     * Before an island's hydrate step: start noting what lands in `<head>`. A MutationObserver on the
     * head's own children, read synchronously when the step ends, so the record costs what the island
     * added, not the whole head (a copy of the head per island grew as islands × head). Without
     * MutationObserver: the head's elements, copied.
     */
    mark_head(): HeadMark;
    /** After an island's hydrate: the head elements it added (not there before the step, not
     *  page-owned) are that island's; then retire the page's copies of them. */
    record_island_head(mark: HeadMark): void;
    /**
     * Remove every PAGE-owned head element that duplicates a live island-owned one (same markup), and
     * the page's `<title>` once an island renders its own (the browser honours the first title, and
     * the island's is the reactive one). Runs after an island hydrates and after a navigation merge.
     */
    retire_page_head_copies(): void;
    readonly lake_cache: Map<string, LakeCacheEntry>;
    readonly settled_lakes: WeakSet<Element>;
    readonly initialized_lakes: Set<string>;
    readonly server_gate: ConcurrencyGate;
    /** The visit of the page on screen (see {@link PageVisit}). */
    get visit(): PageVisit;
    /** The visit of the page a navigation brings, made before its swap: the navigation's (it ends
     *  it when there is no swap) until `reset(next)` makes it the page. */
    next_visit(): PageVisit;
    get remote_seeded(): boolean;
    mark_remote_seeded(): void;
    get page_seeded(): boolean;
    mark_page_seeded(): void;
    get kit_page(): boolean | undefined;
    set kit_page(v: boolean | undefined);
    /** Insert/replace a lake cache entry; evict oldest if over LAKE_CACHE_MAX. */
    set_lake_cache(id: string, entry: LakeCacheEntry): void;
    settle_lakes_in(root: ParentNode): void;
    /** The next page takes over (its visit, made by its navigation; a new one when none is given),
     *  and the visit of the page it replaces ends. */
    reset(next?: PageVisit): void;
}
/** Process-wide session for the islands runtime (one client module graph). */
export declare const runtime_session: RuntimeSession;
