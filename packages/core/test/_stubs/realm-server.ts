// Test stub for `ogygia:server`: the realm module, re-exporting each entry's stub under its realm
// name, as the generated one does (src/compiler/virtual/core.ts). It imports each entry by its old
// id, so a suite's `vi.mock('virtual:ogygia/<name>')` still reaches what the realm module exports.
// test/virtual-table.test.ts checks it exports every name the table gives the realm.
export { runtimeUrl } from 'virtual:ogygia/runtime-url';
export { devHmrUrl } from 'virtual:ogygia/dev-hmr-url';
export { devtoolsBootUrl } from 'virtual:ogygia/devtools-boot-url';
export {
	islandDeps as regionDeps,
	islandInteractivity as regionInteractivity,
	chunkContents,
	chunkHeavy,
	chunkDuplicates,
	chunkBarrels,
	islandHazards as regionHazards,
	islandCss as regionCss,
	contentCss,
	islandCssInline as regionCssInline,
	islandReadsPage as regionReadsPage,
	islandPageKeys as regionPageKeys,
	islandPageWhy as regionPageWhy,
	islandRemotes as regionRemotes,
	fnManifest,
	entryLocation,
	locationMap
} from 'virtual:ogygia/island-deps';
export { buildKey, buildHadSecret } from 'virtual:ogygia/secret';
export { sign, verify, region_mac_message as regionMacMessage } from 'virtual:ogygia/sign';
export { getRequestEvent } from 'virtual:ogygia/request-event';
export {
	makeRegionEndpoint,
	mintServerIsland as mintServerRegion,
	known_region_fps as knownRegionFps,
	islandFingerprint as regionFingerprint,
	holeCss
} from 'virtual:ogygia/region-endpoint';
export {
	stringify_remote_arg as stringifyRemoteArg,
	stringify_command_arg as stringifyCommandArg,
	create_remote_key as createRemoteKey
} from 'virtual:ogygia/kit-wire';
export { rateLimit } from 'virtual:ogygia/rate-limit';
export { plugins as serverPlugins } from 'virtual:ogygia/server-plugins';
export { profilerMaps } from 'virtual:ogygia/profiler-maps';
export { routerEnabled, viewTransitions } from 'virtual:ogygia/router-config';
export { sessionCookie } from 'virtual:ogygia/session-cookie';
export { regionTtl, renewWindow } from 'virtual:ogygia/region-ttl';
export { csrTrueRoutes, errorCsrTrueRoutes, rootLayoutCsrTrue } from 'virtual:ogygia/route-csr';
export { route_config as routeConfig } from 'virtual:ogygia/route-config';
export {
	load_islands as loadServerRegions,
	island_url as regionUrl,
	island_name as regionName,
	island_render as regionRender,
	render_island as renderRegion,
	island_reads_page_data as regionReadsPageData
} from 'virtual:ogygia/server-manifest';
