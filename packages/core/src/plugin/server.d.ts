/**
 * Core's side of the server realm: turns the generated plugin list into live plugins (an `app` each,
 * `setup` called once, shared hooks registered) and makes each request's per-plugin contexts. Used
 * by hooks.ts only.
 */
import type { RequestEvent } from '@sveltejs/kit';
import type { Handle } from '../kit-handle.ts';
import type { RequestContext, ResolveOptions, ServerApp, ServerPlugin } from './index.ts';
import { type RequestFacts } from './facts.ts';
import { type CapabilitySigner } from './capability.ts';
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
/** Make each plugin live, in order: app, shared hooks, `setup`. `leave` takes their shared hooks out
 *  again. */
export declare function start_plugins(entries: readonly ServerPluginEntry[], signer: AppSigner): {
    plugins: LivePlugin[];
    leave: () => void;
};
/** The app's plugins, live: the handle module's start, each time it runs. The plugins of the run
 *  before leave first, so only this run's answer `ask` and hear `notify`. */
export declare function start_app_plugins(entries: readonly ServerPluginEntry[], signer: AppSigner): LivePlugin[];
/** Two `resolve()` option sets as one: the inner transform (ogygia's document injection) runs first,
 *  the outer (a plugin's `handle`) sees the finished chunk; the other options merge, outer last. */
export declare function compose_resolve_options(inner?: ResolveOptions, outer?: ResolveOptions): ResolveOptions | undefined;
/** The plugins' `handle` hooks nested around `core`, first plugin outermost. No hook: `core` itself. */
export declare function around(plugins: readonly LivePlugin[], core: Handle): Handle;
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
export declare function end_request(plugins: readonly LivePlugin[], ctxs: readonly RequestContext<unknown, unknown>[], platform: unknown): void;
/** The per-plugin contexts of one request. */
export declare function request_contexts(plugins: readonly LivePlugin[], event: RequestEvent, path: string, facts: RequestFacts, render_hole: (endpoint: string) => Promise<string | null>): RequestContext<unknown, unknown>[];
