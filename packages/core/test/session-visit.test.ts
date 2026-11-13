// What belongs to one page lives on its visit (src/runtime/session.ts `PageVisit`): the next page's
// swap starts it over, and a navigation's next visit holds nothing of the page on screen.
import { expect, test } from 'vitest';
import { RuntimeSession } from '../src/runtime/session.ts';

const entry = { frag: {} as Node, endpoint: '', when: '', cachedAt: 0, maxAgeMs: 0 };

function used(session: RuntimeSession): void {
	session.mark_page_seeded();
	session.mark_remote_seeded();
	session.kit_page = true;
	session.lake_cache.set('lake', entry);
	session.initialized_lakes.add('lake');
}

const page_state = (session: RuntimeSession) => ({
	page: session.page_seeded,
	remote: session.remote_seeded,
	kit: session.kit_page,
	cached: session.lake_cache.size,
	initialized: session.initialized_lakes.size
});

const FRESH = { page: false, remote: false, kit: undefined, cached: 0, initialized: 0 };

test("the next page's swap starts the page's state over", () => {
	const session = new RuntimeSession();
	used(session);
	expect(page_state(session)).toEqual({
		...FRESH,
		page: true,
		remote: true,
		kit: true,
		cached: 1,
		initialized: 1
	});
	session.reset(session.next_visit());
	expect(page_state(session)).toEqual(FRESH);
});

test('a navigation that never swaps leaves the page on screen as it was', () => {
	const session = new RuntimeSession();
	used(session);
	const next = session.next_visit();
	next.scope.close(); // called off
	expect(page_state(session).cached).toBe(1);
	expect(session.page_seeded).toBe(true);
});

test('the visit that ends closes its scope', () => {
	const session = new RuntimeSession();
	const left = session.visit;
	session.reset();
	expect(left.scope.signal.aborted).toBe(true);
});

test('past 64 lakes the one cached or refreshed longest ago goes; reading one keeps nothing', () => {
	const session = new RuntimeSession();
	for (let i = 0; i < 64; i++) session.lake_cache.set(`lake-${i}`, entry);
	session.lake_cache.peek('lake-0'); // a read: not a use
	session.lake_cache.set('lake-1', entry); // a refresh: the newest now
	session.lake_cache.set('lake-64', entry);
	expect(session.lake_cache.has('lake-0')).toBe(false);
	expect(session.lake_cache.has('lake-1')).toBe(true);
	session.lake_cache.set('lake-65', entry);
	expect(session.lake_cache.has('lake-2')).toBe(false);
	expect(session.lake_cache.size).toBe(64);
});

test("the page's lake cache ends with its visit", () => {
	const session = new RuntimeSession();
	const cached = session.lake_cache;
	cached.set('lake', entry);
	session.reset();
	expect(cached.size).toBe(0);
	expect(cached.set('lake', entry)).toBe(false);
});
