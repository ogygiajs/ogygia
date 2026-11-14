// What the drift check reads, what it says, and what the repair does, one claim at a time: the live
// light DOM of a sleeping island against the server copy it connected with.
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_lakes } from '../../src/runtime/lakes.ts';
import { repair_if_drifted } from '../../src/runtime/hydrate-core.ts';

beforeAll(() => {
	link_boot();
	install_lakes();
});

beforeEach(() => {
	document.body.innerHTML = '';
});

/** A region holding `live`, in the page. */
function region_of(live: string): HTMLElement {
	const el = document.createElement('ogygia-region');
	el.innerHTML = live;
	document.body.append(el);
	return el;
}

test('a dropped whitespace node is said to be whitespace a normalizing pass stripped', () => {
	const r = region_of('<p>a</p><p>b</p>');
	const out = repair_if_drifted(r, '<p>a</p> <p>b</p>');
	expect(out.repaired).toBe(true);
	expect(out.reason).toBe(
		'1 node(s) the server sent were removed from the island — e.g. whitespace (whitespace stripped by a DOM-normalizing pass)'
	);
	expect(r.innerHTML).toBe('<p>a</p> <p>b</p>');
});

test('the first place the sequences part is named, not the end of the longer one', () => {
	const r = region_of('<p>a</p><!--x--><p>b</p><i>c</i>');
	const out = repair_if_drifted(r, '<p>a</p><p>b</p><i>c</i>');
	expect(out.reason).toBe('1 node(s) were inserted into the island — e.g. a comment');
});

test('a changed text deep in an element is named in that element', () => {
	const r = region_of('<div><p>new</p></div>');
	const out = repair_if_drifted(r, '<div><p>old</p></div>');
	expect(out.repaired).toBe(true);
	expect(out.reason).toBe('<p>: the text of a text node changed (a translator or text rewrite)');
	expect(r.innerHTML).toBe('<div><p>old</p></div>');
});

test('an element the walk does not enter is not read: what changed inside it is not the reason', () => {
	const r = region_of('<div data-og-opaque><i>widget</i></div><p>new</p>');
	const out = repair_if_drifted(r, '<div data-og-opaque><b>server</b></div><p>old</p>');
	expect(out.reason).toBe('<p>: the text of a text node changed (a translator or text rewrite)');
	expect(r.querySelector('[data-og-opaque]')!.innerHTML, 'left as the widget made it').toBe(
		'<i>widget</i>'
	);
});

test('only an element the walk does not enter may differ inside: no repair is made for it', () => {
	const r = region_of('<div data-og-opaque><i>widget</i></div><p>same</p>');
	expect(repair_if_drifted(r, '<div data-og-opaque><b>server</b></div><p>same</p>').repaired).toBe(
		false
	);
});

test('an element of another tag at the same place is drift, and the server’s element comes back', () => {
	const r = region_of('<span>x</span>');
	const out = repair_if_drifted(r, '<p>x</p>');
	expect(out.repaired).toBe(true);
	expect(out.reason).toBe('the island: the server sent <p> but the browser had <span>');
	expect(r.innerHTML).toBe('<p>x</p>');
});

test.each([
	['<style>.x{}</style>', 'an injected <style>'],
	['<template shadowrootmode="open"></template>', 'a declarative shadow-DOM template'],
	['<b sc-x=""></b>', 'scoped web-component hydration marks'],
	['<b s-id="1"></b>', 'scoped web-component hydration marks'],
	['<b c-id="1"></b>', 'scoped web-component hydration marks'],
	['<b s-sn="1"></b>', 'scoped web-component hydration marks'],
	['<b class="hydrated"></b>', 'marked it `hydrated`']
])('an inserted %s is named for what likely left it', (inserted, hint) => {
	const r = region_of(`${inserted}<p>a</p>`);
	// (a declarative template is consumed by the parser: put the template in by hand)
	if (inserted.startsWith('<template')) {
		r.replaceChildren(document.createElement('template'), r.lastChild!);
		r.firstElementChild!.setAttribute('shadowrootmode', 'open');
	}
	const out = repair_if_drifted(r, '<p>a</p>');
	expect(out.reason).toContain(hint);
});

test('a plain inserted element carries no guess', () => {
	const r = region_of('<b></b><p>a</p>');
	expect(repair_if_drifted(r, '<p>a</p>').reason).toBe(
		'1 node(s) were inserted into the island — e.g. <b>'
	);
});

test('a removed text node that is not whitespace is said to be a text node', () => {
	const r = region_of('<p>a</p>');
	expect(repair_if_drifted(r, '<p>a</p>z').reason).toBe(
		'1 node(s) the server sent were removed from the island — e.g. a text node'
	);
});

test('the conflict named is the first one the repair met', () => {
	const r = region_of(
		'<details><summary>s</summary><i>own</i></details><dialog><b>a</b><i>own</i></dialog>x'
	);
	const out = repair_if_drifted(
		r,
		'<details><summary>s</summary></details><dialog><b>a</b></dialog>'
	);
	expect(out.conflict).toBe('<details>');
	expect(r.innerHTML, 'each takes the server’s children').toBe(
		'<details><summary>s</summary></details><dialog><b>a</b></dialog>'
	);
});

test('a conflict is the repair’s that met it: the next repair, with none, names none', () => {
	const a = region_of('<details><summary>s</summary><i>own</i></details>x');
	expect(repair_if_drifted(a, '<details><summary>s</summary></details>').conflict).toBe(
		'<details>'
	);
	const b = region_of('<p>a</p>x');
	expect(repair_if_drifted(b, '<p>a</p>').conflict).toBeNull();
});

test('a lake that refreshed itself is no drift: the check does not walk into a lake, which stays in place', () => {
	const r = region_of(
		'<p>host</p><ogygia-region wake="none" entry="lk"><b>refreshed</b></ogygia-region>'
	);
	expect(
		repair_if_drifted(
			r,
			'<p>host</p><ogygia-region wake="none" entry="lk"><i>as served</i></ogygia-region>'
		).repaired
	).toBe(false);
});

test('a server copy carrying a declarative shadow root reads as the live host that has one', () => {
	const r = region_of('<x-card></x-card><p>a</p>');
	r.querySelector('x-card')!.attachShadow({ mode: 'open' }).innerHTML = '<slot></slot>';
	const out = repair_if_drifted(
		r,
		'<x-card><template shadowrootmode="open"><slot></slot></template></x-card><p>a</p>'
	);
	expect(out.repaired).toBe(false);
});
