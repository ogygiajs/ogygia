/**
 * The runtime's measurement internals the devtools dock, the profiler and the insights engine read
 * (`@ogygia/devtools`, `@ogygia/insights`): the props sidecar, the page seeds, render-blocking, the
 * islands' own cost, the tools' own fetches, the page-defer keys, the island graph, unscoped-css,
 * the devtools and testing switch cookies and the compiler's hydration hazards.
 *
 * **Not a public API** — do not import from app code.
 *
 * @packageDocumentation
 * @internal
 */
export {
	attr_changes,
	without_comments,
	without_runtime_marks,
	type AttrChange
} from './contract/markup-text.ts';
export { hole_copy_of } from './contract/hash.ts';
export {
	DEVTOOLS_COOKIE,
	DEVTOOLS_ON,
	DEVTOOLS_PARAM,
	TESTING_COOKIE,
	TESTING_LEAN,
	TESTING_PARAM,
	devtools_switched_on,
	switch_in_url,
	testing_lean,
	without_switch,
	write_switch
} from './contract/switch.ts';
export {
	hydration_hazards,
	hazard_fix,
	hazard_words,
	type IslandHazard
} from './contract/hydration-hazards.ts';
export { OWN_PACKAGE_NAMES } from './contract/own-package.ts';
export type { BarrelLeftReason, IslandBarrel } from './contract/barrels.ts';
export type { ChunkBarrel } from './contract/virtual-modules.ts';
export type { DevtoolsEvent } from './contract/events.ts';
export { metered } from './runtime/own-cost.ts';
export { props_sidecar_of } from './runtime/sidecar.ts';
export { import_again } from './runtime/import-again.ts';
export { download } from './policies.ts';
export { PAGE_SEED_SELECTOR } from './page-seed-selector.ts';
export { paint_blocker } from './runtime/render-blocking.ts';
export type { RegionRefusal } from './runtime/region-endpoint-url.ts';
export { charge, own_cost } from './runtime/own-cost.ts';
export { nearest_attr } from './runtime/nearest-attr.ts';
export { REGION_RENDER_CONCURRENCY } from './runtime/concurrency.ts';
export { tool_fetch, tool_made } from './tool-fetches.ts';
export { PAGE_DEFER_KEY, PAGE_DEFER_GLOBAL, PAGE_DEFER_REGISTRY_KEY } from './page-defer.ts';
export { ISLAND_GRAPH_ATTR, decode_island_graph } from './island-graph.ts';
export {
	find_unscoped,
	unscoped_finding,
	unscoped_marker,
	type UnscopedStyles
} from './contract/unscoped-css.ts';
