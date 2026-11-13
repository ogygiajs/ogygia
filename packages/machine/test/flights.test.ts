import { afterAll, describe, expect, it, vi } from 'vitest';
import { flights, MachineError, observe, policy, scope, STALE, type Policy } from '../src/index.ts';
import { macrotask } from './_tick.ts';
import { DISPOSE } from './_dispose.ts';

/** A promise and its two ends. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Every step a flight can take, heard across this file: the suite takes each of them (the
// `paths()` rule for a machine this package keeps to itself).
const NAME = 'flights under test';
const taken = new Set<string>();
const off = observe((name, from, to) => {
	if (name === NAME) taken.add(`${from.kind} → ${to?.kind ?? 'stopped'}`);
});
afterAll(() => {
	off();
	expect([...taken].sort()).toEqual(
		['flying → flying', 'flying → kept', 'flying → gone', 'kept → flying', 'kept → gone'].sort()
	);
});

describe('one key (what once() was)', () => {
	it('runs on the first get and keeps the answer', async () => {
		const run = vi.fn(async () => ({ hydrate: 1 }));
		const core = flights({ name: NAME, run });
		expect(run).not.toHaveBeenCalled();
		const a = await core.get();
		const b = await core.get();
		expect(a).toBe(b);
		expect(run).toHaveBeenCalledOnce();
	});

	it('callers while it runs share the one run, and the same promise', async () => {
		const d = deferred<number>();
		const run = vi.fn(() => d.promise);
		const core = flights({ name: NAME, run });
		const a = core.get();
		const b = core.get();
		expect(a).toBe(b);
		d.resolve(5);
		expect(await a).toBe(5);
		expect(core.get()).toBe(a); // kept: the same settled promise
		expect(run).toHaveBeenCalledOnce();
	});

	it('never keeps a failure: the next get runs again', async () => {
		const blip = new Error('network blip');
		const run = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(blip)
			.mockResolvedValue('core');
		const core = flights({ name: NAME, run });
		await expect(core.get()).rejects.toBe(blip);
		await expect(core.get()).resolves.toBe('core');
		await expect(core.get()).resolves.toBe('core');
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('every caller of a failed run gets the failure, then the next get starts fresh', async () => {
		const first = deferred<string>();
		const run = vi
			.fn<() => Promise<string>>()
			.mockImplementationOnce(() => first.promise)
			.mockResolvedValue('second');
		const core = flights({ name: NAME, run });
		const a = core.get();
		const b = core.get(undefined, { signal: new AbortController().signal });
		first.reject(new Error('down'));
		await expect(a).rejects.toThrow('down');
		await expect(b).rejects.toThrow('down');
		await expect(core.get()).resolves.toBe('second');
	});

	it('tries again at once before it fails, within the turn: no timer between tries', async () => {
		const run = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error('1'))
			.mockRejectedValueOnce(new Error('2'))
			.mockResolvedValue('ok');
		const retry = policy({ attempts: 3, backoff: 0, jitter: 0, deadline: Infinity });
		const got = flights({ run, retry }).get();
		let timer_ran = false;
		setTimeout(() => (timer_ran = true), 0);
		await expect(got).resolves.toBe('ok');
		expect(timer_ran).toBe(false); // all three tries ran before any macrotask
		expect(run).toHaveBeenCalledTimes(3);
	});

	it('gives the last failure when its tries run out', async () => {
		const run = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error('1'))
			.mockRejectedValueOnce(new Error('2'));
		const retry = policy({ attempts: 2, backoff: 0, jitter: 0, deadline: Infinity });
		await expect(flights({ run, retry }).get()).rejects.toThrow('2');
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('waits between tries as its policy says, real timers', async () => {
		const at: number[] = [];
		const start = Date.now();
		const run = vi.fn(async () => {
			at.push(Date.now() - start);
			if (at.length < 3) throw new Error(String(at.length));
			return 'ok';
		});
		const retry = policy({ attempts: 3, backoff: [30, 60], jitter: 0, deadline: Infinity });
		await expect(flights({ run, retry }).get()).resolves.toBe('ok');
		expect(at[1] - at[0]).toBeGreaterThanOrEqual(29);
		expect(at[2] - at[1]).toBeGreaterThanOrEqual(59);
	});

	it('a deadline aborts the try out and fails with a TimeoutError', async () => {
		let signal!: AbortSignal;
		const run = (_: void, s: AbortSignal) => ((signal = s), new Promise<string>(() => {}));
		const retry = policy({ attempts: 1, backoff: 0, jitter: 0, deadline: 30 });
		await expect(flights({ run, retry }).get()).rejects.toThrow(/no try was done within 30 ms/);
		expect(signal.aborted).toBe(true);
	});

	it('a drop during the wait between tries ends them: STALE, no next try', async () => {
		const run = vi.fn(async () => {
			throw new Error('down');
		});
		const retry = policy({ attempts: 3, backoff: 40, jitter: 0, deadline: Infinity });
		const pages = flights({ run, retry });
		const out = pages.get();
		await macrotask();
		pages.drop(undefined);
		await expect(out).resolves.toBe(STALE);
		await wait(120);
		expect(run).toHaveBeenCalledOnce();
	});

	it('a run that throws synchronously is a failure too', async () => {
		let calls = 0;
		const core = flights({
			run: () => {
				if (calls++ === 0) throw new Error('sync');
				return 'fine';
			}
		});
		await expect(core.get()).rejects.toThrow('sync');
		await expect(core.get()).resolves.toBe('fine');
	});

	it('takes a plain value', async () => {
		await expect(flights({ run: () => 3 }).get()).resolves.toBe(3);
	});

	it('refuses options it cannot take', () => {
		for (const retry of [1, 'twice', { attempts: 1.5 }] as unknown as Policy[])
			expect(() => flights({ run: () => 1, retry })).toThrow(/machine_bad_option/);
		for (const keep of [-1, Number.NaN, '5' as unknown as number])
			expect(() => flights({ run: () => 1, keep })).toThrow(/`keep` must be a time in ms/);
		for (const max of [0, -1, Number.NaN, Infinity])
			expect(() => flights({ run: () => 1, max })).toThrow(
				/`max` must be a finite number more than 0/
			);
		expect(() => flights({ run: 'no' as never })).toThrow(/`run` must be a function/);
	});

	it('a weigh with no max is refused: the default max counts answers, not the weigh’s unit', () => {
		expect(() => flights({ run: () => 'page', weigh: (h: string) => h.length })).toThrow(
			/machine_bad_option/
		);
		expect(() =>
			flights({ run: () => 'page', weigh: (h: string) => h.length, max: 5_000_000 })
		).not.toThrow();
	});

	it('its own handling of a failure adds no unhandled rejection', async () => {
		const seen: unknown[] = [];
		const on_node = (reason: unknown) => seen.push(reason);
		const on_browser = (event: PromiseRejectionEvent) => seen.push(event.reason);
		const node = typeof process !== 'undefined' && typeof process.on === 'function';
		if (node) process.on('unhandledRejection', on_node);
		else globalThis.addEventListener('unhandledrejection', on_browser);
		const core = flights({
			run: async () => {
				throw new Error('nobody listens');
			}
		});
		void core.get().catch(() => {}); // the caller handles it: nothing may be left unhandled
		// a caller with a signal that leaves before the failure lands: its flight fails unheard
		const ctl = new AbortController();
		const late = flights({ run: () => wait(5).then(() => Promise.reject(new Error('late'))) });
		void late.get(undefined, { signal: ctl.signal });
		ctl.abort();
		await wait(30);
		if (node) process.off('unhandledRejection', on_node);
		else globalThis.removeEventListener('unhandledrejection', on_browser);
		expect(seen).toEqual([]);
	});
});

describe('keyed', () => {
	it('one flight per key: the same key joins, another key runs on its own', async () => {
		const run = vi.fn(async (href: string) => `page ${href}`);
		const pages = flights({ name: NAME, run });
		const [a, b, c] = await Promise.all([pages.get('/a'), pages.get('/a'), pages.get('/b')]);
		expect([a, b, c]).toEqual(['page /a', 'page /a', 'page /b']);
		expect(run.mock.calls.map((c) => c[0])).toEqual(['/a', '/b']);
	});

	it('`key` names the fields that are one flight; the input that started it is the one that runs', async () => {
		const run = vi.fn(async (i: { href: string; by: string }) => i.by);
		const pages = flights.keyed<{ href: string; by: string }>()({
			key: ['href'],
			ignore: { by: 'who asked, not what is fetched' },
			run
		});
		const a = pages.get({ href: '/a', by: 'prefetch' });
		const b = pages.get({ href: '/a', by: 'click' });
		expect(await a).toBe('prefetch');
		expect(await b).toBe('prefetch');
		expect(run).toHaveBeenCalledOnce();
		expect(pages.peek({ href: '/a' })?.kind).toBe('kept');
	});

	it('two inputs that differ in any key field never share an answer', async () => {
		type Spec = { owner: string; repo: string; ref: string; sub: string };
		const run = vi.fn(async (s: Spec) => `${s.owner}/${s.repo}@${s.ref}:${s.sub}`);
		const checkouts = flights.keyed<Spec>()({ key: ['owner', 'repo', 'ref', 'sub'], run });
		const base: Spec = { owner: 'a', repo: 'b', ref: 'main', sub: 'docs' };
		const inputs: Spec[] = [base];
		for (const field of ['owner', 'repo', 'ref', 'sub'] as const) {
			inputs.push({ ...base, [field]: `${base[field]}x` });
			// a value that a careless join would spell like another field's
			inputs.push({ ...base, [field]: `${base[field]}:b` });
		}
		inputs.push({ owner: 'a:b', repo: '', ref: 'main', sub: 'docs' });
		const answers = await Promise.all(inputs.map((i) => checkouts.get(i)));
		expect(new Set(answers).size).toBe(inputs.length);
		expect(run).toHaveBeenCalledTimes(inputs.length);
		await checkouts.get({ ...base });
		expect(run).toHaveBeenCalledTimes(inputs.length); // the same fields: the kept answer
	});

	it('a key field compares objects by identity, and keeps every kind of value apart', async () => {
		type In = { v: unknown };
		const run = vi.fn(async (i: In) => i.v);
		const vs = flights.keyed<In>()({ key: ['v'], run });
		const o = {};
		const values = [o, {}, 1, '1', 1n, true, 'true', null, 'null', undefined, 'u;', Symbol('s')];
		for (const v of values) await vs.get({ v });
		expect(run).toHaveBeenCalledTimes(values.length);
		await vs.get({ v: o });
		expect(run).toHaveBeenCalledTimes(values.length);
		expect(vs.peek({ v: o })?.kind).toBe('kept');
	});

	it('a missing key field and one that is undefined are one key; a registered symbol is one by its name', async () => {
		type In = { v?: unknown };
		const run = vi.fn(async (i: In) => String(i.v));
		const vs = flights.keyed<In>()({ key: ['v'], run });
		await vs.get({});
		await vs.get({ v: undefined });
		expect(run).toHaveBeenCalledOnce();
		await vs.get({ v: Symbol.for('ogygia.test.key') });
		await vs.get({ v: Symbol.for('ogygia.test.key') });
		await vs.get({ v: Symbol('ogygia.test.key') }); // (a symbol of its own: another key)
		await vs.get({ v: 's15:ogygia.test.key' }); // (a string spelled like it: another key)
		expect(run).toHaveBeenCalledTimes(4);
	});

	it('drop by key fields, or by a predicate over them (never over the rest of the input)', async () => {
		type Ask = { href: string; purpose: string };
		const pages = flights.keyed<Ask>()({
			key: ['href'],
			ignore: { purpose: 'how it is fetched, not what' },
			run: async (a) => a.href
		});
		await pages.get({ href: '/a', purpose: 'nav' });
		await pages.get({ href: '/b', purpose: 'prefetch' });
		const seen: unknown[] = [];
		pages.drop((key) => (seen.push(key), key.href === '/a'));
		expect(seen).toEqual([{ href: '/a' }, { href: '/b' }]);
		expect(pages.peek({ href: '/a' })).toBeUndefined();
		pages.drop({ href: '/b' });
		expect(pages.peek({ href: '/b' })).toBeUndefined();
	});

	it('a keyed flights refuses a key it cannot use, where it is written', () => {
		const run = async () => 0;
		const make = flights.keyed<{ a: string; b: string }>();
		expect(() => make({ key: ['a', 'a'], run })).toThrow(MachineError);
		expect(() => make({ key: ['a'], ignore: { a: 'twice' } as never, run })).toThrow(MachineError);
		expect(() => make({ key: ['a'], ignore: { b: ' ' }, run })).toThrow(MachineError);
		expect(() => make({ run } as never)).toThrow(MachineError);
		expect(() => flights({ ignore: { a: 'a reason with no key' }, run } as never)).toThrow(
			MachineError
		);
		expect(() => flights({ max: 0, run })).toThrow(MachineError);
		expect(() => flights({ max: Infinity, run })).toThrow(MachineError);
		expect(() => flights({ world: {} as never, run })).toThrow(MachineError);
		expect(make({ key: [], ignore: { a: 'one look-up per owner', b: 'same' }, run })).toBeDefined();
	});

	it('runs inside the get that starts it, with a signal of its own', () => {
		let signal: AbortSignal | null = null;
		const pages = flights({ run: (_: string, s) => ((signal = s), new Promise(() => {})) });
		void pages.get('/a');
		expect(signal).toBeInstanceOf(AbortSignal);
		expect(signal!.aborted).toBe(false);
	});

	it('a run that gets its own key before it returns joins its own flight (#354)', async () => {
		let inner: Promise<unknown> | null = null;
		const sync = flights({
			run: (href: string) => {
				inner = sync.get(href);
				return href.length;
			}
		});
		expect(await sync.get('/abc')).toBe(4);
		expect(await inner).toBe(4);

		let later: Promise<unknown> | null = null;
		const d = deferred<string>();
		const run = vi.fn((href: string) => {
			later = pages.get(href);
			return d.promise;
		});
		const pages = flights({ run });
		const outer = pages.get('/a');
		d.resolve('page');
		expect(await outer).toBe('page');
		expect(await later).toBe('page');
		expect(run).toHaveBeenCalledOnce();
	});

	it('a drop ends the flight out: every caller gets STALE, its signal aborts, nothing is kept', async () => {
		const d = deferred<string>();
		let signal!: AbortSignal;
		const run = vi.fn((_: string, s: AbortSignal) => ((signal = s), d.promise));
		const pages = flights({ name: NAME, run });
		const plain = pages.get('/a');
		const held = pages.get('/a', { signal: new AbortController().signal });
		pages.drop('/a');
		expect(signal.aborted).toBe(true);
		await expect(plain).resolves.toBe(STALE);
		await expect(held).resolves.toBe(STALE);
		d.resolve('the page from before'); // it lands after all: nobody gets it, nothing keeps it
		await macrotask();
		expect(pages.peek('/a')).toBeUndefined();
		run.mockImplementation(async () => 'fresh');
		await expect(pages.get('/a')).resolves.toBe('fresh');
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('a failure that lands after a drop is STALE, not a failure, for the callers of that flight', async () => {
		const d = deferred<string>();
		const pages = flights<string, Promise<string>>({ run: () => d.promise });
		const out = pages.get('/a');
		pages.drop('/a');
		d.reject(new Error('late'));
		await expect(out).resolves.toBe(STALE);
	});

	it('drop takes a predicate, over kept answers and flights out alike', async () => {
		const run = vi.fn(async (href: string) => href);
		const pages = flights({ name: NAME, run });
		await Promise.all([pages.get('/docs/a'), pages.get('/docs/b'), pages.get('/blog/c')]);
		const out = pages.get('/docs/d'); // still out
		const seen: string[] = [];
		pages.drop((key, entry) => (seen.push(`${key}:${entry.kind}`), key.startsWith('/docs/')));
		expect(seen.sort()).toEqual(['/blog/c:kept', '/docs/a:kept', '/docs/b:kept', '/docs/d:flying']);
		await expect(out).resolves.toBe(STALE);
		expect(pages.peek('/docs/a')).toBeUndefined();
		expect(pages.peek('/blog/c')?.kind).toBe('kept');
		await pages.get('/docs/a');
		expect(run).toHaveBeenCalledTimes(5);
	});

	it('a drop predicate that gets or drops as it is asked: every key is asked once, every caller settles', async () => {
		const run = vi.fn(async (href: string) => href);
		const pages = flights({ run });
		await Promise.all([pages.get('/a'), pages.get('/b'), pages.get('/c')]);
		const asked: string[] = [];
		let started: Promise<unknown> | null = null;
		pages.drop((key) => {
			asked.push(key);
			if (key === '/a') {
				pages.drop('/b'); // (another key, taken out under the walk)
				started = pages.get('/d'); // (a new flight, put in under the walk)
			}
			return key === '/a' || key === '/d';
		});
		// (a Map walk sees a key put in during it: the new flight is asked, and goes too)
		expect(asked).toEqual(['/a', '/c', '/d']);
		await expect(started).resolves.toBe(STALE);
		expect(pages.peek('/a')).toBeUndefined();
		expect(pages.peek('/b')).toBeUndefined();
		expect(pages.peek('/c')?.kind).toBe('kept');
		expect(await pages.get('/d')).toBe('/d');
	});

	it('a caller that leaves gets STALE at once; the work stops only when the last one has left', async () => {
		let signal!: AbortSignal;
		const run = vi.fn((_: string, s: AbortSignal) => ((signal = s), new Promise<string>(() => {})));
		const pages = flights({ name: NAME, run });
		const one = new AbortController();
		const two = new AbortController();
		const a = pages.get('/a', { signal: one.signal });
		const b = pages.get('/a', { signal: two.signal });
		one.abort();
		await expect(a).resolves.toBe(STALE);
		expect(signal.aborted).toBe(false); // its twin still waits
		expect(pages.peek('/a')?.kind).toBe('flying');
		two.abort();
		await expect(b).resolves.toBe(STALE);
		expect(signal.aborted).toBe(true);
		expect(pages.peek('/a')).toBeUndefined();
		void pages.get('/a');
		expect(run).toHaveBeenCalledTimes(2); // nobody was left on the first: the next get runs again
	});

	it('a caller with no signal holds the flight: the others leaving does not stop it', async () => {
		const d = deferred<string>();
		let signal!: AbortSignal;
		const pages = flights({ run: (_: string, s) => ((signal = s), d.promise) });
		const ctl = new AbortController();
		const left = pages.get('/a', { signal: ctl.signal });
		const stays = pages.get('/a');
		ctl.abort();
		await expect(left).resolves.toBe(STALE);
		expect(signal.aborted).toBe(false);
		d.resolve('page');
		await expect(stays).resolves.toBe('page');
	});

	it('a caller whose signal already aborted gets STALE and starts nothing', async () => {
		const run = vi.fn(async () => 'x');
		const pages = flights({ run });
		await expect(pages.get(undefined, { signal: AbortSignal.abort() })).resolves.toBe(STALE);
		expect(run).not.toHaveBeenCalled();
	});

	it('a kept answer reaches a caller with a signal too', async () => {
		const pages = flights({ run: async (href: string) => href });
		await pages.get('/a');
		await expect(pages.get('/a', { signal: new AbortController().signal })).resolves.toBe('/a');
	});
});

describe('keep, max and weigh', () => {
	it('keeps an answer for `keep` ms, real time, then runs again', async () => {
		let n = 0;
		const pages = flights({ name: NAME, run: async () => ++n, keep: 40 });
		expect(await pages.get()).toBe(1);
		expect(await pages.get()).toBe(1);
		const at = pages.peek(undefined);
		expect(at?.kind === 'kept' && Date.now() - at.at < 40).toBe(true);
		await wait(70);
		expect(pages.peek(undefined)).toBeUndefined(); // expired: nothing shown
		expect(await pages.get()).toBe(2);
	});

	it('`keep` made from the answer: 0 keeps nothing (callers share the flight while it is out)', async () => {
		const run = vi.fn(async (href: string) => ({ href, cacheable: href !== '/private' }));
		const pages = flights({ name: NAME, run, keep: (page) => (page.cacheable ? Infinity : 0) });
		const [a, b] = await Promise.all([pages.get('/private'), pages.get('/private')]);
		expect(a).toBe(b);
		expect(pages.peek('/private')).toBeUndefined();
		await pages.get('/private');
		await pages.get('/public');
		await pages.get('/public');
		expect(run.mock.calls.map((c) => c[0])).toEqual(['/private', '/private', '/public']);
	});

	it('an expired answer is swept out when a new flight starts', async () => {
		const pages = flights({ run: async (href: string) => href, keep: 20 });
		await pages.get('/a');
		await wait(40);
		await pages.get('/b');
		const seen: string[] = [];
		pages.drop((key) => (seen.push(key), false));
		expect(seen).toEqual(['/b']);
	});

	it('`max` counts answers: past it the least recently used goes first', async () => {
		const run = vi.fn(async (href: string) => href);
		const pages = flights({ name: NAME, run, max: 2 });
		await pages.get('/a');
		await pages.get('/b');
		await pages.get('/a'); // a use: /b is now the oldest
		await pages.get('/c');
		expect(pages.peek('/a')?.kind).toBe('kept');
		expect(pages.peek('/b')).toBeUndefined();
		expect(pages.peek('/c')?.kind).toBe('kept');
	});

	it('`weigh` puts each answer against `max`; one heavier than all of `max` is not kept', async () => {
		const pages = flights({
			run: async (html: string) => html,
			max: 10,
			weigh: (html) => html.length
		});
		await pages.get('aaaa');
		await pages.get('bbbb');
		await pages.get('cccc'); // 12 > 10: the oldest goes
		expect(pages.peek('aaaa')).toBeUndefined();
		expect(pages.peek('bbbb')?.kind).toBe('kept');
		await pages.get('xxxxxxxxxxxx'); // 12 alone: not kept, and nothing else is pushed out for it
		expect(pages.peek('xxxxxxxxxxxx')).toBeUndefined();
		expect(pages.peek('bbbb')?.kind).toBe('kept');
		expect(pages.peek('cccc')?.kind).toBe('kept');
	});

	it('a weight below 0 or not a number is not kept, so `max` still caps (#355)', async () => {
		const weights: Record<string, number> = { a: -1, b: NaN, c: -Infinity, d: 1, e: 1 };
		const pages = flights({ run: async (k: string) => k, max: 1, weigh: (k) => weights[k] });
		for (const k of ['a', 'b', 'c', 'd', 'e']) expect(await pages.get(k)).toBe(k);
		expect(['a', 'b', 'c', 'd', 'e'].filter((k) => pages.peek(k) !== undefined)).toEqual(['e']);
	});

	it('an expired answer goes before a live one is pushed out (#356)', async () => {
		const pages = flights({
			run: async (k: string) => (k === 'new' ? wait(40).then(() => k) : k),
			keep: (k) => (k === 'short' ? 20 : 60_000),
			max: 2
		});
		await pages.get('long');
		await pages.get('short'); // (the newest use: 'long' is first in line)
		// a flight starts while 'short' is still good, and lands once it has expired
		await pages.get('new');
		expect(pages.peek('long')?.kind).toBe('kept');
		expect(pages.peek('new')?.kind).toBe('kept');
		expect(pages.peek('short')).toBeUndefined();
	});

	it('a refresh out keeps its prior against `max` until it lands; nothing kept passes `max` after', async () => {
		const d = deferred<string>();
		let round = 0;
		const pages = flights({
			run: (k: string) => (k === '/a' && round++ === 1 ? d.promise : Promise.resolve(k + round)),
			max: 1
		});
		await pages.get('/a');
		const refresh = pages.get('/a', { fresh: true });
		// (only the refresh's prior is kept: a new answer has no room beside it)
		expect(await pages.get('/b')).toBe('/b2');
		expect(pages.peek('/b')).toBeUndefined();
		expect(pages.peek('/a')).toMatchObject({ kind: 'kept', flying: true });
		d.resolve('/a new');
		expect(await refresh).toBe('/a new');
		expect(pages.peek('/a')).toMatchObject({ kind: 'kept', answer: '/a new', flying: false });
		const weight = (pages as unknown as { _weight: number })._weight;
		expect(weight).toBe(1);
	});

	it('a refresh that lands past its prior’s age, into a full cache no sweep has reached yet, is kept', async () => {
		let now = 1_000_000;
		// (the clock port reads the platform's `performance` at each call)
		const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);
		const d = deferred<string>();
		let round = 0;
		const pages = flights({
			run: (k: string) => (k === '/a' && round++ === 1 ? d.promise : Promise.resolve(k)),
			keep: 1000,
			weigh: (answer) => answer.length,
			max: 7
		});
		await pages.get('/a');
		await pages.get('/b');
		const refresh = pages.get('/a', { fresh: true });
		// both answers pass their age while the refresh is out; the cache's sweep has not run
		now += 2000;
		d.resolve('/a new');
		expect(await refresh).toBe('/a new');
		expect(pages.peek('/a')).toMatchObject({ kind: 'kept', answer: '/a new', flying: false });
		expect((pages as unknown as { _weight: number })._weight).toBe('/a new'.length);
		spy.mockRestore();
	});

	it('a keep or weigh that throws fails the flight and keeps nothing', async () => {
		const pages = flights({
			run: async () => 'x',
			keep: () => {
				throw new Error('keep broke');
			}
		});
		await expect(pages.get()).rejects.toThrow('keep broke');
		expect(pages.peek(undefined)).toBeUndefined();
	});
});

describe('fresh', () => {
	it('starts a new flight beside the kept answer, which stays until the new one lands', async () => {
		const next = deferred<string>();
		const run = vi.fn<(href: string) => Promise<string>>().mockResolvedValueOnce('old');
		const pages = flights({ name: NAME, run });
		await pages.get('/a');
		run.mockImplementationOnce(() => next.promise);
		const refreshed = pages.get('/a', { fresh: true });
		expect(pages.peek('/a')).toMatchObject({ kind: 'kept', answer: 'old', flying: true });
		const joined = pages.get('/a'); // joins the refresh
		next.resolve('new');
		expect(await refreshed).toBe('new');
		expect(await joined).toBe('new');
		expect(pages.peek('/a')).toMatchObject({ kind: 'kept', answer: 'new', flying: false });
	});

	it('a refresh that fails, or answers what is not kept, leaves the kept answer in place', async () => {
		const run = vi
			.fn<(href: string) => Promise<{ ok: boolean; body: string }>>()
			.mockResolvedValueOnce({ ok: true, body: 'good' })
			.mockRejectedValueOnce(new Error('down'))
			.mockResolvedValueOnce({ ok: false, body: 'an error page' });
		const pages = flights({ name: NAME, run, keep: (page) => (page.ok ? Infinity : 0) });
		await pages.get('/a');
		await expect(pages.get('/a', { fresh: true })).rejects.toThrow('down');
		expect(pages.peek('/a')).toMatchObject({ kind: 'kept', answer: { body: 'good' } });
		await expect(pages.get('/a', { fresh: true })).resolves.toMatchObject({ ok: false });
		expect(pages.peek('/a')).toMatchObject({ kind: 'kept', answer: { body: 'good' } });
		expect(await pages.get('/a')).toMatchObject({ body: 'good' });
	});

	it('a fresh flight ends the one already out: its callers get STALE', async () => {
		const first = deferred<string>();
		let signal!: AbortSignal;
		const run = vi
			.fn<(href: string, s: AbortSignal) => Promise<string>>()
			.mockImplementationOnce((_, s) => ((signal = s), first.promise))
			.mockResolvedValueOnce('after the mutation');
		const pages = flights({ name: NAME, run });
		const before = pages.get('/a');
		const after = pages.get('/a', { fresh: true });
		expect(signal.aborted).toBe(true);
		first.resolve('before the mutation');
		await expect(before).resolves.toBe(STALE);
		await expect(after).resolves.toBe('after the mutation');
		expect(await pages.get('/a')).toBe('after the mutation');
	});

	it('a fresh flight over one whose callers have signals: they get STALE, and their leaving later stops nothing', async () => {
		const first = deferred<string>();
		const second = deferred<string>();
		let signal2!: AbortSignal;
		const run = vi
			.fn<(href: string, s: AbortSignal) => Promise<string>>()
			.mockImplementationOnce(() => first.promise)
			.mockImplementationOnce((_, s) => ((signal2 = s), second.promise));
		const pages = flights({ name: NAME, run });
		const a = new AbortController();
		const b = new AbortController();
		const before = [pages.get('/a', { signal: a.signal }), pages.get('/a', { signal: b.signal })];
		const after = pages.get('/a', { fresh: true });
		await expect(Promise.all(before)).resolves.toEqual([STALE, STALE]);
		// (the callers of the ended flight leave: the new one is not theirs)
		a.abort();
		b.abort();
		expect(signal2.aborted).toBe(false);
		second.resolve('new');
		await expect(after).resolves.toBe('new');
		expect(pages.peek('/a')).toMatchObject({ kind: 'kept', answer: 'new' });
	});

	it('the last caller of a refresh leaving puts the kept answer back', async () => {
		const pages = flights({
			run: vi
				.fn<(href: string) => Promise<string>>()
				.mockResolvedValueOnce('kept')
				.mockImplementationOnce(() => new Promise(() => {}))
		});
		await pages.get('/a');
		const ctl = new AbortController();
		const out = pages.get('/a', { fresh: true, signal: ctl.signal });
		ctl.abort();
		await expect(out).resolves.toBe(STALE);
		expect(pages.peek('/a')).toMatchObject({ kind: 'kept', answer: 'kept', flying: false });
	});
});

describe('priority', () => {
	it('a run sees the priority of the get that started it (0 when it gave none)', async () => {
		const seen: number[] = [];
		const pages = flights({
			name: NAME,
			run: async (href: string, _signal, flight) => (seen.push(flight.priority), href)
		});
		await pages.get('/a');
		await pages.get('/b', { priority: 2 });
		expect(seen).toEqual([0, 2]);
	});

	it('a join with a higher priority raises the flight, and the run hears it', async () => {
		const d = deferred<string>();
		const heard: number[] = [];
		let flight!: { readonly priority: number };
		const pages = flights({
			name: NAME,
			run: (_href: string, _signal, f) => {
				flight = f;
				f.onRaise((p) => heard.push(p));
				return d.promise;
			}
		});
		const low = pages.get('/a', { priority: 0 });
		const high = pages.get('/a', { priority: 3 });
		expect(flight.priority).toBe(3);
		expect(heard).toEqual([3]);
		d.resolve('page');
		expect(await low).toBe('page');
		expect(await high).toBe('page');
	});

	it('a raise listener that is not a function is refused with a code, when it is added', () => {
		let refused: unknown = null;
		const pages = flights({
			name: NAME,
			run: (_href: string, _signal, f) => {
				try {
					f.onRaise('not a function' as never);
				} catch (error) {
					refused = error;
				}
				return new Promise<string>(() => {});
			}
		});
		void pages.get('/a');
		expect(refused).toBeInstanceOf(MachineError);
		pages.drop(() => true);
	});

	it('a join with a lower or equal priority never lowers it, and is not heard', () => {
		const heard: number[] = [];
		let flight!: { readonly priority: number };
		const pages = flights({
			name: NAME,
			run: (_href: string, _signal, f) => {
				flight = f;
				f.onRaise((p) => heard.push(p));
				return new Promise<string>(() => {});
			}
		});
		void pages.get('/a', { priority: 2 });
		void pages.get('/a', { priority: 1 });
		void pages.get('/a', { priority: 2 });
		void pages.get('/a');
		expect(flight.priority).toBe(2);
		expect(heard).toEqual([]);
		pages.drop(() => true);
	});

	it('a caller that leaves does not take the raise back', async () => {
		let flight!: { readonly priority: number };
		const pages = flights({
			name: NAME,
			run: (_href: string, _signal, f) => ((flight = f), new Promise<string>(() => {}))
		});
		void pages.get('/a', { priority: 0 });
		const ctl = new AbortController();
		const high = pages.get('/a', { priority: 3, signal: ctl.signal });
		ctl.abort();
		await expect(high).resolves.toBe(STALE);
		expect(flight.priority).toBe(3);
		pages.drop(() => true);
	});

	it('a kept answer is given as it is: no run, nothing raised', async () => {
		const run = vi.fn(async (href: string) => href);
		const pages = flights({ name: NAME, run });
		await pages.get('/a', { priority: 0 });
		expect(await pages.get('/a', { priority: 9 })).toBe('/a');
		expect(run).toHaveBeenCalledOnce();
	});

	it('a fresh flight starts at its own caller priority', async () => {
		const seen: number[] = [];
		const pages = flights({
			name: NAME,
			run: async (href: string, _signal, f) => (seen.push(f.priority), href)
		});
		await pages.get('/a', { priority: 3 });
		await pages.get('/a', { priority: 1, fresh: true });
		expect(seen).toEqual([3, 1]);
	});

	it('every try a retry policy gives reads the priority as it stands', async () => {
		const seen: number[] = [];
		let calls = 0;
		const gate = deferred<void>();
		const pages = flights({
			name: NAME,
			retry: policy({ attempts: 2, backoff: 0, jitter: 0, deadline: Infinity }),
			run: async (href: string, _signal, f) => {
				seen.push(f.priority);
				if (calls++ === 0) {
					await gate.promise;
					throw new Error('blip');
				}
				return href;
			}
		});
		const out = pages.get('/a', { priority: 0 });
		void pages.get('/a', { priority: 2 });
		gate.resolve();
		expect(await out).toBe('/a');
		expect(seen).toEqual([0, 2]);
	});

	it('a raise is heard only by the try that is out: a failed try’s listeners are let go', async () => {
		const heard: string[] = [];
		let tries = 0;
		const first = deferred<void>();
		const second = deferred<string>();
		const started = deferred<void>();
		const pages = flights({
			name: NAME,
			retry: policy({ attempts: 2, backoff: 0, jitter: 0, deadline: Infinity }),
			run: async (_href: string, _signal, f) => {
				const mine = ++tries;
				f.onRaise((p) => heard.push(`try ${mine}: ${p}`));
				if (mine === 1) {
					await first.promise;
					throw new Error('blip');
				}
				started.resolve();
				return second.promise;
			}
		});
		const out = pages.get('/a', { priority: 0 });
		first.resolve();
		await started.promise;
		void pages.get('/a', { priority: 2 });
		second.resolve('/a');
		expect(await out).toBe('/a');
		expect(heard).toEqual(['try 2: 2']);
	});

	it('keyed: two inputs of one key are one flight, raised by the later', () => {
		let flight!: { readonly priority: number };
		const pages = flights.keyed<{ href: string; purpose: string }>()({
			name: NAME,
			key: ['href'],
			ignore: { purpose: 'how, not what' },
			run: (_ask, _signal, f) => ((flight = f), new Promise<string>(() => {}))
		});
		void pages.get({ href: '/a', purpose: 'prefetch' }, { priority: 0 });
		void pages.get({ href: '/a', purpose: 'nav' }, { priority: 3 });
		expect(flight.priority).toBe(3);
		pages.drop(() => true);
	});

	it('a raise listener that throws is said, and the join and the other listeners go on', async () => {
		const said = vi.spyOn(console, 'error').mockImplementation(() => {});
		const page = globalThis as { reportError?: (e: unknown) => void };
		const own = page.reportError;
		const reported: unknown[] = [];
		page.reportError = (e) => reported.push(e);
		try {
			const heard: number[] = [];
			const d = deferred<string>();
			const pages = flights({
				name: NAME,
				run: (_href: string, _signal, f) => {
					f.onRaise(() => {
						throw new Error('listener');
					});
					f.onRaise((p) => heard.push(p));
					return d.promise;
				}
			});
			void pages.get('/a');
			const joined = pages.get('/a', { priority: 1 });
			expect(heard).toEqual([1]);
			expect(String(said.mock.calls[0]?.[0])).toContain('machine_flight_raise_failed');
			expect(reported).toHaveLength(1);
			d.resolve('page');
			expect(await joined).toBe('page');
		} finally {
			page.reportError = own;
			said.mockRestore();
		}
	});

	it('a priority that is not a number is refused', () => {
		const pages = flights({ name: NAME, run: async (href: string) => href });
		expect(() => pages.get('/a', { priority: NaN })).toThrow(MachineError);
		expect(() => pages.get('/a', { priority: '1' as never })).toThrow(/priority/);
	});
});

describe('owned', () => {
	it('a disposed flights drops everything and runs nothing after', async () => {
		const run = vi.fn(() => new Promise<string>(() => {}));
		const pages = flights<string, Promise<string>>({ run });
		const out = pages.get('/a');
		pages[DISPOSE]();
		await expect(out).resolves.toBe(STALE);
		await expect(pages.get('/b')).resolves.toBe(STALE);
		expect(run).toHaveBeenCalledOnce();
	});

	it('a scope adopts it: closing the scope ends its flights', async () => {
		const page = scope();
		const pages = page.adopt(
			flights<string, Promise<string>>({ run: () => new Promise<string>(() => {}) })
		);
		const out = pages.get('/a');
		page.close();
		await expect(out).resolves.toBe(STALE);
	});
});

describe('under load (real concurrency)', () => {
	it('random gets, leaves, drops and answers: one run per flight, every caller settles, nothing failed is kept', async () => {
		for (let seed = 1; seed <= 40; seed++) {
			let x = seed;
			const rand = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
			const out: { key: string; p: Promise<unknown> }[] = [];
			const live = new Map<string, Set<AbortSignal>>(); // the runs out per key
			let overlap = false;
			const pages = flights({
				run: async (key: string, signal) => {
					const runs = live.get(key) ?? new Set<AbortSignal>();
					live.set(key, runs);
					// two runs of one key at once only when the older one was ended (its signal aborted)
					for (const other of runs) if (!other.aborted) overlap = true;
					runs.add(signal);
					try {
						await wait(Math.floor(rand() * 3));
						if (rand() < 0.2) throw new Error('blip');
						return `${key}!`;
					} finally {
						runs.delete(signal);
					}
				},
				keep: 5,
				max: 3
			});
			for (let i = 0; i < 60; i++) {
				const key = `/${Math.floor(rand() * 4)}`;
				const r = rand();
				if (r < 0.1) pages.drop(key);
				else if (r < 0.15) pages.drop(() => true);
				else {
					const ctl = rand() < 0.3 ? new AbortController() : null;
					const p = pages.get(key, { signal: ctl?.signal, fresh: rand() < 0.05 });
					p.catch(() => {}); // (read below: a failure before then is not unhandled)
					out.push({ key, p });
					if (ctl && rand() < 0.5) ctl.abort();
				}
				if (rand() < 0.3) await macrotask();
			}
			const settled = await Promise.allSettled(out.map((o) => o.p));
			for (let i = 0; i < settled.length; i++) {
				const s = settled[i];
				if (s.status === 'fulfilled') expect([STALE, `${out[i].key}!`]).toContain(s.value);
				else expect((s.reason as Error).message).toBe('blip');
			}
			expect(overlap).toBe(false);
			await wait(10);
		}
	});
});
