// A content collection's lifecycle, and the caches built on it (#189-#193): a failure is never kept,
// a live source keeps going past a bad update and a dropped connection, a change made while the
// first value is built is never missed, and the site's search follows the content.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as v from 'valibot';
import { defineRun } from '@ogygia/machine';
import { content, folder, json, type Source, type SourceEntry } from '../src/index.ts';
import { withRemotes } from '../src/server.ts';
import { GRAPH } from '../src/graph.ts';
import { COLLECTION } from '../src/collection-base.ts';
import { site as siteRaw } from '../src/site/site.ts';
import { dimensions } from '../src/site/dimensions.ts';
import { outline, pick } from '../src/site/outline.ts';
import { dedent } from '@ogygia/core/plugin/utils';

type Meta = { headings: never[] };
const schema = v.object({ title: v.string() });
const tick = () => new Promise((r) => setTimeout(r, 0));
/** A few macrotasks: a live change pulled, reloaded and announced. */
const settle = async () => {
	for (let i = 0; i < 5; i++) await tick();
};

/** A live source: `refs()` returns the rows, `live()` yields whenever `emit()` is called. Flags make
 *  it fail the way real content sources do. */
function liveSource(rows: SourceEntry<Meta>[] = []) {
	const waiters: Array<() => void> = [];
	const ctl = {
		refs_fail: 0,
		init_fail: 0,
		/** the live connection drops (its iterator throws) on its first pull this many times */
		live_drops: 0,
		subscribed: 0,
		/** called inside refs(), as the read runs: a change landing mid-read */
		during_refs: null as null | (() => void)
	};
	const emit = () => waiters.splice(0).forEach((w) => w());
	const source: Source<Meta> = {
		async init() {
			if (ctl.init_fail > 0) {
				ctl.init_fail--;
				throw new Error('source init failed');
			}
		},
		async get(id) {
			return rows.find((r) => r.id === id) ?? null;
		},
		async refs() {
			if (ctl.refs_fail > 0) {
				ctl.refs_fail--;
				throw new Error('source down');
			}
			const out = rows.slice();
			ctl.during_refs?.();
			ctl.during_refs = null;
			return out;
		},
		async *live() {
			ctl.subscribed++;
			if (ctl.live_drops > 0) {
				ctl.live_drops--;
				throw new Error('connection dropped');
			}
			while (true) {
				await new Promise<void>((r) => waiters.push(r));
				yield 1;
			}
		}
	};
	return {
		source,
		ctl,
		push(e: SourceEntry<Meta>) {
			rows.push(e);
			emit();
		},
		emit
	};
}

/** Runs `body` and then fails if a promise was rejected meanwhile with nothing to handle it. */
async function never_unhandled(body: () => Promise<void>): Promise<void> {
	const unhandled = vi.fn();
	process.on('unhandledRejection', unhandled);
	try {
		await body();
		vi.useRealTimers();
		await new Promise((r) => setTimeout(r, 20));
		expect(unhandled).not.toHaveBeenCalled();
	} finally {
		process.off('unhandledRejection', unhandled);
	}
}

const row = (id: string, title: unknown): SourceEntry<Meta> =>
	({ id, data: { title }, meta: { headings: [] } }) as SourceEntry<Meta>;

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('a collection never keeps a failed start (#189)', () => {
	it('a source that is down for the first read: the next read loads', async () => {
		const { source, ctl } = liveSource([row('a', 'A')]);
		ctl.refs_fail = 1;
		const c = content({ schema, loader: source });
		await expect(c.refs()).rejects.toThrow('source down');
		const all = await c.refs();
		expect(all.map((e) => e.id)).toEqual(['a']);
	});

	it('a source whose init fails once: the next read starts it again', async () => {
		const { source, ctl } = liveSource([row('a', 'A')]);
		ctl.init_fail = 1;
		const c = content({ schema, loader: source });
		await expect(c.refs()).rejects.toThrow('source init failed');
		expect((await c.refs()).map((e) => e.id)).toEqual(['a']);
	});

	it('a schema error on the first read: fixed at the source, the next read loads', async () => {
		const rows = [row('a', 5)];
		const { source } = liveSource(rows);
		const c = content({ schema, loader: source });
		await expect(c.refs()).rejects.toThrow();
		rows[0] = row('a', 'A');
		expect((await c.refs()).map((e) => e.data.title)).toEqual(['A']);
	});

	it('readers while it loads share the one load', async () => {
		const { source } = liveSource([row('a', 'A')]);
		const refs = vi.spyOn(source, 'refs');
		const c = content({ schema, loader: source });
		await Promise.all([c.refs(), c.refs(), c.refs()]);
		expect(refs).toHaveBeenCalledOnce();
	});
});

describe('a live source keeps going (#190)', () => {
	it('one bad update (a field the schema refuses) does not stop the ones after it', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { source, push } = liveSource([row('a', 'A')]);
		const c = content({ schema, loader: source });
		await c.refs();
		push(row('bad', 5)); // an editor saves an entry with a bad field
		await settle();
		push(row('b', 'B')); // and then a good one
		await settle();
		expect((await c.refs()).map((e) => e.id)).toContain('b');
		expect(error).toHaveBeenCalled();
	});

	it('a dropped connection is opened again, and what changed meanwhile is read', () =>
		never_unhandled(async () => {
			vi.useFakeTimers();
			vi.spyOn(console, 'error').mockImplementation(() => {});
			const rows = [row('a', 'A')];
			const { source, ctl, push } = liveSource(rows);
			ctl.live_drops = 1;
			const c = content({ schema, loader: source });
			await c.refs();
			await vi.advanceTimersByTimeAsync(0);
			rows.push(row('b', 'B')); // changed while the connection was down: no event for it
			await vi.advanceTimersByTimeAsync(60_000);
			expect(ctl.subscribed).toBe(2);
			expect((await c.refs()).map((e) => e.id)).toContain('b'); // read on reconnect
			push(row('c', 'C')); // and the new connection carries the next change
			await vi.advanceTimersByTimeAsync(0);
			await vi.advanceTimersByTimeAsync(0);
			expect((await c.refs()).map((e) => e.id)).toContain('c');
		}));
});

describe('a source that is down never leaves live connections behind', () => {
	it('reads that fail while the source is down share one connection, and the change it brings applies once', async () => {
		const rows = [row('a', 'A')];
		const { source, ctl, push } = liveSource(rows);
		ctl.refs_fail = 3;
		const reads = vi.spyOn(source, 'refs');
		const c = content({ schema, loader: source });
		for (let i = 0; i < 3; i++) await expect(c.refs()).rejects.toThrow('source down');
		expect((await c.refs()).map((e) => e.id)).toEqual(['a']);
		expect(ctl.subscribed).toBe(1); // one connection, not one per failed read
		const before = reads.mock.calls.length;
		push(row('b', 'B'));
		await settle();
		expect((await c.refs()).map((e) => e.id)).toEqual(['a', 'b']);
		expect(reads.mock.calls.length - before).toBe(1); // the change read once, by one connection
	});

	it('a reconnect whose read fails waits and tries again on the same connection', () =>
		never_unhandled(async () => {
			vi.useFakeTimers();
			vi.spyOn(console, 'error').mockImplementation(() => {});
			const rows = [row('a', 'A')];
			const { source, ctl } = liveSource(rows);
			ctl.live_drops = 1;
			const c = content({ schema, loader: source });
			await c.refs();
			ctl.refs_fail = 3; // the source is down for the next three reads
			await vi.advanceTimersByTimeAsync(0);
			rows.push(row('b', 'B'));
			await vi.advanceTimersByTimeAsync(120_000);
			expect((await c.refs()).map((e) => e.id)).toContain('b'); // it came back, and was read
			expect(ctl.subscribed).toBe(2); // the first, and the one opened again: not one per retry
		}));
});

describe('a change made while the first value is built is not missed (#191)', () => {
	it('the live connection is open before the first full read: a change during it is seen', async () => {
		// a source that announces each change to whoever listens AT THAT MOMENT (a CMS webhook feed,
		// a database change stream): nothing is replayed to a listener that subscribes later
		const rows = [row('a', 'A')];
		const listeners: Array<() => void> = [];
		let first_read = true;
		const source: Source<Meta> = {
			get: async (id) => rows.find((r) => r.id === id) ?? null,
			refs: async () => {
				const out = rows.slice();
				if (first_read) {
					// an editor publishes while the first full read is out: the read misses it
					first_read = false;
					rows.push(row('b', 'B'));
					listeners.splice(0).forEach((l) => l());
				}
				return out;
			},
			async *live() {
				while (true) {
					await new Promise<void>((r) => listeners.push(r));
					yield 1;
				}
			}
		};
		const c = content({ schema, loader: source });
		await c.refs();
		await settle();
		expect((await c.refs()).map((e) => e.id).sort()).toEqual(['a', 'b']);
	});

	it('live.list: a change between the first value and the next pull is yielded', async () => {
		const { source, push } = liveSource([row('a', 'A')]);
		const remote = withRemotes(content({ schema, loader: source })).live.list({
			map: (e) => e.id
		});
		const gen = (await remote()) as unknown as AsyncGenerator<string[]>;
		expect((await gen.next()).value).toEqual(['a']);
		// the client is still rendering the first value when the content changes
		push(row('b', 'B'));
		await settle();
		const next = await Promise.race([
			gen.next().then((r) => r.value),
			new Promise<'waiting'>((r) => setTimeout(() => r('waiting'), 300))
		]);
		expect(next).toEqual(['a', 'b']);
		await gen.return?.(undefined);
	});

	it('live.get: the same', async () => {
		const rows = [row('a', 'one')];
		const { source, emit } = liveSource(rows);
		const remote = withRemotes(content({ schema, loader: source })).live.get({
			map: (e) => e.data.title
		});
		const gen = (await remote('a')) as unknown as AsyncGenerator<string | null>;
		expect((await gen.next()).value).toBe('one');
		rows[0] = row('a', 'two');
		emit();
		await settle();
		const next = await Promise.race([
			gen.next().then((r) => r.value),
			new Promise<'waiting'>((r) => setTimeout(() => r('waiting'), 300))
		]);
		expect(next).toBe('two');
		await gen.return?.(undefined);
	});
});

describe('a dimension (a language, a version) never keeps a failed outline (#192)', () => {
	it('fr fails to build once: the next fr page builds', async () => {
		const page = (id: string, title: string) =>
			({
				id,
				filePath: `docs/00-guide/0${id.length}-${id}/+doc.svx`,
				order: [0, id.length],
				data: { title },
				meta: { headings: [] }
			}) as SourceEntry<Meta>;
		const of = (title: string) =>
			content({
				loader: {
					get: async () => null,
					refs: async () => [page('guide/a', title)]
				} as Source<Meta>,
				schema
			});
		let fr_fails = 1;
		const d = dimensions({
			axes: { locale: { values: ['en', 'fr'], default: 'en', fallback: true, label: 'Language' } },
			// (async, as a real resolve that reads a CMS is: its failure is a rejected promise)
			resolve: async ({ locale }) => {
				if (locale === 'fr' && fr_fails-- > 0) throw new Error('source blip');
				return locale === 'fr' ? of('A fr') : of('A en');
			}
		});
		const s = siteRaw({ outline: d });
		await expect(s.page('fr/guide/a')).rejects.toThrow('source blip');
		expect((await s.page('fr/guide/a'))?.entry.data).toMatchObject({ title: 'A fr' });
	});
});

describe('site search follows the content (#193)', () => {
	const doc = (id: string, title: string, text: string) =>
		({
			id,
			filePath: `content/docs/00-start/0${id.length}-${id}/+doc.svx`,
			data: { title },
			meta: { headings: [] },
			source: async () => dedent`
				# ${title}

				${text}
			`
		}) as unknown as SourceEntry<Meta>;

	it('a page a live source adds is found by the next search', async () => {
		const { source, push } = liveSource([doc('install', 'Install', 'Run the installer.')]);
		const s = siteRaw({ outline: content({ schema, loader: source }) });
		expect(await s.search('quantum')).toEqual([]);
		push(doc('quantum', 'Quantum', 'Quantum islands are new.'));
		await settle();
		const hits = await s.search('quantum');
		expect(hits.length).toBeGreaterThan(0);
	});

	it("a dimensioned site: a page the default coordinate's live source adds is found by the next search", async () => {
		const { source, push } = liveSource([doc('install', 'Install', 'Run the installer.')]);
		const en = content({ schema, loader: source });
		const fr = content({ schema, loader: liveSource([]).source });
		const d = dimensions({
			axes: { locale: { values: ['en', 'fr'], default: 'en', fallback: true } },
			resolve: ({ locale }) => (locale === 'en' ? en : fr)
		});
		const s = siteRaw({ outline: d });
		expect(await s.search('quantum')).toEqual([]);
		push(doc('quantum', 'Quantum', 'Quantum islands are new.'));
		await settle();
		expect((await s.search('quantum')).length).toBeGreaterThan(0);
	});

	it('a failed first build is not kept: the next search builds again', async () => {
		const { source, ctl } = liveSource([doc('install', 'Install', 'Run the installer.')]);
		const s = siteRaw({ outline: content({ schema, loader: source }) });
		ctl.refs_fail = 1;
		await expect(s.search('installer')).rejects.toThrow();
		expect((await s.search('installer')).length).toBeGreaterThan(0);
	});
});

describe('the outline is stamped with the content it read, never a newer version (#326)', () => {
	it('a change that lands while its entries are graphed: the next read weaves again', async () => {
		const page = (id: string, title: string) =>
			({
				id,
				filePath: `content/docs/00-start/0${id.length}-${id}/+doc.svx`,
				data: { title, author: 'ada' },
				meta: { headings: [] }
			}) as unknown as SourceEntry<Meta>;
		// the authors load when the test says: graphing the docs waits on them
		let authors_in!: () => void;
		const authors_held = new Promise<void>((r) => (authors_in = r));
		const people = content({
			schema: v.object({ name: v.string() }),
			loader: {
				async refs() {
					await authors_held;
					return [{ id: 'ada', data: { name: 'Ada' }, meta: { headings: [] } }];
				},
				async get() {
					return null;
				}
			} as Source<Meta>
		});
		const rows = [page('install', 'Install')];
		const { source, emit } = liveSource(rows);
		const docs = content({
			schema: v.object({ title: v.string(), author: v.string() }),
			loader: source,
			relations: () => ({ author: people })
		});
		const s = siteRaw({ outline: docs });
		const first = s.outline.addresses();
		// the docs are read (install only); their graph waits on the authors
		await settle();
		// an editor adds a page while the weave is still graphing what it read
		rows.push(page('usage', 'Usage'));
		emit();
		await settle();
		authors_in();
		expect(await first).toEqual(['install']); // woven from what it read: the page before
		// read again: the content changed since the entries the outline was woven from
		expect(await s.outline.addresses()).toEqual(['install', 'usage']);
	});

	it('the first read of a collection not yet loaded weaves once: its load is not a change', async () => {
		const page = (id: string, title: string) =>
			({
				id,
				filePath: `content/docs/00-start/0${id.length}-${id}/+doc.svx`,
				data: { title },
				meta: { headings: [] }
			}) as unknown as SourceEntry<Meta>;
		const { source } = liveSource([page('install', 'Install')]);
		const docs = content({ schema, loader: source });
		const reads = vi.spyOn(docs, 'refs');
		const s = siteRaw({ outline: docs });
		expect(await s.outline.addresses()).toEqual(['install']);
		expect(await s.outline.addresses()).toEqual(['install']);
		expect(await s.outline.addresses()).toEqual(['install']);
		expect(reads).toHaveBeenCalledTimes(1);
	});
});

describe('a live edit that breaks the outline keeps the last good one', () => {
	const doc = (id: string, title: string) =>
		({
			id,
			filePath: `content/docs/00-start/0${id.length}-${id}/+doc.svx`,
			data: { title },
			meta: { headings: [] },
			source: async () => dedent`
				# ${title}

				The ${title} page.
			`
		}) as unknown as SourceEntry<Meta>;

	it('an entry the outline places nowhere: the nav stays, an error says why, the fix applies', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const rows = [doc('install', 'Install'), doc('usage', 'Usage')];
		const { source, emit } = liveSource(rows);
		const docs = content({ schema, loader: source });
		// a hand-placed outline, no remainder: every entry must be picked
		const s = siteRaw({
			outline: outline([
				{ label: 'Start', items: pick(docs, 'install') },
				{ label: 'Use', items: pick(docs, 'usage') }
			])
		});
		const slugs = async () => (await s.outline.addresses()).slice();
		expect(await slugs()).toEqual(['install', 'usage']);

		// an editor adds a page the outline does not place: the weave fails (unplaced entry)
		rows.push(doc('draft', 'Draft'));
		emit();
		await settle();
		expect(await slugs()).toEqual(['install', 'usage']); // the last good outline
		await expect(s.nav()).resolves.toHaveLength(2);
		expect(await s.page('install')).not.toBeNull(); // and its pages still serve
		const said = error.mock.calls.filter((c) =>
			String(c[0]).includes('content_outline_weave_failed')
		);
		expect(said).toHaveLength(1); // said once for the broken content, not once per request
		expect(String(said[0][1])).toMatch(/unplaced entr/);

		// the editor removes it: the outline weaves again, from the fixed content
		rows.pop();
		rows.push(doc('usage', 'Using it'));
		rows.splice(1, 1);
		emit();
		await settle();
		const tree = await s.nav();
		expect(JSON.stringify(tree)).toContain('Using it');
	});

	it('the first weave failing is still the caller’s error (there is nothing to keep)', async () => {
		const { source } = liveSource([doc('install', 'Install'), doc('stray', 'Stray')]);
		const docs = content({ schema, loader: source });
		const s = siteRaw({ outline: outline([{ label: 'Start', items: pick(docs, 'install') }]) });
		await expect(s.nav()).rejects.toThrow(/unplaced entr/);
	});
});

describe('a folder sidecar that fails to load once is loaded again (#246)', () => {
	/** A folder over a lazy glob (each file a thunk, as `import.meta.glob` without `eager` gives):
	 *  the section's `+meta.json` fails to load the first `fails` times. */
	function lazy_folder(fails: number) {
		const loads = { meta: 0 };
		const map = {
			'content/docs/00-guide/+meta.json': async () => {
				loads.meta++;
				if (fails-- > 0) throw new Error('sidecar failed to load');
				return { default: { label: 'The guide' } };
			},
			'content/docs/00-guide/00-intro/+doc.svx': async () => ({ title: 'Intro' }),
			'content/docs/01-api/00-reference/+doc.svx': async () => ({ title: 'Reference' })
		};
		return { docs: content({ loader: folder(map, { format: json }), schema }), loads };
	}

	it('the collection: the next read loads it', async () => {
		const { docs } = lazy_folder(1);
		await expect(docs.refs()).rejects.toThrow('sidecar failed to load');
		expect((await docs.refs()).map((e) => e.id)).toEqual(['guide/intro', 'api/reference']);
	});

	it('its groups: the next read has the label', async () => {
		const { docs } = lazy_folder(1);
		await expect(docs.groups()).rejects.toThrow('sidecar failed to load');
		expect((await docs.groups()).get('guide')).toEqual({ label: 'The guide' });
	});

	it('once loaded, the sidecars are kept: readers share the one load', async () => {
		const { docs, loads } = lazy_folder(0);
		await Promise.all([docs.refs(), docs.groups(), docs.groups()]);
		await docs.groups();
		expect(loads.meta).toBe(1);
	});
});

describe('a collection a newer run of its module replaces stops following (#247)', () => {
	// What core's definer marking does in a module run: the run asks for its wrapper
	// (`defineRun`), and the module's content() calls go through it. (A real dev server drives it
	// in dev-reload.test.ts; here each named run is one run of the same module, to reach the retry
	// timer.)
	let runs = new Map<string, ReturnType<typeof defineRun>>();
	beforeEach(() => {
		runs = new Map();
	});
	const in_run = <T>(r: string, build: () => T): T => {
		let wrap = runs.get(r);
		if (!wrap) runs.set(r, (wrap = defineRun('/app/src/lib/docs.server.ts')));
		return wrap(build)();
	};

	it('its live connection: a change after it was replaced is not read', async () => {
		const old = liveSource([row('a', 'A')]);
		const reads = vi.spyOn(old.source, 'refs');
		const first = in_run('1', () => content({ schema, loader: old.source }));
		await first.refs();
		await settle();
		const current = liveSource([row('a', 'A')]);
		in_run('2', () => content({ schema, loader: current.source }));
		old.push(row('b', 'B'));
		await settle();
		expect(reads).toHaveBeenCalledOnce(); // the first read only
	});

	it('its retry: a dropped connection is not opened again once it was replaced', async () => {
		vi.useFakeTimers();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const old = liveSource([row('a', 'A')]);
		old.ctl.live_drops = 1;
		const first = in_run('1', () => content({ schema, loader: old.source }));
		await first.refs();
		await vi.advanceTimersByTimeAsync(0); // the connection dropped: a retry waits
		in_run('2', () => content({ schema, loader: liveSource([row('a', 'A')]).source }));
		await vi.advanceTimersByTimeAsync(120_000);
		expect(old.ctl.subscribed).toBe(1);
	});

	it('the module kept it: read again, it follows again', async () => {
		const kept = liveSource([row('a', 'A')]);
		const c = in_run('1', () => content({ schema, loader: kept.source }));
		await c.refs();
		in_run('2', () => content({ schema, loader: liveSource([row('a', 'A')]).source }));
		await settle();
		expect((await c.refs()).map((e) => e.id)).toEqual(['a']);
		kept.push(row('b', 'B'));
		await settle();
		expect((await c.refs()).map((e) => e.id)).toEqual(['a', 'b']);
	});

	it('a live list streaming it ends once it was replaced, and so does a live get', async () => {
		const old = liveSource([row('a', 'A')]);
		const c = in_run('1', () => content({ schema, loader: old.source }));
		const remotes = withRemotes(c);
		const list = (await remotes.live.list({ map: (e) => e.id })()) as unknown as AsyncGenerator;
		const one = (await remotes.live.get({ map: (e) => e.id })('a')) as unknown as AsyncGenerator;
		expect((await list.next()).value).toEqual(['a']);
		expect((await one.next()).value).toBe('a');
		const next = [list.next(), one.next()]; // pages stream them across the edit
		in_run('2', () => content({ schema, loader: liveSource([row('a', 'A')]).source }));
		const steps = await Promise.race([
			Promise.all(next),
			new Promise<'hangs'>((r) => setTimeout(() => r('hangs'), 300))
		]);
		expect(steps).toEqual([
			{ done: true, value: undefined },
			{ done: true, value: undefined }
		]);
	});

	it('one an ended run builds later (a lazy content() call) is out of the graph until read', async () => {
		const run_1 = defineRun('/app/src/lib/lazy.server.ts');
		const lazy = run_1(() => content({ schema, loader: liveSource([row('a', 'A')]).source }));
		defineRun('/app/src/lib/lazy.server.ts'); // the module ran again: run 1 ended
		const c = lazy();
		const in_graph = () =>
			[...GRAPH.all].includes((c as unknown as Record<symbol, never>)[COLLECTION]);
		expect(in_graph()).toBe(false);
		expect((await c.refs()).map((e) => e.id)).toEqual(['a']);
		expect(in_graph()).toBe(true);
	});

	it('a collection the same run builds replaces nothing', async () => {
		const one = liveSource([row('a', 'A')]);
		const a = in_run('1', () => content({ schema, loader: one.source }));
		await a.refs();
		in_run('1', () => content({ schema, loader: liveSource([]).source }));
		one.push(row('b', 'B'));
		await settle();
		expect((await a.refs()).map((e) => e.id)).toEqual(['a', 'b']);
	});
});
