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

test('a candidate URL that ends in the comma before the next one is a URL without it', () => {
	const doc = parse(`<link rel="preload" as="image" imagesrcset="../a.png, ../b.png">`);
	resolve_head_urls(doc.head, new URL('https://example.com/x/y/'));
	expect(doc.head.firstElementChild!.getAttribute('imagesrcset')).toBe(
		'https://example.com/x/a.png, https://example.com/x/b.png'
	);
});

test('a URL that names the same file from any page stays as written', () => {
	const absolute = `${location.origin}/_app/a.css`;
	const doc = parse(
		`<link rel="stylesheet" href="//cdn.example.com/a.css"><link rel="stylesheet" href="${absolute}"><link rel="stylesheet" href="/_app/b.css">`
	);
	resolve_head_urls(doc.head, new URL('/x/y/', location.href));
	const [cdn, same, root] = doc.head.children;
	expect(cdn.getAttribute('href')).toBe('//cdn.example.com/a.css');
	expect(same.getAttribute('href')).toBe(absolute);
	expect(root.getAttribute('href')).toBe('/_app/b.css');
});

test('a page-relative URL on this origin is written root-relative', () => {
	const doc = parse(`<link rel="stylesheet" href="../../_app/x.css?v=1#k">`);
	resolve_head_urls(doc.head, new URL('/a/e/f', location.href));
	expect(doc.head.firstElementChild!.getAttribute('href')).toBe('/_app/x.css?v=1#k');
});

test('a page-relative URL that does not parse is left as written: the browser ignores it the same way on either page', () => {
	// (a backslash reads as a slash in an http URL: `\\[x` is a host that does not parse)
	const doc = parse('<link rel="stylesheet" href="\\\\[x/a.css">');
	resolve_head_urls(doc.head, new URL('https://example.com/a/e/'));
	expect(doc.head.firstElementChild!.getAttribute('href')).toBe('\\\\[x/a.css');
});

test('a head node whose URL does not parse is keyed by the URL as written', () => {
	const live = document.createElement('link');
	live.rel = 'stylesheet';
	live.setAttribute('href', 'http://[');
	expect(head_node_key(live)).toBe('LINK:stylesheet:http://[:');
});
