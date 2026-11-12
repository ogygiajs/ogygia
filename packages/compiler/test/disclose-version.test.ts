// The runtime discloses its version on `window.__ogygia.v`, as Svelte does on `window.__svelte.v`:
// a Set, so a page running more than one ogygia (a federated fragment's) lists each.
import { afterEach, expect, test, vi } from 'vitest';

type Own = { __ogygia?: { v?: Set<string> } };

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

test('the version the plugin defined joins window.__ogygia.v', async () => {
	const win: Own = {};
	vi.stubGlobal('window', win);
	vi.stubGlobal('__OGYGIA_VERSION__', '0.12.4');
	const { disclose_version } = await import('../../core/src/runtime/disclose-version.ts');
	disclose_version();
	disclose_version();
	expect([...win.__ogygia!.v!]).toEqual(['0.12.4']);
});

test("another runtime's version joins the same Set", async () => {
	const win: Own = { __ogygia: { v: new Set(['0.8.12']) } };
	vi.stubGlobal('window', win);
	vi.stubGlobal('__OGYGIA_VERSION__', '0.12.4');
	const { disclose_version } = await import('../../core/src/runtime/disclose-version.ts');
	disclose_version();
	expect([...win.__ogygia!.v!]).toEqual(['0.8.12', '0.12.4']);
});

test('nothing is written without a defined version (a plain import of the module)', async () => {
	const win: Own = {};
	vi.stubGlobal('window', win);
	const { disclose_version } = await import('../../core/src/runtime/disclose-version.ts');
	disclose_version();
	expect(win.__ogygia).toBeUndefined();
});

test('the plugin reads the installed package version', async () => {
	const { OGYGIA_VERSION } = await import('@ogygia/core/contract');
	const pkg = (await import('../../core/package.json', { with: { type: 'json' } })).default as {
		version: string;
	};
	expect(OGYGIA_VERSION).toBe(pkg.version);
});
