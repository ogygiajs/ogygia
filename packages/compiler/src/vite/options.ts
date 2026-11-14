import { PRESET_KEYS, type ImportKeys } from '../region/transform.ts';
import { OgygiaError } from '../messages.ts';

/**
 * Named strategy bundle referenced from source via `with { preset: 'name' }`
 * (or the renamed `importKeys.preset` key).
 *
 * A preset speaks the SAME grammar as an inline import: a `render` mode with its timing (`fetch` for
 * a `deferred` hole, `wake` for an island), plus the tuning options that aren't allowed inline
 * (`margin`, `maxAge`, …).
 */
export interface OgygiaPreset {
	/**
	 * Delivery mode (the `render` import attribute): `'static'` (default — an island that hydrates)
	 * | `'deferred'` (a hole whose HTML is fetched, on its `fetch` timing) | `'live'` (a hole that
	 * revalidates).
	 */
	render?: 'static' | 'deferred' | 'live';
	/**
	 * When an island's JS runs (the `wake` import attribute): `'load'` | `'idle'` | `'visible'` |
	 * `'interaction'` | a CSS media query | `'none'` (a frozen lake). With `render: 'live'`, the
	 * revalidate schedule. Never a `deferred` hole's timing — that is `fetch`.
	 */
	wake?: string;
	/**
	 * A `render: 'deferred'` hole's timing — when its HTML arrives (the `fetch` import attribute):
	 * `'load'` (default) | `'idle'` | `'visible'` | `'interaction'` | a CSS media query.
	 */
	fetch?: string;
	/** `IntersectionObserver` `rootMargin` when the schedule is `'visible'`. */
	margin?: string;
	/**
	 * A hole (`fetch`) — response cache max-age for the hole's HTML: seconds (number) or a
	 * duration string (`'30s'` | `'5m'` | `'1h'`). Absent or `0` → `no-store`: the hole is dynamic,
	 * re-rendered on every request. A positive value opts into a `private, max-age` browser cache.
	 * Signed into the hole's endpoint so a harvested URL can't be re-pointed at a longer cache.
	 *
	 * With `render: 'live'` this is instead the client revalidate staleness — use a duration string
	 * to stay unit-explicit across both.
	 */
	maxAge?: number | string;
	/** `render: 'live'` — past `maxAge`, whether to clear the hole (`'empty'`) or refetch (`'fetch'`). */
	onExpire?: 'empty' | 'fetch';
	/**
	 * A hole (`fetch`) — warm the hole's HTML into the frame store on this schedule (`'load'` |
	 * `'idle'` | `'visible'` | a media query) while `fetch` still decides when it swaps in. An
	 * on-demand hole (`fetch: 'interaction'`) then has its bytes before the first hover: the gesture
	 * joins the warm frame instead of paying the origin round trip. Never `'interaction'` — that is
	 * the swap schedule, `fetch`'s job.
	 */
	prefetch?: string;
	/** `render: 'live'` — the revalidate schedule (`false` disables). Defaults to `wake`. */
	revalidate?: false | string;
	/** Continuity name (the `keep` import attribute): the live island relocates across SPA
	 *  navigation instead of remounting when the next page carries the same name. */
	keep?: string;
}

/** Per-IP budget for the signed deferred-region / lake-remount endpoint. */
export interface OgygiaRateLimit {
	/** Max requests per window (default `60`). `0` disables allowing any. */
	max?: number;
	/** Sliding window length in milliseconds (default `60_000`). */
	windowMs?: number;
}

/**
 * Options for the {@link ogygia} Vite plugin. The root is the region system itself — its defaults
 * (`visible`), its named presets (referenced from a use site by a LITERAL `preset: 'name'`:
 * `import X from '…' with { preset: 'name' }`), its holes' capability lifetimes — beside the client
 * router. Feature packages are Vite plugins listed beside it (`plugins: [ogygia(), flags(), sveltekit()]`).
 *
 * @example
 * ```ts
 * import { ogygia } from 'ogygia/vite';
 * export default defineConfig({
 *   plugins: [
 *     ogygia({
 *       visible: { margin: '200px' },
 *       presets: { chart: { wake: 'visible', margin: '200px' } },
 *       ttl: 3600
 *     }),
 *     sveltekit()
 *   ]
 * });
 * ```
 */
export interface OgygiaOptions {
	/**
	 * Defaults for regions that wake `'visible'` (`wake: 'visible'` / `render` + `wake: 'visible'`)
	 * without their own `margin` (via a preset).
	 */
	visible?: {
		/** Default `IntersectionObserver` `rootMargin` (e.g. `'200px'`). */
		margin?: string;
	};
	/**
	 * Named strategy bundles. Reference one from an import:
	 * `import Chart from '$lib/Chart.svelte' with { preset: 'chart' };`
	 */
	presets?: Record<string, OgygiaPreset>;
	/**
	 * How long a deferred/live hole's signed capability URL stays valid, in seconds (default `3600`).
	 * Clamped to `[60, 86400]`. Keep short for harvested-URL risk. Holes outlive this automatically
	 * where they must: on prerendered and postrendered pages, and on a page a load marks shared-cacheable
	 * (`setHeaders({ 'cache-control': 'public, s-maxage=…' })`), where an anonymous hole is signed for
	 * the page's cache life; a hole on an older cached copy renews itself when it wakes.
	 */
	ttl?: number;
	/**
	 * The oldest a cached copy of a page can be and still get its holes, in seconds (default
	 * `691200`, 8 days). An anonymous hole whose capability expired while a cache kept its page
	 * renews itself for up to this long after that expiry; past it, the hole keeps its fallback.
	 * Raise it to the longest your CDN may serve a page when the page does not say so in its
	 * `cache-control`. `0` turns renewal off. Unlike `ttl` it never lengthens a hole URL's life (a
	 * renewed URL lives `ttl`), and a hole bound to a session never renews. A renewable URL replays its
	 * props: keep hole props to routing keys (a locale, a page), and read anything sensitive at render.
	 */
	maxPageAge?: number;

	/**
	 * Client-side SPA router — app-wide, on by default. It intercepts same-origin links, swaps
	 * `<body>`, merges `<head>`, and keeps `data-ogygia-keep` chrome across navigations. No component
	 * to place: the server handle injects the runtime + the `ogygia-router` meta into every page.
	 *
	 * - `true` (default) — router on, View Transitions on, form continuity on.
	 * - `false` — router off (the whole feature is tree-shaken out; same-origin links do full MPA
	 *   loads, and form continuity — which rides SPA navigation — goes with it).
	 * - `{ viewTransitions: false }` — router on, but no View Transitions API on navigation.
	 * - `{ forms: false }` — router on, but an island's half-filled form fields are NOT carried
	 *   across SPA navigation (continuity off).
	 * - `{ serverDelta: true }` — opt IN to server-delta nav: an SPA nav tells the server (via an
	 *   `x-ogygia-known` header) which islands it already has live, so the server SKIPS re-rendering
	 *   the unchanged ones and the client keeps them running. OFF by default (it is a new client↔server
	 *   protocol); when off the client never sends the header and the server always full-renders.
	 *
	 * Per-page escape hatch (no second config): a page opts *itself* out of View Transitions by
	 * emitting `<svelte:head><meta name="ogygia-router" content="plain" /></svelte:head>` — the handle
	 * injects the app default but a page that sets its own meta wins.
	 */
	router?: boolean | { viewTransitions?: boolean; forms?: boolean; serverDelta?: boolean };

	/**
	 * Rename the import-attribute keys claimed by the transform.
	 * Defaults stay `wake` / `fetch` / `render` / `preset` / `region`. Escape hatch if another
	 * tool already uses those names on the same imports.
	 *
	 * Preset **definitions** ({@link OgygiaOptions.presets}) still use the standard `render` /
	 * `wake` / `fetch` / … keys: only the `with { … }` spellings in source change.
	 */
	importKeys?: Partial<ImportKeys>;

	/**
	 * Per-IP budget for the signed island endpoint served by `ogygiaHandle()`.
	 * Default `{ max: 60, windowMs: 60_000 }`. Pass `false` to disable.
	 */
	rateLimit?: false | OgygiaRateLimit;

	/**
	 * Cookie name to seal into the region MAC (opt-in). Empty/prerender stays unbound.
	 * Harvested capability URLs then fail verification without that cookie.
	 * Default `false` (unbound).
	 */
	sessionCookie?: false | string;

	/**
	 * @internal Recreate this plugin instance inside the standalone client build.
	 * App authors should not set this.
	 */
	standalone?: boolean;
}

const OPTION_KEYS: Readonly<Record<keyof OgygiaOptions, true>> = {
	visible: true,
	presets: true,
	ttl: true,
	maxPageAge: true,
	router: true,
	importKeys: true,
	rateLimit: true,
	sessionCookie: true,
	standalone: true
};

/** Every key of `options` is one `ogygia()` has: any other fails the build (`option_unknown`), so
 *  a misspelt or removed option never silently does nothing. */
export function assert_known_options(options: OgygiaOptions): void {
	for (const key of Object.keys(options)) {
		if (key in OPTION_KEYS) continue;
		if (key === 'barrels') throw new OgygiaError('barrels_option_removed');
		throw new OgygiaError('option_unknown', {
			option: key,
			known: Object.keys(OPTION_KEYS)
				.filter((k) => k !== 'standalone')
				.join(', ')
		});
	}
}

/**
 * Config-time region-preset validation — the transform re-checks on USE (with file/line context), but
 * a broken preset nobody references yet should still fail the build, not lurk.
 */
export function validate_region_presets(presets: Record<string, unknown>): void {
	for (const [name, bag] of Object.entries(presets)) {
		if (!bag || typeof bag !== 'object' || Object.keys(bag).length === 0) {
			throw new OgygiaError('preset_empty', { name });
		}
		for (const k of Object.keys(bag)) {
			if (!PRESET_KEYS.has(k)) {
				throw new OgygiaError('preset_key_unknown', {
					name,
					key: k,
					allowed: [...PRESET_KEYS].join(', ')
				});
			}
		}
	}
}

/** The router/capability config resolved from `OgygiaOptions` — pure derivation the factory reads. */
export interface ResolvedOgygiaConfig {
	rate_limit: { max: number; windowMs: number };
	session_cookie: string;
	region_ttl: number;
	renew_window: number;
	router_enabled: boolean;
	router_view_transitions: boolean;
	continuity_forms: boolean;
	server_delta: boolean;
}

/**
 * Normalize the router / rate-limit / session / ttl / continuity / server-delta options into the flat
 * config the factory threads into `CompileCtx` + `Program`. Pure — no defaults leak back into `options`.
 * `defaultRegionTtl` / `defaultRenewWindow` are passed in (the endpoint's DEFAULT_REGION_TTL_SEC,
 * shared-cache's RENEW_WINDOW_SEC) to keep this Vite-free.
 */
export function resolve_options(
	options: OgygiaOptions,
	defaultRegionTtl: number,
	defaultRenewWindow: number = 8 * 24 * 3600
): ResolvedOgygiaConfig {
	const rate_limit =
		options.rateLimit === false
			? { max: 0, windowMs: 60_000 }
			: {
					max: Math.max(0, options.rateLimit?.max ?? 60),
					windowMs: Math.max(1, options.rateLimit?.windowMs ?? 60_000)
				};

	const session_cookie = typeof options.sessionCookie === 'string' ? options.sessionCookie : '';
	const region_ttl = Math.min(86400, Math.max(60, Math.floor(options.ttl ?? defaultRegionTtl)));
	const renew_raw = options.maxPageAge;
	if (
		renew_raw !== undefined &&
		!(typeof renew_raw === 'number' && Number.isFinite(renew_raw) && renew_raw >= 0)
	) {
		throw new OgygiaError('max_page_age_invalid', { value: String(renew_raw) });
	}
	const renew_window = Math.min(10 * 365 * 24 * 3600, Math.floor(renew_raw ?? defaultRenewWindow));
	const router_enabled = options.router !== false;
	const router_view_transitions =
		options.router === false
			? false
			: typeof options.router === 'object'
				? options.router.viewTransitions !== false
				: true;
	const continuity_forms =
		router_enabled && (typeof options.router === 'object' ? options.router.forms !== false : true);
	const server_delta = typeof options.router === 'object' && options.router.serverDelta === true;

	return {
		rate_limit,
		session_cookie,
		region_ttl,
		renew_window,
		router_enabled,
		router_view_transitions,
		continuity_forms,
		server_delta
	};
}
