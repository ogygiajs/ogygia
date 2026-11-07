// A collection's lifecycle, as a live content source drives it: the first read, live changes (one of
// them an entry that fails its schema), a dropped connection opened again, the site's outline and
// search following the changes, a dimension whose outline fails once, and the on-device search
// client over a stand-in worker (the browser's Worker is the client's only browser need).
import { bench } from '@bench/heisenbench/bench';
import * as v from 'valibot';
// (the modules themselves, not the package's index or the site layer: those reach its Svelte
// components, which a bench in plain node does not compile)
import { content } from '../src/factory.ts';
import type { Source, SourceEntry } from '../src/source.ts';
import { outline } from '../src/site/outline.ts';
import { create_search, orama_engine } from '../src/site/search.ts';
import { dimensions } from '../src/site/dimensions.ts';
import { SearchClient } from '../src/site/search-client.ts';
import { CONTENT_ERRORS } from '../src/messages/runtime.ts';

type Meta = { headings: never[] };
const schema = v.object({ title: v.string() });
const tick = () => new Promise((r) => setTimeout(r, 0));

const doc = (i: number, title: unknown = `Page ${i}`): SourceEntry<Meta> =>
	({
		id: `guide/p${i}`,
		filePath: `content/docs/00-guide/${String(i).padStart(2, '0')}-p${i}/+doc.svx`,
		order: [0, i],
		data: { title },
		meta: { headings: [] },
		source: async () => `# Page ${i}\n\nThe text of page ${i}, with islands.`
	}) as unknown as SourceEntry<Meta>;

/** A live source over `rows`: `emit(change)` announces a change; `drop()` drops the connection. */
function live_source(rows: SourceEntry<Meta>[]) {
	let wake: ((change: unknown) => void) | null = null;
	let fail: ((e: Error) => void) | null = null;
	const source: Source<Meta> = {
		get: async (id) => rows.find((r) => r.id === id) ?? null,
		refs: async () => rows.slice(),
		async *live() {
			while (true) {
				yield await new Promise<unknown>((resolve, reject) => {
					wake = resolve;
					fail = reject;
				});
			}
		}
	};
	return {
		source,
		emit: (change: unknown) => wake?.(change),
		drop: () => fail?.(new Error('connection dropped'))
	};
}

bench(
	'content: a live collection, its outline and search following n changes',
	async ({ n }) => {
		const rows = Array.from({ length: 20 }, (_, i) => doc(i));
		const src = live_source(rows);
		const c = content({ schema, loader: src.source });
		const ol = outline(c as never);
		const search = create_search(ol, orama_engine());
		let found = (await search('islands')).length;
		const error = console.error;
		console.error = () => {};
		try {
			for (let i = 0; i < n; i++) {
				const id = 20 + i;
				rows.push(doc(id, i % 5 === 0 ? 5 : `Page ${id}`)); // one in five fails its schema
				src.emit(i % 2 === 0 ? [`guide/p${id}`] : 1); // by id, or "something changed"
				await tick();
				await tick();
				found += (await ol.tree()).length + (await search('islands')).length;
			}
			src.drop(); // the connection drops: opened again after its wait, the source read again
			await new Promise((r) => setTimeout(r, 1100));
			rows.push(doc(999));
			src.emit(['guide/p999']);
			await tick();
			await tick();
			found += (await c.refs()).length;
		} finally {
			console.error = error;
		}
		found += CONTENT_ERRORS.content_live_change_failed.text().length;
		found += CONTENT_ERRORS.content_live_change_failed.details().length;
		return found;
	},
	{ setup: () => ({ n: 12 }), scale: (_ctx, k) => ({ n: 12 * k }) }
);

bench(
	'content: a dimension whose outline fails once, then builds',
	async ({ n }) => {
		let pages = 0;
		for (let i = 0; i < n; i++) {
			let fails = 1;
			const d = dimensions({
				axes: {
					locale: { values: ['en', 'fr'], default: 'en', fallback: true, label: 'Language' }
				},
				resolve: async ({ locale }) => {
					if (locale === 'fr' && fails-- > 0) throw new Error('source blip');
					return content({
						schema,
						loader: {
							get: async () => null,
							refs: async () => [doc(1, `A ${locale}`)]
						} as Source<Meta>
					});
				}
			});
			const search = create_search(d, orama_engine());
			await d.resolve('fr/guide/p1').catch(() => null);
			if (await d.resolve('fr/guide/p1')) pages++;
			pages += (await search('islands')).length;
		}
		return pages;
	},
	{ setup: () => ({ n: 6 }), scale: (_ctx, k) => ({ n: 6 * k }) }
);

/** The browser's Worker, stood in for: answers the client as the search worker does. */
class StandInWorker {
	onmessage: ((e: MessageEvent) => void) | null = null;
	onerror: ((e: ErrorEvent) => void) | null = null;
	#fail_load: boolean;
	constructor(_url: URL, _opts: unknown) {
		this.#fail_load = StandInWorker.fail_next;
		StandInWorker.fail_next = false;
	}
	static fail_next = false;
	postMessage(m: { type: string; id?: number; q?: string }) {
		queueMicrotask(() => {
			if (m.type === 'load')
				this.onmessage?.({
					data: this.#fail_load ? { type: 'error', message: 'index 404' } : { type: 'ready' }
				} as MessageEvent);
			else if (m.q === 'broken')
				this.onmessage?.({
					data: { type: 'error', id: m.id, message: 'query failed' }
				} as MessageEvent);
			else this.onmessage?.({ data: { type: 'result', id: m.id, hits: [] } } as MessageEvent);
		});
	}
	terminate() {}
}

bench(
	'content: the search client answers or rejects every query (ready, failed, crashed, destroyed)',
	async ({ n }) => {
		const g = globalThis as { Worker?: unknown };
		const had = g.Worker;
		g.Worker = StandInWorker;
		let settled = 0;
		try {
			for (let i = 0; i < n; i++) {
				StandInWorker.fail_next = i % 4 === 1;
				const s = new SearchClient({ base: '/docs' });
				await s.ready.catch(() => {});
				const qs = [s.query('install'), s.query('broken'), s.query('islands')];
				if (i % 4 === 2) (s as unknown as { destroy(): void }).destroy();
				for (const q of qs)
					await q.then(
						() => settled++,
						() => settled++
					);
				await s.query('after').then(
					() => settled++,
					() => settled++
				);
				s.destroy();
			}
		} finally {
			g.Worker = had;
		}
		return settled;
	},
	{ setup: () => ({ n: 20 }), scale: (_ctx, k) => ({ n: 20 * k }) }
);
