// The page the Page tab and `page()` report from is the one the router last SWAPPED in. A navigation
// that started and never finished — it fell back to a full load a test held back (204), or a later
// one overtook it — changed nothing, and must not cut the report to "since then" (it emptied the
// islands of a page that never left).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { record_hook } from '../src/devtools/hook-record.ts';
import { last_nav } from '../src/devtools/page.ts';

const started = (at: number, to: string) => {
	vi.spyOn(performance, 'now').mockReturnValueOnce(at);
	record_hook('navStarted', { from: '/', to, type: 'link' });
};
const navigated = (t: number, at: number, to: string) => {
	vi.spyOn(performance, 'now').mockReturnValueOnce(at);
	record_hook('navigated', {
		from: '/',
		to,
		type: 'link',
		t,
		fetched: t,
		styled: t,
		swapped: at,
		reconciled: true
	});
};

beforeEach(() => {
	delete (globalThis as Record<symbol, unknown>)[Symbol.for('ogygia.hook-record')];
	vi.restoreAllMocks();
});

describe('last_nav', () => {
	it('a navigation that finished: its start, its address', () => {
		started(100, '/b');
		navigated(100, 180, '/b');
		expect(last_nav()).toEqual({ to: '/b', t: 100 });
	});
	it('one that started and never finished changes nothing', () => {
		started(100, '/login');
		expect(last_nav()).toBe(null);
		started(100, '/b');
		navigated(100, 180, '/b');
		started(900, '/login');
		expect(last_nav()).toEqual({ to: '/b', t: 100 });
	});
	it('an overtaken navigation is not the page: the one that finished is', () => {
		started(100, '/a');
		started(150, '/b');
		navigated(150, 220, '/b');
		expect(last_nav()).toEqual({ to: '/b', t: 150 });
	});
});
