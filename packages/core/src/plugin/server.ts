/**
 * Core's side of the server realm: turns the generated plugin list into live plugins (an `app` each,
 * `setup` called once, shared hooks registered) and makes each request's per-plugin contexts. Used
 * by hooks.ts only.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { try_get_request_store } from '@sveltejs/kit/internal/server';
import type { Handle } from '../kit-handle.ts';
import type { HtmlPass, RequestContext, ResolveOptions, ServerApp, ServerPlugin } from './index.ts';
import { current_facts, facts_of, note_per_visitor, type RequestFacts } from './facts.ts';
import { observe_reads } from './reads.ts';
import { ask, notify, register_hooks } from './hooks.ts';
import { route_config } from './routes.ts';
import { renders_for_a_page } from '../server/endpoint.ts';
import { plugin_capabilities, type CapabilitySigner } from './capability.ts';
import { record_server_event } from '../events/server-registry.ts';
import { warn } from '../messages/server.ts';
import { say, slot as shared } from '@ogygia/machine';

/** One plugin's server half as the build lists it (`ogygia:server/server-plugins`). */
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

/** Make each plugin live, in order: app, shared hooks, `setup`. `leave` takes their shared hooks out
 *  again. */
export function start_plugins(
	entries: readonly ServerPluginEntry[],
	signer: AppSigner
): { plugins: LivePlugin[]; leave: () => void } {
	const leaves: Array<() => void> = [];
	const plugins = entries.map(({ name, options, server }) => {
		// (once per message, of the last 1024 said: a message with a URL in it never grows the server)
		const warned = say();
		const app: ServerApp<unknown> = {
			name,
			options,
			notify,
			ask,
			facts: facts_of,
			current: current_facts,
			perVisitor: note_per_visitor,
			observeReads: (event) => observe_reads(event, facts_of(event.request).reads),
			sign: signer.sign,
			verify: signer.verify,
			capability: plugin_capabilities(name, signer),
			devtools: record_server_event,
			keepAlive: keep_alive,
			warn(message) {
				warned.once(message, () => console.warn(`[${name}] ${message}`));
			}
		};
		leaves.push(register_hooks(server));
		server.setup?.(app);
		return { def: server, app };
	});
	return {
		plugins,
		leave() {
			for (const leave of leaves) leave();
		}
	};
}

/** The leave of the app's plugins as the handle module last started them. One global slot, like the
 *  shared hooks themselves: the handle module runs again in dev (an edit runs a plugin's server half
 *  again, and the handle module that imports it), and its new run must not find the old one there. */
const app_plugins = shared<{ leave: (() => void) | null }>({
	name: 'ogygia.app-plugins',
	version: 1,
	make: () => ({ leave: null })
});

/** The app's plugins, live: the handle module's start, each time it runs. The plugins of the run
 *  before leave first, so only this run's answer `ask` and hear `notify`. */
export function start_app_plugins(
	entries: readonly ServerPluginEntry[],
	signer: AppSigner
): LivePlugin[] {
	app_plugins.leave?.();
	const { plugins, leave } = start_plugins(entries, signer);
	app_plugins.leave = leave;
	return plugins;
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
 * the work they leave running (a sink's send, #243):
 * - the platform keeps a request alive past its response (`platform.context.waitUntil` or
 *   `platform.ctx.waitUntil`): the work is handed to it;
 * - otherwise it runs on by itself: a long-running server keeps it alive in the process.
 *
 * The visitor's response is never held for it. A failed piece of work never fails the request (the
 * plugin says what went wrong), and is never an unhandled rejection.
 */
export function end_request(
	plugins: readonly LivePlugin[],
	ctxs: readonly RequestContext<unknown, unknown>[],
	platform: unknown
): void {
	let left: Promise<void>[] | null = null;
	for (let i = 0; i < plugins.length; i++) {
		// (a plugin's tail never fails the request, and its failure is said)
		try {
			const work = plugins[i].def.done?.(ctxs[i]);
			if (work) (left ??= []).push(Promise.resolve(work).then(undefined, done_failed));
		} catch (error) {
			done_failed(error);
		}
	}
	if (left === null) return;
	const wait_until = wait_until_of(platform);
	if (wait_until === null) return;
	try {
		wait_until(left.length === 1 ? left[0] : Promise.all(left).then(ignore));
	} catch {
		// ok: a platform that refuses it: the work runs on by itself
	}
}

function done_failed(error: unknown): void {
	warn('plugin_hook_failed', { name: 'done' }, error);
}

function ignore(): void {}

/** `app.keepAlive`: `work` handed to the `waitUntil` of the request the running code belongs to
 *  (Kit's request store knows it, through every await of the request), or left to run on. */
function keep_alive(work: Promise<unknown>): void {
	const event = (try_get_request_store() as { event?: RequestEvent } | null)?.event;
	const wait_until = wait_until_of(event?.platform);
	if (wait_until === null) return;
	try {
		wait_until(work);
	} catch {
		// ok: a platform that refuses it: the work runs on by itself
	}
}

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

/** The app's own pass over `event`'s HTML: the first plugin's answer, or undefined. */
export function html_pass(
	plugins: readonly LivePlugin[],
	event: RequestEvent
): HtmlPass | undefined {
	for (const { def } of plugins) {
		const pass = def.pass?.(event);
		if (pass) return pass;
	}
	return undefined;
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
	const per_visitor = (reason: string) => note_per_visitor(event.request, reason);
	const for_page = renders_for_a_page(event);
	return plugins.map(({ def, app }) => ({
		event,
		path,
		forPage: for_page,
		state: def.state?.(),
		options: app.options,
		app,
		facts,
		routeConfig: route_cfg,
		renderHole: render_hole,
		perVisitor: per_visitor
	}));
}
