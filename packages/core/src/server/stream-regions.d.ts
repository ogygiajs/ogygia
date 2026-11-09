/**
 * Region parcels for the batch endpoint (single-flight navigation, a page's first-load holes, OOO).
 * Each rendered region call is boxed as a `<template data-ogygia-slot>` parcel keyed by its capability
 * signature; the client frame stream reads them out of order and drops each into the matching region.
 * A done-sentinel ends the batch.
 *
 * The client reads a parcel as TEXT (runtime/frame-nav.ts), never as DOM. A plain parcel ends at the
 * first `</template>`; an answer that itself carries `</template` (a web component's declarative
 * shadow root) is LENGTH-FRAMED instead — `data-og-len` is its UTF-16 length, the unit the client's
 * decoded string counts in — so its content can never close the box or forge a parcel for another
 * slot, and it no longer falls back to a second request.
 *
 * No I/O and no Kit (the batch stream is handed its render), so it stays unit-testable.
 */
import { type Scope } from '@ogygia/machine';
/** Build a parcel `<template data-ogygia-slot="…">…rendered html…</template>` (length-framed when
 *  the html carries a `</template` of its own). */
export declare function build_parcel(slot: string, html: string): string;
/** The done-sentinel parcel (empty template) the client watches to end the batch. */
export declare function done_parcel(): string;
/** One region call's answer in a batch: its slot (the capability signature) and its HTML. Null:
 *  the call is left out (the client fetches it on its own). */
export type BatchAnswer = {
    slot: string;
    html: string;
} | null;
/**
 * The batch's frame stream: every call renders at once, and each answer goes out as its parcel the
 * moment it settles, whatever the order; the done sentinel ends it. `render` is handed the batch's
 * signal: it aborts when the stream is cancelled, or when `owner` (the request's) ends first.
 */
export declare function batch_stream(calls: readonly string[], render: (endpoint: string, signal: AbortSignal) => Promise<BatchAnswer>, owner?: Scope): ReadableStream<Uint8Array>;
