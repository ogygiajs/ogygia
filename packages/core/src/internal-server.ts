/**
 * Internal server-only region helpers used on the SSR / region-endpoint graph.
 *
 * **Not a public API** — do not import from app code.
 *
 * @packageDocumentation
 * @internal
 */
/** Signer for deferred regions — SSR-only (the client region binding never imports this). */
export { make_region_endpoint } from './server/region-endpoint.ts';
/** A held region's server render to HTML — the one copy every region binding calls. */
export { render_region_html } from './server/render-region-html.ts';
/** What the profiler (`@ogygia/devtools`) reads off a request ogygia served. */
export {
	hole_stats_of,
	record_request_stats,
	request_stats_of,
	set_batch_hole_listener,
	hold_request_stats_detail,
	want_request_stats,
	type BatchHoleStats,
	type HoleRequestStats,
	type HoleStat,
	type IslandInteractivity,
	type IslandStat,
	type OgygiaRequestStats,
	type SeedKeyStat
} from './server/request-stats.ts';
export { mark_personal } from './server/personal-response.ts';
/** The hole render cache (the endpoint's cached render), for a plugin's tests. */
export { cached_render, render_cache_clear, render_cache_key } from './server/render-cache.ts';
/** The owner (a scope) of a server request: what the request starts goes when it ends. */
export {
	cleanup_failed,
	current_request_scope,
	request_local,
	request_scope
} from './plugin/request-scope.ts';
export { islands_endpoint } from './server/endpoint.ts';
