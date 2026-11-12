// A collection's lifecycle, as a live content source drives it: the first read, live changes (one of
// them an entry that fails its schema), a dropped connection opened again, the site's outline and
// search following the changes, a dimension whose outline fails once, and the on-device search
// client over a stand-in worker (the browser's Worker is the client's only browser need).
import { bench } from '@bench/heisenbench/bench';
import * as v from 'valibot';
// (the site layer reaches the package's own Svelte components, written for experimental.async:
// Heisenbench compiles them with the package's svelte.config.js)
import { content, folder, json, type Source, type SourceEntry } from '../src/index.ts';
import { defineRun } from '@ogygia/machine';
import { site } from '../src/site/site.ts';
import { dimensions } from '../src/site/dimensions.ts';
import { create_search, type SearchEngine } from '../src/site/search.ts';
import { outline, pick } from '../src/site/outline.ts';

/** Every content collection registers in one process-wide graph (relations, backlinks), and a
 *  graph read walks all of them: each run starts from an empty graph, or a run would walk the
 *  collections every earlier run made and count more than the one before. */
function fresh<T>(ctx: T): T {
	const graph = (globalThis as Record<symbol, { all?: Set<unknown> } | undefined>)[
		Symbol.for('ogygia.content.graph')
	];
	graph?.all?.clear();
	return ctx;
}

/** A search engine in the bench itself: the site's default (Orama) loads lazily on the first query,
 *  and a module load is file IO, which a measuring window refuses. What is measured is the search
 *  brain around the engine: when it builds the index again (the content changed) and that it never
 *  keeps a failed build. */
const in_memory: SearchEngine = {
	async build(docs) {
		return {
			async query(q, { limit }) {
				return docs
					.filter((d) => d.text.includes(q) || d.title.includes(q))
					.slice(0, limit)
					.map((d) => ({ id: d.id, href: d.id, title: d.title, excerpt: '', score: 1 })) as never;
			}
		};
	}
};
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
		const s = site({ outline: c });
		const search = create_search(s.outline, in_memory);
		let found = (await search('islands')).length;
		const error = console.error;
		console.error = () => {};
		try {
			for (let i = 0; i < n; i++) {
				const id = 20 + i;
				rows.push(doc(id, i % 5 === 0 ? 5 : `Page ${id}`)); // one in five fails its schema
				// an editor saves a bad field on a page already there: it keeps its last good version
				if (i % 4 === 3) rows[1] = doc(1, 7);
				src.emit(i % 2 === 0 ? [`guide/p${id}`] : 1); // by id, or "something changed"
				await tick();
				await tick();
				found += (await s.nav()).length + (await search('islands')).length;
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
	{ setup: () => fresh({ n: 12 }), scale: (_ctx, k) => fresh({ n: 12 * k }) }
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
			const s = site({ outline: d });
			await s.page('fr/guide/p1').catch(() => null);
			if (await s.page('fr/guide/p1')) pages++;
			pages += (await create_search(s.outline, in_memory)('islands')).length;
		}
		return pages;
	},
	{ setup: () => fresh({ n: 6 }), scale: (_ctx, k) => fresh({ n: 6 * k }) }
);

bench(
	'content: an outline and a search index that fail once are never kept',
	async ({ n }) => {
		let found = 0;
		for (let i = 0; i < n; i++) {
			let refs_fail = 1;
			let build_fail = 1;
			const c = content({
				schema,
				loader: {
					get: async () => null,
					refs: async () => {
						if (refs_fail-- > 0) throw new Error('source down');
						return [doc(1), doc(2)];
					}
				} as Source<Meta>
			});
			const s = site({ outline: c });
			await s.nav().catch(() => null); // the source is down: the outline fails
			found += (await s.nav()).length; // and the next read builds it
			const failing: SearchEngine = {
				async build(docs) {
					if (build_fail-- > 0) throw new Error('index build failed');
					return in_memory.build(docs);
				}
			};
			const search = create_search(s.outline, failing);
			await search('Page').catch(() => null); // the index build fails
			found += (await search('Page')).length; // and the next query builds it again
		}
		return found;
	},
	{ setup: () => fresh({ n: 6 }), scale: (_ctx, k) => fresh({ n: 6 * k }) }
);

bench(
	'content: live edits that break a hand-placed outline keep the last good one, then the fix weaves',
	async ({ n }) => {
		let found = 0;
		const error = console.error;
		console.error = () => {};
		try {
			for (let i = 0; i < n; i++) {
				const rows = [doc(1), doc(2)];
				const src = live_source(rows);
				const c = content({ schema, loader: src.source });
				// picks and no remainder: an entry it places nowhere breaks the weave
				const s = site({
					outline: outline([
						{ label: 'One', items: pick(c, 'guide/p1') },
						{ label: 'Two', items: pick(c, 'guide/p2') }
					])
				});
				found += (await s.nav()).length;
				rows.push(doc(3)); // an editor adds a page the outline does not place
				src.emit(['guide/p3']);
				await tick();
				await tick();
				found += (await s.nav()).length + (await s.nav()).length; // the last good one, twice
				rows.pop(); // the editor takes it out again
				src.emit(1);
				await tick();
				await tick();
				found += (await s.nav()).length;
			}
		} finally {
			console.error = error;
		}
		const said = CONTENT_ERRORS.content_outline_weave_failed;
		return found + said.text().length + said.details().length;
	},
	{ setup: () => fresh({ n: 6 }), scale: (_ctx, k) => fresh({ n: 6 * k }) }
);

bench(
	'content: a folder whose section sidecar fails to load once, read again',
	async ({ n }) => {
		let found = 0;
		for (let i = 0; i < n; i++) {
			let fails = 1;
			const map: Record<string, unknown> = {
				'content/docs/00-guide/+meta.json': async () => {
					if (fails-- > 0) throw new Error('sidecar failed to load');
					return { default: { label: 'The guide' } };
				}
			};
			for (let p = 0; p < 8; p++) {
				map[`content/docs/00-guide/0${p}-page-${p}/+doc.svx`] = async () => ({ title: `P${p}` });
				map[`content/docs/01-api/0${p}-ref-${p}/+doc.svx`] = async () => ({ title: `R${p}` });
			}
			const c = content({ schema, loader: folder(map, { format: json }) });
			await c.refs().catch(() => null); // the sidecar fails: the start fails
			found += (await c.refs()).length; // and the next read loads it
			found += (await c.groups()).size;
		}
		return found;
	},
	{ setup: () => fresh({ n: 6 }), scale: (_ctx, k) => fresh({ n: 6 * k }) }
);

bench(
	'content: edits in dev, each run of a module replacing the live collections the run before built',
	async ({ n }) => {
		let found = 0;
		const kept: ReturnType<typeof content>[] = [];
		for (let run = 0; run < n; run++) {
			// what core's dev transform puts at the top of each run of a module that calls content()
			const marked = defineRun('/app/src/lib/docs.server.ts');
			const rows = Array.from({ length: 10 }, (_, i) => doc(i));
			const src = live_source(rows);
			const c = marked(content)({ schema, loader: src.source });
			// a second collection the same run builds: it replaces nothing
			const other = marked(content)({ schema, loader: live_source(rows.slice(0, 3)).source });
			if (run % 3 === 0) kept.push(c); // one the module keeps on a global, read later
			found += (await c.refs()).length + (await other.refs()).length;
			src.emit(['guide/p1']);
			await tick();
		}
		// read again, a kept one comes back and follows again
		for (const c of kept) found += (await c.refs()).length;
		return found;
	},
	{ setup: () => fresh({ n: 12 }), scale: (_ctx, k) => fresh({ n: 12 * k }) }
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
