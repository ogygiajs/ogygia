/**
 * Client-side search — a Web Worker over the prerendered `search.json`, so queries run on-device and
 * instantaneously (no network per keystroke, no server index build). This is the fast path the
 * `<Search>` brick and bespoke chrome (a custom sidebar) both use; the `remotes(site).search` remote
 * is the OTHER path, for dynamic sites where the corpus must stay server-side.
 *
 * Browser-only (instantiates a `Worker`). Build once (fetch + index), then `query()` is a worker
 * round-trip — sub-millisecond for docs-scale corpora.
 */
import { machine, STALE } from '@ogygia/machine';
import type { SearchHit } from './search.ts';

// ── regexes
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

/**
 * The client's lifecycle: its index loading, ready, failed (the index did not load, or the worker
 * crashed) or destroyed. Every query is answered or rejected in each of them: a failed query, a
 * failed load, a crash or `destroy()` once left queries waiting forever (#207).
 */
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
 * The headless search handle for bespoke chrome — `const s = new SearchClient({ base: '/docs' })`,
 * then `s.query(q)`. One argument, convention-first. (The `<Search>` brick uses this internally;
 * inside a `<Shell>` it needs no arguments at all.)
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

		// ready settles when the machine gets there, or as soon as it never can
		this.ready = this.#state.wait('ready').then((s) => {
			if (s === STALE) throw this.#error();
		});
		// (a load failure reaches every query too: nobody has to listen to `ready`)
		this.ready.catch(() => {});

		worker.onmessage = (e: MessageEvent) => {
			const m = e.data as { type: string; id?: number; hits?: SearchHit[]; message?: string };
			if (m.type === 'result' && m.id !== undefined) this.#settle(m.id)?.resolve(m.hits ?? []);
			else if (m.type === 'ready') this.#state.move('loading', 'ready');
			else if (m.type === 'error' && m.id !== undefined)
				this.#settle(m.id)?.reject(new Error(m.message ?? 'search query failed'));
			else if (m.type === 'error')
				this.#fail(new Error(m.message ?? 'search index failed to load'));
		};
		// A worker-level crash (module failed to load/parse) never sends a message — surface it so the
		// palette shows *why* instead of hanging on "loading" forever.
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
		// (twice is once: a manual destroy, then the palette's unmount; `destroyed` steps nowhere)
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
