// A WINDOW ID is a capability (@ogygia/machine): signed under a key derived from the profiler's
// secret, it expires, names what it is for, and is checked in constant time. A production profiler
// with no secret mints and takes none; dev without one signs under a key of this process alone.
import { afterEach, expect, it, vi } from 'vitest';
import { window_ids, WINDOW_ID_MS } from '../src/profiler/window-id.ts';

const SECRET = 'a-profiler-secret-of-32-bytes-ok';

afterEach(() => vi.useRealTimers());

it('an id it minted checks; the same id under another secret does not', () => {
	const ids = window_ids(SECRET, false)!;
	const id = ids.mint();
	expect(ids.check(id)).toBe(id);
	expect(window_ids(`${SECRET}-rotated`, false)!.check(id)).toBeNull();
});

it('an id ends after its lifetime', () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	const ids = window_ids(SECRET, false)!;
	const id = ids.mint();
	vi.setSystemTime(Date.now() + WINDOW_ID_MS + 1);
	expect(ids.check(id)).toBeNull();
});

it('an id with any part changed does not check', () => {
	const ids = window_ids(SECRET, false)!;
	const parts = ids.mint().split('.');
	for (let i = 0; i < parts.length; i++) {
		const changed = [...parts];
		changed[i] = changed[i]!.slice(0, -1) + (changed[i]!.endsWith('A') ? 'B' : 'A');
		expect(ids.check(changed.join('.'))).toBeNull();
	}
	expect(ids.check(null)).toBeNull();
	expect(ids.check('x'.repeat(4096))).toBeNull();
});

it('production with no secret has no window ids', () => {
	expect(window_ids('', false)).toBeNull();
});

it('dev with no secret signs under a key of its own process: another one’s id does not check', () => {
	const a = window_ids('', true)!;
	const b = window_ids('', true)!;
	const id = a.mint();
	expect(a.check(id)).toBe(id);
	expect(b.check(id)).toBeNull();
});
