// Test stub for `ogygia:server`: the realm module, re-exporting each entry's stub under its realm
// name, as the generated one does (src/compiler/virtual/core.ts). It imports each entry by its own
// id, so a suite's `vi.mock('ogygia:server/<id>')` reaches what the realm module exports.
// test/virtual-table.test.ts checks it exports every name the table gives the realm.
export { runtime_url } from 'ogygia:server/runtime-url';
export { devtools_boot_url } from 'ogygia:server/devtools-boot-url';
export {
	region_deps,
	region_interactivity,
	chunk_contents,
	chunk_heavy,
	chunk_duplicates,
	chunk_barrels,
	region_hazards,
	region_css,
	content_css,
	region_css_inline,
	region_reads_page,
	region_page_keys,
	region_page_why,
	region_remotes,
	fn_manifest,
	entry_location,
	location_map
} from 'ogygia:server/region-deps';
export { build_key, build_had_secret } from 'ogygia:server/secret';
export { sign, verify, region_mac_message } from 'ogygia:server/sign';
export { getRequestEvent as get_request_event } from 'ogygia:server/request-event';
export {
	make_region_endpoint,
	mint_server_region,
	known_region_fps,
	region_fingerprint,
	hole_css
} from 'ogygia:server/region-endpoint';
export {
	stringify_remote_arg,
	stringify_command_arg,
	create_remote_key
} from 'ogygia:server/kit-wire';
export { rate_limit } from 'ogygia:server/rate-limit';
export { profiler_maps } from 'ogygia:server/profiler-maps';
export { plugins as server_plugins } from 'ogygia:server/server-plugins';
export { router_enabled, view_transitions } from 'ogygia:server/router-config';
export { session_cookie } from 'ogygia:server/session-cookie';
export { region_ttl, renew_window } from 'ogygia:server/region-ttl';
export {
	csr_true_routes,
	error_csr_true_routes,
	root_layout_csr_true
} from 'ogygia:server/route-csr';
export { route_config } from 'ogygia:server/route-config';
export {
	load_server_regions,
	region_url,
	region_name,
	region_render,
	render_region,
	region_reads_page_data
} from 'ogygia:server/server-manifest';
