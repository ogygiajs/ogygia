import { describe, expect, it } from 'vitest';
import { scope } from '@ogygia/machine';
import {
	mark_region_changed,
	region_changed,
	watch_region
} from '../../src/runtime/drift-watch.ts';

function region(html: string): HTMLElement {
	const el = document.createElement('ogygia-region');
	el.innerHTML = html;
	document.body.append(el);
	return el;
}

describe('drift-watch: which sleeping islands were touched', () => {
	it('an untouched island is not changed; attribute edits do not count', () => {
		const r = region('<p>hi</p>');
		const sleep = scope();
		watch_region(sleep, r);
		r.querySelector('p')!.setAttribute('class', 'x');
		expect(region_changed(r)).toBe(false);
		sleep.close();
		r.remove();
	});

	it('a node or text change inside marks it, and its enclosing island too', () => {
		const outer = region('<div><ogygia-region><p>a</p></ogygia-region></div>');
		const inner = outer.querySelector('ogygia-region')!;
		const other = region('<p>b</p>');
		const sleep = scope();
		watch_region(sleep, outer);
		inner.querySelector('p')!.firstChild!.nodeValue = 'changed';
		expect(region_changed(inner)).toBe(true);
		expect(region_changed(outer)).toBe(true);
		expect(region_changed(other)).toBe(false);
		sleep.close();
		outer.remove();
		other.remove();
	});

	it('records pending when the last sleep ends still count', () => {
		const r = region('<p>c</p>');
		const sleep = scope();
		watch_region(sleep, r);
		r.append(document.createElement('span'));
		sleep.close();
		expect(region_changed(r)).toBe(true);
		r.remove();
	});

	it('one sleep ending leaves the watch on for the regions still asleep', () => {
		const r = region('<p>e</p>');
		const first = scope();
		const second = scope();
		watch_region(first, r);
		watch_region(second, r);
		first.close();
		first.close(); // (an end runs once: it cannot take the second's place)
		r.append(document.createElement('span'));
		expect(region_changed(r)).toBe(true);
		second.close();
		r.remove();
	});

	it('a sleep that already ended adds nothing to the watch', () => {
		const r = region('<p>f</p>');
		const ended = scope();
		ended.close();
		watch_region(ended, r);
		r.append(document.createElement('span'));
		const sleep = scope();
		watch_region(sleep, r);
		expect(region_changed(r)).toBe(false);
		sleep.close();
		r.remove();
	});

	it('mark_region_changed forces the comparison', () => {
		const r = region('<p>d</p>');
		mark_region_changed(r);
		expect(region_changed(r)).toBe(true);
		r.remove();
	});
});
