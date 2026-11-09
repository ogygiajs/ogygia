/** Serialize a Kit `page` snapshot for a single document-level ogygia side-channel. */
import { stringify } from 'devalue';
type PageLike = {
    url?: {
        href?: string;
    };
    params?: Record<string, string>;
    route?: {
        id: string | null;
    };
    status?: number;
    data?: unknown;
    form?: unknown;
    error?: unknown;
};
/** The seed's text and the lane it is in (`json` → the runtime reads it with `JSON.parse`). */
export interface SeedText {
    text: string;
    json: boolean;
}
export declare class PageSeed {
    /**
     * Public page slice for islands. url/params/route/status are always plain and MUST survive;
     * data/form/error may carry a non-serializable leaf (function/store/class) — that leaf is left
     * out where it sits (`keep_serializable`), never its field or the whole seed. Promises should already be resolved by the handle
     * (`resolve_promises`) before this. See INVARIANTS.md · PAGE-SEED.
     *
     * `json`: the caller proved the whole slice JSON-exact (seed-refs.ts `analyze`) — then the seed
     * goes out as native `JSON.stringify` output (an order of magnitude cheaper than devalue on a
     * CMS tree), escaped once for the `<script>`. devalue output needs no escape (it writes `<`).
     */
    static serialize(page_ref: PageLike, stringify_fn?: typeof stringify, json?: boolean): SeedText | null;
}
export {};
