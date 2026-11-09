import { type Plugin } from 'vite';
import type { PreprocessorGroup } from 'svelte/compiler';
export { normalize_import_keys, DEFAULT_IMPORT_KEYS, import_keys_hint, islandChunkFileName, islandPublicUrl, islandId, wrapperVirtualId, CLIENT_BINDING_STUB, regionId, regionIdentity, strategyKey } from '../compiler/region/transform.ts';
export { rewrite_lake_import_to_placeholder } from '../compiler/region/emit.ts';
export type { ImportKeys } from '../compiler/region/transform.ts';
export { debarrel } from '../compiler/debarrel/plugin.ts';
export { definePlugin } from './plugin-api.ts';
export type { OgygiaPlugin, PluginDefinition, BuildContext, MacroHandler, MacroContext, MarkupSource, MarkupRegions } from './plugin-api.ts';
export type { DebarrelOptions, Matcher as DebarrelMatcher } from '../compiler/debarrel/options.ts';
export type { OgygiaPreset, OgygiaRateLimit, OgygiaOptions } from './options.ts';
import type { OgygiaOptions } from './options.ts';
/**
 * Vite plugin: transforms `with { hydrate | defer | preset }` imports into islands,
 * serves virtual island modules, and wires signed region endpoints for deferred HTML.
 *
 * Place **before** `sveltekit()` in `vite.config`.
 *
 * @param options - Plugin configuration. See {@link OgygiaOptions}.
 * @returns Vite plugins (`ogygia` pre + island sourcemap fix post). Vite flattens the array.
 */
export declare function ogygia(options?: OgygiaOptions): Plugin[];
export declare namespace ogygia {
    /**
     * @deprecated Does nothing: returns `['.svelte']`. Markdown extensions come from
     * `extensions()` in `@ogygia/content/vite`.
     */
    const extensions: () => string[];
    /**
     * @deprecated Does nothing: returns `[]`. The markdown preprocessor comes from `preprocess()` in
     * `@ogygia/content/vite`.
     */
    const preprocess: () => PreprocessorGroup[];
}
