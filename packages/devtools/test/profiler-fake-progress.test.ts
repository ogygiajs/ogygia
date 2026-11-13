// The profile view's progress bar (profiler/ui/fake-progress.svelte.ts) ticks on a timer while a
// profile runs. A view that unmounts mid-run must take its timer with it: disposing the bar stops
// it, at once and for good (it ticked on forever, with no way to stop it but finish() or fail()).
import { afterEach, expect, it, vi } from 'vitest';
import { FakeProgress } from '../src/profiler/ui/fake-progress.svelte.ts';

afterEach(() => vi.useRealTimers());

it('a disposed progress bar stops ticking', () => {
	vi.useFakeTimers();
	const p = new FakeProgress();
	p.start();
	vi.advanceTimersByTime(1000);
	const at = p.value;
	expect(at).toBeGreaterThan(0);
	p.close();
	expect(vi.getTimerCount()).toBe(0);
	vi.advanceTimersByTime(5000);
	expect(p.value).toBe(at);
	// a start after it is disposed starts nothing
	p.start();
	expect(vi.getTimerCount()).toBe(0);
});
