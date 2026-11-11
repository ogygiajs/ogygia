import { machine, STALE } from '@ogygia/machine';
import type { SearchHit } from './search.ts';

const TRAILING_SLASHES_RE = /\/+$/;

export type SearchClientOptions = {
	/** Mount prefix — hit hrefs AND the index location derive from it (default `''`, root mount). */
	base?: string;
	/** Where the index is mounted. Convention: `{base}/search.json`. Override only if you mounted
	 *  `site.emit.search()` somewhere else. */
	endpoint?: string;
	/** Result cap (default 10). */
	limit?: number;
};

const lifecycle = machine<{
	loading: {};
	ready: {};
	failed: { error: Error };
	destroyed: {};
}>()({
	name: 'search client',
	initial: 'loading',
	steps: {
		loading: ['ready', 'failed', 'destroyed'],
		ready: ['failed', 'destroyed'],
		failed: ['destroyed'],
		destroyed: []
	}
});

type Waiting = { resolve: (hits: SearchHit[]) => void; reject: (error: Error) => void };

/**
 * On-device search: a Web Worker over the prerendered `search.json` (`site.emit.search()`), fetched
 * and indexed once, so a query costs no network. `const s = new SearchClient({ base: '/docs' })`,
 * then `s.query(q)`. The `<Search>` brick uses it (inside a `<Shell>` with no arguments). Browser
 * only: it starts a `Worker`. A dynamic site whose corpus stays on the server uses
 * `remotes(site).search` instead.
 *
 * Every query is answered or rejected: a failed query, a failed load, a worker crash and
 * `destroy()` each reject what waits (#207).
 */
export class SearchClient {
	/** Resolves once the index is fetched + built (rejects on load failure, a crash, or `destroy()`). */
	readonly ready: Promise<void>;
	#base: string;
	#limit: number;
	#worker: Worker;
	#seq = 0;
	#pending = new Map<number, Waiting>();
	#state = lifecycle.create();

	constructor(opts: SearchClientOptions = {}) {
		const base = (this.#base = (opts.base ?? '').replace(TRAILING_SLASHES_RE, ''));
		this.#limit = opts.limit ?? 10;
		const url = opts.endpoint ?? `${base}/search.json`;
		const worker = (this.#worker = new Worker(new URL('./search-worker.js', import.meta.url), {
			type: 'module'
		}));

		this.ready = this.#state.wait('ready').then((s) => {
			if (s === STALE) throw this.#error();
		});
		this.ready.catch(() => {}); // ok: the same failure rejects every query, which the palette shows

		worker.onmessage = (e: MessageEvent) => {
			const m = e.data as { type: string; id?: number; hits?: SearchHit[]; message?: string };
			if (m.type === 'result' && m.id !== undefined) this.#settle(m.id)?.resolve(m.hits ?? []);
			else if (m.type === 'ready') this.#state.move('loading', 'ready');
			else if (m.type === 'error' && m.id !== undefined)
				this.#settle(m.id)?.reject(new Error(m.message ?? 'search query failed'));
			else if (m.type === 'error')
				this.#fail(new Error(m.message ?? 'search index failed to load'));
		};
		// @why a worker that fails to start sends no message: only onerror can reject what waits (test: test/search-client.test.ts › the worker crashes: waiting queries and later ones are rejected)
		worker.onerror = (e: ErrorEvent) => {
			this.#fail(new Error(e.message || `search worker failed to start (${url})`));
		};
		worker.postMessage({ type: 'load', url });
	}

	/** Ranked hits for a query (empty string → []). */
	query(q: string): Promise<SearchHit[]> {
		if (!q.trim()) return Promise.resolve([]);
		const s = this.#state.now;
		if (s.kind === 'failed' || s.kind === 'destroyed') return Promise.reject(this.#error());
		const id = ++this.#seq;
		return new Promise<SearchHit[]>((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			this.#worker.postMessage({ type: 'query', id, q, base: this.#base, limit: this.#limit });
		});
	}

	/** Terminate the worker: waiting queries, and later ones, are rejected. */
	destroy(): void {
		if (this.#state.now.kind === 'destroyed') return;
		this.#state.go('destroyed');
		this.#worker.terminate();
		this.#reject_all();
	}

	/** Why queries are refused now. */
	#error(): Error {
		const s = this.#state.now;
		return s.kind === 'failed' ? s.error : new Error('search client destroyed');
	}

	/** The index failed to load, or the worker crashed: everything waiting is rejected with why. */
	#fail(error: Error): void {
		const s = this.#state.now;
		if (s.kind !== 'loading' && s.kind !== 'ready') return;
		this.#state.go('failed', { error });
		this.#reject_all();
	}

	#reject_all(): void {
		const error = this.#error();
		for (const waiting of this.#pending.values()) waiting.reject(error);
		this.#pending.clear();
	}

	#settle(id: number): Waiting | undefined {
		const waiting = this.#pending.get(id);
		this.#pending.delete(id);
		return waiting;
	}
}
