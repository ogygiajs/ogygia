/**
 * SvelteKit's `Handle`, written from what SvelteKit 2 and 3 both export. Kit 3 moved `Handle` and
 * `ResolveOptions` from `@sveltejs/kit` to `@sveltejs/kit/hooks`, where Kit 2 has no such types, so
 * neither import path types a handle on both. The shape is Kit's, so a handle typed with it assigns
 * to either Kit's `Handle` (`sequence(…)`, `export const handle: Handle`), and either Kit's handle
 * input assigns to it. The options are methods so their parameters compare both ways (Kit 3's
 * `preload` input grew a font `filename`).
 */
import type { RequestEvent } from '@sveltejs/kit';

type MaybePromise<T> = T | Promise<T>;

/** Kit's `resolve()` options. */
export interface ResolveOptions {
	transformPageChunk?(input: { html: string; done: boolean }): MaybePromise<string | undefined>;
	filterSerializedResponseHeaders?(name: string, value: string): boolean;
	preload?(input: { type: 'font' | 'css' | 'js' | 'asset'; path: string }): boolean;
}

/** Kit's `Handle` hook. */
export type Handle = (input: {
	event: RequestEvent;
	resolve: (event: RequestEvent, opts?: ResolveOptions) => MaybePromise<Response>;
}) => MaybePromise<Response>;
