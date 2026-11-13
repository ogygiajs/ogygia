// Which head comments `neutralize_head_hydration_markers` takes away: only a `<svelte:head>` block's
// own open marker, found at the head's top level, past whatever a third party left in the head.
import { beforeEach, expect, test } from 'vitest';
import { neutralize_head_hydration_markers } from '../../src/runtime/hydrate-core.ts';

const HASH = 'svelte-1abc23';

const head_comments = () =>
	[...document.head.childNodes].filter((n): n is Comment => n.nodeType === 8).map((c) => c.data);

beforeEach(() => {
	document.head.innerHTML = '';
});

test('a comment a third party put inside a head block is left, and the block still loses its open marker', () => {
	document.head.innerHTML = [
		`<!--${HASH}-->`,
		'<!--[-->',
		'<!-- a third party -->',
		'<!---->',
		'<meta name="x">',
		'<!--]-->',
		'<!---->'
	].join('');
	neutralize_head_hydration_markers();
	expect(head_comments()).toEqual(['[', ' a third party ', '', ']', '']);
});

test('a stray block close before a head block does not hide the block’s open marker', () => {
	document.head.innerHTML = ['<!--]-->', `<!--${HASH}-->`, '<meta name="x">', '<!---->'].join('');
	neutralize_head_hydration_markers();
	expect(head_comments()).toEqual([']', '']);
});

test('an element in the head is never read as a marker, nor what is inside it', () => {
	document.head.innerHTML = [`<!--${HASH}-->`, '<meta name="x">', '<!---->'].join('');
	neutralize_head_hydration_markers();
	expect(document.head.querySelector('meta[name="x"]')).not.toBeNull();
	expect(head_comments()).toEqual(['']);
});
