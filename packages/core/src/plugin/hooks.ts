/**
 * SHARED HOOKS — how plugins (and core) talk to each other: the same way core talks to them. A
 * plugin implements a hook as a method of its server half; anyone calls it through `app`:
 *
 *   app.notify.invalidate(tags)        every implementation runs (resolves when all are done;
 *                                      rejects then if one failed)
 *   app.ask.lastBuild(version)         the first answer that is not `undefined`, in plugin order
 *
 * Nobody implementing a hook is normal: `notify` does nothing, `ask` answers `undefined`. Core owns
 * the common names below; a plugin's own hooks carry its name (`federationThaw`), added by
 * declaration merging:
 *
 *   declare module 'ogygia/plugin' { interface ServerHooks { myThing(x: number): void } }
 *
 * One global slot: every module instance dispatches over the same implementations.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { warn } from '../messages/server.ts';
import { current_facts } from './facts.ts';

/** The shared hooks. Each is optional on a plugin; the signature is the contract. */
export interface ServerHooks {
	/** Drop every stored page carrying any of `tags` (a peer said they are stale). Never re-announced. */
	invalidate(tags: string[]): void | Promise<void>;
	/** Stored pages were dropped: `tags` names what (`p:<path>`, `s:<source>:<fp>`), or `'all'`. */
	invalidated(tags: string[] | 'all'): void | Promise<void>;
	/** Record `version` as the build the shared store last saw; answer the one before (or undefined). */
	lastBuild(version: string): string | undefined | Promise<string | undefined>;
	/** Is this request's visitor one the plugin measures for, proved by its own credentials (the
	 *  profiler: its logged-in user)? Such a visitor's region answers say how loaded the server is
	 *  (`server-timing`). A plugin that cannot tell answers `undefined`. */
	measures(event: RequestEvent): boolean | undefined | Promise<boolean | undefined>;
	/** The origins island code on this app's pages may load from besides its own (a federation
	 *  shell's peers). Sync, and every implementation's answers count: read through
	 *  {@link code_origins}, written on the runtime's script (runtime/code-origins.ts). */
	codeOrigins(): readonly string[];
}

type AnyFn = (...args: unknown[]) => unknown;
type Impl = Record<string, unknown>;

const implementations: Impl[] = ((globalThis as Record<symbol, Impl[] | undefined>)[
	Symbol.for('ogygia.server-hooks.v1')
] ??= []);

/** Core only: a set of hook implementations joins (a plugin's server half, or core's own). Keyed by
 *  identity; returns the leave. */
export function register_hooks(impl: object): () => void {
	const entry = impl as Impl;
	if (!implementations.includes(entry)) implementations.push(entry);
	return () => {
		const at = implementations.indexOf(entry);
		if (at !== -1) implementations.splice(at, 1);
	};
}

/** Every implementation's `codeOrigins`, in plugin order (a failing one is logged and adds none),
 *  then the running request's own (`facts.codeOrigins`). */
export function code_origins(): string[] {
	const out: string[] = [];
	for (const impl of implementations) {
		const fn = impl.codeOrigins;
		if (typeof fn !== 'function') continue;
		try {
			out.push(...((fn as AnyFn).call(impl) as readonly string[]));
		} catch (e) {
			warn('plugin_hook_failed', { name: 'codeOrigins' }, e);
		}
	}
	const learned = current_facts()?.codeOrigins;
	if (learned) out.push(...learned);
	return out;
}

export type Notify = {
	[K in keyof ServerHooks]: (...args: Parameters<ServerHooks[K]>) => Promise<void>;
};
export type Ask = {
	[K in keyof ServerHooks]: (
		...args: Parameters<ServerHooks[K]>
	) => Promise<Awaited<ReturnType<ServerHooks[K]>> | undefined>;
};

/** Every implementation of the named hook runs; a failing one is logged and does not stop the
 *  others. Once all ran, the notify rejects with what failed (the one error, or an
 *  AggregateError): "done" and "done, but one could not" are different answers, like the ask's
 *  (a peer said done for a thaw its store failed to apply, #287). */
export const notify: Notify = new Proxy({} as Notify, {
	get:
		(_, name: string) =>
		async (...args: unknown[]): Promise<void> => {
			let failed: unknown[] | null = null;
			// (a copy: an implementation may join or leave while a hook awaits)
			for (const impl of implementations.slice()) {
				const fn = impl[name];
				if (typeof fn !== 'function') continue;
				try {
					await (fn as AnyFn).apply(impl, args);
				} catch (e) {
					warn('plugin_hook_failed', { name }, e);
					(failed ??= []).push(e);
				}
			}
			if (failed)
				throw failed.length === 1
					? failed[0]
					: new AggregateError(failed, `${failed.length} implementations of ${name} failed`);
		}
});

/** The first implementation that answers something other than `undefined`. When none answered and
 *  one threw, the ask throws that error: "nobody knows" and "the one who knows could not say" are
 *  different answers (a store down once read as "no store", and the deploy thaw was lost, #198). */
export const ask: Ask = new Proxy({} as Ask, {
	get:
		(_, name: string) =>
		async (...args: unknown[]): Promise<unknown> => {
			let failed: { error: unknown } | null = null;
			// (a copy: an implementation may join or leave while a hook awaits)
			for (const impl of implementations.slice()) {
				const fn = impl[name];
				if (typeof fn !== 'function') continue;
				try {
					const answer = await (fn as AnyFn).apply(impl, args);
					if (answer !== undefined) return answer;
				} catch (e) {
					warn('plugin_hook_failed', { name }, e);
					failed ??= { error: e };
				}
			}
			if (failed) throw failed.error;
			return undefined;
		}
});
