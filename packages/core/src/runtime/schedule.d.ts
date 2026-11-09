import { type Scope, type Stale } from '@ogygia/machine';
export declare function yield_task(): Promise<void>;
/**
 * Run `fn` at background priority, off the current task: `scheduler.postTask` at 'background' where
 * it exists, else a macrotask. This orders MAIN-THREAD work only — it lets a pending render or input
 * task go first. It does not hold back the network: while the page's resources download the main
 * thread is idle, so a background task runs at once and an `import()` it starts competes with them.
 * Holding island code back until the page has painted is `after_document_painted`'s job.
 */
export declare function background_start(fn: () => void): void;
/**
 * Resolves once the document is parsed AND painted: after `DOMContentLoaded`, then one rendered
 * frame. This is the moment SvelteKit starts hydrating (its start runs from a deferred module
 * script, so never before DOMContentLoaded), and an island's wake starts no earlier: the runtime
 * boots from a module script that runs BEFORE DOMContentLoaded — the app's other deferred scripts
 * may still be executing and the first paint (and its LCP image) not yet happened — and an island
 * `import()` started there takes bandwidth from both.
 *
 * `readyState` cannot tell "DOMContentLoaded fired" from "about to fire" (it reads `interactive` for
 * both), so the navigation timing entry decides; `load` backs up the listener where there is none.
 * A hidden document paints no frame (`requestAnimationFrame` never fires there) — nothing to protect,
 * so it waits one task instead. Once resolved it stays resolved: a late region (SPA swap, a hole's
 * answer) passes straight through.
 */
export declare function after_document_painted(): Promise<void | Stale>;
/** Test seam: forget the resolved gate (a test that fakes a fresh document). */
export declare function reset_document_painted(): void;
/**
 * Register a region with the scheduler at connect: stamp its order, start its viewport snapshot.
 * Cheap on purpose (a stamp and an `observe`) — connect runs for every region in one task. The
 * snapshot is `owner`'s (the region's lifetime in the page): it stops at the region's turn, or when
 * the owner ends.
 */
export declare function register_region(el: Element, owner: Scope): void;
/**
 * Drop a region from the scheduler (disconnect): its snapshot stops and any pending turn is handed
 * out at once — the waiting hydrate step then sees `isConnected === false` and stands down (or, if
 * the element was re-attached meanwhile, runs — exactly what an un-scheduled wait would have done).
 */
export declare function unregister_region(el: Element): void;
/** The island's module is in flight: a viewport island here holds ready islands below the fold. */
export declare function hydrate_started(el: Element): void;
/** The hydrate attempt is over (turn taken, or it never got there — no entry, a failed import). */
export declare function hydrate_settled(el: Element): void;
/**
 * Wait for this region's turn. Resolves in a task of its own, after every region ahead of it in
 * priority has had its task. Call it when the island can hydrate right now (module loaded) — the
 * continuation after the `await` IS the turn: keep the whole synchronous hydrate step in it.
 */
export declare function hydrate_turn(el: Element): Promise<void>;
/** Test seam: is a hydration turn queued or being drained right now? */
export declare function schedule_idle(): boolean;
