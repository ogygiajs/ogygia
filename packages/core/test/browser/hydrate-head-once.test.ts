// When an island's hydrate takes the head's `<svelte:head>` open markers away: on a page Kit does
// not hydrate, once, at the first island; never on a page Kit hydrates. The tests run in order: the
// first hydrate of this file is the Kit page's.
import { afterAll, beforeAll, beforeEach, expect, inject, test } from 'vitest';
import { from_b64 } from './b64.ts';
import type { Component } from 'svelte';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { load_devalue } from '../../src/runtime/devalue-lane.ts';
import { runtime_session } from '../../src/runtime/session.ts';
import { hydrate_island } from '../../src/runtime/hydrate-core.ts';
import Counter from './fixtures/Counter.svelte';

const render_html = () => from_b64(inject('counter_render_b64'));
const counter = { default: Counter as unknown as Component<Record<string, unknown>> };
const HEAD = '<!--svelte-1abc23--><meta name="x"><!---->';
const head_comments = () =>
	[...document.head.childNodes].filter((n): n is Comment => n.nodeType === 8).map((c) => c.data);

/** A fetched answer's region (Kit never hydrates it), in the page. */
function answer(): HTMLElement {
	const el = document.createElement('ogygia-region');
	el.setAttribute('render', 'defer');
	el.setAttribute('entry', '/counter');
	el.innerHTML = render_html();
	document.body.append(el);
	return el;
}

let kit_page: boolean | undefined;
beforeAll(async () => {
	link_boot();
	await load_devalue();
	kit_page = runtime_session.kit_page;
});
afterAll(() => {
	runtime_session.kit_page = kit_page;
	document.head.querySelector('meta[name="x"]')?.remove();
});
beforeEach(() => {
	document.body.innerHTML = '';
	for (const c of Array.from(document.head.childNodes)) if (c.nodeType === 8) c.remove();
	document.head.querySelector('meta[name="x"]')?.remove();
	document.head.insertAdjacentHTML('beforeend', HEAD);
});

test('on a page Kit hydrates, an island of ours leaves the head’s markers to Kit', () => {
	runtime_session.kit_page = true;
	expect(hydrate_island(answer(), '/counter', counter, null, false)).not.toBeNull();
	expect(head_comments()).toEqual(['svelte-1abc23', '']);
});

test('on a page Kit does not hydrate, the first island takes the open markers away', () => {
	runtime_session.kit_page = false;
	expect(hydrate_island(answer(), '/counter', counter, null, false)).not.toBeNull();
	expect(head_comments()).toEqual(['']);
});

test('a later island leaves the head as it is: it is done once per page', () => {
	runtime_session.kit_page = false;
	expect(hydrate_island(answer(), '/counter', counter, null, false)).not.toBeNull();
	expect(head_comments()).toEqual(['svelte-1abc23', '']);
});
