// EVERY SERVER SHAPE HYDRATES IN PLACE, in a real browser. An island's server markup is the
// component's nodes in one anchor pair: a placed island's (Region.svelte's dynamic component), a
// deferred answer's and a live region's (`render()`'s root pair). The runtime hydrates the component
// itself — no host component around it — so each one is adopted, never re-rendered. (A host's extra
// marker layer met `render()`'s single pair one layer short: a live region and a woken deferred
// answer were thrown away and re-rendered on every wake.)
import { beforeAll, beforeEach, expect, inject, test } from 'vitest';
import type { Component } from 'svelte';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { load_devalue } from '../../src/runtime/devalue-lane.ts';
import { install as install_live } from '../../src/runtime/live.ts';
import { hydrate_island, hydrate_live } from '../../src/runtime/hydrate-core.ts';
import Counter from './fixtures/Counter.svelte';
import Label from './fixtures/Label.svelte';
import NestedProbe from './fixtures/NestedProbe.svelte';

type Key = 'counter_ssr_b64' | 'counter_render_b64' | 'label_render_b64' | 'probe_render_b64';
const decode = (key: Key) => decodeURIComponent(escape(atob(inject(key))));
const as_module = (c: unknown) => ({ default: c as Component<Record<string, unknown>> });

beforeAll(async () => {
	link_boot();
	await load_devalue();
	install_live();
});

beforeEach(() => {
	document.body.innerHTML = '';
});

/** A region element holding `html`, as a fetched answer or a live tick swaps it in. */
function region_with(html: string, attrs: Record<string, string> = {}): HTMLElement {
	const el = document.createElement('ogygia-region');
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	el.innerHTML = html;
	document.body.append(el);
	return el;
}

test('a placed island adopts its server nodes', async () => {
	// (the region element is not defined here: no runtime boot, the hydrate step alone)
	document.body.innerHTML = decode('counter_ssr_b64');
	const region = document.querySelector('ogygia-region') as HTMLElement;
	const button = region.querySelector('button')!;
	const app = hydrate_island(region, '/counter', as_module(Counter), null, false);
	expect(app).not.toBeNull();
	expect(region.querySelector('button'), 'the server button, adopted').toBe(button);
	expect(region.hasAttribute('data-og-recovered')).toBe(false);
	button.click();
	await expect.poll(() => region.querySelector('[data-testid="count"]')!.textContent).toBe('4');
});

test("a deferred answer (render()'s shape, its stylesheet links first) adopts its server nodes", () => {
	const region = region_with(
		`<link rel="stylesheet" href="data:text/css," data-ogygia-region-css>${decode('counter_render_b64')}`,
		{ render: 'defer', entry: '/counter' }
	);
	const button = region.querySelector('button')!;
	const app = hydrate_island(region, '/counter', as_module(Counter), null, false);
	expect(app).not.toBeNull();
	expect(region.querySelector('button'), 'the answer button, adopted').toBe(button);
	expect(region.hasAttribute('data-og-recovered')).toBe(false);
});

test("a placed island an earlier build rendered (its host's {#if} pair around it) is adopted too", async () => {
	// (a hole's answer from a server still on the earlier build, mid rolling deploy)
	const region = region_with(`<!--[0-->${decode('counter_render_b64')}<!--]-->`, {
		entry: '/counter'
	});
	const button = region.querySelector('button')!;
	const app = hydrate_island(region, '/counter', as_module(Counter), null, false);
	expect(app).not.toBeNull();
	expect(region.querySelector('button'), 'the earlier build’s button, adopted').toBe(button);
	expect(region.hasAttribute('data-og-recovered')).toBe(false);
	// (no props sidecar here: the island counts from its default)
	button.click();
	await expect.poll(() => region.querySelector('[data-testid="count"]')!.textContent).toBe('1');
});

test('a live region adopts its server nodes, and a pushed tick shows on the same node', async () => {
	const region = region_with(decode('label_render_b64'), { live: '' });
	const p = region.querySelector('p')!;
	const app = hydrate_live(region, '/label', as_module(Label), { text: 'one' })!;
	expect(region.querySelector('p'), 'the server paragraph, adopted').toBe(p);
	app.set_props!({ text: 'two' });
	await expect.poll(() => p.textContent).toBe('two');
	expect(region.querySelector('p'), 'still the server paragraph').toBe(p);
});

test('a kept island takes the next page’s props in place', async () => {
	const region = region_with(decode('label_render_b64'), {
		entry: '/label',
		'data-ogygia-keep': 'label'
	});
	const p = region.querySelector('p')!;
	const app = hydrate_island(region, '/label', as_module(Label), null, false)!;
	expect(app.set_props, 'a kept island can take pushed props').toBeTypeOf('function');
	app.set_props!({ text: 'next page' });
	await expect.poll(() => p.textContent).toBe('next page');
	expect(region.querySelector('p')).toBe(p);
});

test('pushable props: the values as pushed (never proxied), a push replaces the whole snapshot', async () => {
	const { PushableProps } = await import('../../src/runtime/pushable-props.svelte.ts');
	const tree = { items: [{ href: '/a' }] };
	const p = new PushableProps({ tree, title: 'one' });
	expect(p.props.tree, 'the very object, not a reactive proxy of it').toBe(tree);
	expect(Object.keys(p.props)).toEqual(['tree', 'title']);
	const next = { items: [] };
	p.push({ tree: next });
	expect(p.props.tree).toBe(next);
	expect('title' in p.props, 'a prop the next snapshot leaves out is gone').toBe(false);
	expect(p.props.title).toBeUndefined();
});

test('a hydrated island is "inside an island" for its children (placed and live)', () => {
	const seen: boolean[] = [];
	(globalThis as { __og_nested_seen?: boolean[] }).__og_nested_seen = seen;
	try {
		hydrate_island(
			region_with(decode('probe_render_b64'), { entry: '/probe' }),
			'/probe',
			as_module(NestedProbe),
			null,
			false
		);
		hydrate_live(region_with(decode('probe_render_b64')), '/probe', as_module(NestedProbe), {});
		expect(seen).toEqual([true, true]);
	} finally {
		delete (globalThis as { __og_nested_seen?: boolean[] }).__og_nested_seen;
	}
});
