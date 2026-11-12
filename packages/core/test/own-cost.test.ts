// What measuring costs the page (src/runtime/own-cost.ts): time charged by phase, summed and
// rounded, in one ledger the runtime's and the devtools' copies of the module share.
import { afterEach, expect, test, vi } from 'vitest';
import { charge, metered, own_cost } from '../src/runtime/own-cost.ts';

const LEDGER = Symbol.for('ogygia.own-cost');

afterEach(() => {
	// (the module holds the ledger it found: empty it in place, so one import serves every test)
	const ledger = (globalThis as Record<symbol, Record<string, number>>)[LEDGER]!;
	for (const k in ledger) delete ledger[k];
	vi.restoreAllMocks();
});

/** `performance.now()` reads the given times in order (the last one again, past the end). */
function clock(...times: number[]) {
	let i = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => times[Math.min(i++, times.length - 1)]);
}

test('charged time adds up by phase, and in a total', () => {
	clock(10, 12.5, 20);
	charge('hydrate', 0); // 10 ms
	charge('hydrate', 10); // 2.5 ms
	charge('visit', 15); // 5 ms
	expect(own_cost()).toEqual({ ms: 17.5, phases: { hydrate: 12.5, visit: 5 } });
});

test('metered runs its work and charges its time, even when the work throws', () => {
	clock(0, 3, 10, 14);
	expect(metered('check', () => 'done')).toBe('done');
	expect(() =>
		metered('check', () => {
			throw new Error('boom');
		})
	).toThrow('boom');
	expect(own_cost().phases).toEqual({ check: 7 });
});

test('the cost is rounded to a tenth of a millisecond', () => {
	clock(1.234, 2.36);
	charge('a', 0);
	charge('b', 2.2);
	expect(own_cost()).toEqual({ ms: 1.4, phases: { a: 1.2, b: 0.2 } });
});

test('two copies of the module (the runtime and the devtools chunks) keep one ledger', async () => {
	vi.resetModules();
	const second = await import('../src/runtime/own-cost.ts');
	expect(second.charge).not.toBe(charge);
	clock(4);
	charge('hydrate', 0);
	expect(second.own_cost().phases).toEqual({ hydrate: 4 });
});
