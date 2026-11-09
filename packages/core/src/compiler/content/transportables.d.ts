/**
 * Does this module define an exported class carrying a transportable codec? Used to build
 * the eager-registration manifest so islands never need a manual `import` of the class.
 *
 * Signal: an exported class with a `static` member whose key is COMPUTED (`static [x] = …` /
 * `static [x]() {}`) — every rewritten wire member is exactly that — OR, pre-rewrite, the
 * `import.meta.og.wire` construct marker (prescan reads RAW source, where the blessed spelling
 * `static wire = import.meta.og.wire()` is not yet a computed member). A false positive (an
 * unrelated computed static, the marker in a comment) only eagerly loads one extra module; a
 * transportable class is never missed.
 */
export declare function moduleHasTransportable(code: string, id_n: string): boolean;
/**
 * Append `__register_transportable` calls for every exported class in this module. Returns
 * the augmented code, or null when there is no exported class. Append-only — the module's
 * existing sourcemap stays valid.
 */
export declare function appendTransportRegistrations(code: string, id_n: string, root: string, pathModule: {
    relative: (from: string, to: string) => string;
}): string | null;
/** True if a `.svelte` file's `<script module>` exports a transportable class. */
export declare function svelteModuleHasTransportable(code: string, id_n: string): boolean;
/** Inject registration for a `.svelte` module script's exported transportable classes. */
export declare function appendSvelteModuleRegistrations(code: string, id_n: string, root: string, pathModule: {
    relative: (from: string, to: string) => string;
}): string | null;
