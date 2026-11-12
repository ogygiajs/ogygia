// A throwaway app on disk under a real Vite dev server with the content HMR plugin, for the dev edit
// tests (#247): collections with live sources in server modules, importing `@ogygia/content` as an
// app does. Shared by dev-reload.test.ts (under Node) and _dev-app.bun.ts (the same app under Bun).
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type RunnableDevEnvironment, type ViteDevServer } from 'vite';
import { edit } from '../../compiler/test/_dev-edit.ts';
import { definers_plugin } from '../../compiler/src/vite/definers.ts';
import { content_hmr } from '../src/vite/hmr.ts';

const own = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/** What the fixture's live sources count, by source name, on a global the tests read. */
export type Live = {
	open: Record<string, number>;
	opened: Record<string, number>;
	reads: Record<string, number>;
	emit: Record<string, () => void>;
};
export const live = (): Live =>
	((globalThis as Record<string, unknown>).__og_dev_reload_live ??= {
		open: {},
		opened: {},
		reads: {},
		emit: {}
	}) as Live;
export const graph = (): { all: Set<unknown> } =>
	((globalThis as Record<symbol, unknown>)[Symbol.for('ogygia.content.graph')] as
		| { all: Set<unknown> }
		| undefined) ?? { all: new Set() };

/** A live source (a CMS feed: its `return()` unsubscribes at once) that counts its connections and
 *  reads. `emit(name)` announces a change on its open connections. */
export const live_module = `
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

/** The docs collections: the pages a glob reads (so a page edit runs this module again), and a
 *  live list of their texts (a remote a page streams). `extra` adds a collection the module keeps
 *  across its runs on a global, as apps do in dev; `before` runs before the collection is built. */
export const docs_module = (extra = '', before = '') => `
import { content } from '@ogygia/content';
import { withRemotes } from '@ogygia/content/server';
import { live_source } from './live.ts';
const pages = import.meta.glob('../content/*.md', { eager: true, query: '?raw', import: 'default' });
const rows = () => Object.entries(pages).map(([id, text]) => ({ id, data: { text } }));
${before}
export const docs = content({ loader: live_source('docs', rows) });
export const feed = withRemotes(docs).live.list({ map: (e) => e.data.text });
${extra}
`;

/** A module of the same name elsewhere, with a collection of the same name over other pages. */
export const other_docs_module = `
import * as c from '@ogygia/content';
import { live_source } from '../../lib/live.ts';
const pages = import.meta.glob('../../blog/*.md', { eager: true, query: '?raw', import: 'default' });
const rows = () => Object.entries(pages).map(([id, text]) => ({ id, data: { text } }));
export const docs = c.content({ loader: live_source('blog', rows) });
`;

/** A run of the docs module that waits at a gate (a top-level await) before it builds. */
export const GATED = `globalThis.__og_dev_reload_gate.at();
await globalThis.__og_dev_reload_gate.open;`;
export type Gate = {
	at: () => void;
	open: Promise<void>;
	reached: Promise<void>;
	release: () => void;
};
export function gate(): Gate {
	const g = {} as Gate;
	g.reached = new Promise((r) => (g.at = r));
	g.open = new Promise((r) => (g.release = r));
	(globalThis as Record<string, unknown>).__og_dev_reload_gate = g;
	return g;
}

/** A collection in a module no page edit touches. */
export const people_module = `
import { content } from '@ogygia/content';
import { live_source } from './live.ts';
export const people = content({ loader: live_source('people', () => [{ id: 'ada', data: {} }]) });
`;

export const KEPT = `export const kept = (globalThis.__og_dev_reload_kept ??= content({
	loader: live_source('kept', rows)
}));`;

type Handle = { refs(): Promise<Array<{ id: string; data: { text?: string } }>> };
export const texts = async (h: unknown): Promise<Array<string | undefined>> =>
	(await (h as Handle).refs()).map((e) => e.data.text);

export type Load = (srv: ViteDevServer, url: string) => Promise<Record<string, unknown>>;
/** How the app's server loads a module in dev: Kit 2 through `ssrLoadModule`, Kit 3 through the
 *  ssr environment's own module runner. */
export const LOADERS: Array<[string, Load]> = [
	['ssrLoadModule', (srv, url) => srv.ssrLoadModule(url)],
	[
		"the ssr environment's runner",
		(srv, url) => (srv.environments.ssr as RunnableDevEnvironment).runner.import(url)
	]
];

export class DevApp {
	readonly root: string;
	server: ViteDevServer | null = null;

	/** `folder`: the app folder's name (a prefix: a few random characters follow it). */
	constructor(folder = 'og-content-dev-') {
		this.root = realpathSync(mkdtempSync(path.join(tmpdir(), folder)));
		this.write('package.json', JSON.stringify({ name: 'app', type: 'module' }));
		this.write('src/content/a.md', '# A');
		this.write('src/lib/live.ts', live_module);
		Object.assign(live(), { open: {}, opened: {}, reads: {}, emit: {} });
		delete (globalThis as Record<string, unknown>).__og_dev_reload_kept;
	}

	write(rel: string, text: string): void {
		const abs = path.join(this.root, rel);
		mkdirSync(path.dirname(abs), { recursive: true });
		writeFileSync(abs, text);
	}

	/** An edit of `rel` once the dev server runs: done when its watcher reports it. */
	edit(rel: string, text: string): Promise<void> {
		return edit(this.server!.watcher, path.join(this.root, rel), text);
	}

	/** `debounce_ms`: how long the content plugin waits on a change before it reloads. */
	async start(debounce_ms = 0): Promise<ViteDevServer> {
		const server = await createServer({
			root: this.root,
			configFile: false,
			logLevel: 'silent',
			// (core's definer marking, as the content plugin asks for it: `b.definers()`)
			plugins: [
				content_hmr({ hmrDebounceMs: debounce_ms }),
				definers_plugin(() => [{ module: '@ogygia/content', names: ['content'] }])
			],
			// the package as an app imports it (its collection factory, its server remotes), and
			// Kit's `$app/server` as core's tests stand it in
			resolve: {
				alias: [
					{ find: /^@ogygia\/content$/, replacement: own('../src/factory.ts') },
					{ find: /^@ogygia\/content\/server$/, replacement: own('../src/server.ts') },
					{ find: /^\$app\/server$/, replacement: own('../../core/test/_stubs/app-server.ts') }
				]
			},
			server: { middlewareMode: true, hmr: false }
		});
		this.server = server;
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
	async reloaded(
		load: Load,
		url: string,
		before: Record<string, unknown>
	): Promise<Record<string, unknown>> {
		const until = Date.now() + 10_000;
		while (Date.now() < until) {
			const mod = await load(this.server!, url);
			if (mod !== before) return mod;
			await new Promise((r) => setTimeout(r, 25));
		}
		throw new Error(`the edit never ran ${url} again`);
	}

	async close(): Promise<void> {
		await this.server?.close();
		this.server = null;
		rmSync(this.root, { recursive: true, force: true });
	}
}

/** Two page edits under `load`: how many connections the docs source opened, how many are open,
 *  and how many collections the graph gained. */
export async function two_page_edits(
	load: Load,
	folder?: string
): Promise<{ texts: unknown[]; opened: number; open: number; in_graph: number }> {
	const app = new DevApp(folder);
	const before = graph().all.size;
	try {
		app.write('src/lib/docs.server.ts', docs_module());
		const srv = await app.start();
		let mod = await load(srv, '/src/lib/docs.server.ts');
		const seen: unknown[] = [await texts(mod.docs)];
		for (const text of ['# A, edited', '# A, edited again']) {
			await app.edit('src/content/a.md', text);
			mod = await app.reloaded(load, '/src/lib/docs.server.ts', mod);
			seen.push(await texts(mod.docs));
		}
		return {
			texts: seen,
			opened: live().opened.docs ?? 0,
			open: live().open.docs ?? 0,
			in_graph: graph().all.size - before
		};
	} finally {
		await app.close();
	}
}
