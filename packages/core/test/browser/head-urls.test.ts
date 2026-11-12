// A FETCHED PAGE'S HEAD URLS BELONG TO ITS ADDRESS (#449, runtime/router-nav.ts `resolve_head_urls`).
// The next page's nodes go into the live document while the page being left is still on screen:
// each URL is resolved against the next page once, after the parse, and a node's key names the
// file it means, so one file linked two ways (page-relative on two depths, root-relative) is one.
import { expect, test } from 'vitest';
import { head_node_key, resolve_head_urls } from '../../src/runtime/router-nav.ts';

const parse = (head: string) =>
	new DOMParser().parseFromString(`<head>${head}</head>`, 'text/html');

test('every URL of a fetched head is resolved against the page it came from', () => {
	const doc = parse(
		`<link rel="stylesheet" href="../../_app/a.css"><link rel="preload" as="image" imagesrcset="../i-1.png 1x, ../i-2.png 2x,"><script type="module" src="../_app/s.js">\x3C/script><link rel="icon" href="https://cdn.example.com/f.ico">`
	);
	resolve_head_urls(doc.head, new URL('https://example.com/a/e/'));
	const [sheet, preload, script, icon] = doc.head.children;
	expect(sheet.getAttribute('href')).toBe('https://example.com/_app/a.css');
	expect(preload.getAttribute('imagesrcset')).toBe(
		'https://example.com/a/i-1.png 1x, https://example.com/a/i-2.png 2x'
	);
	expect(script.getAttribute('src')).toBe('https://example.com/a/_app/s.js');
	expect(icon.getAttribute('href')).toBe('https://cdn.example.com/f.ico');
});

test('an empty URL attribute stays empty: it names no file, not the page', () => {
	// (the browser ignores an empty href/src; resolved, it would fetch the page as a sheet)
	const doc = parse(
		`<link rel="stylesheet" href=""><script src=" ">\x3C/script><link rel="preload" as="image" imagesrcset="">`
	);
	resolve_head_urls(doc.head, new URL('https://example.com/a/e/'));
	const [sheet, script, preload] = doc.head.children;
	expect(sheet.getAttribute('href')).toBe('');
	expect(script.getAttribute('src')).toBe(' ');
	expect(preload.getAttribute('imagesrcset')).toBe('');
});

test('a candidate URL with a comma inside it stays one URL', () => {
	// (a comma separates candidates only after whitespace, or at the end of a URL; an image CDN's
	// transform path and a data: URL hold commas of their own)
	const doc = parse(
		`<link rel="preload" as="image" imagesrcset="https://cdn.example.com/w_100,h_100/a.png 1x, ../w_200,h_200/a.png 2x,data:image/gif;base64,R0lGOD 3x">`
	);
	resolve_head_urls(doc.head, new URL('https://example.com/a/e/'));
	expect(doc.head.firstElementChild!.getAttribute('imagesrcset')).toBe(
		`https://cdn.example.com/w_100,h_100/a.png 1x, https://example.com/a/w_200,h_200/a.png 2x, data:image/gif;base64,R0lGOD 3x`
	);
});

test('one file linked page-relative from two depths is one head node', () => {
	const deep = parse('<link rel="stylesheet" href="../../../_app/x.css">');
	const shallow = parse('<link rel="stylesheet" href="../_app/x.css">');
	resolve_head_urls(deep.head, new URL('https://example.com/r/a/b/c'));
	resolve_head_urls(shallow.head, new URL('https://example.com/r/e'));
	expect(head_node_key(deep.head.firstElementChild!)).toBe(
		head_node_key(shallow.head.firstElementChild!)
	);
	// a live node keys by the address it names on the page on screen
	const live = document.createElement('link');
	live.rel = 'stylesheet';
	live.setAttribute('href', '/_app/x.css');
	expect(head_node_key(live)).toBe(`LINK:stylesheet:${location.origin}/_app/x.css:`);
});
