// Where the browser has no IntersectionObserver, watching an element throws, so its caller is told
// rather than left waiting for a state that never comes. Its own file: the tracker it began is this
// file's for good.
import { expect, test, vi } from 'vitest';
import { watch_viewport } from '../../src/runtime/viewport.ts';

test('where the browser has no IntersectionObserver, a watch throws: its caller is told', () => {
	vi.stubGlobal('IntersectionObserver', undefined);
	try {
		const el = document.createElement('div');
		document.body.append(el);
		expect(() => watch_viewport(el, '0px', () => {})).toThrow();
	} finally {
		vi.unstubAllGlobals();
	}
});
