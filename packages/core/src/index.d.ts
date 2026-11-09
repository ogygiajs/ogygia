/**
 * Public runtime components for ogygia apps.
 *
 * Regions are authored with an import attribute on a Svelte component import:
 *
 * ```svelte
 * <script>
 *   import Counter from '$lib/Counter.svelte' with { wake: 'load' };
 *   import Chart from '$lib/Chart.svelte' with { wake: 'visible' };
 *   import Greeting from '$lib/Greeting.svelte' with { render: 'deferred' };
 * </script>
 * ```
 *
 * Configure the Vite plugin from `ogygia/vite` (`ogygia()`). Wire the signed
 * region endpoint with `ogygiaHandle()` from `ogygia/hooks`. For SPA navigation
 * from inside islands, prefer `ogygia/app` over `$app/navigation`.
 *
 * @packageDocumentation
 */
export { default as Boundary } from './OgygiaBoundary.svelte';
export { default as Region } from './Region.svelte';
export { region, isRegion } from './region.ts';
export { og_derived } from './store-transport.ts';
export { preload } from './preload.ts';
export { script } from './script.ts';
export { requestEvent } from './request-event.ts';
export { keepFallback } from './keep-fallback.ts';
export { preference } from './preference.ts';
export type { Preference, PreferenceSpec } from './preference.ts';
export type { RegionValue, AwaitableRegion, InlineRegion, DualRegion, DeferredRegion, RegionOptions, RegionSchedule } from './region.ts';
export type Fallback<P = unknown> = P & {
    ogygiaFallback?: import('svelte').Snippet;
};
export { transport } from 'virtual:ogygia/kit-transport';
export type { TransportCodec } from './live-transport.ts';
export { createContext, setContext, __tag_context } from './context-bridge.ts';
export { default as Provide } from './Provide.svelte';
export { getContext } from 'svelte';
export { hydratedBy } from './hydration-info.ts';
export { isOgygiaPage } from './context.ts';
export { SharedState } from './shared-state.ts';
