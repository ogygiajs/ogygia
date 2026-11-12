import { flights, net, STALE } from '@ogygia/machine';
import { orama_engine, type SearchHit, type SearchIndex } from './search.ts';
import { OgygiaError } from '../messages/runtime.ts';

/** What `SearchClient` sends its worker: build the index from the prerendered `search.json` at
 *  `url`, or answer a query against the index of the last `load`. */
export type SearchWorkerIn =
	| { type: 'load'; url: string }
	| { type: 'query'; id: number; q?: string; base?: string; limit?: number };

/** What the worker answers: an `error` with an `id` answers that query; one without answers the
 *  `load`. */
export type SearchWorkerOut =
	| { type: 'ready' }
	| { type: 'result'; id: number; hits: SearchHit[] }
	| { type: 'error'; id?: number; message: string };

type Port = { postMessage(m: SearchWorkerOut): void };

// @why a failed index download is not kept (test: test/search-client.test.ts › the index failed to download once: the next query downloads it again and is answered)
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
let index_url: string | null = null;

async function index_now(url: string): Promise<SearchIndex> {
	const index = await indexes.get(url);
	// @why a query whose index a newer load dropped is answered from the new one (test: test/search-client.test.ts › a newer load replaces the index a waiting query was going to read: it is answered from the new one)
	return index === STALE ? index_now(index_url ?? url) : index;
}

self.onmessage = async (e: MessageEvent) => {
	const msg = e.data as SearchWorkerIn;

	if (msg.type === 'load' && msg.url) {
		// @why a new load drops the index before it, and its download if still out (test: test/search-client.test.ts › a newer load replaces the index a waiting query was going to read: it is answered from the new one)
		indexes.drop(() => true);
		index_url = msg.url;
		try {
			await index_now(msg.url);
			(self as unknown as Port).postMessage({ type: 'ready' });
		} catch (err) {
			(self as unknown as Port).postMessage({
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
			(self as unknown as Port).postMessage({ type: 'result', id: msg.id, hits });
		} catch (err) {
			// @why a failed query is answered with its id, or it waits forever (test: test/search-client.test.ts › the index failed to build: a query is answered `error` with ITS id)
			(self as unknown as Port).postMessage({
				type: 'error',
				id: msg.id,
				message: err instanceof Error ? err.message : String(err)
			});
		}
	}
};
