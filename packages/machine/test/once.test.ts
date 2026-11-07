import { describe, expect, it, vi } from 'vitest';
import { once } from '../src/index.ts';

describe('once', () => {
	it('loads on the first call and keeps the answer', async () => {
		const load = vi.fn(async () => ({ hydrate: 1 }));
		const get = once(load);
		expect(load).not.toHaveBeenCalled();
		const a = await get();
		const b = await get();
		expect(a).toBe(b);
		expect(load).toHaveBeenCalledOnce();
	});

	it('callers while it loads share the one load', async () => {
		let finish!: (v: number) => void;
		const load = vi.fn(() => new Promise<number>((r) => (finish = r)));
		const get = once(load);
		const a = get();
		const b = get();
		expect(a).toBe(b);
		finish(5);
		expect(await a).toBe(5);
		expect(load).toHaveBeenCalledOnce();
	});

	it('never keeps a failure: the next call loads again', async () => {
		const blip = new Error('network blip');
		const load = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(blip)
			.mockResolvedValue('core');
		const get = once(load);
		await expect(get()).rejects.toBe(blip);
		await expect(get()).resolves.toBe('core');
		await expect(get()).resolves.toBe('core');
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('every caller of a failed load gets the failure, then the next call starts fresh', async () => {
		let fail!: (e: unknown) => void;
		const load = vi
			.fn<() => Promise<string>>()
			.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)))
			.mockResolvedValue('second');
		const get = once(load);
		const a = get();
		const b = get();
		fail(new Error('down'));
		await expect(a).rejects.toThrow('down');
		await expect(b).rejects.toThrow('down');
		await expect(get()).resolves.toBe('second');
	});

	it('retries at once before failing', async () => {
		const load = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error('1'))
			.mockRejectedValueOnce(new Error('2'))
			.mockResolvedValue('ok');
		await expect(once(load, { retries: 2 })()).resolves.toBe('ok');
		expect(load).toHaveBeenCalledTimes(3);
	});

	it('gives the last failure when the retries run out', async () => {
		const load = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(new Error('1'))
			.mockRejectedValueOnce(new Error('2'));
		await expect(once(load, { retries: 1 })()).rejects.toThrow('2');
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('a load that throws synchronously is a failure too', async () => {
		let calls = 0;
		const get = once(() => {
			if (calls++ === 0) throw new Error('sync');
			return 'fine';
		});
		await expect(get()).rejects.toThrow('sync');
		await expect(get()).resolves.toBe('fine');
	});

	it('takes a plain value', async () => {
		await expect(once(() => 3)()).resolves.toBe(3);
	});

	it('refuses a retries count that is not a whole number of 0 or more', () => {
		for (const retries of [-1, 1.5, Number.NaN, Infinity])
			expect(() => once(() => 1, { retries })).toThrow(/machine_bad_option/);
	});

	it('its own reset after a failure adds no unhandled rejection of its own', async () => {
		const seen: unknown[] = [];
		const on_node = (reason: unknown) => seen.push(reason);
		const on_browser = (event: PromiseRejectionEvent) => seen.push(event.reason);
		const node = typeof process !== 'undefined' && typeof process.on === 'function';
		if (node) process.on('unhandledRejection', on_node);
		else globalThis.addEventListener('unhandledrejection', on_browser);
		const get = once(async () => {
			throw new Error('nobody listens');
		});
		void get().catch(() => {}); // the caller handles it: nothing may be left unhandled
		await new Promise((r) => setTimeout(r, 20));
		if (node) process.off('unhandledRejection', on_node);
		else globalThis.removeEventListener('unhandledrejection', on_browser);
		expect(seen).toEqual([]);
	});
});
