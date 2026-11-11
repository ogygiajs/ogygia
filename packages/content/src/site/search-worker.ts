/**
 * Search worker — builds the Orama index off the main thread and answers queries. Instantiated by
 * the `<Search>` brick via `new Worker(new URL('./search-worker.js', import.meta.url))`. Ingests the
 * prerendered `search.json` documents; the heavy engine (optional peer) is lazy-loaded inside.
 *
 * Messages in:  { type: 'load', url } | { type: 'query', id, q, base, limit }
 * Messages out: { type: 'ready' } | { type: 'error', message } (the index failed to load)
 *             | { type: 'result', id, hits } | { type: 'error', id, message } (that query failed)
 */
import { flights, net, STALE } from '@ogygia/machine';
import { orama_engine, type SearchIndex } from './search.ts';
import { OgygiaError } from '../messages/runtime.ts';

/** The index, by the url it is built from: one download shared by the queries waiting on it. A
 *  failed one is not kept, so the next query downloads it again. */
const indexes = flights({
	name: 'content search worker index',
	run: async (url: string): Promise<SearchIndex> => {
		const res = await net.fetch(url);
		if (!res.ok) {
			throw new OgygiaError('content_search_index_fetch_failed', { url, status: res.status });
		}
		const docs = await res.json();
		const engine = orama_engine();
		await engine.init?.();
		return engine.build(docs);
	}
});
/** The url the last `load` named: the index queries are answered from. */
let index_url: string | null = null;

/** The index of `index_url` (a newer `load` dropped the one this waited on: then that one's). */
async function index_now(url: string): Promise<SearchIndex> {
	const index = await indexes.get(url);
	return index === STALE ? index_now(index_url ?? url) : index;
}

self.onmessage = async (e: MessageEvent) => {
	const msg = e.data as {
		type: string;
		url?: string;
		id?: number;
		q?: string;
		base?: string;
		limit?: number;
	};

	if (msg.type === 'load' && msg.url) {
		// a new index: the one before (and its download, if still out) goes
		indexes.drop(() => true);
		index_url = msg.url;
		try {
			await index_now(msg.url);
			(self as unknown as Worker).postMessage({ type: 'ready' });
		} catch (err) {
			(self as unknown as Worker).postMessage({
				type: 'error',
				message: err instanceof Error ? err.message : String(err)
			});
		}
		return;
	}

	if (msg.type === 'query' && index_url) {
		try {
			const index = await index_now(index_url);
			const hits = await index.query(msg.q ?? '', { limit: msg.limit ?? 10, base: msg.base ?? '' });
			(self as unknown as Worker).postMessage({ type: 'result', id: msg.id, hits });
		} catch (err) {
			// answered with the query's id: an error without one reached no query (it waited forever)
			(self as unknown as Worker).postMessage({
				type: 'error',
				id: msg.id,
				message: err instanceof Error ? err.message : String(err)
			});
		}
	}
};
