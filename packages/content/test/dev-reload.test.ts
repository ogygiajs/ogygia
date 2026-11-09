// Edits in dev (#247): a real Vite dev server with the content HMR plugin, and collections with live
// sources in server modules (the app in _dev-app.ts). An edit runs a collections module again, which
// builds new collections: the ones they replace must close their live connections and leave the
// graph, a live list open across the edit must not hang on them, and a collection the edit did not
// replace must keep going.
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	DevApp,
	GATED,
	KEPT,
	LOADERS,
	docs_module,
	gate,
	graph,
	live,
	other_docs_module,
	people_module,
	texts,
	two_page_edits,
	type Load
} from './_dev-app.ts';

let app: DevApp;
let in_graph = 0;
let load: Load = LOADERS[0][1];

beforeEach(() => {
	app = new DevApp();
	in_graph = graph().all.size;
});
afterEach(async () => {
	await app.close();
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const DOCS = '/src/lib/docs.server.ts';

describe.each(LOADERS)(
	'edits in dev (#247), modules loaded by %s',
	{ timeout: 30_000 },
	(_, by) => {
		beforeEach(() => {
			load = by;
		});

		it('two page edits leave one live connection and one collection in the graph', async () => {
			app.write('src/lib/docs.server.ts', docs_module());
			const srv = await app.start();
			let mod = await load(srv, DOCS);
			expect(await texts(mod.docs)).toEqual(['# A']);
			expect(live().open.docs).toBe(1);

			for (const text of ['# A, edited', '# A, edited again']) {
				await app.edit('src/content/a.md', text);
				mod = await app.reloaded(load, DOCS, mod);
				// a new collection was built: it reads the edit, over a connection of its own
				expect(await texts(mod.docs)).toEqual([text]);
			}

			expect(live().opened.docs).toBe(3); // one per run of the module
			expect(live().open.docs).toBe(1); // only the current collection still listens
			expect(graph().all.size - in_graph).toBe(1);
		});

		it('an app in a folder whose name has a space: the same', async () => {
			expect(await two_page_edits(load, 'og content dev ')).toEqual({
				texts: [['# A'], ['# A, edited'], ['# A, edited again']],
				opened: 3,
				open: 1,
				in_graph: 1
			});
		});

		it('two edits of the collections module itself: the same', async () => {
			app.write('src/lib/docs.server.ts', docs_module());
			const srv = await app.start();
			let mod = await load(srv, DOCS);
			await texts(mod.docs);

			for (const n of [1, 2]) {
				await app.edit('src/lib/docs.server.ts', docs_module(`export const edit = ${n};`));
				mod = await app.reloaded(load, DOCS, mod);
				expect(mod.edit).toBe(n);
				await texts(mod.docs);
			}

			expect(live().opened.docs).toBe(3);
			expect(live().open.docs).toBe(1);
			expect(graph().all.size - in_graph).toBe(1);
		});

		it('a collection in a module the edit did not run again keeps its connection and its place', async () => {
			app.write('src/lib/docs.server.ts', docs_module());
			app.write('src/lib/people.server.ts', people_module);
			const srv = await app.start();
			let mod = await load(srv, DOCS);
			const people = (await load(srv, '/src/lib/people.server.ts')).people;
			await Promise.all([texts(mod.docs), texts(people)]);

			await app.edit('src/content/a.md', '# A, edited');
			mod = await app.reloaded(load, DOCS, mod);
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

		it('two modules of the same name, each with a collection of the same name: an edit replaces only its own', async () => {
			app.write('src/lib/docs.server.ts', docs_module());
			app.write('src/routes/blog/docs.server.ts', other_docs_module);
			app.write('src/blog/b.md', '# B');
			const srv = await app.start();
			let mod = await load(srv, DOCS);
			const blog = (await load(srv, '/src/routes/blog/docs.server.ts')).docs;
			expect(await texts(blog)).toEqual(['# B']);
			await texts(mod.docs);

			for (const text of ['# A, edited', '# A, edited again']) {
				await app.edit('src/content/a.md', text);
				mod = await app.reloaded(load, DOCS, mod);
				await texts(mod.docs);
			}

			expect((await load(srv, '/src/routes/blog/docs.server.ts')).docs).toBe(blog);
			expect(live().open.docs).toBe(1);
			expect(live().opened.blog).toBe(1);
			expect(live().open.blog).toBe(1);
			const reads = live().reads.blog;
			live().emit.blog(); // the other one still follows its source
			await tick();
			await tick();
			expect(live().reads.blog).toBe(reads + 1);
			expect(graph().all.size - in_graph).toBe(2);
		});

		it('a live list open across an edit gets the new values or ends, never hangs', async () => {
			app.write('src/lib/docs.server.ts', docs_module());
			const srv = await app.start();
			let mod = await load(srv, DOCS);
			const stream = (await (mod.feed as () => Promise<unknown>)()) as AsyncGenerator<string[]>;
			expect((await stream.next()).value).toEqual(['# A']);
			const next = stream.next(); // a page streams the list across the edit

			await app.edit('src/content/a.md', '# A, edited');
			mod = await app.reloaded(load, DOCS, mod);
			await texts(mod.docs);

			const step = await Promise.race([
				next,
				new Promise<'hangs'>((r) => setTimeout(() => r('hangs'), 2000))
			]);
			expect(step).not.toBe('hangs');
			const { done, value } = step as IteratorResult<string[]>;
			if (!done) expect(value).toEqual(['# A, edited']);
			expect(live().open.docs).toBe(1);
		});

		it('a collection the module keeps across its runs still answers and follows after an edit', async () => {
			app.write('src/lib/docs.server.ts', docs_module(KEPT));
			const srv = await app.start();
			let mod = await load(srv, DOCS);
			const kept = mod.kept;
			await Promise.all([texts(mod.docs), texts(kept)]);

			await app.edit('src/content/a.md', '# A, edited');
			mod = await app.reloaded(load, DOCS, mod);
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
			app.write('src/lib/docs.server.ts', docs_module('', GATED));
			const srv = await app.start();
			const invalidate = () => {
				const node = srv.moduleGraph.getModuleById(path.join(app.root, 'src/lib/docs.server.ts'));
				srv.moduleGraph.invalidateModule(node!);
			};
			let g = gate();
			g.release();
			const first = await load(srv, DOCS);
			await texts(first.docs);

			invalidate(); // the watcher
			g = gate();
			const running = load(srv, DOCS); // a request runs the module: it waits at the gate
			await g.reached;
			invalidate(); // the flush, while it runs
			g.release();
			const second = await running;
			await texts(second.docs);
			const third = await app.reloaded(load, DOCS, second); // the next request runs it again
			await texts(third.docs);

			expect(live().opened.docs).toBe(3);
			expect(live().open.docs).toBe(1);
			expect(graph().all.size - in_graph).toBe(1);
		});
	}
);

/** Bun, when it is installed (CI's e2e installs it for the adapter suite). */
const bun = (() => {
	const found = spawnSync('bun', ['--version'], { encoding: 'utf8' });
	return found.status === 0 ? 'bun' : null;
})();

describe('edits in dev under Bun (#247)', { timeout: 60_000 }, () => {
	it.skipIf(!bun)('two page edits leave one live connection, however Kit loads the module', () => {
		const script = fileURLToPath(new URL('./_dev-app.bun.ts', import.meta.url));
		const out = execFileSync(bun!, [script], {
			cwd: fileURLToPath(new URL('..', import.meta.url)),
			encoding: 'utf8'
		});
		const runs = JSON.parse(out.trim().split('\n').pop()!) as Record<
			string,
			Awaited<ReturnType<typeof two_page_edits>>
		>;
		for (const [name] of LOADERS) {
			expect(runs[name], name).toEqual({
				texts: [['# A'], ['# A, edited'], ['# A, edited again']],
				opened: 3,
				open: 1,
				in_graph: 1
			});
		}
	});
});
