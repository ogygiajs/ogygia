// The page beacon is an inline script and imports nothing, so it carries its own copy of three core
// helpers. Each copy answers exactly as core's does.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
	attr_changes,
	hole_copy_of,
	without_comments,
	without_runtime_marks
} from '@ogygia/core/internal/instruments';
import { fuzz, html_arb, inner_html } from '@ogygia/config/html-fuzz';
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

// (the beacon reads what `innerHTML` writes, comments out; core reads it with its tag walk: the two
// answer alike over generated pages holding `>`, `<`, quotes and entities in values, #1370)
const SERIALIZED = html_arb({
	tags: ['div', 'a', 'img', 'script', 'style', 'textarea', 'title', 'noscript', 'p', 'x-widget'],
	attrs: ['class', 'href', 'data-x', 'aria-label', 'hidden'],
	values: ['one', 'two'],
	texts: ['if(a<b)go()', '</p>', 'x > y']
});

test("attr_changes() is core's over serialized markup", () => {
	fuzz(
		SERIALIZED,
		(html) => {
			const a = without_comments(inner_html(html));
			for (const b of [
				a,
				without_comments(inner_html(html.replaceAll('one', 'two'))),
				without_comments(inner_html(html.replaceAll('if(a<b)', 'if(b<a)')))
			])
				expect(page.attr_changes(a, b), `${a}\n${b}`).toEqual(attr_changes(a, b));
		},
		{ runs: 500 }
	);
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
