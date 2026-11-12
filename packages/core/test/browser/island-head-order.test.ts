// AN ISLAND'S HEAD CONTENT STANDS WHERE THE SERVER WROTE IT (#1107). On a csr=false page each
// island's <svelte:head> renders fresh when it wakes (hydrate-core.ts
// `neutralize_head_hydration_markers`), and the page's server copy is retired (runtime/session.ts).
// Islands wake in any order (`load` vs `idle`, which module came first, what was cached), so the
// fresh copies must take the server copy's place in <head>: where two head styles set one property,
// the later one wins, and that has to be the server's later one on every load. (A meta stands in
// for the style here: the server and the client write it alike.)
import { beforeAll, expect, inject, test } from 'vitest';
import type { Component } from 'svelte';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { boot_link } from '../../src/runtime/slots.ts';
import { load_devalue } from '../../src/runtime/devalue-lane.ts';
import { hydrate_island } from '../../src/runtime/hydrate-core.ts';
import HeadStyle from './fixtures/HeadStyle.svelte';

const decode = (key: 'head_style_head_b64' | 'head_style_body_b64') =>
	decodeURIComponent(escape(atob(inject(key))));
const as_module = (c: unknown) => ({ default: c as Component<Record<string, unknown>> });

beforeAll(async () => {
	link_boot();
	await load_devalue();
});

test("islands' head tags keep the server order when the islands wake in the other order", () => {
	document.head.innerHTML = `<meta charset="utf-8"><title>page</title>${decode('head_style_head_b64')}<meta name="after" content="x">`;
	boot_link().runtime_session.adopt_document_head();
	document.body.innerHTML = decode('head_style_body_b64');
	const order = () =>
		[...document.head.querySelectorAll('meta[name="head-style"]')].map((s) =>
			s.getAttribute('content')
		);
	expect(order(), 'as served').toEqual(['a', 'b']);
	const [a, b] = document.querySelectorAll<HTMLElement>('ogygia-region');
	// (b wakes first: its module came first)
	expect(hydrate_island(b, '/head-style', as_module(HeadStyle), null, false)).not.toBeNull();
	expect(hydrate_island(a, '/head-style', as_module(HeadStyle), null, false)).not.toBeNull();
	expect(order(), 'once both woke: one copy each, in the server order').toEqual(['a', 'b']);
	// (and where the server put them: before the page's next head element)
	const after = document.head.querySelector('meta[name="after"]')!;
	for (const s of document.head.querySelectorAll('meta[name="head-style"]'))
		expect(s.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
