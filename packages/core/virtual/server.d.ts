// The `ogygia:server` module and its entries' own ids. GENERATED from the virtual-module
// table (packages/core/src/compiler/virtual/core.ts) by
// `node packages/core/scripts/virtual-types.ts`; every type is read off the code (see
// src/compiler/virtual/types.ts). Do not edit.

declare module 'ogygia:server' {
export const dev_hmr_url: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').dev_hmr_url>['dev_hmr_url'];
export const devtools_boot_url: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').devtools_boot_url>['devtools_boot_url'];
export const stringify_remote_arg: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').kit_wire>['stringify_remote_arg'];
export const stringify_command_arg: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').kit_wire>['stringify_command_arg'];
export const create_remote_key: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').kit_wire>['create_remote_key'];
export const profiler_maps: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').profiler_maps>['profiler_maps'];
export const rate_limit: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').rate_limit>['rate_limit'];
export const region_deps: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandDeps'];
export const region_interactivity: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandInteractivity'];
export const chunk_contents: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['chunkContents'];
export const chunk_heavy: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['chunkHeavy'];
export const chunk_duplicates: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['chunkDuplicates'];
export const chunk_barrels: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['chunkBarrels'];
export const region_hazards: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandHazards'];
export const region_css: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandCss'];
export const content_css: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['contentCss'];
export const region_css_inline: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandCssInline'];
export const region_reads_page: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandReadsPage'];
export const region_page_keys: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandPageKeys'];
export const region_page_why: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandPageWhy'];
export const region_remotes: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['islandRemotes'];
export const fn_manifest: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['fnManifest'];
export const entry_location: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['entryLocation'];
export const location_map: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').region_deps>['locationMap'];
export { makeRegionEndpoint as make_region_endpoint, mintServerIsland as mint_server_region, known_region_fps, islandFingerprint as region_fingerprint, holeCss as hole_css } from '../dist/server/region-endpoint.js';
export const region_ttl: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').region_ttl>['region_ttl'];
export const renew_window: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').region_ttl>['renew_window'];
export { getRequestEvent as get_request_event } from '$app/server';
export const route_config: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').route_config>['route_config'];
export const csr_true_routes: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['csr_true_routes'];
export const error_csr_true_routes: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['error_csr_true_routes'];
export const root_layout_csr_true: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['root_layout_csr_true'];
export const router_enabled: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').router_config>['router_enabled'];
export const view_transitions: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').router_config>['view_transitions'];
export const runtime_url: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').runtime_url>['runtime_url'];
export const build_key: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').secret>['build_key'];
export const build_had_secret: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').secret>['build_had_secret'];
export const load_server_regions: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_manifest>['load_islands'];
export const region_url: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_manifest>['island_url'];
export const region_name: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_manifest>['island_name'];
export const region_render: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_manifest>['island_render'];
export const render_region: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_manifest>['render_island'];
export const region_reads_page_data: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_manifest>['island_reads_page_data'];
export const server_plugins: import('../dist/compiler/virtual/table.js').ModuleOf<typeof import('../dist/compiler/virtual/core.js').server_plugins>['plugins'];
export const session_cookie: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').session_cookie>['session_cookie'];
export { sign, verify, region_mac_message } from '../dist/server/hmac.js';
}
declare module 'ogygia:server/dev-hmr-url' {
export const dev_hmr_url: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').dev_hmr_url>['dev_hmr_url'];
}
declare module 'virtual:ogygia/dev-hmr-url' {
export const dev_hmr_url: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').dev_hmr_url>['dev_hmr_url'];
}
declare module 'ogygia:server/devtools-boot-url' {
export const devtools_boot_url: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').devtools_boot_url>['devtools_boot_url'];
}
declare module 'virtual:ogygia/devtools-boot-url' {
export const devtools_boot_url: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').devtools_boot_url>['devtools_boot_url'];
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
export const profiler_maps: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').profiler_maps>['profiler_maps'];
}
declare module 'virtual:ogygia/profiler-maps' {
export const profiler_maps: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').profiler_maps>['profiler_maps'];
}
declare module 'ogygia:server/rate-limit' {
export const rate_limit: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').rate_limit>['rate_limit'];
}
declare module 'virtual:ogygia/rate-limit' {
export const rate_limit: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').rate_limit>['rate_limit'];
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
export const region_ttl: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').region_ttl>['region_ttl'];
export const renew_window: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').region_ttl>['renew_window'];
}
declare module 'virtual:ogygia/region-ttl' {
export const region_ttl: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').region_ttl>['region_ttl'];
export const renew_window: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').region_ttl>['renew_window'];
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
export const csr_true_routes: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['csr_true_routes'];
export const error_csr_true_routes: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['error_csr_true_routes'];
export const root_layout_csr_true: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['root_layout_csr_true'];
}
declare module 'virtual:ogygia/route-csr' {
export const csr_true_routes: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['csr_true_routes'];
export const error_csr_true_routes: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['error_csr_true_routes'];
export const root_layout_csr_true: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').route_csr>['root_layout_csr_true'];
}
declare module 'ogygia:server/router-config' {
export const router_enabled: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').router_config>['router_enabled'];
export const view_transitions: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').router_config>['view_transitions'];
}
declare module 'virtual:ogygia/router-config' {
export const router_enabled: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').router_config>['router_enabled'];
export const view_transitions: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').router_config>['view_transitions'];
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
export const runtime_url: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').runtime_url>['runtime_url'];
}
declare module 'virtual:ogygia/runtime-url' {
export const runtime_url: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').runtime_url>['runtime_url'];
}
declare module 'ogygia:server/secret' {
export const build_key: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').secret>['build_key'];
export const build_had_secret: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').secret>['build_had_secret'];
}
declare module 'virtual:ogygia/secret' {
export const build_key: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').secret>['build_key'];
export const build_had_secret: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').secret>['build_had_secret'];
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
export const session_cookie: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').session_cookie>['session_cookie'];
}
declare module 'virtual:ogygia/session-cookie' {
export const session_cookie: import('../dist/compiler/virtual/table.js').ValueOf<typeof import('../dist/compiler/virtual/core.js').session_cookie>['session_cookie'];
}
declare module 'ogygia:server/sign' {
export { sign, verify, region_mac_message } from '../dist/server/hmac.js';
}
declare module 'virtual:ogygia/sign' {
export { sign, verify, region_mac_message } from '../dist/server/hmac.js';
}
