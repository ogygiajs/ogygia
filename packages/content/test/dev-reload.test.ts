// Edits in dev (#247): a real Vite dev server with the content HMR plugin, and collections with live
// sources in server modules. An edit runs a collections module again, which builds new collections:
// the ones they replace must close their live connections and leave the graph, and a collection
// the edit did not replace must keep going.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type RunnableDevEnvironment, type ViteDevServer } from 'vite';
import { content_hmr } from '../src/vite/hmr.ts';

const FACTORY = fileURLToPath(new URL('../src/factory.ts', import.meta.url));

/** What the fixture's live sources count, by source name, on a global this test reads. */
type Live = {
	open: Record<string, number>;
	opened: Record<string, number>;
	reads: Record<string, number>;
	emit: Record<string, () => void>;
};
const live = (): Live =>
	((globalThis as Record<string, unknown>).__og_dev_reload_live ??= {
		open: {},
		opened: {},
		reads: {},
		emit: {}
	}) as Live;
const graph = () =>
	((globalThis as Record<symbol, unknown>)[Symbol.for('ogygia.content.graph')] as
		| { all: Set<unknown> }
		| undefined) ?? { all: new Set() };

/** A live source (a CMS feed: its `return()` unsubscribes at once) that counts its connections and
 *  reads. `emit(name)` announces a change on its open connections. */
const live_module = `
const live = globalThis.__og_dev_reload_live;
export function live_source(name, rows) {
	const pulls = new Set();
	live.emit[name] = () => {
		for (const pull of [...pulls]) pull({ done: false, value: 1 });
		pulls.clear();
	};
	return {
		async refs() {
			live.reads[name] = (live.reads[name] ?? 0) + 1;
			return rows();
		},
		async get(id) {
			return rows().find((r) => r.id === id) ?? null;
		},
		live() {
			return {
				[Symbol.asyncIterator]() {
					live.open[name] = (live.open[name] ?? 0) + 1;
					live.opened[name] = (live.opened[name] ?? 0) + 1;
					let closed = false;
					return {
						next: () => new Promise((pull) => pulls.add(pull)),
						async return() {
							if (!closed) live.open[name]--;
							closed = true;
							return { done: true, value: undefined };
						}
					};
				}
			};
		}
	};
}
`;

/** The docs collections: the pages a glob reads (so a page edit runs this module again). `extra`
 *  adds a collection the module keeps across its runs on a global, as apps do in dev; `before` runs
 *  before the collection is built. */
const docs_module = (extra = '', before = '') => `
import { content } from ${JSON.stringify(FACTORY)};
import { live_source } from './live.ts';
const pages = import.meta.glob('../content/*.md', { eager: true, query: '?raw', import: 'default' });
const rows = () => Object.entries(pages).map(([id, text]) => ({ id, data: { text } }));
${before}
export const docs = content({ loader: live_source('docs', rows) });
${extra}
`;

/** A run of the docs module that waits at a gate (a top-level await) before it builds. */
const GATED = `globalThis.__og_dev_reload_gate.at();
await globalThis.__og_dev_reload_gate.open;`;
type Gate = { at: () => void; open: Promise<void>; reached: Promise<void>; release: () => void };
function gate(): Gate {
	const g = {} as Gate;
	g.reached = new Promise((r) => (g.at = r));
	g.open = new Promise((r) => (g.release = r));
	(globalThis as Record<string, unknown>).__og_dev_reload_gate = g;
	return g;
}

/** A collection in a module no page edit touches. */
const people_module = `
import { content } from ${JSON.stringify(FACTORY)};
import { live_source } from './live.ts';
export const people = content({ loader: live_source('people', () => [{ id: 'ada', data: {} }]) });
`;

const KEPT = `export const kept = (globalThis.__og_dev_reload_kept ??= content({
	loader: live_source('kept', rows)
}));`;

type Handle = { refs(): Promise<Array<{ id: string; data: { text?: string } }>> };
const texts = async (h: unknown) => (await (h as Handle).refs()).map((e) => e.data.text);

let root = '';
let server: ViteDevServer | null = null;
let in_graph = 0;

beforeEach(async () => {
	root = realpathSync(mkdtempSync(path.join(tmpdir(), 'og-content-dev-')));
	write('package.json', JSON.stringify({ name: 'app', type: 'module' }));
	write('src/content/a.md', '# A');
	write('src/lib/live.ts', live_module);
	Object.assign(live(), { open: {}, opened: {}, reads: {}, emit: {} });
	delete (globalThis as Record<string, unknown>).__og_dev_reload_kept;
	in_graph = graph().all.size;
});
afterEach(async () => {
	await server?.close();
	server = null;
	rmSync(root, { recursive: true, force: true });
});

function write(rel: string, text: string) {
	const abs = path.join(root, rel);
	mkdirSync(path.dirname(abs), { recursive: true });
	writeFileSync(abs, text);
}

async function start() {
	server = await createServer({
		root,
		configFile: false,
		logLevel: 'silent',
		plugins: [content_hmr({ hmrDebounceMs: 0 })],
		server: { middlewareMode: true, hmr: false }
	});
	// macOS reports the fixture's own writes a moment after the watcher starts: let them pass, or
	// they would run a module again that no edit touched
	let last = Date.now();
	const seen = () => (last = Date.now());
	server.watcher.on('all', seen);
	while (Date.now() - last < 300) await new Promise((r) => setTimeout(r, 50));
	server.watcher.off('all', seen);
	return server;
}

/** `url` as the next request loads it, once an edit has run it again. */
async function reloaded(
	srv: ViteDevServer,
	url: string,
	before: Record<string, unknown>
): Promise<Record<string, unknown>> {
	const until = Date.now() + 10_000;
	while (Date.now() < until) {
		const mod = await load(srv, url);
		if (mod !== before) return mod;
		await new Promise((r) => setTimeout(r, 25));
	}
	throw new Error(`the edit never ran ${url} again`);
}

const tick = () => new Promise((r) => setTimeout(r, 0));

type Load = (srv: ViteDevServer, url: string) => Promise<Record<string, unknown>>;
/** How the app's server loads a module in dev: Kit 2 through `ssrLoadModule`, Kit 3 through the
 *  ssr environment's own module runner. */
const LOADERS: Array<[string, Load]> = [
	['ssrLoadModule', (srv, url) => srv.ssrLoadModule(url)],
	[
		"the ssr environment's runner",
		(srv, url) => (srv.environments.ssr as RunnableDevEnvironment).runner.import(url)
	]
];
let load: Load = LOADERS[0][1];

describe.each(LOADERS)(
	'edits in dev (#247), modules loaded by %s',
	{ timeout: 30_000 },
	(_, by) => {
		beforeEach(() => {
			load = by;
		});

		it('two page edits leave one live connection and one collection in the graph', async () => {
			write('src/lib/docs.server.ts', docs_module());
			const srv = await start();
			let mod = await load(srv, '/src/lib/docs.server.ts');
			expect(await texts(mod.docs)).toEqual(['# A']);
			expect(live().open.docs).toBe(1);

			for (const text of ['# A, edited', '# A, edited again']) {
				write('src/content/a.md', text);
				mod = await reloaded(srv, '/src/lib/docs.server.ts', mod);
				// a new collection was built: it reads the edit, over a connection of its own
				expect(await texts(mod.docs)).toEqual([text]);
			}

			expect(live().opened.docs).toBe(3); // one per run of the module
			expect(live().open.docs).toBe(1); // only the current collection still listens
			expect(graph().all.size - in_graph).toBe(1);
		});

		it('two edits of the collections module itself: the same', async () => {
			write('src/lib/docs.server.ts', docs_module());
			const srv = await start();
			let mod = await load(srv, '/src/lib/docs.server.ts');
			await texts(mod.docs);

			for (const n of [1, 2]) {
				write('src/lib/docs.server.ts', docs_module(`export const edit = ${n};`));
				mod = await reloaded(srv, '/src/lib/docs.server.ts', mod);
				expect(mod.edit).toBe(n);
				await texts(mod.docs);
			}

			expect(live().opened.docs).toBe(3);
			expect(live().open.docs).toBe(1);
			expect(graph().all.size - in_graph).toBe(1);
		});

		it('a collection in a module the edit did not run again keeps its connection and its place', async () => {
			write('src/lib/docs.server.ts', docs_module());
			write('src/lib/people.server.ts', people_module);
			const srv = await start();
			let mod = await load(srv, '/src/lib/docs.server.ts');
			const people = (await load(srv, '/src/lib/people.server.ts')).people;
			await Promise.all([texts(mod.docs), texts(people)]);

			write('src/content/a.md', '# A, edited');
			mod = await reloaded(srv, '/src/lib/docs.server.ts', mod);
			await texts(mod.docs);

			expect((await load(srv, '/src/lib/people.server.ts')).people).toBe(people);
			expect(live().opened.people).toBe(1);
			expect(live().open.people).toBe(1);
			const reads = live().reads.people;
			live().emit.people(); // and it still follows its source
			await tick();
			await tick();
			expect(live().reads.people).toBe(reads + 1);
			expect(graph().all.size - in_graph).toBe(2);
		});

		it('a collection the module keeps across its runs still answers and follows after an edit', async () => {
			write('src/lib/docs.server.ts', docs_module(KEPT));
			const srv = await start();
			let mod = await load(srv, '/src/lib/docs.server.ts');
			const kept = mod.kept;
			await Promise.all([texts(mod.docs), texts(kept)]);

			write('src/content/a.md', '# A, edited');
			mod = await reloaded(srv, '/src/lib/docs.server.ts', mod);
			expect(mod.kept).toBe(kept);
			await Promise.all([texts(mod.docs), texts(kept)]);

			expect(live().open.kept).toBe(1);
			const reads = live().reads.kept;
			live().emit.kept();
			await tick();
			await tick();
			expect(live().reads.kept).toBe(reads + 1);
			expect(live().open.docs).toBe(1);
			expect(graph().all.size - in_graph).toBe(2);
		});

		it('a module invalidated again while it runs: the run after it replaces what it built', async () => {
			// (an edit invalidates twice: the dev server's watcher, then the content HMR's flush. A
			// request between the two runs the module, and the flush lands while it runs.)
			const url = '/src/lib/docs.server.ts';
			write('src/lib/docs.server.ts', docs_module('', GATED));
			const srv = await start();
			const invalidate = () => {
				const node = srv.moduleGraph.getModuleById(path.join(root, 'src/lib/docs.server.ts'));
				srv.moduleGraph.invalidateModule(node!);
			};
			let g = gate();
			g.release();
			const first = await load(srv, url);
			await texts(first.docs);

			invalidate(); // the watcher
			g = gate();
			const running = load(srv, url); // a request runs the module: it waits at the gate
			await g.reached;
			invalidate(); // the flush, while it runs
			g.release();
			const second = await running;
			await texts(second.docs);
			const third = await reloaded(srv, url, second); // the next request runs it again
			await texts(third.docs);

			expect(live().opened.docs).toBe(3);
			expect(live().open.docs).toBe(1);
			expect(graph().all.size - in_graph).toBe(1);
		});
	}
);
