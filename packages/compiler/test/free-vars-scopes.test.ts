// What a hoisted template subtree reads from outside it, what it writes there, and where it reads a
// `$store`, through JavaScript's own scopes: a name a function, block, loop, switch or catch binds is
// no capture, a property name is no read, and a TypeScript type names no value. A missed read is a
// ReferenceError when a portable snippet renders on the far side; an extra one serializes a host
// value for nothing. A write into a capture writes a snapshot, so the transform keeps that snippet
// plain (`mutated`).
import { describe, expect, it } from 'vitest';
import { parse } from 'svelte/compiler';
import { collectCaptureInfo, scope_bindings } from '../src/compiler/free-vars.ts';
import { parse_module } from '../src/compiler/parse/oxc.ts';

const info = (markup: string) => {
	const r = collectCaptureInfo(parse(markup, { modern: true }).fragment.nodes as never);
	return {
		free: [...r.free].sort(),
		mutated: [...r.mutated].sort(),
		stores: Object.fromEntries([...r.stores].map(([k, v]) => [k, v.length]))
	};
};
const free = (markup: string) => info(markup).free;
const mutated = (markup: string) => info(markup).mutated;

describe('collectCaptureInfo: a name in a non-reading position is no capture', () => {
	it.each([
		['{a.b}', ['a']],
		['{a[b]}', ['a', 'b']],
		['{({ k: v })}', ['v']],
		['{({ k })}', ['k']],
		['{({ [k]: v })}', ['k', 'v']],
		['{(() => { const z = 1; return z; })()}', []],
		['{(function f(p) { return f(p); })}', []],
		['{(class { m() {} x = 1; [k]() {} })}', ['k']],
		['{(class K {})}', []],
		['{(class { static { const q = 1; q; } })}', []],
		['{(class { static { class Q {} Q; } })}', []],
		['{#each xs as act}<p use:act>x</p>{/each}', ['xs']],
		['{(() => { a: for (;;) break a; })()}', []],
		['{import.meta.env}', []],
		[
			'<script lang="ts"></script>{(x as Foo)}{(y!)}{((z: Bar): Baz => z)}{f<T>(w)}',
			['f', 'w', 'x', 'y']
		]
	])('%s → %j', (markup, want) => {
		expect(free(markup)).toEqual(want);
	});
});

describe('collectCaptureInfo: a scope binds its names before any is read', () => {
	it.each([
		['{(() => { f(); function f() {} })()}', []],
		['{(() => { if (c) { var v = 1; } return v; })()}', ['c']],
		[
			'{(() => { for (var i = 0; ; ) {} for (var k in o) {} while (c) { var w; } do { var dw; } while (c); try { var t; } catch { var h; } finally { var fi; } switch (c) { case 1: var sw; } lbl: { var lb; } return [i, k, w, dw, t, h, fi, sw, lb]; })()}',
			['c', 'o']
		],
		['{(() => { { const q = 1; } return q; })()}', ['q']],
		['{(() => { { var q = 1; } return q; })()}', []],
		['{(() => { switch (a) { case 1: let s = 1; s; } })()}', ['a']],
		['{(() => { switch (a) { case 1: let s = 1; } return s; })()}', ['a', 's']],
		['{(() => { class K {} return K; })()}', []]
	])('%s → %j', (markup, want) => {
		expect(free(markup)).toEqual(want);
	});

	it('a program binds its imports, exports, declarations and every `var`, however deep', () => {
		const { program } = parse_module(
			'export var x = 1; export const y = 2; export function g() {} import a from "b"; if (c) { var z; } for (var i of []) {}',
			'x.ts'
		);
		expect([...scope_bindings(program as never)].sort()).toEqual(['a', 'g', 'i', 'x', 'y', 'z']);
	});
});

describe('collectCaptureInfo: a write into a capture is a mutation', () => {
	it.each([
		['<button onclick={() => count++}>x</button>', ['count']],
		['<button onclick={() => (a.b = 1)}>x</button>', ['a']],
		['<button onclick={() => ([p, q] = r)}>x</button>', ['p', 'q']],
		['<button onclick={() => ({ s, t: [u = 1], ...w } = r)}>x</button>', ['s', 'u', 'w']],
		['<button onclick={() => { let n = 0; n++; }}>x</button>', []],
		['{#snippet sn(p)}<button onclick={() => p++}>x</button>{/snippet}', []],
		['<input bind:value={v} />', ['v']],
		['<input bind:value={o.k} />', ['o']],
		['{#each xs as x}<input bind:value={x} />{/each}', []]
	])('%s → %j', (markup, want) => {
		expect(mutated(markup)).toEqual(want);
	});

	it('a bound name is read as well as written', () => {
		expect(free('<input bind:value={o.k} />')).toEqual(['o']);
	});
});

describe('collectCaptureInfo: every `$store` read site is kept', () => {
	it('a free `$name` is a store read at each site', () => {
		expect(info('{$count}{$count + 1}').stores).toEqual({ $count: 2 });
	});

	it('a bound `$name` is no store read', () => {
		expect(info('{(() => { let $x = 1; return $x; })()}').stores).toEqual({});
	});

	it('a plain name is no store read', () => {
		expect(info('{count}').stores).toEqual({});
	});
});

describe('collectCaptureInfo: the template binds and reads', () => {
	it.each([
		['<p title="a {t} b">x</p>', ['t']],
		['<p title={t}>x</p>', ['t']],
		['<p {...rest}>x</p>', ['rest']],
		['<p hidden>x</p>', []],
		['<p on:click={h}>x</p>', ['h']],
		['<svelte:element this={tag} />', ['tag']],
		['<Foo.Bar />', ['Foo']],
		['{#each xs as x}<x.Y />{/each}', ['xs']],
		['<C let:item>{item}</C>', ['C']],
		['<C let:item={[a, ...rest]}>{a}{rest}</C>', ['C']],
		['<C let:item={[a = 1]}>{a}</C>', ['C']],
		['<svelte:fragment let:item>{item}</svelte:fragment>', []],
		['{#each xs as x, i (i)}{x}{/each}', ['xs']],
		['{#each xs as x (k)}{x}{/each}', ['k', 'xs']],
		['{#each xs as x}{x}{:else}{e}{/each}', ['e', 'xs']],
		['{#await p}{w}{:then v}{v}{:catch err}{err}{/await}', ['p', 'w']],
		['{#key k}{c}{/key}', ['c', 'k']],
		['{#snippet s()}{n}{/snippet}{@render s()}', ['n']],
		['{@render s()}{#snippet s()}{n}{/snippet}', ['n']],
		['{@const c = 1}{c}', []],
		['{@html h}', ['h']],
		['<svelte:boundary>{b}</svelte:boundary>', ['b']],
		['<svelte:head><title>{t}</title></svelte:head>', ['t']]
	])('%s → %j', (markup, want) => {
		expect(free(markup)).toEqual(want);
	});
});
