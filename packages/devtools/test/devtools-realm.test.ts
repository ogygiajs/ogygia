// The realm (realm.ts) in two copies on one page: the dock's, built with the app, and the testing
// engine's, which a test injects and `testing()` feeds. The runtime hands both the same event
// object; each reader is fed once.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEYS = [
	'ogygia.leftovers',
	'ogygia.hook-record',
	'ogygia.hook-once.record',
	'ogygia.hook-once.beacon',
	'ogygia.beacon',
	'ogygia.beacon.regions'
];

beforeEach(() => {
	for (const k of KEYS) delete (globalThis as Record<symbol, unknown>)[Symbol.for(k)];
	vi.unstubAllGlobals();
	vi.resetModules();
});

const region = (fp: string) =>
	({
		isConnected: true,
		getAttribute: (k: string) => (k === 'data-og-fp' ? fp : null),
		hasAttribute: () => false
	}) as unknown as Element;

describe('two copies of the realm', () => {
	it('a hook call both hear is in the record once', async () => {
		const dock = await import('../src/realm.ts');
		vi.resetModules();
		const engine = await import('../src/realm.ts');
		expect(engine.realm_hook).not.toBe(dock.realm_hook);
		const e = { el: region('f1'), when: 'load' };
		dock.realm_hook('regionWoke', e);
		engine.realm_hook('regionWoke', e);
		engine.realm_hook('regionWoke', { el: region('f2'), when: 'load' });
		const { hook_entries } = await import('../src/devtools/hook-entries.ts');
		expect(hook_entries().map((x) => x.fp)).toEqual(['f1', 'f2']);
	});

	it('each role handles a call once, whichever copy asks first, and the roles do not share', async () => {
		const a = await import('../src/devtools/hook-once.ts');
		vi.resetModules();
		const b = await import('../src/devtools/hook-once.ts');
		const e = {};
		expect(a.first_handling('beacon', e)).toBe(true);
		expect(b.first_handling('beacon', e)).toBe(false);
		expect(b.first_handling('record', e)).toBe(true);
		expect(b.first_handling('beacon', {})).toBe(true);
	});

	it('the leftovers watch patches the page’s timers once', async () => {
		const set_interval = () => 0;
		const win = { setInterval: set_interval, clearInterval: () => {} };
		vi.stubGlobal('window', win);
		const dock = await import('../src/devtools/leftovers.ts');
		dock.watch_leftovers();
		const once = win.setInterval;
		expect(once).not.toBe(set_interval);
		vi.resetModules();
		const engine = await import('../src/devtools/leftovers.ts');
		engine.watch_leftovers();
		expect(win.setInterval).toBe(once);
	});
});
