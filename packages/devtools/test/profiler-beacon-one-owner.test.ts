// One page beacon a document, whatever reaches it: two copies of the regions' half (two apps'
// runtimes) hand their data to the first, and `ogygia/profiler/client` carries no beacon of its own.
// Two beacons once split the browser's CPU samples and sent every visit twice.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { _restart_page_beacon, type PageBeacon } from '../src/profiler/beacon-standalone.ts';

type Beacon = typeof import('../src/profiler/beacon.ts');

const g = globalThis as Record<string, unknown>;
beforeEach(() => {
	vi.useFakeTimers();
	g.document = {
		querySelector: (s: string) =>
			s.includes('ogygia-profiler-beacon') ? { getAttribute: () => '/__profiler/beacon' } : null,
		querySelectorAll: () => [],
		addEventListener: () => {},
		visibilityState: 'visible',
		cookie: ''
	};
	g.addEventListener = () => {};
	vi.stubGlobal('location', new URL('http://localhost/'));
});
afterEach(() => {
	(globalThis as unknown as Record<symbol, PageBeacon | undefined>)[
		Symbol.for('ogygia.beacon')
	]?.stop();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	delete g.document;
	delete g.addEventListener;
});

test("the second copy of the regions' half hands its hydrations to the first", async () => {
	// @ts-expect-error a query makes a second module instance
	const a: Beacon = await import('../src/profiler/beacon.ts?copy=a');
	// @ts-expect-error a query makes a second module instance
	const b: Beacon = await import('../src/profiler/beacon.ts?copy=b');
	a._reset_beacon();
	b._reset_beacon();
	const page = _restart_page_beacon();
	a.install_beacon(false);
	b.install_beacon(false);

	const el = {
		getAttribute: (n: string) => (n === 'data-og-fp' ? 'fp1' : n === 'entry' ? 'x.js' : null),
		hasAttribute: () => false,
		innerHTML: ''
	};
	b.beacon_hydrated(el as unknown as Element, 0, 1, 2);
	expect(page.state().queued).toBe(1);
	expect(a.beacon_page()?.islands.map((i) => i.fp)).toEqual(['fp1']);
	expect(b.beacon_page()?.islands.map((i) => i.fp)).toEqual(['fp1']);

	a._reset_beacon();
	expect(g[Symbol.for('ogygia.beacon.regions') as unknown as string]).toBeUndefined();
});

test("ogygia/profiler/client carries no beacon of its own: its marks reach the page's, and an early one waits for it", async () => {
	const key = Symbol.for('ogygia.beacon');
	const store = globalThis as Record<symbol, unknown>;
	// @ts-expect-error a query makes a fresh module instance
	const { mark } = await import('../src/profiler/client.ts?fresh=1');
	delete store[key];
	mark.start('early').end();
	await vi.advanceTimersByTimeAsync(60_000);
	const page = _restart_page_beacon();
	expect(page.state().marks).toBe(1);
	mark.start('late').end();
	expect(page.state().marks).toBe(2);
});
