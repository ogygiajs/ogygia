// A build's dock starts the page beacon from a lazy chunk once a browser switches devtools on. A chunk
// that fails to download leaves the page unmeasured: the app author hears it, once per page, with its
// code, instead of the failure passing in silence.
import { afterEach, expect, test, vi } from 'vitest';
import { start_page_beacon } from '../src/page-beacon-start.ts';

afterEach(() => {
	vi.restoreAllMocks();
});

test('a failed beacon chunk download prints its warning once, however often the start is asked', async () => {
	const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const dropped = new TypeError(
		'Failed to fetch dynamically imported module: /beacon-standalone.js'
	);
	const load = vi.fn(() => Promise.reject(dropped));
	await start_page_beacon(load);
	await start_page_beacon(load);
	await start_page_beacon(load);
	expect(load).toHaveBeenCalledTimes(3);
	const lines = warned.mock.calls.filter((c) =>
		String(c[0]).includes('devtools_page_beacon_load_failed')
	);
	expect(lines).toHaveLength(1);
	expect(lines[0]).toContain(dropped);
});

test('a beacon that throws as it starts is warned with the same code, and the start never rejects', async () => {
	const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const broke = new Error('observer refused');
	const standalone_beacon = vi.fn(() => {
		throw broke;
	});
	vi.resetModules();
	const fresh = await import('../src/page-beacon-start.ts');
	await expect(fresh.start_page_beacon(() => Promise.resolve({ standalone_beacon }))).resolves.toBe(
		undefined
	);
	const lines = warned.mock.calls.filter((c) =>
		String(c[0]).includes('devtools_page_beacon_load_failed')
	);
	expect(lines).toHaveLength(1);
	expect(lines[0]).toContain(broke);
});

test('a beacon chunk that loads starts the beacon and says nothing', async () => {
	const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const standalone_beacon = vi.fn();
	await start_page_beacon(() => Promise.resolve({ standalone_beacon }));
	expect(standalone_beacon).toHaveBeenCalledTimes(1);
	expect(warned).not.toHaveBeenCalled();
});
