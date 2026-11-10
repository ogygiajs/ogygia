// Test stub for `ogygia:server`: the realm module, re-exporting each entry's stub under its realm
// name, as the generated one does (src/compiler/virtual/core.ts). It imports each entry by its old
// id, so a suite's `vi.mock('virtual:ogygia/<name>')` still reaches what the realm module exports.
// test/virtual-table.test.ts checks it exports every name the table gives the realm.
export { runtime_url } from 'virtual:ogygia/runtime-url';
export { devtools_boot_url } from 'virtual:ogygia/devtools-boot-url';
export {
	islandDeps as region_deps,
	islandInteractivity as region_interactivity,
	chunkContents as chunk_contents,
	chunkHeavy as chunk_heavy,
	chunkDuplicates as chunk_duplicates,
	chunkBarrels as chunk_barrels,
	islandHazards as region_hazards,
	islandCss as region_css,
	contentCss as content_css,
	islandCssInline as region_css_inline,
	islandReadsPage as region_reads_page,
	islandPageKeys as region_page_keys,
	islandPageWhy as region_page_why,
	islandRemotes as region_remotes,
	fnManifest as fn_manifest,
	entryLocation as entry_location,
	locationMap as location_map
} from 'virtual:ogygia/island-deps';
export { build_key, build_had_secret } from 'virtual:ogygia/secret';
export { sign, verify, region_mac_message } from 'virtual:ogygia/sign';
export { getRequestEvent as get_request_event } from 'virtual:ogygia/request-event';
export {
	makeRegionEndpoint as make_region_endpoint,
	mintServerIsland as mint_server_region,
	known_region_fps,
	islandFingerprint as region_fingerprint,
	holeCss as hole_css
} from 'virtual:ogygia/region-endpoint';
export {
	stringify_remote_arg,
	stringify_command_arg,
	create_remote_key
} from 'virtual:ogygia/kit-wire';
export { rate_limit } from 'virtual:ogygia/rate-limit';
export { profiler_maps } from 'virtual:ogygia/profiler-maps';
export { plugins as server_plugins } from 'virtual:ogygia/server-plugins';
export { router_enabled, view_transitions } from 'virtual:ogygia/router-config';
export { session_cookie } from 'virtual:ogygia/session-cookie';
export { region_ttl, renew_window } from 'virtual:ogygia/region-ttl';
export {
	csr_true_routes,
	error_csr_true_routes,
	root_layout_csr_true
} from 'virtual:ogygia/route-csr';
export { route_config } from 'virtual:ogygia/route-config';
export {
	load_islands as load_server_regions,
	island_url as region_url,
	island_name as region_name,
	island_render as region_render,
	render_island as render_region,
	island_reads_page_data as region_reads_page_data
} from 'virtual:ogygia/server-manifest';
