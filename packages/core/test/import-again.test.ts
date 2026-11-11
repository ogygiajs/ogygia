// import-again.ts: a chunk whose download failed is asked for again under a fresh URL (the browser
// keeps the failed URL for the life of the page). The real browser behaviour is proven by the e2e
// lazy-chunk-retry spec; this pins the URL reading and the attempt sequence.
import { describe, expect, it, vi } from 'vitest';
import { flights } from '@ogygia/machine';
import {
	import_again,
	is_failed_import,
	on_reload_needed,
	retry_url
} from '../src/runtime/import-again.ts';
import { download } from '../src/policies.ts';

const CHROMIUM = new TypeError(
	'Failed to fetch dynamically imported module: https://shop.test/_app/immutable/chunks/DmQpvhkC.js'
);
const FIREFOX = new TypeError(
	'error loading dynamically imported module: https://shop.test/_app/immutable/chunks/DmQpvhkC.js'
);
const SAFARI = new TypeError('Importing a module script failed.');

describe('is_failed_import', () => {
	it('tells a failed load from a module that threw, in every engine’s wording (#383)', () => {
		expect(is_failed_import(CHROMIUM)).toBe(true);
		expect(is_failed_import(FIREFOX)).toBe(true);
		expect(is_failed_import(SAFARI)).toBe(true);
		expect(is_failed_import(new TypeError('undefined is not a function'))).toBe(false);
		expect(is_failed_import(new ReferenceError('x is not defined'))).toBe(false);
		expect(is_failed_import(undefined)).toBe(false);
	});
});

describe('retry_url', () => {
	it('adds the retry mark, keeping the rest of the URL', () => {
		expect(retry_url('https://shop.test/a.js', 1)).toBe('https://shop.test/a.js?og-retry=1');
		expect(retry_url('https://shop.test/a.js?v=3', 2)).toBe(
			'https://shop.test/a.js?v=3&og-retry=2'
		);
		expect(retry_url('https://shop.test/a.js?og-retry=1', 2)).toBe(
			'https://shop.test/a.js?og-retry=2'
		);
	});
});

describe('import_again', () => {
	it('loads normally while nothing failed', async () => {
		const fresh = vi.fn();
		const load = import_again(async () => 'core', fresh);
		await expect(load()).resolves.toBe('core');
		await expect(load()).resolves.toBe('core');
		expect(fresh).not.toHaveBeenCalled();
	});

	it('after a failed download, asks for its file under a new URL each time', async () => {
		const asked: string[] = [];
		const fresh = vi.fn(async (url: string) => {
			asked.push(url);
			if (asked.length === 1)
				throw new TypeError(`Failed to fetch dynamically imported module: ${url}`);
			return 'core';
		});
		const load = import_again(
			() => Promise.reject(CHROMIUM),
			fresh,
			'https://shop.test/_app/immutable/chunks/DmQpvhkC.js'
		);
		await expect(load()).rejects.toBe(CHROMIUM);
		await expect(load()).rejects.toThrow('og-retry=1');
		await expect(load()).resolves.toBe('core');
		expect(asked).toEqual([
			'https://shop.test/_app/immutable/chunks/DmQpvhkC.js?og-retry=1',
			'https://shop.test/_app/immutable/chunks/DmQpvhkC.js?og-retry=2'
		]);
	});

	it('when the failure names no URL (Safari), tries the plain load again', async () => {
		const fresh = vi.fn();
		const plain = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(SAFARI)
			.mockResolvedValue('core');
		const load = import_again(plain, fresh);
		await expect(load()).rejects.toBe(SAFARI);
		await expect(load()).resolves.toBe('core');
		expect(fresh).not.toHaveBeenCalled();
	});

	it('when the failure names no URL (Safari) but the caller knows the file, asks for it under a new URL (#383)', async () => {
		vi.stubGlobal('location', new URL('https://shop.test/cart'));
		const file = 'https://shop.test/_app/immutable/entry/island.js';
		const asked: string[] = [];
		const fresh = vi.fn(async (url: string) => {
			asked.push(url);
			return 'island';
		});
		const load = import_again(() => Promise.reject(SAFARI), fresh, file);
		await expect(load()).rejects.toBe(SAFARI);
		await expect(load()).resolves.toBe('island');
		expect(asked).toEqual([file + '?og-retry=1']);
		vi.unstubAllGlobals();
	});

	it('a failure that names another file (Firefox names the dependency that failed) asks for the loader’s own file again, never that one', async () => {
		vi.stubGlobal('location', new URL('https://shop.test/cart'));
		const own = 'https://shop.test/_app/immutable/chunks/hydrate-core.js';
		const dependency = new TypeError(
			'error loading dynamically imported module: https://shop.test/_app/immutable/chunks/shared.js'
		);
		const asked: string[] = [];
		const fresh = vi.fn(async (url: string) => {
			asked.push(url);
			return 'core';
		});
		const load = import_again(() => Promise.reject(dependency), fresh, own);
		await expect(load()).rejects.toBe(dependency);
		await load();
		expect(asked).toEqual([own + '?og-retry=1']);
		vi.unstubAllGlobals();
	});

	it('a loader that does not know its own file never asks for the file a failure names', async () => {
		vi.stubGlobal('location', new URL('https://shop.test/cart'));
		const fresh = vi.fn();
		const plain = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(CHROMIUM)
			.mockResolvedValue('core');
		const load = import_again(plain, fresh);
		await expect(load()).rejects.toBe(CHROMIUM);
		await expect(load()).resolves.toBe('core');
		expect(fresh).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('a file named relative to the loader’s module is asked for at that module’s URL', async () => {
		const asked: string[] = [];
		const fresh = vi.fn(async (url: string) => {
			asked.push(url);
			return 'nav';
		});
		const load = import_again(
			() => Promise.reject(SAFARI),
			fresh,
			'./chunks/nav.js',
			'https://cdn.shop.test/_app/immutable/og-runtime.js'
		);
		await expect(load()).rejects.toBe(SAFARI);
		await expect(load()).resolves.toBe('nav');
		expect(asked).toEqual(['https://cdn.shop.test/_app/immutable/chunks/nav.js?og-retry=1']);
	});

	it('a failed retry fails its caller at once; a call while its verdict is out waits for it, then asks again (#392)', async () => {
		const file = 'https://shop.test/_app/immutable/chunks/nav.js';
		const asked: string[] = [];
		const fresh = vi.fn(async (url: string) => {
			asked.push(url);
			if (asked.length === 1)
				throw new TypeError(`Failed to fetch dynamically imported module: ${url}`);
			return 'nav';
		});
		const load = import_again(() => Promise.reject(SAFARI), fresh, file);
		await expect(load()).rejects.toBe(SAFARI);
		// (no timing entry ever lands for the retry, as in WebKit for a dropped download: its verdict
		// waits out the entry wait)
		vi.useFakeTimers();
		try {
			await expect(load()).rejects.toThrow('og-retry=1');
			const next = load();
			expect(asked).toHaveLength(1);
			await vi.runAllTimersAsync();
			await expect(next).resolves.toBe('nav');
		} finally {
			vi.useRealTimers();
		}
		expect(asked).toEqual([`${file}?og-retry=1`, `${file}?og-retry=2`]);
	});

	it('the page says it needs a reload exactly once, however many retries fail with their own file loaded', async () => {
		const said: string[] = [];
		on_reload_needed((url) => said.push(url));
		// (every retry's own file came: a 200 in the timeline, so each failure is a dependency's)
		const entries = vi
			.spyOn(performance, 'getEntriesByName')
			.mockImplementation(
				(name) =>
					(name.includes('og-retry')
						? [{ responseStatus: 200, responseStart: 1 }]
						: []) as unknown as PerformanceEntryList
			);
		try {
			const dep = (url: string) =>
				new TypeError(`Failed to fetch dynamically imported module: ${url}`);
			const loaders = ['a.js', 'b.js', 'c.js'].map((name) => {
				const file = `https://shop.test/_app/immutable/chunks/${name}`;
				return import_again(
					() => Promise.reject(dep(file)),
					async (url: string) => {
						throw dep(url);
					},
					file
				);
			});
			for (const load of loaders) {
				await expect(load()).rejects.toThrow(TypeError);
				await expect(load()).rejects.toThrow('og-retry=1');
				// (the verdict landed: stuck now, every later call fails at once)
				await expect(load()).rejects.toThrow('og-retry=1');
				await expect(load()).rejects.toThrow('og-retry=1');
			}
			expect(said).toEqual(['https://shop.test/_app/immutable/chunks/a.js?og-retry=1']);
		} finally {
			entries.mockRestore();
			on_reload_needed(() => {});
		}
	});

	it('a known file whose module threw (not a download) is not asked for again (#383)', async () => {
		vi.stubGlobal('location', new URL('https://shop.test/cart'));
		const fresh = vi.fn();
		const thrown = new TypeError('undefined is not a function');
		const plain = vi.fn<() => Promise<string>>().mockRejectedValue(thrown);
		const load = import_again(plain, fresh, 'https://shop.test/_app/immutable/entry/island.js');
		await expect(load()).rejects.toBe(thrown);
		await expect(load()).rejects.toBe(thrown);
		expect(fresh).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('with flights({ retry: download }): one dropped download is invisible to the caller', async () => {
		const core = flights({
			run: import_again(
				() => Promise.reject(CHROMIUM),
				async () => 'core',
				'https://shop.test/_app/immutable/chunks/DmQpvhkC.js'
			),
			retry: download
		});
		await expect(core.get()).resolves.toBe('core');
	});
});
