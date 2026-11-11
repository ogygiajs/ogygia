// Svelte's dev hydration warnings, read off the console line: the code, the message, the file
// (without the zero-width spaces Svelte breaks paths with), and nothing for other warnings.
import { expect, test } from 'vitest';
import { parse_svelte_warning } from '../src/runtime/svelte-warnings.ts';

const line =
	'%c[svelte] hydration_html_changed\n%cThe value of an `{@html ...}` block in /​Users/​me/​app/​src/​Card.svelte changed between server and client renders. The client value will be ignored in favour of the server value\nhttps://svelte.dev/e/hydration_html_changed';

test('a hydration warning: code, message, the component file', () => {
	const w = parse_svelte_warning(line)!;
	expect(w.code).toBe('hydration_html_changed');
	expect(w.file).toBe('/Users/me/app/src/Card.svelte');
	expect(w.message.startsWith('The value of an `{@html ...}` block')).toBe(true);
	expect(w.message).not.toContain('https://svelte.dev');
});

test('not a hydration warning: nothing', () => {
	expect(
		parse_svelte_warning('%c[svelte] state_snapshot_uncloneable\n%cValue cannot be cloned')
	).toBeNull();
	expect(parse_svelte_warning('some other warning')).toBeNull();
});
