/**
 * ROUTE CONFIG — the keys a plugin reads inside Kit's own `config` page option
 * (`export const config = { postrender: false }` in a `+page.ts`). Kit takes anything inside
 * `config`, so nothing is stripped and no plugin invents an export in Kit's files. A plugin claims
 * its keys once (`b.routeConfig(key)`); the compiler reads each page's merged `config` at build time
 * the way Kit merges it (layouts root → leaf, then the page; at each level the server module, then
 * the universal one; later wins, top level only) and bakes the claimed keys.
 *
 * Two worlds answer, in the order dispatch itself resolves a request:
 * 1. A mounted programmatic `routes()` table that CLAIMS the pathname (it answers inside the
 *    handle, ahead of any file route): its merged page > layout > table `config`.
 * 2. A Kit page route: its build-time merged value.
 * Anything else (an endpoint, a request no route claimed) answers `undefined`: the plugin's own
 * default applies.
 *
 * One global slot: dist entries and plugin packages must share the registry.
 */

/** A route's merged `config`, as far as the claimed keys go. */
export type RouteConfig = Readonly<Record<string, unknown>>;
/** Per matcher: `undefined` = not mine (ask the next one, then the file world) · an object = mine,
 *  with this merged config (a claimed key it lacks answers `undefined`, never the file world). */
export type RouteConfigMatcher = (pathname: string) => RouteConfig | undefined;

interface RoutesSlot {
	routers: Map<string, RouteConfigMatcher>;
	/** route id (group-stripped) → the claimed keys of its merged config, for every Kit page route */
	pages: Map<string, RouteConfig>;
}
const slot: RoutesSlot = ((globalThis as Record<symbol, RoutesSlot | undefined>)[
	Symbol.for('ogygia.route-config.v1')
] ??= {
	routers: new Map(),
	pages: new Map()
});

/** A `routes()` table joins (keyed: dev re-evaluates hooks.server.ts and calls `routes()` again; a
 *  matcher with the same key REPLACES its stale twin instead of shadowing it). */
export function register_route_config(key: string, matcher: RouteConfigMatcher): void {
	slot.routers.delete(key);
	slot.routers.set(key, matcher);
}

/** Core only (hooks.ts): the Kit pages' merged config, baked by the compiler. */
export function set_page_route_config(pages: Record<string, RouteConfig>): void {
	slot.pages = new Map(Object.entries(pages));
}

/** Tests only. */
export function clear_route_config(): void {
	slot.routers.clear();
	slot.pages.clear();
}

/** Kit's `(group)` segments dropped from a `route.id` (the compiler keys pages the same way). */
function strip_route_groups(id: string): string {
	const segs = id
		.split('/')
		.filter(Boolean)
		.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
	return '/' + segs.join('/');
}

/** This request's value for `key` in its route's merged `config`, or `undefined` (use the plugin's
 *  default). A null `routeId` is never normalized to `/` — that would be a different route. */
export function route_config(
	key: string,
	route_id: string | null | undefined,
	pathname: string
): unknown {
	for (const matcher of slot.routers.values()) {
		const config = matcher(pathname);
		if (config !== undefined) return config[key];
	}
	if (route_id == null) return undefined;
	return slot.pages.get(strip_route_groups(route_id))?.[key];
}
