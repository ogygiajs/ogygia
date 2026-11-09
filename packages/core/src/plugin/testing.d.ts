/**
 * `ogygia/plugin/testing` — start a plugin's server realm without a server, for unit tests: its app
 * made, its shared hooks registered, its `setup` run (exactly what the handle does at boot), and a
 * request context to call its hooks with.
 *
 *   const { app, ctx } = startPlugin(server, { name: '@ogygia/flags' });
 *   await server.request?.(ctx(new Request('http://x/')));
 */
import type { RequestEvent } from '@sveltejs/kit';
import type { RequestContext, ServerApp, ServerPlugin } from './index.ts';
/** This request's value for `key` (a registered router's merged config, else the Kit page's baked
 *  value), or `undefined`. */
export { route_config as routeConfig } from './routes.ts';
/** Forget every registered router and every page's merged config. */
export { clear_route_config as clearRouteConfig } from './routes.ts';
/** Stand in for the compiler: the Kit pages' merged config (route id → key → value). */
export { set_page_route_config as setPageRouteConfig } from './routes.ts';
/**
 * Runs `fn` inside a request, as Kit runs a hook or an endpoint: Kit's request store carries
 * `event` through every await of it, so `app.keepAlive` finds its platform (a `waitUntil` at
 * `platform.context` or `platform.ctx`).
 */
export declare function inRequest<T>(event: Partial<RequestEvent>, fn: () => T): T;
export interface StartedPlugin<Options, State> {
    app: ServerApp<Options>;
    /** A request context for `request` (a bare event: url, request, cookies that read nothing). */
    ctx(request: Request, event?: Partial<RequestEvent>): RequestContext<Options, State>;
}
export declare function startPlugin<Options = undefined, State = undefined>(server: ServerPlugin<Options, State>, { name, options }?: {
    name?: string;
    options?: Options;
}): StartedPlugin<Options, State>;
