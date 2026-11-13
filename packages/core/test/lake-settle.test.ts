// A LAKE'S CONTENT, as the regions in it see it (src/runtime/session.ts `LAKE`). Settling and
// waking are two moments: a lake's answer settles it BEFORE its swap (what the swap brings in then
// connects and runs), and the regions that waited are woken AFTER it (woken earlier, they would run
// with no content).
import { expect, test } from 'vitest';
import { RuntimeSession } from '../src/runtime/session.ts';

const lake = () => ({}) as Element;

test('a region in an unsettled lake waits; in a settled one it runs', () => {
	const s = new RuntimeSession();
	const a = lake();
	expect(s.lake_settled(a)).toBe(false);
	expect(s.wait_on_lake(a)).toBe(true);
	const b = lake();
	s.settle_lake(b);
	expect(s.wait_on_lake(b)).toBe(false);
});

test('settled before its swap, a lake wakes the regions that waited only after it', () => {
	const s = new RuntimeSession();
	const a = lake();
	s.wait_on_lake(a);
	s.settle_lake(a); // the answer is in hand, the swap not done
	expect(s.lake_settled(a)).toBe(true); // a region connecting now runs
	expect(s.wake_lake(a)).toBe(true); // after the swap: the waiters wake, once
	expect(s.wake_lake(a)).toBe(false);
});

test('a lake nobody waited on wakes nobody after its swap', () => {
	const s = new RuntimeSession();
	const a = lake();
	s.settle_lake(a);
	expect(s.wake_lake(a)).toBe(false);
});

test('a lake whose refresh failed for good is settled as it stands', () => {
	const s = new RuntimeSession();
	const a = lake();
	s.wait_on_lake(a);
	s.settle_lake_now(a);
	expect(s.lake_settled(a)).toBe(true);
	expect(s.wake_lake(a)).toBe(false); // its waiters were woken with it
});
