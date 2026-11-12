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
/** Where the handle hands each request's stats: the profiler's store (`@ogygia/devtools`). */
export {
	set_request_stats_sink,
	type RequestStatsSink,
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
/** The per-address budget the region endpoint charges; the profiler's login spends one too. */
export { RateLimiter } from './server/rate-limit.ts';
/** The production floor for a signing secret (UTF-8 bytes). */
export { MIN_SECRET_BYTES } from './server/hmac.ts';
// the page markup's vocabulary and its tag reader
export * from './wire-markup.ts';
