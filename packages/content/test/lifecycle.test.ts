// A content collection's lifecycle, and the caches built on it (#189-#193): a failure is never kept,
// a live source keeps going past a bad update and a dropped connection, a change made while the
// first value is built is never missed, and the site's search follows the content.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as v from 'valibot';
import { content, type Source, type SourceEntry } from '../src/index.ts';
import { withRemotes } from '../src/server.ts';
import { site as siteRaw } from '../src/site/site.ts';
import { dimensions } from '../src/site/dimensions.ts';

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

	it('a dropped connection is opened again, and what changed meanwhile is read', async () => {
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
	});
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
			source: async () => `# ${title}\n\n${text}`
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

	it('a failed first build is not kept: the next search builds again', async () => {
		const { source, ctl } = liveSource([doc('install', 'Install', 'Run the installer.')]);
		const s = siteRaw({ outline: content({ schema, loader: source }) });
		ctl.refs_fail = 1;
		await expect(s.search('installer')).rejects.toThrow();
		expect((await s.search('installer')).length).toBeGreaterThan(0);
	});
});
