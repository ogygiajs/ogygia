// A live remote's first value and the version it is stamped with describe the same catalog (#551).
import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { content, type Source, type SourceEntry } from '../src/index.ts';
import { COLLECTION } from '../src/collection-base.ts';
import { withRemotes } from '../src/server.ts';

type Meta = { headings: never[] };
const schema = v.object({ title: v.string() });
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
	for (let i = 0; i < 5; i++) await tick();
};
const row = (id: string, title: string): SourceEntry<Meta> =>
	({ id, data: { title }, meta: { headings: [] } }) as SourceEntry<Meta>;

/** A live source over `rows`: `emit()` announces a change. */
function liveSource(rows: SourceEntry<Meta>[]) {
	const waiters: Array<() => void> = [];
	const source: Source<Meta> = {
		async get(id) {
			return rows.find((r) => r.id === id) ?? null;
		},
		async refs() {
			return rows.slice();
		},
		async *live() {
			while (true) {
				await new Promise<void>((r) => waiters.push(r));
				yield 1;
			}
		}
	};
	return { source, emit: () => waiters.splice(0).forEach((w) => w()) };
}

/** Lands `edit` (and lets the collection reload) after the first `ready()` took its snapshot and
 *  before its caller resumes: the widest form of the one-microtask gap. */
function editAfterFirstReady(handle: unknown, edit: () => void) {
	const c = (handle as Record<symbol, { ready(): Promise<unknown> }>)[COLLECTION];
	const ready = c.ready.bind(c);
	let once = true;
	c.ready = async () => {
		const snap = await ready();
		if (once) {
			once = false;
			edit();
			await settle();
		}
		return snap;
	};
}

const next_or_waiting = <T>(gen: AsyncGenerator<T>) =>
	Promise.race([
		gen.next().then((r) => r.value),
		new Promise<'waiting'>((r) => setTimeout(() => r('waiting'), 300))
	]);

describe('a live remote never misses an edit made while its first value is read (#551)', () => {
	it('live.list: an edit that lands as the first snapshot is taken still reaches the client', async () => {
		const rows = [row('a', 'A')];
		const { source, emit } = liveSource(rows);
		const handle = content({ schema, loader: source });
		editAfterFirstReady(handle, () => {
			rows.push(row('b', 'B'));
			emit();
		});
		const gen = (await withRemotes(handle).live.list({
			map: (e) => e.id
		})()) as unknown as AsyncGenerator<string[]>;
		const first = (await gen.next()).value;
		if (first.length === 1) expect(await next_or_waiting(gen)).toEqual(['a', 'b']);
		else expect(first).toEqual(['a', 'b']);
		await gen.return(undefined);
	});

	it('live.get: an edit that lands as the first snapshot is taken still reaches the client', async () => {
		const rows = [row('a', 'one')];
		const { source, emit } = liveSource(rows);
		const handle = content({ schema, loader: source });
		editAfterFirstReady(handle, () => {
			rows[0] = row('a', 'two');
			emit();
		});
		const gen = (await withRemotes(handle).live.get({
			map: (e) => e.data.title
		})('a')) as unknown as AsyncGenerator<string | null>;
		const first = (await gen.next()).value;
		if (first === 'one') expect(await next_or_waiting(gen)).toBe('two');
		else expect(first).toBe('two');
		await gen.return(undefined);
	});
});
