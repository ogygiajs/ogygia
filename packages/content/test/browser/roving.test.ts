// A navigation surface is one tab stop: the current item takes it, arrows move it, and the keys are
// left alone while focus is elsewhere.
import { afterEach, describe, expect, it } from 'vitest';
import { roving } from '../../src/site/components/roving.ts';

let teardown: (() => void) | undefined;
afterEach(() => {
	teardown?.();
	teardown = undefined;
	document.body.innerHTML = '';
});

function list(current = -1): { container: HTMLElement; items: HTMLAnchorElement[] } {
	const container = document.createElement('nav');
	for (let i = 0; i < 3; i++) {
		const a = document.createElement('a');
		a.href = `#item-${i}`;
		a.className = 'item';
		a.textContent = `Item ${i}`;
		if (i === current) a.setAttribute('aria-current', 'page');
		container.append(a);
	}
	document.body.append(container);
	return { container, items: [...container.querySelectorAll<HTMLAnchorElement>('.item')] };
}

const press = (el: Element, key: string) => {
	const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
	el.dispatchEvent(e);
	return e;
};
const stops = (items: HTMLElement[]) => items.map((el) => el.tabIndex);

describe('roving', () => {
	it('the current item is the one tab stop, else the first', () => {
		const a = list(1);
		teardown = roving({ selector: '.item' })(a.container);
		expect(stops(a.items)).toEqual([-1, 0, -1]);
		teardown?.();
		document.body.innerHTML = '';
		const b = list();
		teardown = roving({ selector: '.item' })(b.container);
		expect(stops(b.items)).toEqual([0, -1, -1]);
	});

	it('arrows, Home and End move focus and the tab stop; the ends wrap unless loop is off', () => {
		const { container, items } = list();
		teardown = roving({ selector: '.item' })(container);
		items[0].focus();
		press(items[0], 'ArrowDown');
		expect(document.activeElement).toBe(items[1]);
		expect(stops(items)).toEqual([-1, 0, -1]);
		press(items[1], 'End');
		expect(document.activeElement).toBe(items[2]);
		press(items[2], 'ArrowDown');
		expect(document.activeElement).toBe(items[0]);
		press(items[0], 'ArrowUp');
		expect(document.activeElement).toBe(items[2]);
		press(items[2], 'Home');
		expect(document.activeElement).toBe(items[0]);

		teardown?.();
		document.body.innerHTML = '';
		const clamped = list();
		teardown = roving({ selector: '.item', loop: false })(clamped.container);
		clamped.items[0].focus();
		press(clamped.items[0], 'ArrowUp');
		expect(document.activeElement).toBe(clamped.items[0]);
	});

	it('a horizontal surface moves with Left and Right, not Up and Down', () => {
		const { container, items } = list();
		teardown = roving({ selector: '.item', orientation: 'horizontal' })(container);
		items[0].focus();
		press(items[0], 'ArrowDown');
		expect(document.activeElement).toBe(items[0]);
		press(items[0], 'ArrowRight');
		expect(document.activeElement).toBe(items[1]);
	});

	it('a key pressed while focus is not on an item is left alone', () => {
		const { container } = list();
		const field = document.createElement('input');
		container.append(field);
		teardown = roving({ selector: '.item' })(container);
		field.focus();
		expect(press(field, 'ArrowDown').defaultPrevented).toBe(false);
		expect(document.activeElement).toBe(field);
	});

	it('Enter is not handled: activating an item stays native', () => {
		const { container, items } = list();
		teardown = roving({ selector: '.item' })(container);
		items[0].focus();
		expect(press(items[0], 'Enter').defaultPrevented).toBe(false);
	});
});
