// import-again.ts: a chunk whose download failed is asked for again under a fresh URL (the browser
// keeps the failed URL for the life of the page). The real browser behaviour is proven by the e2e
// lazy-chunk-retry spec; this pins the URL reading and the attempt sequence.
import { describe, expect, it, vi } from 'vitest';
import { flights } from '@ogygia/machine';
import { failed_import_url, import_again, retry_url } from '../src/runtime/import-again.ts';

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

	it('with flights({ retries: 1 }): one dropped download is invisible to the caller', async () => {
		vi.stubGlobal('location', new URL('https://shop.test/cart'));
		const core = flights({
			run: import_again(
				() => Promise.reject(CHROMIUM),
				async () => 'core'
			),
			retries: 1
		});
		await expect(core.get()).resolves.toBe('core');
		vi.unstubAllGlobals();
	});
});
