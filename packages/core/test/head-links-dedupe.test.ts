/**
 * `dedupe_head_links` — the handle's ONE pass over the head slice that drops duplicate `<link>`s:
 *  - `rel="modulepreload"`: each island instance SSR-emits its own dep-hint block, so two `load`
 *    islands sharing dep chunks (or one island rendered N times) repeat identical hints — a real
 *    page carried ~44 duplicate tags. First occurrence wins; a low-priority copy shadowed by a
 *    normal-priority hint of the same chunk is dropped (a `load` island's dep must never be demoted).
 *  - `rel="stylesheet"`: Kit links a route's client-graph CSS and Region.svelte links a rendered
 *    island's CSS from the render pass; a layout island compiled as a real wrapper is in both, so one
 *    page carried 16 sheets twice. First occurrence wins.
 * Everything else in the head passes through byte-identical.
 */
import { describe, expect, it } from 'vitest';
import { dedupe_head_links } from '../src/server/head-presence.ts';

const hint = (href: string) => `<link rel="modulepreload" href="${href}">`;
const low = (href: string) => `<link rel="modulepreload" href="${href}" fetchpriority="low">`;
const kit = (href: string) => `<link href="${href}" rel="stylesheet">`;
const og = (href: string) => `<link rel="stylesheet" href="${href}" data-ogygia-region-css>`;

describe('dedupe_head_links · modulepreload', () => {
	it('drops same-href duplicates, keeping the first', () => {
		const html = `<head>${hint('/a.js')}${hint('/b.js')}${hint('/a.js')}${hint('/a.js')}</head>`;
		expect(dedupe_head_links(html)).toBe(`<head>${hint('/a.js')}${hint('/b.js')}</head>`);
	});

	it('keeps distinct hrefs and links of other kinds untouched', () => {
		const other =
			'<link rel="preload" as="fetch" href="/x"><link rel="preload" as="fetch" href="/x"><link rel="icon" href="/i.png">';
		const html = `<head>${other}${hint('/a.js')}${hint('/b.js')}</head>`;
		expect(dedupe_head_links(html)).toBe(html);
	});

	it('dedupes across interleaved per-island blocks (the real emission shape)', () => {
		// island 1: facade + shared deps; island 2: its facade + the SAME shared deps
		const html = `${
			hint('/og-region.aaa.js') +
			hint('/chunks/shared1.js') +
			hint('/chunks/shared2.js') +
			hint('/og-region.bbb.js') +
			hint('/chunks/shared1.js') +
			hint('/chunks/shared2.js')
		}</head>`;
		expect(dedupe_head_links(html)).toBe(
			`${
				hint('/og-region.aaa.js') +
				hint('/chunks/shared1.js') +
				hint('/chunks/shared2.js') +
				hint('/og-region.bbb.js')
			}</head>`
		);
	});

	it('handles single-quoted attributes and attribute order variance', () => {
		const html = `<link href="/x.js" rel="modulepreload"><link rel='modulepreload' href='/x.js'></head>`;
		expect(dedupe_head_links(html)).toBe(`<link href="/x.js" rel="modulepreload"></head>`);
	});

	it('never matches an HTML-escaped (documented) tag in prose', () => {
		const doc = `<code>&lt;link rel="modulepreload" href="/a.js"&gt;</code>`;
		const html = `${doc}${hint('/a.js')}${hint('/a.js')}</head>`;
		expect(dedupe_head_links(html)).toBe(`${doc}${hint('/a.js')}</head>`);
	});

	it('dedupes the low-priority hints every island emits (two islands, shared deps)', () => {
		const html = `${low('/a.js') + low('/shared.js') + low('/b.js') + low('/shared.js')}</head>`;
		expect(dedupe_head_links(html)).toBe(
			`${low('/a.js') + low('/shared.js') + low('/b.js')}</head>`
		);
	});

	it('first occurrence wins regardless of attributes (no priority arbitration: every hint is low)', () => {
		const html = `${low('/x.js') + hint('/x.js') + hint('/y.js') + low('/y.js')}</head>`;
		expect(dedupe_head_links(html)).toBe(`${low('/x.js') + hint('/y.js')}</head>`);
	});
});

describe('dedupe_head_links · stylesheet', () => {
	it('drops a Kit copy of a sheet the region pass already linked (Kit links after the rendered head)', () => {
		const html = `<head>${og('/a.css')}${og('/b.css')}${kit('/a.css')}${kit('/c.css')}</head>`;
		expect(dedupe_head_links(html)).toBe(
			`<head>${og('/a.css')}${og('/b.css')}${kit('/c.css')}</head>`
		);
	});

	it('drops a region copy when Kit linked first — whichever comes first wins', () => {
		const html = `<head>${kit('/a.css')}${og('/a.css')}</head>`;
		expect(dedupe_head_links(html)).toBe(`<head>${kit('/a.css')}</head>`);
	});

	it('leaves distinct hrefs and <style> untouched', () => {
		const html = `<head>${kit('/a.css')}${og('/b.css')}<style>.a{}</style></head>`;
		expect(dedupe_head_links(html)).toBe(html);
	});

	it('same href linked N times by N identical islands collapses to one', () => {
		const html = `<head>${og('/a.css')}${og('/a.css')}${og('/a.css')}</head>`;
		expect(dedupe_head_links(html)).toBe(`<head>${og('/a.css')}</head>`);
	});

	it('a link with no href is left alone', () => {
		const html = `<head><link rel="stylesheet"><link rel="stylesheet"></head>`;
		expect(dedupe_head_links(html)).toBe(html);
	});

	it('a sheet and a hint with the same href are two different links', () => {
		const html = `<head>${kit('/same')}${hint('/same')}${kit('/same')}${hint('/same')}</head>`;
		expect(dedupe_head_links(html)).toBe(`<head>${kit('/same')}${hint('/same')}</head>`);
	});
});

describe('dedupe_head_links · reads each attribute as HTML does', () => {
	it('keeps a second sheet whose href has an apostrophe (a value ends at its own quote)', () => {
		const html = `<head><link rel="stylesheet" href="/a'1.css"><link rel="stylesheet" href="/a'2.css"></head>`;
		expect(dedupe_head_links(html)).toBe(html);
	});

	it('keeps a second hint whose single-quoted href has a double quote', () => {
		const html = `<head><link rel='modulepreload' href='/a"1.js'><link rel='modulepreload' href='/a"2.js'></head>`;
		expect(dedupe_head_links(html)).toBe(html);
	});

	it('still drops a true duplicate whose href has an apostrophe', () => {
		const one = `<link rel="stylesheet" href="/a'1.css">`;
		expect(dedupe_head_links(`<head>${one}${one}</head>`)).toBe(`<head>${one}</head>`);
	});

	it('does not read data-rel as rel: two data-rel links are not stylesheet links', () => {
		const one = `<link data-rel="stylesheet" href="/a.css">`;
		const html = `<head>${one}${one}</head>`;
		expect(dedupe_head_links(html)).toBe(html);
	});

	it('reads the real rel after a data-rel, so a true duplicate sheet is dropped', () => {
		const one = `<link data-rel="x" rel="stylesheet" href="/a.css">`;
		expect(dedupe_head_links(`<head>${one}${one}</head>`)).toBe(`<head>${one}</head>`);
	});

	it('does not read data-href as href', () => {
		const html = `<head><link rel="stylesheet" data-href="/x" href="/a.css"><link rel="stylesheet" data-href="/x" href="/b.css"></head>`;
		expect(dedupe_head_links(html)).toBe(html);
	});

	it('reads unquoted values and upper-case attribute names', () => {
		const html = `<head><link rel=stylesheet href=/a.css><LINK REL="stylesheet" HREF="/a.css" x><link Rel=stylesheet Href=/a.css></head>`;
		expect(dedupe_head_links(html)).toBe(`<head><link rel=stylesheet href=/a.css></head>`);
	});

	it('a > inside a quoted value does not end the tag', () => {
		const one = `<link rel="stylesheet" href="/a>b.css">`;
		expect(dedupe_head_links(`<head>${one}${one}</head>`)).toBe(`<head>${one}</head>`);
	});

	it('the first of two same-name attributes is the one that counts', () => {
		const html = `<head><link rel="stylesheet" href="/a.css" href="/b.css"><link rel="stylesheet" href="/b.css"></head>`;
		expect(dedupe_head_links(html)).toBe(html);
	});

	it('a <link-x> custom element is not a link', () => {
		const one = `<link-x rel="stylesheet" href="/a.css"></link-x>`;
		const html = `<head>${one}${one}</head>`;
		expect(dedupe_head_links(html)).toBe(html);
	});
});

describe('dedupe_head_links · one pass', () => {
	it('is the same string object on a head with no <link> at all (cheap probe)', () => {
		const html = `<head><title>x</title><meta charset="utf-8"></head>`;
		expect(dedupe_head_links(html)).toBe(html);
	});

	it('reads each link as a browser does: a quoted > stays in its value, a comment is not a link', () => {
		const odd = '<link rel="stylesheet" data-note="a>b" href=\'/a.css\'>';
		const html = `<head>${kit('/a.css')}<!-- ${kit('/c.css')} -->${odd}${kit('/c.css')}</head>`;
		expect(dedupe_head_links(html)).toBe(
			`<head>${kit('/a.css')}<!-- ${kit('/c.css')} -->${kit('/c.css')}</head>`
		);
	});

	it('handles both families in one document in one call', () => {
		const html = `<head>${kit('/a.css')}${hint('/a.js')}${og('/a.css')}${low('/a.js')}${hint('/b.js')}</head>`;
		expect(dedupe_head_links(html)).toBe(
			`<head>${kit('/a.css')}${hint('/a.js')}${hint('/b.js')}</head>`
		);
	});
});
