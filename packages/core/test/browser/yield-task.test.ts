import { afterEach, expect, test, vi } from 'vitest';
import { yield_task } from '../../src/runtime/schedule.ts';

const g = globalThis as { scheduler?: unknown };
const real = Object.getOwnPropertyDescriptor(globalThis, 'scheduler');

function without_scheduler(): void {
	Object.defineProperty(globalThis, 'scheduler', {
		value: undefined,
		configurable: true,
		writable: true
	});
}

afterEach(() => {
	if (real) Object.defineProperty(globalThis, 'scheduler', real);
	else delete g.scheduler;
});

test('a yield uses scheduler.yield where the browser has it', async () => {
	const yielded = vi.fn(() => Promise.resolve());
	Object.defineProperty(globalThis, 'scheduler', {
		value: { yield: yielded },
		configurable: true,
		writable: true
	});
	await yield_task();
	expect(yielded).toHaveBeenCalledTimes(1);
});

test('without scheduler.yield, a yield lands in a new task, not in a microtask', async () => {
	without_scheduler();
	let micro_ran = false;
	let landed_after_micro = false;
	const hop = yield_task().then(() => (landed_after_micro = micro_ran));
	queueMicrotask(() => queueMicrotask(() => (micro_ran = true)));
	await hop;
	expect(landed_after_micro).toBe(true);
});

test('without scheduler.yield, hops asked together land in the order they were asked', async () => {
	without_scheduler();
	const order: number[] = [];
	await Promise.all([0, 1, 2, 3].map((i) => yield_task().then(() => order.push(i))));
	expect(order).toEqual([0, 1, 2, 3]);
});

test('without scheduler.yield, a chain of 100 hops pays no timer clamp', async () => {
	without_scheduler();
	const t0 = performance.now();
	for (let i = 0; i < 100; i++) await yield_task();
	expect(performance.now() - t0).toBeLessThan(200);
});
