import type { RequestEvent } from '@sveltejs/kit';
import { KitRequestStore } from '../server/kit-request-store.ts';
import type { RequestContext, ServerApp, ServerPlugin } from './index.ts';
// oxlint-disable-next-line ogygia/ports -- a test helper's own key, made once per test process (never a running app's)
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { facts_of } from './facts.ts';
import { LivePlugins, request_contexts, type AppSigner } from './server.ts';
import { capability_lifetime } from '../server/capability-lifetime.ts';
import { RENEW_WINDOW_SEC } from '../server/shared-cache.ts';

/** This request's value for `key` (a registered router's merged config, else the Kit page's baked
 *  value), or `undefined`. */
export { route_config as routeConfig } from './routes.ts';
/** Forget every registered router and every page's merged config. */
export { clear_route_config as clearRouteConfig } from './routes.ts';
/** Stand in for the compiler: the Kit pages' merged config (route id → key → value). */
export { set_page_route_config as setPageRouteConfig } from './routes.ts';

const TEST_KEY = randomBytes(32);
const TEST_KEY_FP = createHmac('sha256', TEST_KEY)
	.update('ogygia-key-fp')
	.digest('base64url')
	.slice(0, 8);
const TEST_SIGNER: AppSigner = {
	sign: (message) => createHmac('sha256', TEST_KEY).update(message).digest('base64url'),
	verify(message, signature) {
		const want = Buffer.from(createHmac('sha256', TEST_KEY).update(message).digest('base64url'));
		const got = Buffer.from(signature);
		return want.length === got.length && timingSafeEqual(want, got);
	},
	fingerprint: () => TEST_KEY_FP,
	lifetime: capability_lifetime({
		building: false,
		region_ttl: 3600,
		renew_window: RENEW_WINDOW_SEC,
		request: () => null
	}),
	deny: (why) => new Response('Forbidden', { status: 403, headers: { 'x-ogygia-deny': why } }),
	// (a test's requests pay no budget: the handle's are tested through it, plugin-hole-budgets)
	charge: () => null
};

/**
 * Runs `fn` inside a request, as Kit runs a hook or an endpoint: Kit's request store carries
 * `event` through every await of it, so `app.keepAlive` finds its platform (a `waitUntil` at
 * `platform.context` or `platform.ctx`).
 */
export function inRequest<T>(event: Partial<RequestEvent>, fn: () => T): T {
	return KitRequestStore.run(event, fn);
}

export interface StartedPlugin<Options, State> {
	app: ServerApp<Options>;
	/** A request context for `request` (a bare event: url, request, cookies that read nothing). */
	ctx: (request: Request, event?: Partial<RequestEvent>) => RequestContext<Options, State>;
}

/**
 * Starts a plugin's server realm without a server, for unit tests: its app made, its shared hooks
 * registered, its `setup` run (what the handle does at boot), and a request context to call its
 * hooks with. The app signs with a real HMAC under a key made for this process, with ogygia's
 * default hole lifetime (`ttl` an hour, `maxPageAge` eight days), and refuses a capability with the
 * handle's 403.
 *
 * ```ts
 * const { app, ctx } = startPlugin(server, { name: '@ogygia/flags' });
 * await server.request?.(ctx(new Request('http://x/')));
 * ```
 */
export function startPlugin<Options = undefined, State = undefined>(
	server: ServerPlugin<Options, State>,
	{ name = 'test-plugin', options }: { name?: string; options?: Options } = {}
): StartedPlugin<Options, State> {
	const {
		plugins: [live]
	} = new LivePlugins(
		[{ name, options, server: server as ServerPlugin<unknown, unknown> }],
		TEST_SIGNER
	);
	return {
		app: live.app as ServerApp<Options>,
		ctx(request, event = {}) {
			const url = new URL(request.url);
			const full = {
				request,
				url,
				route: { id: null },
				cookies: { get: () => undefined, getAll: () => [] },
				locals: {},
				...event
			} as unknown as RequestEvent;
			const [ctx] = request_contexts(
				[live],
				full,
				url.pathname,
				facts_of(request),
				async () => null
			);
			return ctx as RequestContext<Options, State>;
		}
	};
}
