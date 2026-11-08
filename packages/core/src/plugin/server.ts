/**
 * Core's side of the server realm: turns the generated plugin list into live plugins (an `app` each,
 * `setup` called once, shared hooks registered) and makes each request's per-plugin contexts. Used
 * by hooks.ts only.
 */
import type { RequestEvent } from '@sveltejs/kit';
import type { Handle } from '../kit-handle.ts';
import type { RequestContext, ResolveOptions, ServerApp, ServerPlugin } from './index.ts';
import { current_facts, facts_of, mark_per_visitor, type RequestFacts } from './facts.ts';
import { ask, notify, register_hooks } from './hooks.ts';
import { route_config } from './routes.ts';
import { plugin_capabilities, type CapabilitySigner } from './capability.ts';
import { record_server_event } from '../events/server-registry.ts';

/** One plugin's server half as the build lists it (`virtual:ogygia/server-plugins`). */
export interface ServerPluginEntry {
	name: string;
	options: unknown;
	server: ServerPlugin<unknown, unknown>;
}

/** A live plugin: its definition and its app. */
export interface LivePlugin {
	def: ServerPlugin<unknown, unknown>;
	app: ServerApp<unknown>;
}

/** The app's signer, handed in by the handle (it holds the region key, and answers a refused
 *  capability the way it answers a refused region request). */
export type AppSigner = CapabilitySigner;

/** Make each plugin live, in order: app, shared hooks, `setup`. */
export function start_plugins(
	entries: readonly ServerPluginEntry[],
	signer: AppSigner
): LivePlugin[] {
	return entries.map(({ name, options, server }) => {
		const warned = new Set<string>();
		const app: ServerApp<unknown> = {
			name,
			options,
			notify,
			ask,
			facts: facts_of,
			current: current_facts,
			sign: signer.sign,
			verify: signer.verify,
			capability: plugin_capabilities(name, signer),
			devtools: record_server_event,
			warn(message) {
				if (warned.has(message)) return;
				warned.add(message);
				console.warn(`[${name}] ${message}`);
			}
		};
		register_hooks(server);
		server.setup?.(app);
		return { def: server, app };
	});
}

/** Two `resolve()` option sets as one: the inner transform (ogygia's document injection) runs first,
 *  the outer (a plugin's `handle`) sees the finished chunk; the other options merge, outer last. */
export function compose_resolve_options(
	inner?: ResolveOptions,
	outer?: ResolveOptions
): ResolveOptions | undefined {
	if (!inner) return outer;
	if (!outer) return inner;
	const a = inner.transformPageChunk;
	const b = outer.transformPageChunk;
	return {
		...inner,
		...outer,
		transformPageChunk: !a
			? b
			: !b
				? a
				: async (input) => {
						const first = await a(input);
						if (first === undefined) return first;
						return b({ ...input, html: first });
					}
	};
}

/** The plugins' `handle` hooks nested around `core`, first plugin outermost. No hook: `core` itself. */
export function around(plugins: readonly LivePlugin[], core: Handle): Handle {
	let inner = core;
	for (let i = plugins.length - 1; i >= 0; i--) {
		const { def, app } = plugins[i];
		const handle = def.handle;
		if (!handle) continue;
		const next_handle = inner;
		inner = async ({ event, resolve }) =>
			handle({ event, options: app.options, app }, (outer) =>
				Promise.resolve(
					next_handle({
						event,
						resolve: (ev, opts) => resolve(ev, compose_resolve_options(opts, outer))
					})
				)
			);
	}
	return inner;
}

/**
 * The request's end: each plugin's `done`, in order (one that throws does not stop the others), and
 * the work they leave running (a sink's send, #243) kept alive until it ends:
 * - the platform keeps a request alive past its response (`platform.context.waitUntil` or
 *   `platform.ctx.waitUntil`): the work is handed to it, and the response does not wait;
 * - otherwise a serverless instance may freeze as soon as its response ends, so the response's body
 *   ends after the work (its head and every byte of the body go out as they come; only the end
 *   waits). A response with no body, or a request that threw (`response` null), waits for it.
 *
 * Null: no work was left, `response` goes out as it is. A failed piece of work never fails the
 * response (the plugin says what went wrong).
 */
export function end_request(
	plugins: readonly LivePlugin[],
	ctxs: readonly RequestContext<unknown, unknown>[],
	platform: unknown,
	response: Response | null
): Promise<Response | null> | null {
	let left: Promise<void>[] | null = null;
	for (let i = 0; i < plugins.length; i++) {
		try {
			const work = plugins[i].def.done?.(ctxs[i]);
			if (work) (left ??= []).push(Promise.resolve(work).then(undefined, ignore));
		} catch {
			/* a plugin's tail never fails the request */
		}
	}
	if (left === null) return null;
	const work = left.length === 1 ? left[0] : Promise.all(left).then(ignore);
	const wait_until = wait_until_of(platform);
	if (wait_until !== null) {
		try {
			wait_until(work);
			return Promise.resolve(response);
		} catch {
			/* a platform that refuses it: the response waits instead */
		}
	}
	const body = response?.body;
	if (!response || !body) return work.then(() => response);
	// (the body's chunks pass through as they come; its end waits for the work)
	const held = body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ flush: () => work }));
	return Promise.resolve(
		new Response(held, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers
		})
	);
}

function ignore(): void {}

/** The platform's way to keep a request alive past its response, or null. */
function wait_until_of(platform: unknown): ((work: Promise<unknown>) => void) | null {
	if (typeof platform !== 'object' || platform === null) return null;
	for (const at of ['context', 'ctx'] as const) {
		const host = (platform as Record<string, unknown>)[at] as
			| { waitUntil?: (work: Promise<unknown>) => void }
			| null
			| undefined;
		if (typeof host?.waitUntil === 'function') return (work) => host.waitUntil!(work);
	}
	return null;
}

/** The per-plugin contexts of one request. */
export function request_contexts(
	plugins: readonly LivePlugin[],
	event: RequestEvent,
	path: string,
	facts: RequestFacts,
	render_hole: (endpoint: string) => Promise<string | null>
): RequestContext<unknown, unknown>[] {
	const route_id = event.route?.id;
	const route_cfg = (key: string) => route_config(key, route_id, path);
	const per_visitor = (reason: string) => mark_per_visitor(facts, reason);
	return plugins.map(({ def, app }) => ({
		event,
		path,
		state: def.state?.(),
		options: app.options,
		app,
		facts,
		routeConfig: route_cfg,
		renderHole: render_hole,
		perVisitor: per_visitor
	}));
}
