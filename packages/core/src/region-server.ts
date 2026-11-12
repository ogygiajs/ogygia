/**
 * THE SERVER'S HALF OF A REGION'S RENDER: what `Region.svelte` and `context.ts` read on the server,
 * from `ogygia:server` and the server helpers. They import it as `#region-server` (package.json
 * `imports`): on the server this module, in the browser `region-server.browser.ts`, the stand-ins
 * typed against it. The browser build never resolves `ogygia:server` (the realm check refuses it).
 */
export {
	region_deps,
	region_css,
	region_css_inline,
	content_css,
	region_reads_page,
	region_page_keys,
	region_remotes,
	region_interactivity,
	entry_location,
	make_region_endpoint,
	mint_server_region,
	known_region_fps,
	region_fingerprint,
	hole_css,
	get_request_event,
	csr_true_routes,
	error_csr_true_routes,
	root_layout_csr_true
} from 'ogygia:server';
export { runtime_bootstrap } from './server/entry-location.ts';
export { region_css_tag, head_owner_attr } from './server/region-css.ts';
