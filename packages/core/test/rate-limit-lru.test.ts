// The rate limiter's buckets (src/server/rate-limit.ts): past `cap` the least recently used address
// goes, and a use is any charge, a new window's first one too.
import { afterEach, expect, test, vi } from 'vitest';
import { clock } from '@ogygia/machine';
import { RateLimiter } from '../src/server/rate-limit.ts';

afterEach(() => vi.restoreAllMocks());

test('a visitor whose window rolled over is used again, not the first let go under pressure', () => {
	let now = 0;
	vi.spyOn(clock, 'mono').mockImplementation(() => now);
	const limiter = new RateLimiter({ max: 1, windowMs: 100, cap: 2 });
	expect(limiter.limited('a')).toBe(false);
	expect(limiter.limited('b')).toBe(false);
	now = 100; // a's window (and b's) is over
	expect(limiter.limited('a')).toBe(false); // a new window: a is the most recent use
	expect(limiter.limited('c')).toBe(false); // past the cap: the least recent (b) goes
	expect(limiter.size).toBe(2);
	// a spent its budget in this window: still over it, not handed a fresh one
	expect(limiter.limited('a')).toBe(true);
});

test('past the cap, a window that ended goes before a visitor still in theirs', () => {
	let now = 0;
	vi.spyOn(clock, 'mono').mockImplementation(() => now);
	const limiter = new RateLimiter({ max: 1, windowMs: 100, cap: 2 });
	expect(limiter.limited('ended')).toBe(false); // its window: 0 to 100
	now = 40;
	expect(limiter.limited('live')).toBe(false); // its window: 40 to 140, budget spent
	now = 50;
	expect(limiter.limited('ended')).toBe(true); // a use: now the most recent
	now = 110; // ended's window is over, live's is not
	expect(limiter.limited('new')).toBe(false); // past the cap: one goes
	// live spent its budget in a window still open: still over it
	expect(limiter.limited('live')).toBe(true);
});
