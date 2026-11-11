// A tab group's choice: shared by every block with the same group, saved, and safe without storage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function memory_storage(): Storage {
	const m = new Map<string, string>();
	return {
		getItem: (k) => m.get(k) ?? null,
		setItem: (k, v) => void m.set(k, v),
		removeItem: (k) => void m.delete(k),
		clear: () => m.clear(),
		key: (i) => [...m.keys()][i] ?? null,
		get length() {
			return m.size;
		}
	};
}

const no_storage = {
	getItem() {
		throw new Error('blocked');
	},
	setItem() {
		throw new Error('blocked');
	}
};

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

const load = () => import('../src/site/components/tab-groups.svelte.ts');

describe('tab groups', () => {
	it('two blocks of one group share the choice, and the choice is saved', async () => {
		const storage = memory_storage();
		vi.stubGlobal('localStorage', storage);
		const { tab_group } = await load();
		const a = tab_group('install');
		const b = tab_group('install');
		a.value = 'pnpm';
		expect(b.value).toBe('pnpm');
		expect(storage.getItem('og-tabs:install')).toBe('pnpm');
	});

	it('hydrate_group restores a saved choice, else the fallback, and never replaces a choice made this session', async () => {
		const storage = memory_storage();
		storage.setItem('og-tabs:saved', 'yarn');
		vi.stubGlobal('localStorage', storage);
		const { tab_group, hydrate_group } = await load();
		hydrate_group('saved', 'npm');
		expect(tab_group('saved').value).toBe('yarn');
		hydrate_group('fresh', 'npm');
		expect(tab_group('fresh').value).toBe('npm');
		tab_group('fresh').value = 'bun';
		storage.setItem('og-tabs:fresh', 'yarn'); // another tab saved a different choice since
		hydrate_group('fresh', 'npm');
		expect(tab_group('fresh').value).toBe('bun');
	});

	it('with storage blocked, choosing and restoring still work in memory', async () => {
		vi.stubGlobal('localStorage', no_storage);
		const { tab_group, hydrate_group } = await load();
		hydrate_group('install', 'npm');
		expect(tab_group('install').value).toBe('npm');
		tab_group('install').value = 'pnpm';
		expect(tab_group('install').value).toBe('pnpm');
	});
});
