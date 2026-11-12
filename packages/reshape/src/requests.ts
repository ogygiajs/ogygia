/**
 * Which requests run the app's pass, and with what: `handle()` files the transform under the request
 * it wraps, and the server realm reads it there when ogygia asks (`ServerPlugin.pass`). A request that
 * never went through `handle()` has no pass.
 *
 * One global slot, not module scope: the handle (from the package's root) and the server realm (named
 * by `reshape()`) can end up as two module instances of this file (src beside dist), and a transform
 * filed through one must be read through the other.
 */
import type { RequestEvent } from '@sveltejs/kit';
import type { TransformKind } from './reversible.ts';

/**
 * The app's own pass over the HTML ogygia sends: the function `handle()` takes. Post-processes every
 * document (the chunk carrying `</head>`; a streamed tail passes untouched) and every region answer
 * (a hole, a lake remount), e.g. a web-component server render. `html` in, `html` out, may be async;
 * it is on the response path, so keep it fast.
 *
 * - `kind`: `'document'` or `'region'`.
 * - `csr`: whether Kit hydrates the whole page (always `false` for a region answer).
 * - `event`: the request being answered.
 *
 * ```ts
 * import type { ReshapeTransform } from '@ogygia/reshape';
 * export const render: ReshapeTransform = (html, { kind }) =>
 * 	renderComponents(html, { fragment: kind === 'region' });
 * ```
 */
export type ReshapeTransform = (
	html: string,
	ctx: { kind: TransformKind; csr: boolean; event: RequestEvent }
) => string | Promise<string>;

interface Slot {
	/** the server realm started (`reshape()` is in vite.config) */
	live: boolean;
	by_request: WeakMap<Request, ReshapeTransform>;
}

export const slot: Slot = ((globalThis as Record<symbol, Slot | undefined>)[
	Symbol.for('ogygia.reshape.v1')
] ??= { live: false, by_request: new WeakMap() });
