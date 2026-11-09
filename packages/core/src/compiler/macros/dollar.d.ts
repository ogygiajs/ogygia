/** One hoisted factory, destined for the fn manifest. `factory_src` is self-contained. */
export interface DollarHoist {
    tag: string;
    factory_src: string;
}
export interface DollarResult {
    code: string;
    hoists: DollarHoist[];
}
/**
 * Rewrite every `import.meta.og.$` mark in `src`. Returns the input (same reference, empty
 * hoists) when there is nothing to do. Throws build-error voice on misuse. `rel_id` is the
 * root-relative module path used for tags; `markup_exts` as in og-wire (['.svelte']).
 */
export declare function rewrite_dollar(src: string, id: string, rel_id: string, markup_exts: readonly string[]): DollarResult;
