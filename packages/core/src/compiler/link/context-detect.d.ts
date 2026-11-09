export declare function source_uses_ogygia_context(src: string): boolean;
/** The string-literal keys a file READS via getContext and SETS via setContext — each PROVEN, by
 *  following the import binding rather than matching text, to be Svelte/ogygia's. */
export interface ContextKeys {
    reads: string[];
    sets: string[];
}
/**
 * Resolve the string-literal keys a file reads via `getContext(…)` and sets via `setContext(…)`, where
 * each call is PROVEN — by following the import binding, not by matching text — to be Svelte's or
 * ogygia's. Counts a `getContext as gc` alias and a namespace `ns.getContext(…)`; ignores a local
 * function of the same name, a `foo.getContext(…)` on an unrelated object, and a dynamic key. ogygia's
 * own bridge keys are `Symbol.for(…)` (never string literals), so they never appear.
 *
 * `reads` drives the WARNING: on a csr=false page the page/layout `<script>` never runs on the client,
 * so a value set with Svelte's own `setContext` in a page/layout is gone by the time an island hydrates
 * in isolation — the island reads `undefined`, renders a different tree, and Svelte discards its server
 * DOM (a silent full re-render). `sets` is what makes the warning precise: a key an island's OWN code
 * both sets and reads lives inside one hydration root (a component library using context internally) and
 * needs no bridge — the caller subtracts island sets from island reads so only a key provided OUTSIDE
 * the island is flagged. Empty on a file with no such call, or one that cannot be parsed.
 */
export declare function context_string_keys(src: string, kind: 'svelte' | 'script'): ContextKeys;
