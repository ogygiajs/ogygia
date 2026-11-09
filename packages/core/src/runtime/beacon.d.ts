import type { RegionRefusal } from './region-endpoint-url.ts';
export declare function beacon_mark(name: string, ms: number, attrs?: Record<string, string | number | boolean>, t0?: number): void;
interface Vitals {
    ttfb?: number;
    fcp?: number;
    lcp?: number;
    cls?: number;
    inp?: number;
}
interface VisitIslandRec {
    fp: string;
    entry?: string;
    t0: number;
    loaded: number;
    /** when its scheduler turn began (after the module load and the queue behind other islands):
     *  `done - turn` is the hydrate step alone, `turn - loaded` the wait for its turn */
    turn?: number;
    done: number;
    /** when its effects had run (Svelte runs them in a microtask after `hydrate()`), when 1 ms or
     *  more after `done`: the end of the island's own work */
    fx?: number;
    recovered?: boolean;
    changed?: boolean;
    /** a change only in attributes (same elements, same text): each one, as `attr_changes` tells them —
     *  often a custom element setting its own (`tabindex`, `aria-*`) as it upgrades, not the app
     *  rendering differently. Absent when text or elements differ too. */
    attrs?: AttrChange[];
    /** input landed on it between its wake and its hydrate (a pointer over it, a key, focus): its DOM
     *  may have answered that input, so a change is not only the render */
    input?: string;
    /** another script edited it before it woke; the runtime put the server markup back */
    healed?: boolean;
    ssr_bytes?: number;
    /** a recovered island whose markup ARRIVED with Svelte's block markers unpaired (`<!--[` openers
     *  against `<!--]` closers): something rewrote them on the way — a render always pairs them */
    markers?: [number, number];
}
interface Shift {
    t: number;
    value: number;
    fp?: string;
    /** the element that moved, told briefly */
    tag?: string;
    from?: [number, number, number, number];
    to?: [number, number, number, number];
}
/** One attribute that differs between the server's markup and the island's after hydrate. */
export interface AttrChange {
    tag: string;
    name: string;
    from: string | null;
    to: string | null;
}
/**
 * When two markups (comments out) differ ONLY in attributes — the same elements in the same order, the
 * same text — each attribute that differs (at most 20); `null` when text or elements differ. A walk of
 * both strings tag by tag, no regex: it runs once per changed island.
 */
export declare function attr_changes(a: string, b: string): AttrChange[] | null;
export declare function beacon_warning(w: {
    code: string;
    message: string;
    file?: string;
    fp?: string;
    t: number;
}): void;
/** holes whose answer never came (no retry after): the profiler names them like the devtools do */
export interface HoleFailed {
    /** the hole's island id (its endpoint's `?id=`): the report's hole rows name it */
    id: string;
    reason: RegionRefusal | 'error';
    /** what answered instead, as a path (a refused answer) */
    final_path?: string;
    /** the error's first line (a failed request), or the server's reason (a refused capability) */
    message?: string;
    attempts: number;
    t: number;
}
export declare function beacon_hole_failed(h: HoleFailed): void;
/**
 * A file's type, for the byte counts and the lanes: its extension first, then the `<link>` that
 * fetched it (`as`), then what started it. A `link` initiator is NOT a stylesheet by itself: a
 * `<link rel=preload>` fetches whatever its `as` says — a hole's preload fetches HTML, from a URL
 * with no extension, and every first-screen hole answer landed in the CSS column (and One clock's
 * CSS lane). (Chromium reports a modulepreload's initiator as `other`; its `.js` decides anyway.)
 */
export declare function resource_type(ext: string, initiator: string, link_as?: string): string;
export interface HoleAnswered {
    /** the hole's island id (its endpoint's `?id=`) */
    id: string;
    /** its place in the visit's list (copies of one component share the id) */
    n: number;
    /** when its fetch started, and when its answer replaced the fallback (page time, ms) */
    start: number;
    t: number;
    /** below the first screen when it swapped: its fallback was not what the visitor looked at */
    below_fold: boolean;
    /** its request, as the browser timed it (page time): left, first byte back, last byte */
    left?: number;
    first?: number;
    end?: number;
    /** the server's split (Server-Timing): its wait for a render slot, and the render */
    queue?: number;
    render?: number;
    /** it came in ONE batch request with this many holes (`left` the batch's, `first`/`end` its
     *  own part's landing, out of order) — no request of its own */
    batch?: number;
    /** which copy (runtime/hash.ts `hole_copy_of` its endpoint): copies of one component share the id */
    p?: string;
}
/** A batch request that carried fewer holes than it was sent for (runtime/frame-nav.ts). */
export interface HoleBatchMiss {
    sent: number;
    delivered: number;
    status: number;
    refused?: 'redirected' | 'document';
    final_url?: string;
    /** the holes' island ids */
    ids: string[];
}
export declare function beacon_hole_batch_missed(m: Omit<HoleBatchMiss, 'ids'> & {
    endpoints: string[];
}): void;
/** The browser's timing of the request that answered a hole: the latest one for its URL done by
 *  `by` (the swap). It may predate the runtime (the document preloads first-screen holes). `left`
 *  is when it went on the wire (`requestStart`: after any wait for a connection), not when it was
 *  asked for. Null when the resource buffer has none (full, or no Resource Timing). */
export declare function hole_request_times(endpoint: string, by: number): {
    left: number;
    first: number;
    end: number;
    queue?: number;
    render?: number;
} | null;
/** An island whose LOCATION failed to load and fell back to its identity fetched fresh
 *  (runtime/entry-locations.ts): the page came from a build whose files are gone. */
export interface EntryFallback {
    /** the identity (the stable URL) */
    entry: string;
    /** the location that failed */
    src: string;
    /** the fresh identity loaded (false: that failed too) */
    recovered: boolean;
}
export declare function beacon_entry_fallback(f: EntryFallback): void;
/** The runtime asks for a hole's HTML (each ask, retries and re-asks included): what lets a
 *  preload followed by a download read as used-then-asked-again, not as a preload the browser could
 *  not use. */
export declare function beacon_hole_fetched(endpoint: string): void;
/** A hole's first answer landed: the profiler weighs how long its fallback held the first screen.
 *  The element is read (id, place) only while measuring. */
export declare function beacon_hole_answered(el: Element, start: number, batch?: {
    left: number;
    at: number;
    size: number;
}): void;
/** An island's markup as the server sent it, after it hydrated, and at the visit's end. A big
 *  island keeps only the window around where the two first differ, without comments (`from`: where
 *  the window starts in that text) — its first 24 KB would quote the cut, not the change. */
export interface Snapshot {
    fp: string;
    ssr: string;
    hydrated: string;
    final?: string;
    from?: number;
}
/** `slim`: the same message without what earlier messages already delivered, for a page going
 *  away with a body too big to leave (the server keeps the longest file list and merges regions).
 *  A page with ~300 islands sent 100 KB: refused by both, and the fetch's rejection went unhandled,
 *  so the profiler never got that page's browser side at all. */
declare function send(body: string, slim?: () => string): void;
/** a kept trace; an interaction's carries its spans (the wait, the handlers) */
export interface CpuKept {
    trace: unknown;
    from: number;
    to: number;
    label: string;
    spans?: {
        t: number;
        wait: [number, number];
        handler: [number, number];
    };
}
/** THE IN-APP NAVIGATIONS (the router's body swaps), each on the page's clock: its start, the page
 *  fetched, its stylesheets in, the swap committed. A slow one is a cost the document's own timing
 *  never shows; the islands the new page woke are in the visit's island list, after `swapped`. */
interface NavRec {
    from: string;
    to: string;
    type: string;
    t: number;
    fetched: number;
    styled: number;
    swapped: number;
    /** the page's address as fetched: its resource timing splits the fetch */
    href?: string;
}
export declare function beacon_nav(n: NavRec): void;
export declare function beacon_failed(el: Element, message?: string, since?: number, turn?: number): void;
/**
 * Record one island's hydration. `t0` is when the wake began (before the module load), `t_loaded`
 * when its modules were in hand, `t_done` when `data-hydrated` was set; `ssr_html` is the markup
 * the server sent (the runtime's own copy), compared with what the island shows now. No-op
 * without the tag.
 */
export declare function beacon_hydrated(el: Element, t0: number, t_loaded: number, t_done: number, ssr_html?: string | null, t_turn?: number): void;
/** `html` without the runtime's own marks (string search, no regex: it runs per changed hydration) */
export declare function without_runtime_marks(html: string): string;
/** A HEADLESS island: it renders nothing meant to be seen — no text of its own, and every element
 *  child marked `hidden` (a marker its effects hang on) — so it exists for its effects, and the
 *  screen sizes that would show it are no question. */
export declare function is_headless(el: Element): boolean;
/** `html` with every `<!-- … -->` removed (string search, no regex: it runs per hydration). */
export declare function without_comments(html: string): string;
/** Start watching the page's paints, shifts, long tasks and first interactions now (the devtools
 *  boot calls this, so a page whose islands never wake is still measured). Idempotent. */
export declare function beacon_watch(): void;
/** Devtools: sample the main thread for `ms` from now (a click, a scroll, a nav) and keep the trace
 *  in the page. Resolves when it is kept; false when the browser cannot sample here. */
export declare function beacon_record_cpu(ms: number, label: string): Promise<boolean>;
/** What the browser saw of this document so far, for the devtools Page tab: the vitals, the visit
 *  (navigation, paints, resources, long tasks, islands, first interactions, shifts, marks) and the
 *  islands' markup before and after hydration. A fresh copy each call; null off a devtools build
 *  without the tag. */
export interface BeaconPage {
    vitals: Vitals;
    visit: Record<string, unknown> | null;
    islands: VisitIslandRec[];
    firsts: {
        fp: string;
        t: number;
        type: string;
    }[];
    shifts: Shift[];
    longtasks: {
        t: number;
        ms: number;
    }[];
    /** `frames`: this browser has no long-task timing; they are frames drawn late */
    longtasks_from?: 'frames';
    /** `boxes`: this browser has no layout-shift timing; the shifts are islands' boxes changing as they woke */
    shifts_from?: 'boxes';
    marks: {
        name: string;
        ms: number;
        t0?: number;
    }[];
    snapshots: Snapshot[];
    /** the main thread, sampled (JS Self-Profiling): the load trace and recordings, newest first */
    cpu: {
        state: 'recording' | 'done' | 'off';
        off?: string | null;
        traces: CpuKept[];
    };
}
export declare function beacon_page(): BeaconPage | null;
/** @internal tests */
export declare function _reset_beacon(): void;
/** @internal tests */
export declare function _beacon_state(): {
    target: string | null | undefined;
    queued: number;
    marks: number;
    scheduled: boolean;
    snapshots: number;
};
/** @internal tests: the size-aware send */
export declare const _beacon_send: typeof send;
/** @internal tests: a send from inside the hide (a page leaving while it still reads "visible") */
export declare function _beacon_send_leaving(body: string, slim?: () => string): void;
export {};
