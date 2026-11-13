import { expect, test } from 'vitest';
import { from_b64 } from './b64.ts';

test('from_b64 reads back the UTF-8 text a setup encoded, non-ASCII included', () => {
	const text = '<p data-x="é">naïve — 日本 🙂</p>';
	const bytes = new TextEncoder().encode(text);
	const b64 = btoa(String.fromCharCode(...bytes));
	expect(from_b64(b64)).toBe(text);
	expect(from_b64(btoa('plain'))).toBe('plain');
});
