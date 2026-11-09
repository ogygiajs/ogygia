/**
 * Search worker — builds the Orama index off the main thread and answers queries. Instantiated by
 * the `<Search>` brick via `new Worker(new URL('./search-worker.js', import.meta.url))`. Ingests the
 * prerendered `search.json` documents; the heavy engine (optional peer) is lazy-loaded inside.
 *
 * Messages in:  { type: 'load', url } | { type: 'query', id, q, base, limit }
 * Messages out: { type: 'ready' } | { type: 'error', message } (the index failed to load)
 *             | { type: 'result', id, hits } | { type: 'error', id, message } (that query failed)
 */
import { orama_engine, type SearchIndex } from './search.ts';
import { OgygiaError } from '../messages/runtime.ts';

let index_p: Promise<SearchIndex> | null = null;

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
		index_p = (async () => {
			const res = await fetch(msg.url!);
			if (!res.ok) {
				throw new OgygiaError('content_search_index_fetch_failed', {
					url: msg.url!,
					status: res.status
				});
			}
			const docs = await res.json();
			const engine = orama_engine();
			await engine.init?.();
			return engine.build(docs);
		})();
		try {
			await index_p;
			(self as unknown as Worker).postMessage({ type: 'ready' });
		} catch (err) {
			(self as unknown as Worker).postMessage({
				type: 'error',
				message: err instanceof Error ? err.message : String(err)
			});
		}
		return;
	}

	if (msg.type === 'query' && index_p) {
		try {
			const index = await index_p;
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
