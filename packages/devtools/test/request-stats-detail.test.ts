/**
 * DETAIL IS HELD (profiler/request-stats.ts): two profilers can record at once in one process (the
 * dev server re-runs the app's hooks on an edit: a new profiler, while the old one's timers still
 * record). The first window to end must not turn detail off under the other, and a window's own
 * release lets go of its hold only, once.
 */
import { describe, it, expect } from 'vitest';
import { scope } from '@ogygia/machine';
import { hold_request_stats_detail, request_stats_store } from '../src/profiler/request-stats.ts';

/** what core's handle asks before it spends on the per-island rows */
const request_stats_detailed = () => request_stats_store.detailed();

describe('hold_request_stats_detail', () => {
	it('stays on while any window holds it; overlapping windows end in any order', () => {
		expect(request_stats_detailed()).toBe(false);
		const a = hold_request_stats_detail(); // window A
		const b = hold_request_stats_detail(); // window B, overlapping
		a(); // A ends first
		expect(request_stats_detailed()).toBe(true); // B still records: its render keeps its rows
		b(); // B ends
		expect(request_stats_detailed()).toBe(false);
	});
	it('a release called twice lets go once: it never ends another window’s hold', () => {
		const a = hold_request_stats_detail();
		const b = hold_request_stats_detail();
		a();
		a(); // a second "off" from A (a retried cleanup)
		expect(request_stats_detailed()).toBe(true); // B still holds it
		b();
		expect(request_stats_detailed()).toBe(false);
		// the next window still turns it on
		const c = hold_request_stats_detail();
		expect(request_stats_detailed()).toBe(true);
		c();
		expect(request_stats_detailed()).toBe(false);
	});
	it('a hold given an owner goes with it: a window that ends without its release lets go', () => {
		const window_scope = scope();
		hold_request_stats_detail(window_scope);
		expect(request_stats_detailed()).toBe(true);
		window_scope.close(); // the window ended (its recording failed before its own release)
		expect(request_stats_detailed()).toBe(false);
	});
});
