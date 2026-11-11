// What measuring costs the page (src/runtime/own-cost.ts): time charged by phase, summed and
// rounded, in one ledger the runtime's and the devtools' copies of the module share.
import { afterEach, expect, test, vi } from 'vitest';

const LEDGER = Symbol.for('ogygia.own-cost');

afterEach(() => {
	delete (globalThis as Record<symbol, unknown>)[LEDGER];
	vi.restoreAllMocks();
	vi.resetModules();
});

/** `performance.now()` reads the given times in order. */
function clock(...times: number[]) {
	let i = 0;
	vi.spyOn(performance, 'now').mockImplementation(() => times[i++]);
}

test('charged time adds up by phase, and in a total', async () => {
	const { charge, own_cost } = await import('../src/runtime/own-cost.ts');
	clock(10, 12.5, 20);
	charge('hydrate', 0); // 10 ms
	charge('hydrate', 10); // 2.5 ms
	charge('visit', 15); // 5 ms
	expect(own_cost()).toEqual({ ms: 17.5, phases: { hydrate: 12.5, visit: 5 } });
});

test('metered runs its work and charges its time, even when the work throws', async () => {
	const { metered, own_cost } = await import('../src/runtime/own-cost.ts');
	clock(0, 3, 10, 14);
	expect(metered('check', () => 'done')).toBe('done');
	expect(() =>
		metered('check', () => {
			throw new Error('boom');
		})
	).toThrow('boom');
	expect(own_cost().phases).toEqual({ check: 7 });
});

test('the cost is rounded to a tenth of a millisecond', async () => {
	const { charge, own_cost } = await import('../src/runtime/own-cost.ts');
	clock(1.234, 2.36);
	charge('a', 0);
	charge('b', 2.2);
	expect(own_cost()).toEqual({ ms: 1.4, phases: { a: 1.2, b: 0.2 } });
});

test('two copies of the module (the runtime and the devtools chunks) keep one ledger', async () => {
	const first = await import('../src/runtime/own-cost.ts');
	vi.resetModules();
	const second = await import('../src/runtime/own-cost.ts');
	expect(second).not.toBe(first);
	clock(4);
	first.charge('hydrate', 0);
	expect(second.own_cost().phases).toEqual({ hydrate: 4 });
});
