/**
 * `@ogygia/rewrite`: an app's own render over the HTML ogygia sends (a web-component server render, a
 * translation proxy), as a Kit handle listed before `ogygia.handle()`. ogygia marks the HTML before
 * the render and puts back what the render moved in Svelte's markup before anything hydrates.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { check, check_event } from './check.ts';
import { OgygiaError } from './messages.ts';
import { step_of } from './pass.ts';
import { slot } from './requests.ts';
import type {
	CheckOptions,
	ElementRewrite,
	PageRewrite,
	Rewrite,
	RewriteContext,
	WholePageRewrite
} from './types.ts';

export type {
	CheckOptions,
	ElementRewrite,
	PageRewrite,
	Rewrite,
	RewriteCheck,
	RewriteContext,
	RewriteElement,
	RewriteKind,
	RewriteResult,
	RewriteSheet,
	WholePageRewrite
} from './types.ts';

/**
 * A rewrite of the HTML ogygia sends, as a Kit handle. List it before `ogygia.handle()`, and
 * `rewrite()` (from `@ogygia/rewrite/vite`) beside `ogygia()` in vite.config:
 *
 * ```ts
 * // src/hooks.server.ts
 * import { sequence } from '@sveltejs/kit/hooks';
 * import * as ogygia from 'ogygia/server';
 * import { rewrite } from '@ogygia/rewrite';
 *
 * const components = rewrite({
 * 	match: 'x-',
 * 	async render(elements, ctx) {
 * 		return elements.map((el) => ({ html: renderElement(el.html), sheets: [] }));
 * 	}
 * });
 * export const handle = sequence(components, ogygia.handle());
 * ```
 *
 * - `{ match, render }`: the outermost elements `match` picks go to `render`, one call per chunk of
 *   the page (and per region answer), which returns one `{ html, sheets }` per element. A failed
 *   batch is retried one element at a time; an element that still fails goes out as ogygia rendered
 *   it, said with its code. Each sheet goes out once per key: into the head, or inline at its first
 *   use once the head has gone.
 * - `{ page }`: the whole document or region answer. The document is held until its last chunk.
 *   The value also has `.html(str)`, the page function on a plain string.
 *
 * An element `render` gets with `restored: true` is one ogygia puts back for Svelte: render its plan
 * (its children inside `<slot>` wrappers, `og-shadow="key …"` naming its shadow sheets, optionally
 * `og-keep="attr …"`), and carry every other `og-*` mark along wherever you move a node.
 *
 * Several rewrites run in the order they are listed, on one marking of the HTML: a later one sees an
 * earlier one's output. `.check(html, { kind, csr })` runs the whole round trip on one piece of
 * markup, for a test.
 */
export function rewrite(definition: ElementRewrite): Rewrite;
export function rewrite(definition: PageRewrite): WholePageRewrite;
export function rewrite(definition: ElementRewrite | PageRewrite): Rewrite | WholePageRewrite {
	const step = step_of(definition);
	const handle: Rewrite = Object.assign(
		(({ event, resolve }) => {
			if (!slot.live) throw new OgygiaError('rewrite_plugin_missing');
			if (slot.started.has(event.request)) throw new OgygiaError('rewrite_after_ogygia');
			const steps = slot.by_request.get(event.request);
			if (steps) steps.push(step);
			else slot.by_request.set(event.request, [step]);
			return resolve(event);
		}) as Rewrite,
		{ check: (html: string, options?: CheckOptions) => check([step], html, options) }
	);
	const page = step.page;
	if (page === null) return handle;
	return Object.assign(handle, {
		html: async (html: string, ctx: Partial<RewriteContext> = {}) => {
			const event: RequestEvent = ctx.event ?? check_event();
			return page(html, {
				kind: ctx.kind ?? 'document',
				csr: ctx.csr ?? false,
				url: ctx.url ?? event.url,
				event,
				signal: ctx.signal ?? event.request.signal
			});
		}
	});
}
