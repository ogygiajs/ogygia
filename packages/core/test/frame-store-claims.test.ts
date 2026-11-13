// What the frame store states about an address's life, its refusals and its one copy per document,
// each on its own (runtime/frame-store.ts).
import { afterEach, expect, test, vi } from 'vitest';
import { STALE } from '@ogygia/machine';
import { watch } from '../src/ref-watch.ts';
import * as frames from './_frames.ts';

const TTL = 60_000;

afterEach(() => {
	vi.useRealTimers();
	frames._reset();
});

/** A fetcher that answers when told to. */
function held(html = 'HTML') {
	let resolve!: (v: string) => void;
	const p = new Promise<string>((r) => (resolve = r));
	return { fetcher: vi.fn((_signal: AbortSignal) => p), answer: () => resolve(html) };
}

/** A refused answer as the region endpoint's client names it (by name: one store per document). */
function refusal(): Error {
	const e = new Error('refused');
	e.name = 'RegionAnswerRefused';
	return e;
}

test('a frame written at an address is not heard by a hub watcher of the same id', () => {
	const heard: unknown[] = [];
	const off = watch('/same', (v) => heard.push(v));
	frames.write({ a: '/same', v: frames.stamp(), html: 'x' });
	off();
	expect(heard).toEqual([]);
});

test('a held refusal is handed once to the first caller; the next one fetches', async () => {
	frames.hold_refusal('/r', refusal());
	await expect(frames.ensure('/r', vi.fn())).rejects.toThrow('refused');
	const next = held('fresh');
	const got = frames.ensure('/r', next.fetcher);
	next.answer();
	expect(await got).toBe('fresh');
});

test('a failure that is not a refusal is not held', async () => {
	frames.hold_refusal('/n', new Error('network'));
	const f = held('ok');
	const got = frames.ensure('/n', f.fetcher);
	f.answer();
	expect(await got).toBe('ok');
});

test('a forced fetch is not refused by a held refusal', async () => {
	frames.hold_refusal('/f', refusal());
	const f = held('forced');
	const got = frames.ensure('/f', f.fetcher, { force: true });
	f.answer();
	expect(await got).toBe('forced');
	expect(f.fetcher).toHaveBeenCalledTimes(1);
});

test('an address a fetch is out at outlives its linger, and lingers again once the fetch is done', async () => {
	vi.useFakeTimers();
	frames.renew('/slow', 'cap');
	const f = held('late');
	const got = frames.ensure('/slow', f.fetcher);
	vi.advanceTimersByTime(TTL + 1);
	expect(frames.renewal('/slow'), 'kept while its fetch is out').toBe('cap');
	f.answer();
	await got;
	vi.advanceTimersByTime(TTL + 1);
	expect(frames.renewal('/slow'), 'let go a linger after').toBeNull();
});

test('a reservation the batch missed lingers once it is released, though it outlived a linger', () => {
	vi.useFakeTimers();
	frames.renew('/res', 'cap');
	frames.reserve('/res');
	vi.advanceTimersByTime(TTL + 1);
	expect(frames.renewal('/res')).toBe('cap');
	frames.release('/res');
	return Promise.resolve().then(async () => {
		await vi.advanceTimersByTimeAsync(TTL + 1);
		expect(frames.renewal('/res')).toBeNull();
	});
});

test('an address its last binder left lingers, then goes', () => {
	vi.useFakeTimers();
	const off = frames.subscribe('/b', () => {});
	frames.write({ a: '/b', v: frames.stamp(), html: 'x' });
	vi.advanceTimersByTime(TTL + 1);
	expect(frames.peek('/b')?.html, 'bound: kept').toBe('x');
	off();
	vi.advanceTimersByTime(TTL + 1);
	expect(frames.peek('/b')).toBeNull();
});

test('each unbound write starts the linger again', () => {
	vi.useFakeTimers();
	frames.write({ a: '/w', v: frames.stamp(), html: 'a' });
	vi.advanceTimersByTime(TTL - 10_000);
	frames.write({ a: '/w', v: frames.stamp(), html: 'b' });
	vi.advanceTimersByTime(20_000);
	expect(frames.peek('/w')?.html).toBe('b');
});

test('the store’s end settles a caller waiting on its fetch with STALE', async () => {
	const got = frames.ensure('/end', held().fetcher);
	frames._reset();
	expect(await got).toBe(STALE);
});

test('one store per document: a second copy of the module writes where the first one’s binder hears', async () => {
	const other = (await import(
		// @ts-expect-error -- the module again under another id: a second instance, as a second bundle's copy is
		'../src/runtime/frame-store.ts?copy'
	)) as typeof import('../src/runtime/frame-store.ts');
	const heard: string[] = [];
	const off = frames.subscribe('/doc', (f) => heard.push(f.html));
	other.write({ a: '/doc', v: other.stamp(), html: 'from the copy' } as never);
	off();
	expect(heard).toEqual(['from the copy']);
	other.reserve('/doc-part');
	const joined = frames.ensure('/doc-part', vi.fn());
	other.write({ a: '/doc-part', v: other.stamp(), html: 'part' } as never);
	expect(await joined).toBe('part');
});
