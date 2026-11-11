// The page beacon is an inline script and imports nothing, so it carries its own copy of three core
// helpers. Each copy answers exactly as core's does.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
	attr_changes,
	hole_copy_of,
	without_comments,
	without_runtime_marks
} from '@ogygia/core/internal/instruments';
import { _restart_page_beacon, type PageBeacon } from '../src/profiler/beacon-standalone.ts';

let page: PageBeacon;
beforeEach(() => {
	vi.stubGlobal('document', {
		readyState: 'complete',
		visibilityState: 'visible',
		querySelector: () => null,
		querySelectorAll: () => [],
		addEventListener: () => {}
	});
	vi.stubGlobal('addEventListener', () => {});
	vi.stubGlobal('location', new URL('http://localhost/'));
	page = _restart_page_beacon();
});
afterEach(() => {
	page.stop();
	vi.unstubAllGlobals();
});

const MARKUP = [
	'<div class="a">x</div>',
	'<!--[--><p data-hydrated="">hi</p><!--]-->',
	'<p data-nested="" data-og-kept="">a<!-- note -->b</p>',
	'<a href=x tabindex="0">y</a>',
	'<b>unclosed <!-- comment',
	''
];

test("bare() is core's without_runtime_marks(without_comments())", () => {
	for (const m of MARKUP) expect(page.bare(m)).toBe(without_runtime_marks(without_comments(m)));
});

test("attr_changes() is core's", () => {
	const pairs: [string, string][] = [
		['<div class="a">x</div>', '<div class="b">x</div>'],
		['<a href=x>y</a>', '<a href=x tabindex="0" aria-hidden=\'true\'>y</a>'],
		['<p>a</p>', '<p>b</p>'],
		['<p>a</p>', '<div>a</div>'],
		['<i id="1" hidden>z</i>', '<i id="1">z</i>']
	];
	for (const [a, b] of pairs) expect(page.attr_changes(a, b)).toEqual(attr_changes(a, b));
});

test("copy_of() is core's hole_copy_of", () => {
	for (const e of [
		'/r?id=1&props=eyJhIjoxfQ',
		'/r?props=abc&id=2',
		'/r?id=3',
		'/r?id=4&props=',
		'/r?id=5&props=eyJsb25nIjoieHh4eHh4eHh4eHh4eHh4eHh4eHh4In0&exp=9'
	])
		expect(page.copy_of(e)).toBe(hole_copy_of(e));
});
