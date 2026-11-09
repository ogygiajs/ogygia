/** Feature entry: fill the `morph` slot (live static-region ticks morph in place). */
export declare function install(): void;
/**
 * Reconcile `parent`'s children toward `new_nodes` (a freshly parsed, detached region). Public slot
 * shape: `(parent: Element, nodes: Node[]) => void` — a drop-in for the previous implementation.
 *
 * `new_nodes` is read but never mutated, so the recursion passes the incoming element's live
 * `childNodes` straight through (see {@link morph_node}) — no per-level array snapshot. Accessed by
 * index, so both a real `Array` (the top-level region) and a live `NodeList` (recursion) fit.
 *
 * Two phases:
 *  1. **Lockstep** — walk old and new in parallel while their keys agree (both `null` and compatible,
 *     or the same non-null key), morphing in place. This is the dominant tick (same structure, values
 *     changed) and it allocates NOTHING — no key map, no cursor bookkeeping. Reorders/inserts/removals
 *     break the lockstep at the first divergence and hand the REMAINDER to phase 2.
 *  2. **Keyed reconcile** — the general move/insert/remove algorithm, run only on the still-unmatched
 *     tail. The key map indexes just the remaining old children, so a change late in a long list still
 *     skips indexing the aligned prefix.
 */
export declare function morph_children(parent: Element, new_nodes: ArrayLike<Node>, options?: MorphOptions): void;
/**
 * One ownership rule (runtime/ownership.ts), two TARGETS.
 *
 * - **`live`** (default: a hole re-answer, a router body swap, a live region tick) — the target is the
 *   new answer, and the DOM stays live afterwards: a child an upgraded element gave itself is foreign
 *   content, kept (a web component must not lose its own upgrade work).
 * - **`walk`** (the pre-hydration repair) — the target is the server sequence Svelte's walk binds by
 *   position, exactly. The same foreign child sitting in a position the walk reads is the node
 *   Svelte's cursor trips on (`getAttribute is not a function` on a nested web component's own
 *   residue), so here it is removed; and a subtree the walk never enters (`data-og-opaque`, a slot) is
 *   left alone — nothing reads it.
 *
 * In both targets a declared-foreign element and a hydrated region are matched, never entered, and an
 * upgraded element's host ATTRIBUTES stay its runtime's.
 */
export interface MorphOptions {
    target?: 'live' | 'walk';
    /**
     * A child of the ROOT that is not the render's (the router's body reconcile: a node a script put
     * in `<body>`, such as a portal's mount anchor; ownership.ts `server_body_child`). The morph steps
     * over it: never matched, never moved, never removed. The render's children around it reconcile
     * as usual. Root level only; below the root the ownership rules decide.
     */
    stays?: (node: Node) => boolean;
}
/** Add + update + remove attributes so `from` matches `to` exactly. Boolean attrs are attr presence.
 *  `keep_extra` (a self-owned element, {@link is_self_owned}): add + update only — an attribute the
 *  element gave itself is not the render's to take away. */
export declare function sync_attributes(from: Element, to: Element, keep_extra?: boolean): void;
