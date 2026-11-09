import { type Scope } from '@ogygia/machine';
/** How the batch that carried `endpoint` timed it, or undefined (it rode no batch). */
export declare function batch_times(endpoint: string): {
    left: number;
    at: number;
    size: number;
} | undefined;
type Parcel = {
    slot: string;
    html: string;
    end: number;
};
/**
 * The next whole parcel in `buf` from `from` (server/stream-regions.ts), or `null` when it has not
 * fully arrived yet. A plain parcel ends at the first `</template>` (the server length-frames any
 * answer carrying one of its own); a length-framed one is exactly `data-og-len` characters.
 */
export declare function read_parcel(buf: string, from: number): Parcel | null;
/**
 * Stream a batch of region calls into the frame store. Endpoints must share an endpoint path (they
 * do — all are minted against the app's one islands endpoint, `handle({ endpoint })`, read here off
 * the first URL). Frames apply as they land; the promise resolves when
 * the response ends.
 *
 * `visit`: the scope of the page whose holes these are (the page on screen by default; a navigation
 * hands the next page's, runtime/session.ts `PageVisit`). The batch is its: the visit ending stops
 * the request and lets go of its body. Every other end lets go of the body too (the end mark, a
 * stall, a refusal), and the holes it did not carry fetch on their own.
 */
export declare function streamFrames(endpoints: string[], kind?: 'page' | 'nav', visit?: Scope): Promise<void>;
/**
 * THE PAGE'S HOLES, ONE REQUEST. Holes that start fetching together (the above-the-fold `visible`
 * ones fire in one observer callback; `idle` and media ones in one task) join here
 * and, at the end of that task, go out as ONE batch — reserved in the store first, so each hole's
 * own fetch then JOINS its address instead of starting a request. One request instead of N: one pass
 * through the app's handle chain (its session lookup, its auth) instead of N, and no per-hole slot in
 * the browser's own few-at-a-time gate. A lone hole goes out on its own (a GET, as before); so does
 * any hole the batch does not deliver (release → its fetch runs). Resolves when the batch is on its
 * way, never with its content.
 */
export declare function join_batch(endpoint: string): Promise<void>;
export {};
