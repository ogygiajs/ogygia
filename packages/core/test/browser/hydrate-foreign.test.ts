// A foreign island (fragment federation: its entry on another origin) is hydrated by its own build:
// its module's `__og_hydrate` gets the region and props parsed plain, nothing of this build's
// around them. Whether an island is foreign is read off its entry alone.
import { afterEach, beforeAll, beforeEach, expect, inject, test, vi } from 'vitest';
import { from_b64 } from './b64.ts';
import type { Component } from 'svelte';
import { stringify } from 'devalue';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { load_devalue } from '../../src/runtime/devalue-lane.ts';
import { current_region, foreign_hydrate } from '../../src/current-region.ts';
import { slots } from '../../src/runtime/slots.ts';
import { hydrate_island, read_region_props } from '../../src/runtime/hydrate-core.ts';
import Counter from './fixtures/Counter.svelte';

const FOREIGN = 'https://peer.example.com/_app/widget.js';
const render_html = () => from_b64(inject('counter_render_b64'));
let said: string[] = [];

type Seen = { region: Element; props: Record<string, unknown>; options: unknown };
function foreign_module(fail_strict = false) {
	const calls: Seen[] = [];
	const during: Array<{ region: Element | null; foreign: unknown }> = [];
	const app = { app: true };
	const mod = {
		default: Counter as unknown as Component<Record<string, unknown>>,
		__og_hydrate: vi.fn((region: Element, props: Record<string, unknown>, options?: unknown) => {
			calls.push({ region, props, options });
			during.push({ region: current_region(), foreign: foreign_hydrate() });
			if (fail_strict && options) throw new Error('mismatch');
			return app;
		}),
		__og_unmount: vi.fn()
	};
	return { mod, calls, during, app };
}

/** A region with `html` and a props sidecar of `props` after it. */
function region_with(html: string, props: unknown = { obj: { a: 1 } }): HTMLElement {
	const el = document.createElement('ogygia-region');
	el.innerHTML = html;
	const sidecar = document.createElement('script');
	sidecar.setAttribute('data-ogygia-props', '');
	sidecar.type = 'application/json';
	sidecar.textContent = stringify(props);
	document.body.append(el, sidecar);
	return el;
}

beforeAll(async () => {
	link_boot();
	await load_devalue();
});
beforeEach(() => {
	document.body.innerHTML = '';
	said = [];
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
		said.push(a.map(String).join(' '));
	});
});
afterEach(() => {
	vi.restoreAllMocks();
});

test('a foreign island is hydrated by its own build: strict first, on the region as it is', () => {
	const { mod, calls, app } = foreign_module();
	const el = region_with('<p>peer</p>');
	const handle = hydrate_island(el, FOREIGN, mod, null, false)!;
	expect(calls).toHaveLength(1);
	expect(calls[0].region).toBe(el);
	expect(calls[0].options).toEqual({ recover: false });
	expect(el.innerHTML, 'no anchor pair of ours around its nodes').toBe('<p>peer</p>');
	handle.dispose();
	expect(mod.__og_unmount).toHaveBeenCalledWith(app);
});

test('a foreign island whose strict hydrate throws is hydrated again with its own recovery', () => {
	const { mod, calls } = foreign_module(true);
	const el = region_with('<p>peer</p>');
	expect(hydrate_island(el, FOREIGN, mod, null, false)).not.toBeNull();
	expect(calls.map((c) => c.options)).toEqual([{ recover: false }, undefined]);
});

test('a foreign island’s props are its own: no guard of this build wraps them', () => {
	const { mod, calls } = foreign_module();
	hydrate_island(region_with('<p>peer</p>'), FOREIGN, mod, null, false);
	(calls[0].props.obj as { a: number }).a = 2;
	expect(said.filter((s) => s.includes('prop_mutation'))).toHaveLength(0);
});

test('while a foreign island hydrates, the hydrate is marked foreign and the region current; after, neither', () => {
	const { mod, during } = foreign_module();
	const el = region_with('<p>peer</p>');
	hydrate_island(el, FOREIGN, mod, null, false);
	expect(during).toEqual([
		{ region: el, foreign: { origin: 'https://peer.example.com', entry: FOREIGN } }
	]);
	expect(current_region()).toBeNull();
	expect(foreign_hydrate()).toBeNull();
});

test('a module that brings its own hydrate, from this origin, is hydrated by this build', () => {
	const { mod } = foreign_module();
	const el = region_with(render_html(), { start: 5 });
	const button = el.querySelector('button');
	hydrate_island(el, `${location.origin}/counter.js`, mod, null, false);
	expect(mod.__og_hydrate).not.toHaveBeenCalled();
	expect(el.querySelector('button'), 'adopted by this build').toBe(button);
});

test('a foreign entry is foreign whatever its module: one with no hydrate of its own still parses its props plain', () => {
	const el = region_with(render_html(), { start: 5 });
	// (a wired value in a foreign sidecar is refused at the boundary)
	el.nextElementSibling!.textContent = '[{"w":1},["OgygiaRef",2],"x"]';
	expect(() =>
		hydrate_island(
			el,
			FOREIGN,
			{ default: Counter as unknown as Component<Record<string, unknown>> },
			null,
			false
		)
	).toThrow(/wired_class_foreign/);
});

test('a seed reference in a foreign island’s props is not read from this page’s seed', () => {
	const el = region_with('<p>peer</p>');
	el.nextElementSibling!.textContent = '[{"s":1},["OgygiaSeedRef",2],[3],"counter"]';
	const page = slots.page;
	slots.page = { ...page!, seed_data_of: () => ({ counter: 'this page' }) };
	try {
		expect(read_region_props(el, false), 'an island of ours reads it').toEqual({
			s: 'this page'
		});
		expect(() => read_region_props(el, true)).toThrow();
	} finally {
		slots.page = page;
	}
});
