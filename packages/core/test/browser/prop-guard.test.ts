// The dev guard on an island's props: a write to a prop is said (once per prop), and what is not a
// snapshot the server serialized (a class instance, a Date, a symbol-keyed field) is handed through
// untouched.
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { Component } from 'svelte';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { load_devalue } from '../../src/runtime/devalue-lane.ts';
import { install as install_live } from '../../src/runtime/live.ts';
import { hydrate_live } from '../../src/runtime/hydrate-core.ts';
import PropsProbe from './fixtures/PropsProbe.svelte';

const probe = { default: PropsProbe as unknown as Component<Record<string, unknown>> };
type Probe = { __og_probe_props?: Record<string, unknown> };
let said: string[] = [];

/** The props as the island sees them, hydrated live from `props` (entry `/probe-<n>`). */
let n = 0;
function island_props(props: Record<string, unknown>): Record<string, unknown> {
	const region = document.createElement('ogygia-region');
	document.body.append(region);
	hydrate_live(region, `/probe-${++n}`, probe, props);
	return (globalThis as Probe).__og_probe_props!;
}
const mutations = () => said.filter((s) => s.includes('prop_mutation'));

beforeAll(async () => {
	link_boot();
	await load_devalue();
	install_live();
});
beforeEach(() => {
	document.body.innerHTML = '';
	said = [];
	vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
		said.push(a.map(String).join(' '));
	});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
	delete (globalThis as Probe).__og_probe_props;
});

test('a write to a nested prop is said, naming its path, once', () => {
	const p = island_props({ obj: { a: 1 } }) as { obj: { a: number } };
	p.obj.a = 2;
	p.obj.a = 3;
	expect(mutations()).toHaveLength(1);
	expect(mutations()[0]).toContain("'obj.a'");
	expect(p.obj.a, 'the write still lands').toBe(3);
});

test('deleting a prop’s field and defining one are writes too', () => {
	const p = island_props({ obj: { a: 1, b: 2 } }) as { obj: Record<string, number> };
	delete p.obj.a;
	Object.defineProperty(p.obj, 'c', { value: 1, configurable: true });
	expect(mutations().map((m) => /'([^']+)'/.exec(m)![1])).toEqual(['obj.a', 'obj.c']);
});

test('an array prop is guarded: a push is said', () => {
	const p = island_props({ list: [1] }) as { list: number[] };
	p.list.push(2);
	expect(mutations().length).toBeGreaterThan(0);
	expect(mutations()[0]).toContain("'list.");
});

test('a Map prop’s set, delete and clear are said; its reads work', () => {
	const p = island_props({ m: new Map([['k', 1]]) }) as { m: Map<string, number> };
	expect(p.m.get('k')).toBe(1);
	expect(p.m.size).toBe(1);
	expect(mutations()).toHaveLength(0);
	p.m.set('j', 2);
	p.m.delete('j');
	p.m.clear();
	expect(mutations().map((m) => /'([^']+)'/.exec(m)![1])).toEqual([
		'm.set()',
		'm.delete()',
		'm.clear()'
	]);
});

test('a Set prop’s add, delete and clear are said; its reads work', () => {
	const p = island_props({ s: new Set([1]) }) as { s: Set<number> };
	expect(p.s.has(1)).toBe(true);
	expect(mutations()).toHaveLength(0);
	p.s.add(2);
	p.s.delete(2);
	p.s.clear();
	expect(mutations().map((m) => /'([^']+)'/.exec(m)![1])).toEqual([
		's.add()',
		's.delete()',
		's.clear()'
	]);
});

test('a class instance is handed through as it is: its private fields work', () => {
	class Cart {
		#items = 1;
		get items() {
			return this.#items;
		}
		add() {
			this.#items++;
		}
	}
	const cart = new Cart();
	const p = island_props({ cart }) as { cart: Cart };
	expect(p.cart).toBe(cart);
	p.cart.add();
	expect(p.cart.items).toBe(2);
	expect(mutations()).toHaveLength(0);
});

test('a Date, a RegExp and a URL are handed through as they are', () => {
	const d = new Date(0);
	const r = /x/;
	const u = new URL('https://example.com/');
	const p = island_props({ d, r, u }) as { d: Date; r: RegExp; u: URL };
	expect(p.d).toBe(d);
	expect(p.r).toBe(r);
	expect(p.u).toBe(u);
	expect(p.d.getTime()).toBe(0);
});

test('a symbol-keyed field is read and written as it is, unsaid', () => {
	const key = Symbol('k');
	const inner = { [key]: { a: 1 } };
	const p = island_props({ obj: inner }) as { obj: Record<symbol, { a: number }> };
	expect(p.obj[key], 'not wrapped').toBe(inner[key]);
	p.obj[key] = { a: 2 };
	delete p.obj[key];
	Object.defineProperty(p.obj, key, { value: 1, configurable: true });
	expect(mutations()).toHaveLength(0);
});

test('props pushed into a live island are guarded too', async () => {
	const region = document.createElement('ogygia-region');
	document.body.append(region);
	const app = hydrate_live(region, '/probe-push', probe, { obj: { a: 1 } })!;
	app.set_props!({ obj: { a: 1 } });
	await Promise.resolve();
	const p = (globalThis as Probe).__og_probe_props as { obj: { a: number } };
	p.obj.a = 5;
	expect(mutations()).toHaveLength(1);
});
