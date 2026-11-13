// Where the browser has no IntersectionObserver, watching an element throws, so its caller is told
// rather than left waiting for a state that never comes, and nothing half made is left behind.
import { afterEach, expect, test, vi } from 'vitest';
import { reset_viewport, tracker_count, watch_viewport } from '../../src/runtime/viewport.ts';

afterEach(() => {
	vi.unstubAllGlobals();
	reset_viewport();
	document.body.innerHTML = '';
});

test('where the browser has no IntersectionObserver, a watch throws: its caller is told', () => {
	vi.stubGlobal('IntersectionObserver', undefined);
	const el = document.createElement('div');
	document.body.append(el);
	expect(() => watch_viewport(el, '0px', () => {})).toThrow();
});

test('a watch that threw for want of an observer leaves no tracker that breaks when the page ends', async () => {
	vi.stubGlobal('IntersectionObserver', undefined);
	const el = document.createElement('div');
	el.style.cssText = 'width:10px;height:10px';
	document.body.append(el);
	expect(() => watch_viewport(el, '5px', () => {})).toThrow();
	expect(tracker_count(), 'no tracker made').toBe(0);
	vi.unstubAllGlobals();
	const heard: boolean[] = [];
	const stop = watch_viewport(el, '5px', (on) => heard.push(on));
	await expect.poll(() => heard, { timeout: 2_000 }).toEqual([true]);
	stop();
	expect(() => reset_viewport(), 'the trackers end cleanly').not.toThrow();
});
