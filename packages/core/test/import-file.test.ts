// AN ISLAND FILE'S LOAD (runtime/import-again.ts `import_file`): one flight per file, through the
// file's own import_again. A failed download whose timing entry never lands (WebKit gives a dropped
// one none) is asked for again; one the server answered for is the caller's; a module that threw is
// never asked for again. And a file that names no URL to ask again under fails with the import's
// own error.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const import_code = vi.fn<(url: string) => Promise<unknown>>();
vi.mock('../src/runtime/code-origins.ts', async (original) => ({
	...(await original<typeof import('../src/runtime/code-origins.ts')>()),
	import_code: (url: string) => import_code(url)
}));

const { import_again, import_file } = await import('../src/runtime/import-again.ts');
const { code_url_or_refuse } = await import('../src/runtime/code-origins.ts');

const failed = (url: string) =>
	new TypeError(`Failed to fetch dynamically imported module: ${url}`);
/** The timeline's entry for each URL (none: never landed). */
const entries = new Map<string, number>();

beforeEach(() => {
	vi.stubGlobal('location', new URL('https://shop.test/cart'));
	import_code.mockReset();
	entries.clear();
	vi.spyOn(performance, 'getEntriesByName').mockImplementation(
		(name) =>
			(entries.has(name)
				? [{ responseStatus: entries.get(name), responseStart: 1 }]
				: []) as unknown as PerformanceEntryList
	);
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('import_file', () => {
	it('a failed download whose timing entry never lands is asked for again under a new URL', async () => {
		const url = code_url_or_refuse('https://shop.test/_app/immutable/chunks/never-landed.js');
		import_code.mockImplementation(async (asked) => {
			if (asked === url) throw failed(url);
			return { island: true };
		});
		vi.useFakeTimers();
		const loaded = import_file(url);
		await vi.runAllTimersAsync();
		await expect(loaded).resolves.toEqual({ island: true });
		expect(import_code.mock.calls.map(([u]) => u)).toEqual([url, `${url}?og-retry=1`]);
	});

	it('a failed download the server answered for (a 404) is the caller’s: never asked for again', async () => {
		const url = code_url_or_refuse('https://shop.test/_app/immutable/chunks/answered.js');
		entries.set(url, 404);
		const error = failed(url);
		import_code.mockRejectedValue(error);
		await expect(import_file(url)).rejects.toBe(error);
		expect(import_code).toHaveBeenCalledTimes(1);
	});

	it('a module that threw is not asked for again, and its caller hears at once', async () => {
		const url = code_url_or_refuse('https://shop.test/_app/immutable/chunks/threw.js');
		const thrown = new TypeError('undefined is not a function');
		import_code.mockRejectedValue(thrown);
		vi.useFakeTimers();
		const loaded = import_file(url);
		const heard = expect(loaded).rejects.toBe(thrown);
		await vi.runAllTimersAsync();
		await heard;
		expect(import_code).toHaveBeenCalledTimes(1);
	});
});

describe('import_again', () => {
	it('a failed download of a file that names no URL fails with the import’s own error, and is loaded the plain way next time', async () => {
		const error = failed('https://shop.test/x.js');
		const fresh = vi.fn();
		const plain = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(error)
			.mockResolvedValue('x');
		const load = import_again(plain, fresh, 'http://[');
		await expect(load()).rejects.toBe(error);
		await expect(load()).resolves.toBe('x');
		expect(fresh).not.toHaveBeenCalled();
	});
});
