// The element a fragment points at, as the browser finds it (src/runtime/fragment.ts).
import { afterEach, expect, test } from 'vitest';
import { fragment_is_top, fragment_target } from '../../src/runtime/fragment.ts';

afterEach(() => {
	document.body.innerHTML = '';
});

test('the fragment as written wins over its decoding', () => {
	document.body.innerHTML = '<p id="a%20b">raw</p><p id="a b">decoded</p>';
	expect(fragment_target('#a%20b')?.textContent).toBe('raw');
});

test('a decoded fragment finds its element when the written one finds none', () => {
	document.body.innerHTML = '<p id="é">x</p>';
	expect(fragment_target('#%C3%A9')?.id).toBe('é');
});

test('a bad escape never throws: it is read as written, or with U+FFFD', () => {
	document.body.innerHTML = '<p id="x�">x</p>';
	expect(fragment_target('#%E0')).toBeNull();
	expect(fragment_target('#x%E0')?.id).toBe('x�');
});

test('a named anchor is a target, any other named element is not', () => {
	document.body.innerHTML = '<input name="q"><a name="q2">x</a>';
	expect(fragment_target('#q')).toBeNull();
	expect(fragment_target('#q2')?.localName).toBe('a');
});

test('#top and an empty fragment mean the top of the page', () => {
	expect(fragment_is_top('')).toBe(true);
	expect(fragment_is_top('#')).toBe(true);
	expect(fragment_is_top('#TOP')).toBe(true);
	expect(fragment_is_top('#%74op')).toBe(true);
	expect(fragment_is_top('#topic')).toBe(false);
});
