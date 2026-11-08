import { afterAll, describe, expect, it, vi } from 'vitest';
import { flights, MachineError, observe, scope, STALE } from '../src/index.ts';
import { macrotask } from './_tick.ts';

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
	if (name === NAME) taken.add(from.kind + ' → ' + (to?.kind ?? 'stopped'));
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

	it('tries again at once before it fails', async () => {
		const run = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error('1'))
			.mockRejectedValueOnce(new Error('2'))
			.mockResolvedValue('ok');
		await expect(flights({ run, retries: 2 }).get()).resolves.toBe('ok');
		expect(run).toHaveBeenCalledTimes(3);
	});

	it('gives the last failure when its tries run out', async () => {
		const run = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error('1'))
			.mockRejectedValueOnce(new Error('2'));
		await expect(flights({ run, retries: 1 }).get()).rejects.toThrow('2');
		expect(run).toHaveBeenCalledTimes(2);
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
		for (const retries of [-1, 1.5, Number.NaN, Infinity])
			expect(() => flights({ run: () => 1, retries })).toThrow(/machine_bad_option/);
		for (const keep of [-1, Number.NaN, '5' as unknown as number])
			expect(() => flights({ run: () => 1, keep })).toThrow(/`keep` must be a time in ms/);
		for (const max of [0, -1, Number.NaN])
			expect(() => flights({ run: () => 1, max })).toThrow(/`max` must be more than 0/);
		expect(() => flights({ run: 'no' as never })).toThrow(/`run` must be a function/);
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
		const run = vi.fn(async (href: string) => 'page ' + href);
		const pages = flights({ name: NAME, run });
		const [a, b, c] = await Promise.all([pages.get('/a'), pages.get('/a'), pages.get('/b')]);
		expect([a, b, c]).toEqual(['page /a', 'page /a', 'page /b']);
		expect(run.mock.calls.map((c) => c[0])).toEqual(['/a', '/b']);
	});

	it('`key` names the fields that are one flight; the input that started it is the one that runs', async () => {
		const run = vi.fn(async (i: { href: string; by: string }) => i.by);
		const pages = flights<{ href: string; by: string }>()({
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
		const checkouts = flights<Spec>()({ key: ['owner', 'repo', 'ref', 'sub'], run });
		const base: Spec = { owner: 'a', repo: 'b', ref: 'main', sub: 'docs' };
		const inputs: Spec[] = [base];
		for (const field of ['owner', 'repo', 'ref', 'sub'] as const) {
			inputs.push({ ...base, [field]: base[field] + 'x' });
			// a value that a careless join would spell like another field's
			inputs.push({ ...base, [field]: base[field] + ':' + 'b' });
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
		const vs = flights<In>()({ key: ['v'], run });
		const o = {};
		const values = [o, {}, 1, '1', 1n, true, 'true', null, 'null', undefined, 'u;', Symbol('s')];
		for (const v of values) await vs.get({ v });
		expect(run).toHaveBeenCalledTimes(values.length);
		await vs.get({ v: o });
		expect(run).toHaveBeenCalledTimes(values.length);
		expect(vs.peek({ v: o })?.kind).toBe('kept');
	});

	it('drop by key fields, or by a predicate over them (never over the rest of the input)', async () => {
		type Ask = { href: string; purpose: string };
		const pages = flights<Ask>()({
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
		const make = flights<{ a: string; b: string }>();
		expect(() => make({ key: ['a', 'a'], run })).toThrow(MachineError);
		expect(() => make({ key: ['a'], ignore: { a: 'twice' } as never, run })).toThrow(MachineError);
		expect(() => make({ key: ['a'], ignore: { b: ' ' }, run })).toThrow(MachineError);
		expect(() => make({ run } as never)).toThrow(MachineError);
		expect(make({ key: [], ignore: { a: 'one look-up per owner', b: 'same' }, run })).toBeDefined();
	});

	it('runs inside the get that starts it, with a signal of its own', () => {
		let signal: AbortSignal | null = null;
		const pages = flights({ run: (_: string, s) => ((signal = s), new Promise(() => {})) });
		void pages.get('/a');
		expect(signal).toBeInstanceOf(AbortSignal);
		expect(signal!.aborted).toBe(false);
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
		pages.drop((key, entry) => (seen.push(key + ':' + entry.kind), key.startsWith('/docs/')));
		expect(seen.sort()).toEqual(['/blog/c:kept', '/docs/a:kept', '/docs/b:kept', '/docs/d:flying']);
		await expect(out).resolves.toBe(STALE);
		expect(pages.peek('/docs/a')).toBeUndefined();
		expect(pages.peek('/blog/c')?.kind).toBe('kept');
		await pages.get('/docs/a');
		expect(run).toHaveBeenCalledTimes(5);
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

describe('owned', () => {
	it('a disposed flights drops everything and runs nothing after', async () => {
		const run = vi.fn(() => new Promise<string>(() => {}));
		const pages = flights<string, Promise<string>>({ run });
		const out = pages.get('/a');
		pages[Symbol.dispose]();
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
						return key + '!';
					} finally {
						runs.delete(signal);
					}
				},
				keep: 5,
				max: 3
			});
			for (let i = 0; i < 60; i++) {
				const key = '/' + Math.floor(rand() * 4);
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
				if (s.status === 'fulfilled') expect([STALE, out[i].key + '!']).toContain(s.value);
				else expect((s.reason as Error).message).toBe('blip');
			}
			expect(overlap).toBe(false);
			await wait(10);
		}
	});
});
