import { type Stale } from '@ogygia/machine';
export type LoadClass = 'user' | 'visible' | 'ahead' | 'speculative';
/** `code`: an island's modules. `content`: HTML (a hole's answer, a prefetched page). */
export type LoadKind = 'code' | 'content';
/** How long background work waits for the page's critical resources at most. */
export declare const CRITICAL_CAP_MS = 2500;
/** Background (`ahead` + `speculative`) downloads in flight at once. */
export declare const BACKGROUND_WINDOW = 3;
/** The fetch priority a class downloads at (`fetch(…, { priority })`, `<link fetchpriority>`). */
export declare function fetch_priority_of(cls: LoadClass): 'high' | 'auto' | 'low';
/**
 * `visible` when `el` — or, for a region with no area of its own, what it renders — intersects the
 * viewport now, else `ahead`. A region whose content is out of flow (a `position: fixed` button) or
 * that is `display: contents` has no area, and where such a box sits says nothing (`display:
 * contents` reports 0,0), so its descendants' boxes decide first (bounded: the first few levels).
 */
export declare function viewport_class(el: Element): 'visible' | 'ahead';
/** How the critical-resources wait ended: they `arrived` (or failed), the visitor's first `input`,
 *  the `cap`, or `none` were pending. */
export type CriticalOutcome = 'arrived' | 'input' | 'cap' | 'none';
type CriticalReport = {
    outcome: CriticalOutcome;
    resources: number;
    waited_ms: number;
};
/** The critical wait's outcome once it settled (the profiler's beacon reads it), else `null`. */
export declare function critical_outcome(): CriticalReport | null;
/** The URLs a preload link may fetch: its `href`, else each `imagesrcset` candidate's. */
export declare function preload_urls(link: HTMLLinkElement): string[];
/**
 * Resolves once the document is parsed and painted AND its author-marked critical resources have
 * arrived (or failed) — or at the visitor's first click or key, or {@link CRITICAL_CAP_MS} into the
 * wait. A page with no marked resource resolves right after the paint. Once resolved it stays so.
 */
export declare function critical_settled(): Promise<void | Stale>;
/**
 * A queued download: asking for one queues it. `ready` resolves with a `release` to call when the
 * download is done (settled, success or not). `cls` may be a getter, re-read whenever the queue
 * drains (viewport changes); `promote` lifts it.
 */
export declare class LoadSlot {
    #private;
    readonly kind: LoadKind;
    readonly label: string | undefined;
    readonly queued_at: number;
    readonly ready: Promise<() => void>;
    /** Still in the queue: a drain takes it out when it starts. */
    queued: boolean;
    constructor(o: {
        kind: LoadKind;
        cls: LoadClass | (() => LoadClass);
        label?: string;
    });
    /** Its class now: the getter's, or the promoted one when that ranks higher. */
    cls(): LoadClass;
    /** Lift it (a prefetch the visitor then navigates to). */
    promote(c: LoadClass): void;
    /** Out of the queue: the holder's `ready` resolves, counted in the background window when it
     *  is one of the guesses. */
    start(cls: LoadClass, background: boolean): void;
}
/** Test seam: a fresh document. */
export declare function reset_load_scheduler(): void;
export {};
