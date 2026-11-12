import type { StandardSchemaV1 } from '@ogygia/core/plugin/utils';

export type { StandardSchemaV1, StandardResult, StandardIssue } from '@ogygia/core/plugin/utils';
export type InferOutput<S> = S extends StandardSchemaV1<infer O> ? O : never;

export type Simplify<T> = { [K in keyof T]: T[K] } & {};
type SegParam<S extends string> = S extends `[[${infer O}]]`
	? { [K in O]?: string }
	: S extends `[...${infer R}]`
		? { [K in R]: string }
		: S extends `${string}[${infer N}]${string}`
			? { [K in N]: string }
			: {};
type ParamsAcc<P extends string> = P extends `${infer A}/${infer B}`
	? SegParam<A> & ParamsAcc<B>
	: SegParam<P>;
/** A route's params, read from its pattern: `/docs/[slug]` → `{ slug: string }`, `/[[lang]]` →
 *  `{ lang?: string }`, `/[...rest]` → `{ rest: string }`, `/[id].json` → `{ id: string }`. */
export type Params<P extends string> = Simplify<ParamsAcc<P>>;

/** The params object `href` accepts for a pattern — every param, as a string or number. */
export type HrefParams<P extends string> = { [K in keyof Params<P>]: string | number };
/** href args: params are REQUIRED when the pattern has any, omittable when it has none. */
export type HrefArgs<P extends string> =
	{} extends Params<P> ? [params?: HrefParams<P>] : [params: HrefParams<P>];
