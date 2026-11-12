/**
 * The hydration scheduler's pick order (runtime/schedule.ts), turn by turn: a region in the
 * viewport before one that is not, connect order within each, two turns of one region in request
 * order; the first picks wait for every queued region's snapshot (bounded), and a ready region
 * below the fold holds while a viewport region is still loading its module (bounded). The browser
 * test (test/browser/hydration-schedule.test.ts) checks the same on a real page; this one pins the
 * order on pages large enough that the queue's bookkeeping matters.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { scope } from '@ogygia/machine';

/** The regions' lifetime in the page: their snapshots are its. */
const page = scope();

type Report = (
	entries: Array<{
		target: object;
		isIntersecting: boolean;
		boundingClientRect: { width: number; height: number };
	}>
) => void;
const observers: Report[] = [];
let s: typeof import('../src/runtime/schedule.ts');

const g = globalThis as Record<string, unknown>;
const saved = { io: g.IntersectionObserver, scheduler: g.scheduler, document: g.document };

beforeAll(async () => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
	g.IntersectionObserver = class {
		constructor(cb: Report) {
			observers.push(cb);
		}
		observe() {}
		unobserve() {}
	};
	g.scheduler = { yield: () => new Promise<void>((r) => setTimeout(r, 0)) };
	g.document = { visibilityState: 'visible' };
	s = await import('../src/runtime/schedule.ts');
});

afterAll(() => {
	vi.useRealTimers();
	g.IntersectionObserver = saved.io;
	g.scheduler = saved.scheduler;
	g.document = saved.document;
});

let made = 0;
const regions = (n: number) =>
	Array.from({ length: n }, () => ({ id: made++ }) as unknown as Element & { id: number });
const report = (el: Element, intersecting: boolean) => {
	// (a region with a box of its own: its own report decides, ./viewport.ts)
	const boundingClientRect = { width: 10, height: 10 };
	for (const cb of observers)
		cb([{ target: el, isIntersecting: intersecting, boundingClientRect }]);
};
/** Ask for every region's turn; resolves with the regions in the order their turns came. */
async function turns(els: Array<Element & { id: number }>, ask = els): Promise<number[]> {
	const order: number[] = [];
	const all = Promise.all(ask.map((el) => s.hydrate_turn(el).then(() => order.push(el.id))));
	await vi.runAllTimersAsync();
	await all;
	expect(s.schedule_idle()).toBe(true);
	return order.map((id) => id - els[0].id);
}

describe('hydration turns', () => {
	it('viewport regions first, then connect order, whatever order the turns were asked in', async () => {
		const els = regions(8);
		for (const el of els) s.register_region(el, page);
		els.forEach((el, i) => report(el, i === 6 || i === 2 || i === 5));
		const shuffled = [3, 6, 0, 7, 2, 5, 1, 4].map((i) => els[i]);
		expect(await turns(els, shuffled)).toEqual([2, 5, 6, 0, 1, 3, 4, 7]);
	});

	it('a page of 300 load wakes: every turn handed out once, in that order', async () => {
		const els = regions(300);
		for (const el of els) s.register_region(el, page);
		const visible = new Set([150, 3, 299, 42]);
		els.forEach((el, i) => report(el, visible.has(i)));
		const order = await turns(els, [...els].reverse());
		expect(order.slice(0, 4)).toEqual([3, 42, 150, 299]);
		expect(order.slice(4)).toEqual(
			Array.from({ length: 300 }, (_, i) => i).filter((i) => !visible.has(i))
		);
	});

	it('a region that leaves the viewport before its turn goes with the rest', async () => {
		const els = regions(4);
		for (const el of els) s.register_region(el, page);
		els.forEach((el, i) => report(el, i >= 2));
		const order: number[] = [];
		const all = Promise.all(
			els.map((el) => s.hydrate_turn(el).then(() => order.push(el.id - els[0].id)))
		);
		report(els[3], false);
		report(els[0], true);
		await vi.runAllTimersAsync();
		await all;
		expect(order).toEqual([0, 2, 1, 3]);
	});

	it('the first pick waits for a snapshot still to come, up to its wait', async () => {
		const els = regions(3);
		for (const el of els) s.register_region(el, page);
		report(els[0], false);
		report(els[1], false);
		const order: number[] = [];
		const all = Promise.all(
			els.map((el) => s.hydrate_turn(el).then(() => order.push(el.id - els[0].id)))
		);
		await vi.advanceTimersByTimeAsync(20);
		expect(order).toEqual([]); // region 2 has not reported
		report(els[2], true);
		await vi.runAllTimersAsync();
		await all;
		expect(order).toEqual([2, 0, 1]);
	});

	it('a ready region below the fold holds while a viewport region loads its module', async () => {
		const els = regions(2);
		for (const el of els) s.register_region(el, page);
		report(els[0], false);
		report(els[1], true);
		s.hydrate_started(els[0]);
		s.hydrate_started(els[1]);
		const order: number[] = [];
		const below = s.hydrate_turn(els[0]).then(() => order.push(0));
		await vi.advanceTimersByTimeAsync(300);
		expect(order).toEqual([]);
		const above = s.hydrate_turn(els[1]).then(() => order.push(1));
		await vi.runAllTimersAsync();
		await Promise.all([below, above]);
		expect(order).toEqual([1, 0]);
	});

	it('the hold is bounded: a viewport module that never comes holds the page 1 s at most', async () => {
		const els = regions(2);
		for (const el of els) s.register_region(el, page);
		report(els[0], false);
		report(els[1], true);
		s.hydrate_started(els[1]);
		let done = false;
		const below = s.hydrate_turn(els[0]).then(() => (done = true));
		await vi.advanceTimersByTimeAsync(990);
		expect(done).toBe(false);
		await vi.advanceTimersByTimeAsync(20);
		await below;
		expect(done).toBe(true);
		s.hydrate_settled(els[1]);
	});

	it('two turns of one region: request order; a region that disconnects gets its turns at once', async () => {
		const els = regions(3);
		for (const el of els) s.register_region(el, page);
		els.forEach((el) => report(el, false));
		const order: string[] = [];
		const all = Promise.all([
			s.hydrate_turn(els[1]).then(() => order.push('1a')),
			s.hydrate_turn(els[0]).then(() => order.push('0')),
			s.hydrate_turn(els[1]).then(() => order.push('1b')),
			s.hydrate_turn(els[2]).then(() => order.push('2'))
		]);
		s.unregister_region(els[2]);
		await vi.runAllTimersAsync();
		await all;
		expect(order).toEqual(['2', '0', '1a', '1b']);
	});
});
