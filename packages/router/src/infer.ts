import type { Snippet } from 'svelte';
import type { AnyPageDef, LoadDef, LayoutDef, PageDef, TableShape, VerbEntry } from './define.ts';
import type { ActionFailure } from './respond.ts';
import type { Params, Simplify, StandardSchemaV1, InferOutput } from './view.ts';

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
	k: infer I
) => void
	? I
	: never;

type Obj<D> = D extends object ? D : {};
type DataWithoutShortCircuit<D> = Obj<Exclude<D, Response>>;
type DataOf<L> =
	L extends LoadDef<infer D, string, never, never>
		? DataWithoutShortCircuit<D>
		: L extends (c: never) => infer R
			? DataWithoutShortCircuit<Awaited<R>>
			: {};
type LayoutData<L> = L extends LayoutDef<string, infer LD> ? DataOf<LD> : {};

type ChainData<Ls extends readonly LayoutDef[]> = Ls extends readonly [infer H, ...infer R]
	? LayoutData<H> & (R extends readonly LayoutDef[] ? ChainData<R> : {})
	: {};

type Layouts<V> = V extends PageDef<infer L, unknown, unknown, unknown, unknown> ? L : readonly [];
type LoadType<V> =
	V extends PageDef<readonly LayoutDef[], infer Load, unknown, unknown, unknown> ? Load : undefined;
type ActionsType<V> =
	V extends PageDef<readonly LayoutDef[], unknown, infer A, unknown, unknown> ? A : undefined;
type ParamsSchemaType<V> =
	V extends PageDef<readonly LayoutDef[], unknown, unknown, infer PS, unknown> ? PS : undefined;
type SearchSchemaType<V> =
	V extends PageDef<readonly LayoutDef[], unknown, unknown, unknown, infer SS> ? SS : undefined;

type PageData<V> = ChainData<Layouts<V>> & DataOf<LoadType<V>>;

type ActionData<R> = R extends ActionFailure<infer F> ? F : R;
type FormOf<V> =
	ActionsType<V> extends Record<string, (c: never) => infer R>
		? ActionData<Awaited<R>> | null
		: null;

type ParamsOf<K extends string, V> =
	ParamsSchemaType<V> extends StandardSchemaV1 ? InferOutput<ParamsSchemaType<V>> : Params<K>;
type SearchOf<V> =
	SearchSchemaType<V> extends StandardSchemaV1 ? InferOutput<SearchSchemaType<V>> : {};

type PageEntries<T> = {
	[K in keyof T & string as T[K] extends AnyPageDef ? K : never]: T[K] extends AnyPageDef
		? {
				data: Simplify<PageData<T[K]>>;
				form: FormOf<T[K]>;
				params: Simplify<ParamsOf<K, T[K]>>;
				search: Simplify<SearchOf<T[K]>>;
			}
		: never;
};

type LayoutEntries<Ls extends readonly LayoutDef[], AncestorData = {}> = Ls extends readonly [
	infer H,
	...infer R
]
	? H extends LayoutDef<infer Name, unknown>
		? {
				[P in `(${Name})`]: { data: Simplify<AncestorData & LayoutData<H>>; children: Snippet };
			} & (R extends readonly LayoutDef[] ? LayoutEntries<R, AncestorData & LayoutData<H>> : {})
		: {}
	: {};

type AllLayoutEntries<T> = UnionToIntersection<
	{ [K in keyof T]: T[K] extends AnyPageDef ? LayoutEntries<Layouts<T[K]>> : {} }[keyof T]
>;

type PayloadOf<R> = [R] extends [never] ? unknown : R extends Response ? unknown : R;
type SlotOut<H> =
	H extends VerbEntry<infer O, unknown>
		? PayloadOf<O>
		: H extends (c: never) => infer R
			? PayloadOf<Awaited<R>>
			: unknown;
type SlotIn<H> = H extends VerbEntry<unknown, infer I> ? I : undefined;
type SlotEntry<H> = { out: SlotOut<H>; in: SlotIn<H> };

type EndpointVerbs<V> = {
	[M in keyof V & string as V[M] extends undefined ? never : Lowercase<M>]: SlotEntry<V[M]>;
};
type EndpointEntries<T> = {
	[K in keyof T & string as T[K] extends AnyPageDef ? never : K]: T[K] extends AnyPageDef
		? never
		: Simplify<EndpointVerbs<T[K]> & { params: Simplify<Params<K>> }>;
};

/**
 * The `$infer` map an app exports (`export type App = typeof app.$infer`): `App['/docs/[slug]']`
 * is a page's `{ data, form, params, search }`, `App['(name)']` a layout's `{ data, children }`, and
 * an endpoint's key holds its lowercase verbs' `{ out, in }`. `data` merges the layout chain's loads
 * with the page's own, as Kit's cascade does. It is computed from loads and schemas, never from
 * components.
 */
export type InferMap<T extends TableShape> = Simplify<
	PageEntries<T> & EndpointEntries<T> & AllLayoutEntries<T>
>;
