import type { FlagSource, FlagQuery, Resolved, CtxLike } from './index.ts';
import { source_failed } from './source-health.ts';

export { ofrep, type OfrepOptions } from './ofrep.ts';

/** The slice of the OpenFeature server `Client` we use — structural, so any SDK version fits. */
export interface OpenFeatureClientLike {
	getBooleanValue(
		flagKey: string,
		defaultValue: boolean,
		context?: EvaluationContextLike
	): Promise<boolean>;
	getStringValue(
		flagKey: string,
		defaultValue: string,
		context?: EvaluationContextLike
	): Promise<string>;
	/** Optional: variants that carry a config payload read via `.value(c)`. */
	getObjectValue?<T>(flagKey: string, defaultValue: T, context?: EvaluationContextLike): Promise<T>;
}

export interface EvaluationContextLike {
	targetingKey?: string;
	[k: string]: unknown;
}

export interface OpenFeatureOptions {
	/** Build the OpenFeature evaluation context from the request (default: visitor `sub`, else
	 *  an anonymous visitor's `vid` → `targetingKey`, plus every own key of `c.visitor`). */
	context?: (c: CtxLike) => EvaluationContextLike;
	/** Also pull each flag's object value as the `.value(c)` payload (one extra eval per flag).
	 *  Off by default — most flags are variant-only. */
	values?: boolean;
}

function default_context(c: CtxLike): EvaluationContextLike {
	const key = c.visitor?.sub || c.visitor?.vid;
	return { ...c.visitor, ...(key ? { targetingKey: key } : {}) };
}

/**
 * A flag source over the app's own OpenFeature client (any provider; ogygia depends on no vendor
 * SDK). One evaluation per declared flag per request: a boolean flag asks with `false` as its
 * default (a missing key never turns a feature on), a variant flag with its first variant. One
 * flag whose evaluation throws falls to its native rule and is said; the others keep the answer.
 * After the one await, a decided flag reads like a native one.
 *
 *   import { OpenFeature } from '@openfeature/server-sdk';
 *   import { decide } from '@ogygia/flags';
 *   import { openfeature } from '@ogygia/flags/openfeature';
 *   decide({ source: openfeature(OpenFeature.getClient()) });
 */
export function openfeature(
	client: OpenFeatureClientLike,
	opts: OpenFeatureOptions = {}
): FlagSource {
	const ctx_of = opts.context ?? default_context;
	return async (queries: FlagQuery[], c: CtxLike): Promise<Record<string, Resolved>> => {
		const context = ctx_of(c);
		const out: Record<string, Resolved> = {};
		await Promise.all(
			queries.map(async (q) => {
				try {
					if (q.kind === 'boolean') {
						const on = await client.getBooleanValue(q.name, false, context);
						out[q.name] = on ? 'on' : 'off';
					} else {
						const variant = await client.getStringValue(q.name, q.variants[0], context);
						out[q.name] = variant;
					}
					if (opts.values && client.getObjectValue) {
						const value = await client.getObjectValue(q.name, undefined, context);
						if (value !== undefined) {
							const prev = out[q.name];
							out[q.name] = {
								variant: typeof prev === 'string' ? prev : q.variants[0],
								value
							};
						}
					}
				} catch (error) {
					source_failed(error);
				}
			})
		);
		return out;
	};
}
