// The `ogygia:server` module and its entries' own ids. GENERATED from the virtual-module
// table (packages/compiler/src/compiler/virtual/core.ts) by
// `node packages/compiler/scripts/virtual-types.ts`; every type is core's contract
// (src/contract/virtual-modules.ts). Do not edit.

declare module 'ogygia:server' {
export const devtools_boot_url: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/devtools-boot-url']['devtools_boot_url'];
export const stringify_remote_arg: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/kit-wire']['stringify_remote_arg'];
export const stringify_command_arg: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/kit-wire']['stringify_command_arg'];
export const create_remote_key: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/kit-wire']['create_remote_key'];
export const profiler_maps: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/profiler-maps']['profiler_maps'];
export const rate_limit: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/rate-limit']['rate_limit'];
export const region_deps: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['region_deps'];
export const region_interactivity: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['region_interactivity'];
export const chunk_contents: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['chunk_contents'];
export const chunk_heavy: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['chunk_heavy'];
export const chunk_duplicates: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['chunk_duplicates'];
export const chunk_barrels: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['chunk_barrels'];
export const region_hazards: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['region_hazards'];
export const region_css: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['region_css'];
export const content_css: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['content_css'];
export const region_css_inline: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['region_css_inline'];
export const region_reads_page: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['region_reads_page'];
export const region_page_keys: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['region_page_keys'];
export const region_page_why: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['region_page_why'];
export const region_remotes: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['region_remotes'];
export const fn_manifest: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['fn_manifest'];
export const entry_location: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['entry_location'];
export const location_map: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps']['location_map'];
export { make_region_endpoint, mint_server_region, known_region_fps, region_fingerprint, hole_css } from '../dist/server/region-endpoint.js';
export const region_ttl: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-ttl']['region_ttl'];
export const renew_window: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-ttl']['renew_window'];
export { getRequestEvent as get_request_event } from '$app/server';
export const route_config: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/route-config']['route_config'];
export const csr_true_routes: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/route-csr']['csr_true_routes'];
export const error_csr_true_routes: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/route-csr']['error_csr_true_routes'];
export const root_layout_csr_true: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/route-csr']['root_layout_csr_true'];
export const router_enabled: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/router-config']['router_enabled'];
export const view_transitions: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/router-config']['view_transitions'];
export const runtime_url: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/runtime-url']['runtime_url'];
export const build_key: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/secret']['build_key'];
export const build_had_secret: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/secret']['build_had_secret'];
export const load_server_regions: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/server-manifest']['load_server_regions'];
export const region_url: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/server-manifest']['region_url'];
export const region_name: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/server-manifest']['region_name'];
export const region_render: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/server-manifest']['region_render'];
export const render_region: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/server-manifest']['render_region'];
export const region_reads_page_data: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/server-manifest']['region_reads_page_data'];
export const server_plugins: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/server-plugins']['plugins'];
export const session_cookie: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/session-cookie']['session_cookie'];
export { sign, verify, region_mac_message } from '../dist/server/hmac.js';
}
declare module 'ogygia:server/devtools-boot-url' {
export const devtools_boot_url: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/devtools-boot-url']['devtools_boot_url'];
}
declare module 'ogygia:server/kit-wire' {
const module: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/kit-wire'];
export = module;
}
declare module 'ogygia:server/profiler-maps' {
export const profiler_maps: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/profiler-maps']['profiler_maps'];
}
declare module 'ogygia:server/rate-limit' {
export const rate_limit: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/rate-limit']['rate_limit'];
}
declare module 'ogygia:server/region-deps' {
const module: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-deps'];
export = module;
}
declare module 'ogygia:server/region-endpoint' {
export { make_region_endpoint, mint_server_region, known_region_fps, region_fingerprint, hole_css } from '../dist/server/region-endpoint.js';
}
declare module 'ogygia:server/region-ttl' {
export const region_ttl: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-ttl']['region_ttl'];
export const renew_window: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/region-ttl']['renew_window'];
}
declare module 'ogygia:server/request-event' {
export { getRequestEvent } from '$app/server';
}
declare module 'ogygia:server/route-config' {
const module: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/route-config'];
export = module;
}
declare module 'ogygia:server/route-csr' {
export const csr_true_routes: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/route-csr']['csr_true_routes'];
export const error_csr_true_routes: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/route-csr']['error_csr_true_routes'];
export const root_layout_csr_true: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/route-csr']['root_layout_csr_true'];
}
declare module 'ogygia:server/router-config' {
export const router_enabled: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/router-config']['router_enabled'];
export const view_transitions: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/router-config']['view_transitions'];
}
declare module 'ogygia:server/router-css' {
const module: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/router-css'];
export = module;
}
declare module 'ogygia:server/runtime-url' {
export const runtime_url: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/runtime-url']['runtime_url'];
}
declare module 'ogygia:server/secret' {
export const build_key: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/secret']['build_key'];
export const build_had_secret: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/secret']['build_had_secret'];
}
declare module 'ogygia:server/server-manifest' {
const module: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/server-manifest'];
export = module;
}
declare module 'ogygia:server/server-plugins' {
const module: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/server-plugins'];
export = module;
}
declare module 'ogygia:server/server-regions' {
const module: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/server-regions'];
export = module;
}
declare module 'ogygia:server/session-cookie' {
export const session_cookie: import('../dist/contract/virtual-modules.js').VirtualModules['ogygia:server/session-cookie']['session_cookie'];
}
declare module 'ogygia:server/sign' {
export { sign, verify, region_mac_message } from '../dist/server/hmac.js';
}
