/**
 * `hydratedBy()` — which schedule woke the hydration root this component is mounting under.
 *
 * Call during component SETUP (like `getContext`): the runtime marks the region it is hydrating
 * (the same anchor cross-island context uses), and this reads that region's `hydrate` attribute.
 *
 * Why you'd care: when a visitor's input woke the island, its first event is a REPLAY — real
 * interaction, but not a trusted browser gesture (`event.isTrusted === false`), so gesture-gated APIs
 * (`window.open`, clipboard, fullscreen) will be blocked for it, and a guard that ignores untrusted
 * clicks ignores it. A component that needs those can check `hydratedBy() === 'interaction'` and
 * adapt (e.g. render the popup as a link the SECOND click uses, or skip an entrance animation that
 * assumes a fresh load).
 *
 * Returns:
 * - `'interaction'` when a visitor's input woke it — an `interaction` island, and a scheduled one
 *   pressed before its schedule made it live (its click is replayed too)
 * - else `'load' | 'idle' | 'visible'` or a media-query string — the region's schedule
 * - `null` on the server (SSR pass), and on csr=true pages where Kit (not ogygia) hydrates.
 *
 * A nested island hydrates with its parent, so it reports the PARENT region's schedule — correct:
 * that is the wake that ran its code.
 */
export declare function hydratedBy(): string | null;
