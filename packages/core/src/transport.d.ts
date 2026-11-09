import { REF_WIRE_KEY, type Ref } from './ref.ts';
type EncodedRegion = {
    i: string;
    p: Record<string, unknown>;
    u: string;
    m: string;
    h?: string;
    g?: string;
    x?: string;
    /** HUB IDENTITY — minted per live region instance (one id however many payloads carry it).
     *  The browser memoizes decode by it, so every consumer of one region value shares one
     *  descriptor, and the future reconciler diffs by it. Absent on legacy payloads. */
    hi?: string;
};
/**
 * A region value AS THE BROWSER RECEIVES IT: through the crossing (encode, then decode) on the server,
 * itself in the browser (it already crossed). A promise `of` resolves to a wire value — a remote's
 * answer — so a server render that awaits one renders this form, the same shape the browser hydrates
 * against (PromiseRegionAwait.svelte). Not a region: unchanged. A plain inline region nothing awaited
 * throws, exactly as the crossing would.
 */
export declare function wire_form<T>(value: T): T;
/** The hub kind: a held/dual/awaited region — the RENDERABLE Ref. `d` is the EncodedRegion.
 *  Decode is deliberately un-memoized at the legacy seam (the wrapper below passes ids through
 *  raw); hub-memoized region identity arrives with the one-key collapse, where it becomes the
 *  foundation for persistent regions (the reconciler resolves by id). */
export declare function register_region_kind(): void;
/**
 * The SvelteKit `transport` entry (install once in universal hooks). TWO entries, ONE codec
 * underneath (hub v2 phase Y): `Region` preserves the legacy region wire shape/tag for
 * compatibility; `OgygiaRef` carries EVERY OTHER hub kind through the same `ref_reducer` /
 * `ref_reviver` the island seams use — so a universal `load` can put a store, wire class, fn or
 * resumable derived in `page.data`, and a remote function can take/return one, all by identity.
 * Kit routes remote args + load data through this same `transport`, so the symmetry is total.
 * Decode is REQUEST-scoped on the server (no `document`) — client-sent identity never memoizes
 * across requests — and PAGE-scoped in the browser (reunification).
 */
export declare const ogygiaTransport: {
    Region: {
        encode(value: unknown): false | EncodedRegion;
        decode(raw: EncodedRegion): unknown;
    };
    [REF_WIRE_KEY]: {
        encode(value: unknown): Ref | false;
        decode(ref: Ref): unknown;
    };
};
export {};
