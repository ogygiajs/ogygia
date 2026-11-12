import { request_scope } from '@ogygia/core/internal/server';
import { net, timers } from '@ogygia/machine';
import type { FlagSource, FlagQuery, Resolved, CtxLike } from './index.ts';

const TRAILING_SLASH_RE = /\/$/;

export interface OfrepOptions {
	/** OFREP base URL (the adapter calls `<url>/ofrep/v1/evaluate/flags/bulk`). */
	url: string;
	/** Static headers (auth token, tenant) sent with every evaluation. */
	headers?: Record<string, string>;
	/** Build the OFREP evaluation context from the request (default: visitor `sub`, else
	 *  an anonymous visitor's `vid` → `targetingKey`, plus every own key of `c.visitor`). */
	context?: (c: CtxLike) => Record<string, unknown>;
	/** Per-request fetch (default global). */
	fetch?: typeof fetch;
	/** Abort the evaluation after N ms (default 800 — a flag service must not gate first byte). */
	timeout?: number;
}

interface OfrepFlag {
	key: string;
	variant?: string;
	value?: unknown;
	reason?: string;
	errorCode?: string;
}

function default_context(c: CtxLike): Record<string, unknown> {
	const key = c.visitor?.sub || c.visitor?.vid;
	return { ...c.visitor, ...(key ? { targetingKey: key } : {}) };
}

/**
 * A flag source that speaks the OpenFeature Remote Evaluation Protocol (OFREP) directly, with no
 * vendor SDK: any OFREP endpoint works (flagd, the OpenFeature operator, a gateway). One bulk POST
 * per request over the app's declared flags; a boolean value reads as `on` / `off`. An error
 * answer, a timeout or a network failure throws, so the flags fall to their native rule and it is
 * said; a request that ended first stops the call and reports nothing.
 *
 *   import { decide } from '@ogygia/flags';
 *   import { ofrep } from '@ogygia/flags/openfeature';
 *   decide({ source: ofrep({ url: 'http://flagd:8016' }) });
 */
export function ofrep(opts: OfrepOptions): FlagSource {
	const ctx_of = opts.context ?? default_context;
	const f = opts.fetch ?? net.fetch;
	const endpoint = opts.url.replace(TRAILING_SLASH_RE, '') + '/ofrep/v1/evaluate/flags/bulk';
	const timeout = opts.timeout ?? 800;
	return async (queries: FlagQuery[], c: CtxLike): Promise<Record<string, Resolved>> => {
		const out: Record<string, Resolved> = {};
		const ended = request_scope(c.request).signal;
		try {
			const res = await f(endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/json', ...opts.headers },
				body: JSON.stringify({ context: ctx_of(c) }),
				signal: timers.timeout(timeout, ended)
			});
			if (!res.ok) throw new Error(`OFREP ${endpoint} answered ${res.status}`);
			const body = (await res.json()) as { flags?: OfrepFlag[] };
			const want = new Map(queries.map((q) => [q.name, q]));
			for (const f of body.flags ?? []) {
				const q = want.get(f.key);
				if (!q || f.errorCode) continue;
				const variant =
					f.variant ?? (typeof f.value === 'boolean' ? (f.value ? 'on' : 'off') : undefined);
				if (variant === undefined || !q.variants.includes(variant)) continue;
				out[f.key] =
					f.value !== undefined && typeof f.value !== 'boolean'
						? { variant, value: f.value }
						: variant;
			}
		} catch (error) {
			if (ended.aborted) return out;
			throw error;
		}
		return out;
	};
}
