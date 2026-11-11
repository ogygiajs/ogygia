/**
 * postrender — observed purity. What the render read that is not the same for every visitor is the
 * request's read set (`facts.reads`, core's plugin/reads.ts): a flag, a streamed promise, and the
 * cookie, personal header or `locals` value `app.observeReads` notes once asked. This adds the one
 * thing a stored page cannot hold besides: a cookie the render (or the app) wrote.
 *
 * The vary-bucket law (the app delta 1): a read that resolved to its DEFAULT value — cookie
 * `undefined`, `locals.user` an empty object — still stores. That IS the canonical render
 * (the cookie-less CDN key, formalized). A NON-default observed value → per-request in v1.
 */
import type { RequestContext } from '@ogygia/core/plugin';

export interface Observation {
	/** The first per-visitor read, or null — the verdict input. Named (`cookie:consent`,
	 *  `header:accept-language`, `locals.user`, `flag:hero`) for the dev note. */
	readonly disqualified_by: string | null;
	/** The render (or the app) wrote a cookie — always per-request. */
	wrote_cookie: boolean;
}

/**
 * Note the event's personal reads from now on, and record its cookie writes (patched in place, per
 * request: the event dies with it). Returns the live observation the verdict reads after the render.
 */
export function observe_event(
	ctx: Pick<RequestContext<unknown, unknown>, 'event' | 'facts' | 'app'>
): Observation {
	const { event, facts } = ctx;
	ctx.app.observeReads(event);
	const obs: Observation = {
		get disqualified_by() {
			return facts.reads.perVisitor;
		},
		wrote_cookie: false
	};
	const cookies = event.cookies;
	const set = cookies.set.bind(cookies);
	const drop = cookies.delete.bind(cookies);
	cookies.set = ((...args: Parameters<typeof set>) => {
		obs.wrote_cookie = true;
		return set(...args);
	}) as typeof cookies.set;
	cookies.delete = ((...args: Parameters<typeof drop>) => {
		obs.wrote_cookie = true;
		return drop(...args);
	}) as typeof cookies.delete;
	return obs;
}
