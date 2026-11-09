export interface FpDrift {
    entry: string;
    fp_was: string;
    fp_now: string;
    /** the first differing path in the props (`stamp`, `items[2].id`), when the props parse */
    path?: string;
    /** the values there, clipped (or the text around the first difference) */
    was?: string;
    now?: string;
}
/** One island as one load (or render) had it. */
export interface KeptIsland {
    entry: string;
    fp: string;
    props?: string;
}
type Kept = KeptIsland;
/** Islands matched by entry and their place among its copies; a moved fingerprint, explained. */
export declare function compare(was: Kept[], now: Kept[]): FpDrift[];
/** Where two props texts differ: the first differing path when both parse as JSON, else the text
 *  around the first differing character — ogygia's own ids (a store's, a class instance's: random
 *  per render by design) left out. `null` when those ids are all that differs. */
export declare function props_diff(a: string, b: string): {
    path?: string;
    was?: string;
    now?: string;
} | null;
export {};
