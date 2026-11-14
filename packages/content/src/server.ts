import { prerender, query } from '$app/server';
import type { ContentRef, Entry } from './index.ts';
import { Collection, COLLECTION } from './collection-base.ts';
import { OgygiaError } from './messages/runtime.ts';

export type ContentMode = 'prerender' | 'query';

/** Return types for the minted remotes (the callable shape consumers use; cast for extra methods). */
export type ListRemote<Out> = () => Promise<Out[]>;
export type GetRemote<Out> = (id: string) => Promise<Out>;

type RefsOptions<T extends Record<string, unknown>, Out> = {
	mode?: ContentMode;
	dynamic?: boolean;
	filter?: (entry: ContentRef<T>) => boolean;
	map?: (entry: ContentRef<T>) => Out;
};
type LiveRefsOptions<T extends Record<string, unknown>, Out> = {
	filter?: (entry: ContentRef<T>) => boolean;
	map?: (entry: ContentRef<T>) => Out;
};
type LiveGetOptions<T extends Record<string, unknown>, Out> = {
	filter?: (entry: ContentRef<T>) => boolean;
	map?: (entry: ContentRef<T>) => Out;
	notFound?: Out | null;
};

/** The server-side handle `withRemotes()` returns: the collection's read paths + its remotes. */
export interface WithRemotes<T extends Record<string, unknown>> {
	refs(): Promise<ContentRef<T>[]>;
	get(id: string): Promise<Entry<T> | null>;
	/** A remote over the corpus refs (wire-safe metadata). `mode` is `'prerender'` for a static
	 *  source and `'query'` for one that reads at request time (dynamic or live); a prerender is
	 *  Kit-`dynamic` unless `dynamic: false`. */
	list<Out = { id: string; data: T }>(options?: RefsOptions<T, Out>): ListRemote<Out>;
	live: {
		list<Out = { id: string; data: T }>(options?: LiveRefsOptions<T, Out>): ListRemote<Out>;
		/** A live remote for one id; a missing or filtered-out id answers `notFound` (default `null`). */
		get<Out = { id: string; data: T } | null>(options?: LiveGetOptions<T, Out>): GetRemote<Out>;
	};
}

const string_arg = {
	['~standard']: {
		version: 1 as const,
		vendor: 'ogygia-content',
		validate(value: unknown) {
			if (typeof value === 'string') return { value };
			return { issues: [{ message: 'Expected string' }] };
		}
	}
};

function collection_of<T extends Record<string, unknown>>(handle: unknown): Collection<T> {
	const c = (handle as Record<symbol, unknown>)?.[COLLECTION];
	if (!(c instanceof Collection)) {
		throw new OgygiaError('content_with_remotes_not_collection');
	}
	return c as Collection<T>;
}

/**
 * Augment a browser-safe collection with its Kit remotes (and keep its read methods). Server-only
 * (it imports `$app/server`): call it from a `.remote.ts`.
 *
 * ```ts
 * // docs.remote.ts
 * import { withRemotes } from '@ogygia/content/server';
 * const r = withRemotes(docs);
 * export const docNav  = r.list({ map: (e) => ({ id: e.id, title: e.data.title }) });
 * export const feed    = r.live.list({ map });
 * export const oneLive = r.live.get({ map, notFound: null });
 * ```
 */
export function withRemotes<T extends Record<string, unknown> = Record<string, unknown>>(
	handle: unknown
): WithRemotes<T> {
	const c = collection_of<T>(handle);
	const default_mode: ContentMode = c.streaming || c.fromIsFunction ? 'query' : 'prerender';

	return {
		refs: () => c.refs(),
		get: (id: string) => c.get(id),

		list<Out = { id: string; data: T }>(options: RefsOptions<T, Out> = {}): ListRemote<Out> {
			const mode = options.mode ?? default_mode;
			const filter = c.compose(options.filter);
			const map = options.map ?? ((e: ContentRef<T>) => ({ id: e.id, data: e.data }) as Out);

			const run = async () => {
				const all = await c.ready();
				const rows = await Promise.all(all.filter(filter).map((e) => c.withGraph(e)));
				return Promise.all(rows.map(map));
			};

			if (mode === 'query') return query(run) as unknown as ListRemote<Out>;
			if (c.streaming) {
				throw new OgygiaError('content_streaming_prerender_list');
			}
			return prerender(run, { dynamic: options.dynamic ?? true }) as unknown as ListRemote<Out>;
		},

		live: {
			list<Out = { id: string; data: T }>(options: LiveRefsOptions<T, Out> = {}): ListRemote<Out> {
				const filter = c.compose(options.filter);
				const map = options.map ?? ((e: ContentRef<T>) => ({ id: e.id, data: e.data }) as Out);
				const project = async (rows: ContentRef<T>[]) =>
					Promise.all((await Promise.all(rows.filter(filter).map((e) => c.withGraph(e)))).map(map));

				return query.live(async function* () {
					await c.ready();
					// @why the stamp and the first list are read in one step (test: test/live-stamp.test.ts › live.list: an edit that lands as the first snapshot is taken still reaches the client)
					const sent = c.version();
					yield await project(c.snapshot());
					for await (const _ of c.watchChanges(sent)) yield await project(c.snapshot());
				}) as unknown as ListRemote<Out>;
			},

			get<Out = { id: string; data: T } | null>(
				options: LiveGetOptions<T, Out> = {}
			): GetRemote<Out> {
				const filter = c.compose(options.filter);
				const notFound = ('notFound' in options ? options.notFound : null) as Out;
				const map = options.map ?? ((e: ContentRef<T>) => ({ id: e.id, data: e.data }) as Out);
				const project = async (id: string): Promise<Out> => {
					const e = c.lookup(id);
					if (!e || !filter(e)) return notFound;
					return map(await c.withGraph(e));
				};

				return query.live(string_arg, async function* (id: unknown) {
					await c.ready();
					const sent = c.version();
					yield await project(id as string);
					for await (const _ of c.watchChanges(sent)) yield await project(id as string);
				}) as unknown as GetRemote<Out>;
			}
		}
	};
}

export * from './site/server.ts';
