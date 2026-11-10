// The `ogygia:server` module and its entries' own ids. GENERATED from the virtual-module
// table (packages/core/src/compiler/virtual/core.ts) by
// `node packages/core/scripts/virtual-types.ts`; every type is read off the code (see
// src/compiler/virtual/types.ts). Do not edit.

declare module 'ogygia:server' {
export const devtoolsBootUrl: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').devtools_boot_url>['devtoolsBootUrl'];
export const stringifyRemoteArg: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').kit_wire>['stringify_remote_arg'];
export const stringifyCommandArg: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').kit_wire>['stringify_command_arg'];
export const createRemoteKey: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').kit_wire>['create_remote_key'];
export const profilerMaps: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').profiler_maps>['profilerMaps'];
export const rateLimit: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').rate_limit>['rateLimit'];
export const regionDeps: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandDeps'];
export const regionInteractivity: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandInteractivity'];
export const chunkContents: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['chunkContents'];
export const chunkHeavy: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['chunkHeavy'];
export const chunkDuplicates: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['chunkDuplicates'];
export const chunkBarrels: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['chunkBarrels'];
export const regionHazards: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandHazards'];
export const regionCss: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandCss'];
export const contentCss: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['contentCss'];
export const regionCssInline: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandCssInline'];
export const regionReadsPage: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandReadsPage'];
export const regionPageKeys: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandPageKeys'];
export const regionPageWhy: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandPageWhy'];
export const regionRemotes: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandRemotes'];
export const fnManifest: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['fnManifest'];
export const entryLocation: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['entryLocation'];
export const locationMap: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['locationMap'];
export { makeRegionEndpoint, mintServerIsland as mintServerRegion, known_region_fps as knownRegionFps, islandFingerprint as regionFingerprint, holeCss } from '../dist/server/region-endpoint.js';
export const regionTtl: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').region_ttl>['regionTtl'];
export const renewWindow: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').region_ttl>['renewWindow'];
export { getRequestEvent } from '$app/server';
export const routeConfig: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').route_config>['route_config'];
export const csrTrueRoutes: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['csrTrueRoutes'];
export const errorCsrTrueRoutes: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['errorCsrTrueRoutes'];
export const rootLayoutCsrTrue: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['rootLayoutCsrTrue'];
export const routerEnabled: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').router_config>['routerEnabled'];
export const viewTransitions: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').router_config>['viewTransitions'];
export const runtimeUrl: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').runtime_url>['runtimeUrl'];
export const buildKey: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').secret>['buildKey'];
export const buildHadSecret: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').secret>['buildHadSecret'];
export const loadServerRegions: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_manifest>['load_islands'];
export const regionUrl: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_manifest>['island_url'];
export const regionName: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_manifest>['island_name'];
export const regionRender: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_manifest>['island_render'];
export const renderRegion: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_manifest>['render_island'];
export const regionReadsPageData: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_manifest>['island_reads_page_data'];
export const serverPlugins: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_plugins>['plugins'];
export const sessionCookie: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').session_cookie>['sessionCookie'];
export { sign, verify, region_mac_message as regionMacMessage } from '../dist/server/hmac.js';
}
declare module 'ogygia:server/devtools-boot-url' {
export const devtoolsBootUrl: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').devtools_boot_url>['devtoolsBootUrl'];
}
declare module 'virtual:ogygia/devtools-boot-url' {
export const devtoolsBootUrl: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').devtools_boot_url>['devtoolsBootUrl'];
}
declare module 'ogygia:server/kit-wire' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').kit_wire>;
export = module;
}
declare module 'virtual:ogygia/kit-wire' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').kit_wire>;
export = module;
}
declare module 'ogygia:server/profiler-maps' {
export const profilerMaps: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').profiler_maps>['profilerMaps'];
}
declare module 'virtual:ogygia/profiler-maps' {
export const profilerMaps: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').profiler_maps>['profilerMaps'];
}
declare module 'ogygia:server/rate-limit' {
export const rateLimit: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').rate_limit>['rateLimit'];
}
declare module 'virtual:ogygia/rate-limit' {
export const rateLimit: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').rate_limit>['rateLimit'];
}
declare module 'ogygia:server/region-deps' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>;
export = module;
}
declare module 'virtual:ogygia/island-deps' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>;
export = module;
}
declare module 'ogygia:server/region-endpoint' {
export { makeRegionEndpoint, mintServerIsland, known_region_fps, islandFingerprint, holeCss } from '../dist/server/region-endpoint.js';
}
declare module 'virtual:ogygia/region-endpoint' {
export { makeRegionEndpoint, mintServerIsland, known_region_fps, islandFingerprint, holeCss } from '../dist/server/region-endpoint.js';
}
declare module 'ogygia:server/region-ttl' {
export const regionTtl: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').region_ttl>['regionTtl'];
export const renewWindow: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').region_ttl>['renewWindow'];
}
declare module 'virtual:ogygia/region-ttl' {
export const regionTtl: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').region_ttl>['regionTtl'];
export const renewWindow: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').region_ttl>['renewWindow'];
}
declare module 'ogygia:server/request-event' {
export { getRequestEvent } from '$app/server';
}
declare module 'virtual:ogygia/request-event' {
export { getRequestEvent } from '$app/server';
}
declare module 'ogygia:server/route-config' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').route_config>;
export = module;
}
declare module 'virtual:ogygia/route-config' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').route_config>;
export = module;
}
declare module 'ogygia:server/route-csr' {
export const csrTrueRoutes: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['csrTrueRoutes'];
export const errorCsrTrueRoutes: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['errorCsrTrueRoutes'];
export const rootLayoutCsrTrue: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['rootLayoutCsrTrue'];
}
declare module 'virtual:ogygia/route-csr' {
export const csrTrueRoutes: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['csrTrueRoutes'];
export const errorCsrTrueRoutes: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['errorCsrTrueRoutes'];
export const rootLayoutCsrTrue: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['rootLayoutCsrTrue'];
}
declare module 'ogygia:server/router-config' {
export const routerEnabled: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').router_config>['routerEnabled'];
export const viewTransitions: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').router_config>['viewTransitions'];
}
declare module 'virtual:ogygia/router-config' {
export const routerEnabled: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').router_config>['routerEnabled'];
export const viewTransitions: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').router_config>['viewTransitions'];
}
declare module 'ogygia:server/router-css' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').router_css>;
export = module;
}
declare module 'virtual:ogygia/router-css' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').router_css>;
export = module;
}
declare module 'ogygia:server/runtime-url' {
export const runtimeUrl: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').runtime_url>['runtimeUrl'];
}
declare module 'virtual:ogygia/runtime-url' {
export const runtimeUrl: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').runtime_url>['runtimeUrl'];
}
declare module 'ogygia:server/secret' {
export const buildKey: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').secret>['buildKey'];
export const buildHadSecret: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').secret>['buildHadSecret'];
}
declare module 'virtual:ogygia/secret' {
export const buildKey: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').secret>['buildKey'];
export const buildHadSecret: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').secret>['buildHadSecret'];
}
declare module 'ogygia:server/server-manifest' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_manifest>;
export = module;
}
declare module 'virtual:ogygia/server-manifest' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_manifest>;
export = module;
}
declare module 'ogygia:server/server-plugins' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_plugins>;
export = module;
}
declare module 'virtual:ogygia/server-plugins' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_plugins>;
export = module;
}
declare module 'ogygia:server/server-regions' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_regions>;
export = module;
}
declare module 'virtual:ogygia/server-islands' {
const module: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_regions>;
export = module;
}
declare module 'ogygia:server/session-cookie' {
export const sessionCookie: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').session_cookie>['sessionCookie'];
}
declare module 'virtual:ogygia/session-cookie' {
export const sessionCookie: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').session_cookie>['sessionCookie'];
}
declare module 'ogygia:server/sign' {
export { sign, verify, region_mac_message } from '../dist/server/hmac.js';
}
declare module 'virtual:ogygia/sign' {
export { sign, verify, region_mac_message } from '../dist/server/hmac.js';
}
