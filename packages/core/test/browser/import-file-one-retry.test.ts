// Two islands of one file wake together, and its first download fails for both (#271). The browser
// keeps the failed URL failed, so each load is asked for again under a fresh URL; callers that
// failed together must share that retry: one fresh URL, one copy of the module. Two retries
// (`?og-retry=1` and `?og-retry=2`) both load, and the module runs twice, its state split between
// the islands.
//
// The download fails for real, at the network (the `drop_downloads` command: Playwright's
// `route.abort`).
import { afterEach, expect, test } from 'vitest';
import { commands } from 'vitest/browser';
import { import_file } from '../../src/runtime/import-again.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		drop_downloads(path: string, times: number): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

afterEach(() => commands.keep_downloads('/fixtures/island-file-copy.ts'));

test('two loads of one file that fail together share one retry, and get one copy of the module', async () => {
	const url = new URL('./fixtures/island-file-copy.ts', import.meta.url).href;
	await commands.drop_downloads('/fixtures/island-file-copy.ts', 1);
	const asked: string[] = [];
	const seen = new PerformanceObserver((list) => {
		for (const e of list.getEntries())
			if (e.name.includes('island-file-copy.ts?')) asked.push(new URL(e.name).search);
	});
	seen.observe({ type: 'resource', buffered: false });

	type Mod = { copy: object };
	const [a, b] = await Promise.all([import_file<Mod>(url), import_file<Mod>(url)]);
	seen.disconnect();

	expect(a.copy).toBe(b.copy);
	expect(asked.filter((s) => s.includes('og-retry'))).toHaveLength(1);
	// a later load is that same module
	expect((await import_file<Mod>(url)).copy).toBe(a.copy);
});
