import { beforeEach, describe, expect, it, vi } from 'vitest';

const LEDGER = Symbol.for('ogygia.leftovers');
const RECORD = Symbol.for('ogygia.hook-record');

beforeEach(() => {
	delete (globalThis as Record<symbol, unknown>)[LEDGER];
	delete (globalThis as Record<symbol, unknown>)[RECORD];
	vi.resetModules();
});

const region = { isConnected: true } as unknown as Element;

describe('a second copy of the readers (the testing engine a test injects)', () => {
	it('sees the islands the realm’s copy of the leftovers watch saw', async () => {
		const realm = await import('../src/devtools/leftovers.ts');
		realm.leftover_island_seen(region, '/a.js', ['http://x/a.js']);
		vi.resetModules();
		const engine = await import('../src/devtools/leftovers.ts');
		expect(engine.leftover_island_seen).not.toBe(realm.leftover_island_seen);
		expect(engine.leftover_state().islands.map((i) => i.entry)).toEqual(['/a.js']);
	});

	it('reads the build’s dev flag, names and sidecar lookup the realm lent through the hook record', async () => {
		const { record_realm } = await import('../src/devtools/hook-record.ts');
		const sidecar = { textContent: '{"a":1}' } as HTMLScriptElement;
		record_realm({
			dev: true,
			lend: async () => ({ region_names: { abc: 'Clock' }, props_sidecar_of: () => sidecar })
		});
		vi.resetModules();
		vi.stubGlobal('window', {});
		const entries = await import('../src/devtools/hook-entries.ts');
		const regions = await import('../src/devtools/regions.ts');
		const { ensure_region_names } = await import('../src/devtools/names.ts');
		expect(entries.built_dev()).toBe(true);
		await ensure_region_names();
		expect((window as { __ogygia_region_names?: unknown }).__ogygia_region_names).toEqual({
			abc: 'Clock'
		});
		expect(regions.region_props_sidecar(region)).toBe('{"a":1}');
		vi.unstubAllGlobals();
	});

	it('with no realm on the page, the build is not the dev server’s and nothing is live', async () => {
		const entries = await import('../src/devtools/hook-entries.ts');
		expect(entries.built_dev()).toBe(false);
		expect(entries.recorded_realm()).toBeUndefined();
	});
});
