/**
 * Internal wrappers the compile-time transform emits into host/island modules.
 *
 * **Not a public API** — do not import from app code. Prefer authoring regions with
 * `with { wake | render | preset }` and the public exports from `ogygia`.
 *
 * One `Region` renders every placement (island / server / lake) and every held value. Server-island
 * minting is routed through the client-stubbed `virtual:ogygia/region-endpoint` virtual, so `Region`
 * lives in the main graph without leaking `$app/server`.
 *
 * @packageDocumentation
 * @internal
 */
export { default as Region } from './Region.svelte';
export { og_entry_hydrate, og_entry_unmount } from './entry-hydrate.ts';
export { isNested, setNested, documentIsCsrTrue } from './context.ts';
export { __register_transportable } from './live-transport.ts';
export { __og_$, __register_fn } from './fn-transport.ts';
export { __og_store, __register_store_factory, mark_store } from './store-transport.ts';
export { __og_boundary, configure_boundary } from './boundary.ts';
export { __og_source } from './source.ts';
export { __tag_context } from './context-bridge.ts';
export { og_portable } from './region-snippet.ts';
export { og_html_region } from './region.ts';
export { prebaked_region } from './region.ts';
