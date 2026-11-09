type Watcher = (live: unknown) => void;
export declare function watchers(): Map<string, Set<Watcher>>;
/** Subscribe to fresh data settling for `id`. Returns an unsubscribe fn. */
export declare function watch(id: string, cb: Watcher): () => void;
/**
 * Notify watchers that fresh data settled for `id`. Called by resolve's live-merge path AND
 * directly by subsystems that push a value in (a region frame landing, a streamed promise
 * resolving) — those pass the settled value; resolve's path passes the merged live instance.
 * A throwing watcher never blocks the others.
 */
export declare function notify(id: string, live: unknown): void;
/**
 * Run `fn` with watch notifications BUFFERED, flushing them once when the outermost batch exits.
 * Wrap any operation that resolves several refs at once (a context parse, a props decode, a nav's
 * ref bag) so cross-ref invariants hold before any watcher reacts. Returns `fn`'s result.
 */
export declare function batch<T>(fn: () => T): T;
/** How many watchers are registered for `id` — lets a subsystem that owns lifecycle around a
 *  hub id (fetch dedupe, eviction TTL) make refcount decisions without a parallel subscriber set. */
export declare function watcher_count(id: string): number;
export {};
