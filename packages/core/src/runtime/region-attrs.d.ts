/**
 * DOM attribute vocabulary for `<ogygia-region>` (DESIGN.md two axes).
 *
 * - `wake`    — when JS wakes: `none` | `load` | `idle` | `visible` | `interaction` | media query
 * - `render`  — when HTML arrives: omit/`page` | `defer`
 * - `when`    — schedule for `render="defer"` OR `remount="swr"` revalidate
 * - `hydrate-margin` — IntersectionObserver rootMargin for phase-2 `wake="visible"`
 * - `remount` — `{#if}` re-creation of `wake="none"`: `cache` | `empty` | `swr`
 * - `max-age` — client lake-cache TTL in ms (optional)
 * - `on-expire` — past max-age: `empty` | `fetch` (swr default `fetch`, cache default `empty`)
 *
 * No "island" / "lake" attribute names — those are nicknames, not the mechanism.
 */
/** CSS selector for frozen regions (`hydrate: 'none'`). */
export declare const FROZEN_SELECTOR = "ogygia-region[wake=\"none\"]";
/** True if this region is a wake boundary (JS will / did run for its subtree). */
export declare function is_awake(el: Element): boolean;
/** True if this region freezes its subtree (SSR DOM preserved; no client module). */
export declare function is_frozen(el: Element): boolean;
/** True if this region fetches HTML later (`render="defer"`). */
export declare function is_deferred(el: Element): boolean;
/**
 * The regions whose INSIDE Kit's hydration never walks — OPAQUE to it, adopted as one element: a lake
 * (frozen server HTML), a hole (a fallback, then an answer fetched after load — a region found inside
 * one on a Kit-hydrated document came with that answer: the page's own fallback renders its islands
 * inline, as Kit's), and a BAKED live region (its first HTML is server-only, morphed in after by the
 * runtime). Their insides are ogygia's on every page: nothing else will wake them. The server twins:
 * `isInLake()` (context.ts — set by LakeBoundary and on every render root whose HTML lands in one) and
 * `region_kind` (reversible.ts).
 */
export declare const OPAQUE_SELECTOR = "ogygia-region[wake=\"none\"],ogygia-region[render=\"defer\"],ogygia-region[data-og-baked]";
/** True if this region sits inside an {@link OPAQUE_SELECTOR opaque} region: on a Kit-hydrated
 *  document nothing but the runtime will ever wake it. */
export declare function inside_opaque(el: Element): boolean;
/** Mixed mode (a csr=true document): Kit hydrates the tree, so an island there is Kit's — EXCEPT
 *  what Kit never sees: a deferred region (its HTML is fetched after load) and anything inside an
 *  opaque region (a lake, a hole's answer, a baked region's first HTML). Those are ours. */
export declare function ours_on_kit_document(el: Element): boolean;
/** `{#if}` remount policy for `wake="none"` regions. Default `cache`. */
export declare function region_remount(el: Element): 'cache' | 'empty' | 'swr';
/** Client lake-cache TTL in ms from `max-age`. `0` = no expiry. */
export declare function region_max_age_ms(el: Element): number;
/**
 * Past-maxAge behavior. Defaults: `cache` → `empty`, `swr` → `fetch`.
 * `fetch` is only meaningful with `remount="swr"` (endpoint present).
 */
export declare function region_on_expire(el: Element): 'empty' | 'fetch';
/**
 * True when a frozen region has only Svelte placeholder anchors (comments / whitespace).
 * Used by remount: a text-only lake is still "filled" — `querySelector('*')` would miss it and
 * double-append the cache on reconnect (REMOUNT-VACANT).
 */
export declare function region_is_vacant(el: ParentNode): boolean;
/** True when this document was SERVED FROM a page store (a plugin stamps the hit/join copies with
 *  `STORED_DOCUMENT_META`). A stored copy is a cached render by definition — swr lakes read this to
 *  revalidate on FIRST mount, not only on remounts. */
export declare function document_is_stored(): boolean;
/**
 * True when the browser's HTML parser tore this placed island's SSR content OUT of the region —
 * the invalid-nesting hoist.
 *
 * A block-rendering island authored INLINE inside a `<p>` (e.g. a `<Counter/>` sitting in a markdown
 * sentence, where the component renders `<div>…</div>`) is invalid HTML: a `<div>` start tag while a
 * `<p>` is in button scope makes the parser CLOSE the paragraph, popping this `<ogygia-region>` with
 * it — the region is left holding only its opening Svelte hydration anchors (`<!--[-->`), while the
 * rendered nodes (and the closing anchors) become siblings of the paragraph. Hydrating that empty
 * region then fresh-mounts a SECOND copy, and the hoisted server copy lingers as an orphan → the
 * page shows the island twice.
 *
 * Detected as an UNBALANCED hydration envelope: strictly more `[` open anchors than `]` close anchors
 * among the region's descendants. A validly-nested region (inline content, or block content in block
 * context) always balances; a region that renders nothing balances (0 == 0); a not-yet-swapped
 * deferred/live region carries no anchors at all (0 == 0). So this never false-positives on a
 * correctly-parsed region — only the parser-truncated envelope reads open > close.
 */
export declare function region_ssr_truncated(el: ParentNode): boolean;
/**
 * Schedule string for the shared scheduler.
 * Deferred regions use `when`; waking regions use `wake`; default `load`.
 */
export declare function region_schedule(el: Element): string;
/**
 * Wake schedule from `wake`, or `null` when this region does not run JS
 * (`wake` absent / `'none'`). Used after a deferred HTML swap for phase 2.
 */
export declare function region_hydrate_schedule(el: Element): string | null;
/**
 * Phase-2 (post-swap) hydrate schedule for a deferred client island.
 *
 * - Matching schedules (`load`/`load`, `idle`/`idle`, `visible`/`visible`, same media) → `'load'`
 *   (hydrate immediately; do not re-arm the same idle / IO / MQ).
 * - `hydrate: 'load'` after any defer → `'load'` (ASAP after swap).
 * - Otherwise arm hydrate’s own schedule only.
 */
export declare function phase2_hydrate_schedule(defer_when: string, hydrate: string): string;
