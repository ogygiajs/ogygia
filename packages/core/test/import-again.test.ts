// import-again.ts: a chunk whose download failed is asked for again under a fresh URL (the browser
// keeps the failed URL for the life of the page). The real browser behaviour is proven by the e2e
// lazy-chunk-retry spec; this pins the URL reading and the attempt sequence.
import { describe, expect, it, vi } from 'vitest';
import { flights } from '@ogygia/machine';
import {
	failed_import_url,
	import_again,
	is_failed_import,
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

describe('failed_import_url', () => {
	it('reads the URL from Chromium and Firefox messages', () => {
		vi.stubGlobal('location', new URL('https://shop.test/cart'));
		expect(failed_import_url(CHROMIUM)).toBe('https://shop.test/_app/immutable/chunks/DmQpvhkC.js');
		expect(failed_import_url(FIREFOX)).toBe('https://shop.test/_app/immutable/chunks/DmQpvhkC.js');
		vi.unstubAllGlobals();
	});

	it('tells a failed load from a module that threw, in every engine’s wording (#383)', () => {
		expect(is_failed_import(CHROMIUM)).toBe(true);
		expect(is_failed_import(FIREFOX)).toBe(true);
		expect(is_failed_import(SAFARI)).toBe(true);
		expect(is_failed_import(new TypeError('undefined is not a function'))).toBe(false);
		expect(is_failed_import(undefined)).toBe(false);
	});

	it('names none for Safari, an evaluation error, another origin or a non-http URL', () => {
		vi.stubGlobal('location', new URL('https://shop.test/cart'));
		expect(failed_import_url(SAFARI)).toBe(null);
		expect(failed_import_url(new ReferenceError('x is not defined'))).toBe(null);
		expect(
			failed_import_url(
				new TypeError('Failed to fetch dynamically imported module: https://cdn.other/x.js')
			)
		).toBe(null);
		expect(
			failed_import_url(
				new TypeError('Failed to fetch dynamically imported module: data:text/javascript,1')
			)
		).toBe(null);
		expect(failed_import_url(undefined)).toBe(null);
		vi.unstubAllGlobals();
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

	it('after a failed download, asks for the same file under a new URL each time', async () => {
		vi.stubGlobal('location', new URL('https://shop.test/cart'));
		const asked: string[] = [];
		const fresh = vi.fn(async (url: string) => {
			asked.push(url);
			if (asked.length === 1)
				throw new TypeError(`Failed to fetch dynamically imported module: ${url}`);
			return 'core';
		});
		const load = import_again(() => Promise.reject(CHROMIUM), fresh);
		await expect(load()).rejects.toBe(CHROMIUM);
		await expect(load()).rejects.toThrow('og-retry=1');
		await expect(load()).resolves.toBe('core');
		expect(asked).toEqual([
			'https://shop.test/_app/immutable/chunks/DmQpvhkC.js?og-retry=1',
			'https://shop.test/_app/immutable/chunks/DmQpvhkC.js?og-retry=2'
		]);
		vi.unstubAllGlobals();
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
		vi.stubGlobal('location', new URL('https://shop.test/cart'));
		const core = flights({
			run: import_again(
				() => Promise.reject(CHROMIUM),
				async () => 'core'
			),
			retry: download
		});
		await expect(core.get()).resolves.toBe('core');
		vi.unstubAllGlobals();
	});
});
