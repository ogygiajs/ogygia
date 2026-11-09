/**
 * A HOLE'S ANSWER, CUT INTO ITS PARTS — the one cut the devtools Page tab's waterfall and the
 * profiler report's One clock both draw. Where the browser (Resource Timing) and the server
 * (Server-Timing `og-queue`, `og-render`) timed it: before its request left (a busy page, the
 * runtime's queue), the server's wait for a render slot, the server render (or, untimed, the wait
 * for the first byte), then the rest (network, the body, the swap). Page times, ms.
 */
export interface HoleTimes {
    /** when its fallback began to count (the first paint, or the hole's own start) */
    shown_at?: number;
    /** how long its fallback stood: from `shown_at` to the swap */
    wait_ms: number;
    left_at?: number;
    first_at?: number;
    server_queue_ms?: number;
    server_ms?: number;
}
export type HoleSegKind = 'wait' | 'before' | 'slot' | 'render' | 'server' | 'rest';
export declare const HOLE_SEG_LABEL: Record<HoleSegKind, string>;
/** The segments, in order. Without a timing, one: the wait. A request the document preloaded
 *  starts before the fallback counts: its segments start where it left. */
export declare function hole_segments(h: HoleTimes): {
    k: HoleSegKind;
    a: number;
    b: number;
}[];
