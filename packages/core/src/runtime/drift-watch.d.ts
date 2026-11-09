/**
 * WHICH SLEEPING ISLANDS WERE TOUCHED. An island keeps its server markup from its first connect and,
 * at its wake, used to parse that copy and walk it against the live DOM (hydrate-core
 * `repair_if_drifted`) — every island, though almost always nothing had touched it: two thirds of
 * Svelte's own hydrate time on a page of heavy islands, measured. One `MutationObserver` over the
 * document now marks an island CHANGED when a node or a text in it changes (the comparison ignores
 * attributes, and so does this); the wake runs the comparison, and the repair, only for a changed
 * one. Nothing is decided by timing: the wake takes the observer's pending records first.
 *
 * The observer runs only while some island sleeps with a copy (a page whose islands are all awake
 * pays nothing for later DOM work). An island that leaves the document while it sleeps is marked
 * changed: nothing watched it meanwhile. A browser without MutationObserver: every island compares,
 * as before.
 */
/** A region kept its server copy: watch until it wakes (pair with {@link unwatch_region}). */
export declare function watch_region(): void;
/** A region woke (or left): stop watching once none sleeps. */
export declare function unwatch_region(): void;
/** The region's copy is stale (it left the document while it slept): compare it at the wake. */
export declare function mark_region_changed(region: Element): void;
/** Was anything in this region's markup touched since it kept its copy? Read at the wake, BEFORE the
 *  runtime itself edits the island (lakes lifted): the pending records are taken first. */
export declare function region_changed(region: Element): boolean;
