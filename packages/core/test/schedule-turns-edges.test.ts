import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { scope } from '@ogygia/machine';

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
const doc = { visibilityState: 'visible' as DocumentVisibilityState };

beforeAll(async () => {
	vi.useFakeTimers({
		toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance']
	});
	g.IntersectionObserver = class {
		constructor(cb: Report) {
			observers.push(cb);
		}
		observe() {}
		unobserve() {}
	};
	g.scheduler = { yield: () => new Promise<void>((r) => setTimeout(r, 0)) };
	g.document = doc;
	s = await import('../src/runtime/schedule.ts');
});

afterEach(() => {
	doc.visibilityState = 'visible';
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
	const boundingClientRect = { width: 10, height: 10 };
	for (const cb of observers)
		cb([{ target: el, isIntersecting: intersecting, boundingClientRect }]);
};
async function settle(all: Promise<unknown>): Promise<void> {
	await vi.runAllTimersAsync();
	await all;
	expect(s.schedule_idle()).toBe(true);
}

describe('hydration turns, the edges', () => {
	it('a hidden document hands out its first turn without waiting for a snapshot', async () => {
		doc.visibilityState = 'hidden';
		const [el] = regions(1);
		s.register_region(el, page);
		let done = false;
		const turn = s.hydrate_turn(el).then(() => (done = true));
		await vi.advanceTimersByTimeAsync(1);
		expect(done).toBe(true);
		await settle(turn);
	});

	it('a hidden document holds no ready region for a viewport region still loading', async () => {
		const [low, top] = regions(2);
		s.register_region(low, page);
		s.register_region(top, page);
		report(low, false);
		report(top, true);
		s.hydrate_started(top);
		doc.visibilityState = 'hidden';
		let done = false;
		const turn = s.hydrate_turn(low).then(() => (done = true));
		await vi.advanceTimersByTimeAsync(1);
		expect(done).toBe(true);
		s.hydrate_settled(top);
		await settle(turn);
	});

	it('the turn is handed out in the task that picked it: the hydrate step runs before any later task', async () => {
		const [el] = regions(1);
		s.register_region(el, page);
		report(el, true);
		let done = false;
		const turn = s.hydrate_turn(el).then(() => (done = true));
		await vi.runOnlyPendingTimersAsync();
		expect(done).toBe(true);
		await settle(turn);
	});

	it('a hold that a viewport turn ends leaves no timer behind', async () => {
		const [low, top] = regions(2);
		s.register_region(low, page);
		s.register_region(top, page);
		report(low, false);
		report(top, true);
		s.hydrate_started(top);
		const order: string[] = [];
		const below = s.hydrate_turn(low).then(() => order.push('low'));
		await vi.advanceTimersByTimeAsync(10);
		const above = s.hydrate_turn(top).then(() => order.push('top'));
		await vi.advanceTimersByTimeAsync(5);
		await Promise.all([below, above]);
		expect(order).toEqual(['top', 'low']);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('a turn handed out at its region leaving is passed over by the next pick', async () => {
		const [gone, next] = regions(2);
		s.register_region(gone, page);
		s.register_region(next, page);
		report(gone, false);
		report(next, false);
		const first = s.hydrate_turn(gone);
		s.unregister_region(gone);
		await first;
		const turn = s.hydrate_turn(next);
		await settle(turn);
		expect(s.turns_counted()).toBeNull();
	});

	it('the turns of one region come in the order they were asked for, whatever else is queued', async () => {
		const els = regions(12);
		for (const el of els) s.register_region(el, page);
		for (const el of els) report(el, false);
		const one = els[5];
		const order: number[] = [];
		const all: Promise<unknown>[] = [];
		for (let i = 0; i < 6; i++) {
			all.push(s.hydrate_turn(one).then(() => order.push(i)));
			all.push(s.hydrate_turn(els[(i * 7) % 12]));
		}
		await settle(Promise.all(all));
		expect(order).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it('a region that leaves gets its turns latest first', async () => {
		const [el] = regions(1);
		s.register_region(el, page);
		report(el, false);
		const order: string[] = [];
		const all = Promise.all([
			s.hydrate_turn(el).then(() => order.push('first')),
			s.hydrate_turn(el).then(() => order.push('second'))
		]);
		s.unregister_region(el);
		await settle(all);
		expect(order).toEqual(['second', 'first']);
	});

	it('a viewport region that took its turn holds nobody, though its hydrate never says it settled', async () => {
		const [top, low] = regions(2);
		s.register_region(top, page);
		s.register_region(low, page);
		report(top, true);
		report(low, false);
		s.hydrate_started(top);
		await settle(s.hydrate_turn(top));
		let done = false;
		const turn = s.hydrate_turn(low).then(() => (done = true));
		await vi.advanceTimersByTimeAsync(50);
		expect(done).toBe(true);
		await settle(turn);
	});

	it('a region whose owner ended is no longer watched: its later reports move nothing', async () => {
		const owner = scope();
		const [watched, first] = regions(2);
		s.register_region(first, page);
		s.register_region(watched, owner);
		report(first, false);
		report(watched, false);
		owner.close();
		report(watched, true);
		const order: number[] = [];
		const all = Promise.all([
			s.hydrate_turn(watched).then(() => order.push(watched.id)),
			s.hydrate_turn(first).then(() => order.push(first.id))
		]);
		await settle(all);
		expect(order).toEqual([first.id, watched.id]);
	});

	it("an owner that ends after its region's turn leaves the region's next snapshot, another owner's, running", async () => {
		const before = scope();
		const after = scope();
		const [el, first] = regions(2);
		s.register_region(first, page);
		s.register_region(el, before);
		report(first, false);
		report(el, false);
		await settle(s.hydrate_turn(el));
		s.register_region(el, after);
		before.close();
		report(el, true);
		const order: number[] = [];
		const all = Promise.all([
			s.hydrate_turn(first).then(() => order.push(first.id)),
			s.hydrate_turn(el).then(() => order.push(el.id))
		]);
		await settle(all);
		expect(order).toEqual([el.id, first.id]);
		after.close();
	});
});

describe('background starts, the budget', () => {
	it('a drain that ran past its budget leaves the rest to a new background task', () => {
		const posted: (() => void)[] = [];
		const prev = g.scheduler;
		g.scheduler = { postTask: (cb: () => void) => posted.push(cb) };
		try {
			const ran: number[] = [];
			const slow = (i: number) => () => {
				ran.push(i);
				vi.advanceTimersByTime(20);
			};
			for (let i = 0; i < 4; i++) s.background_start(slow(i));
			expect(posted).toHaveLength(1);
			posted[0]();
			expect(ran).toEqual([0, 1]);
			expect(posted).toHaveLength(2);
			posted[1]();
			expect(ran).toEqual([0, 1, 2, 3]);
		} finally {
			g.scheduler = prev;
		}
	});
});
