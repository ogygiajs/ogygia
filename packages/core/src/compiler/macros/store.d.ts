/** Rewrite every `import.meta.og.store` mark. Same-reference return when nothing to do. */
export declare function rewrite_store(src: string, id: string, rel_id: string, markup_exts: readonly string[]): string;
/**
 * AUTO-DETECT tier: brand exported factories whose body PROVABLY returns a store, with zero
 * authoring. v1 scope (deliberately narrow — no guessing, under-branding is always safe since
 * the generic writable tier still carries the value):
 *
 *   export const createX = (seed) => ({ subscribe, … })          // object literal w/ subscribe
 *   export const createY = (seed) => writable(seed)              // direct writable()/readable()
 *   export const createZ = (seed) => { … return { subscribe } }  // every return provable
 *
 * Skipped (→ generic tier / the og.store assert): function declarations, re-exports, factories
 * returning call results (`return make(x)`), mixed/ambiguous returns, non-exported consts.
 * Requires the module to import from 'svelte/store' when the proof is a writable()/readable()
 * call (a local function named `writable` must not count).
 */
export declare function auto_brand_stores(src: string, id: string, rel_id: string, markup_exts: readonly string[]): string;
