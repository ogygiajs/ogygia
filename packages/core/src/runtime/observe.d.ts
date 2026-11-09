/**
 * ONE IntersectionObserver per distinct `rootMargin`, shared by every element that wants to know
 * when it enters the viewport — `wake:'visible'` islands, `when="visible"` holes, the hydration
 * scheduler's viewport snapshot. An observer per island (150 of them on a measured page) is 150
 * observers the browser walks on every scroll; one per margin is a handful, each walking the same
 * targets in one pass. Callbacks live on a per-observer `WeakMap` keyed by the target, so a
 * disconnected element drops out with its callbacks.
 *
 * SEVERAL callbacks per element per margin. It was one, a second `observe` replacing the first —
 * and the hydration scheduler's viewport snapshot and a `wake:'visible'` island both watch the
 * island at the default margin: the wake replaced the snapshot, so the scheduler never learned
 * where a visible island was and held every one of them for its whole 48 ms snapshot wait (200
 * islands scrolled into view: each woke 62–84 ms late, with nothing ahead of it).
 */
type Callback = (intersecting: boolean) => void;
/**
 * Observe `el` under the shared observer for `rootMargin`; `cb` sees every intersection change
 * (the initial one included) until the returned unobserve is called. Any number of callbacks per
 * element: a later one gets the element's last known state at once (the browser reports an
 * element it already watches only on a change), or the first report with the others.
 */
export declare function observe(el: Element, rootMargin: string, cb: Callback): () => void;
/** Test seam: how many observers exist (one per distinct rootMargin, ever). */
export declare function observer_count(): number;
/** Observe until the FIRST time `el` intersects, then fire once and stop. */
export declare function once_visible(el: Element, rootMargin: string, fire: () => void): () => void;
export {};
