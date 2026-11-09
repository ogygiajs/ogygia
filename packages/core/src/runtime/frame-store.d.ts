import { type Stale } from '@ogygia/machine';
import type { Frame } from '../frame.ts';
export type FrameFetcher = (signal: AbortSignal) => Promise<string>;
/** A new stamp of the store's world, newer than every one before it: a fetch takes one when it
 *  starts, and a channel that writes from elsewhere (a batch's part, a streamed or mutation frame)
 *  when it writes. */
export declare function stamp(): number;
/** Applied content for an address, if any. */
export declare function peek(a: string): {
    v: number;
    html: string;
} | null;
/** A renewal at this address answered `fresh`, the capability its elements fetch with from now on. */
export declare function renew(a: string, fresh: string): void;
/** The fresh capability a renewal at this address answered, if any. */
export declare function renewal(a: string): string | null;
/** Nothing applied and nothing in flight at this address (a batch may take it on). */
export declare function is_idle(a: string): boolean;
/**
 * Write a frame. Applied only if its stamp is newer than the applied content's; an older or equal
 * one is dropped and reported `false`. Subscribers are notified on apply.
 */
export declare function write(f: Frame): boolean;
/**
 * Reserve an address whose content is arriving via an EXTERNAL batch stream (single-flight navigation). A region
 * binder that mounts before its frame lands calls `ensure()`, finds the batch's flight there, and JOINS it
 * instead of starting its own fetch — so a navigation that pulls N regions makes ONE batch request,
 * not N. `write()` fulfils it when the frame arrives; `release()` fails it if the batch ends without
 * one (the binder then falls back to its own fetch). The flight is the batch's: a binder leaving never
 * ends it. No-op if content or a fetch is already present.
 */
export declare function reserve(a: string): void;
/**
 * Fail an unfulfilled batch part (the batch ended and no frame was written at this address, by it or
 * by anyone). Joined binders reject out of `ensure()` and retry with their own fetch. No-op once a
 * frame has landed (it settled the part).
 */
export declare function release(a: string): void;
/** The error a joined reservation rejects with when its batch ended without its frame: the binder's
 *  own fetch runs at once (nothing failed — the batch just did not carry it). */
export declare const BATCH_MISS = "OgygiaBatchMiss";
/**
 * Subscribe to writes at an address. If content is ALREADY applied, the callback fires immediately
 * with it (a late binder — e.g. a region that mounts after a batch stream already delivered its
 * frame — catches up without a request). Returns an unsubscribe fn. While subscribed the entry
 * stays; after the last unsubscribe it lingers EVICT_TTL then goes (unless re-bound).
 */
export declare function subscribe(a: string, cb: (f: Frame) => void): () => void;
/**
 * Ensure an address has content, deduping concurrent callers onto one fetch.
 *
 * - Content already applied (and not `force`): resolves immediately with it.
 * - A fetch (or a batch's part) is in flight (and not `force`): joins it — N regions, ONE request.
 * - Otherwise starts `fetcher` with a fresh stamp; on success the response is WRITTEN (subject to
 *   the staleness check) and the resolved value is whatever the store now holds.
 * - `force` (SWR revalidate) always starts a new fetch, and ends the one out before it: whoever
 *   waited on that one joins the new one. The stamps still guarantee an older response can't
 *   overwrite a newer one.
 *
 * `signal` is the caller's: when it aborts, this caller alone gets `STALE` at once, and the shared
 * fetch is aborted only once its LAST caller left — one unmounting element must not kill a fetch
 * its twin still awaits. Rejections propagate to every joined caller; retry policy stays with the
 * caller (the element).
 */
export declare function ensure(a: string, fetcher: FrameFetcher, opts?: {
    force?: boolean;
    signal?: AbortSignal;
}): Promise<string | Stale>;
/** Test/HMR hook — end the store (every reservation fails, every caller of a fetch gets STALE); the
 *  next use makes a new one. */
export declare function _reset(): void;
