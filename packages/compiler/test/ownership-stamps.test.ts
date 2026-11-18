// compiler/ownership-stamps.ts — the server-leg stamp on the elements Svelte's hydration never walks
// into (internal/notes/dom-ownership.md §4). The runtime's repair, drift watch and morph leave those
// subtrees alone (runtime/ownership.ts); the runtime can't tell them apart from the DOM by itself.
import { describe, expect, test } from 'vitest';
import { stamp_opaque } from '../src/ownership-stamps.ts';
import { dedent } from '@ogygia/core/contract';
import { runInNewContext } from 'node:vm';

const S = (src: string) => stamp_opaque(src, '/app/src/lib/X.svelte');

describe('stamp_opaque', () => {
	test('an element whose only child is {@html} (whitespace aside) is stamped', () => {
		expect(
			S(dedent`
			<div class="w">
				{@html widget}
			</div>
		`)
		).toBe(
			dedent`
				<div data-og-opaque class="w">
					{@html widget}
				</div>
			`
		);
		expect(S('<x-widget id="w">{@html markup}</x-widget>')).toBe(
			'<x-widget data-og-opaque id="w">{@html markup}</x-widget>'
		);
	});

	test('an {@html} beside other content: the parent stays walked, stamped data-og-html, and the range is marked', () => {
		expect(S('<div><p>{title}</p>{@html body}</div>')).toBe(
			`<div data-og-html><p>{title}</p>{@html ((s) => s && '<!--@html-->' + s)(String((body) ?? ''))}</div>`
		);
	});

	test('the range mark goes before a non-empty value only, and leaves the value as it was', () => {
		const mark = (src: string) =>
			/\{@html (.*)\}<\/div>$/.exec(S(`<div><p>a</p>{@html ${src}}</div>`)!)![1];
		const evaluate = (src: string) => runInNewContext(mark(src)) as string;
		expect(evaluate(`'<b>x</b>'`)).toBe('<!--@html--><b>x</b>');
		expect(evaluate(`''`)).toBe('');
		expect(evaluate('null')).toBe('');
		expect(evaluate('undefined')).toBe('');
		expect(evaluate('0')).toBe('<!--@html-->0');
		expect(evaluate(`'a' + 'b'`)).toBe('<!--@html-->ab');
	});

	test('every {@html} of a stamped element is marked; an opaque or unstamped one is not', () => {
		const out = S('<div>{@html a}<p>x</p>{@html b}</div><span>{@html c}</span>')!;
		expect(out.match(/<!--@html-->/g)).toHaveLength(2);
		expect(out).toContain('<span data-og-opaque>{@html c}</span>');
		expect(S('<div data-og-opaque><p>x</p>{@html a}</div>')).toBeNull();
		expect(S('<div data-og-html><p>x</p>{@html a}</div>')).toBe(
			`<div data-og-html><p>x</p>{@html ((s) => s && '<!--@html-->' + s)(String((a) ?? ''))}</div>`
		);
	});

	test('bind:innerHTML / textContent / innerText are stamped', () => {
		expect(S('<div contenteditable bind:innerHTML={html}></div>')).toBe(
			'<div data-og-opaque contenteditable bind:innerHTML={html}></div>'
		);
		expect(S('<p contenteditable bind:textContent={t}></p>')).toContain('<p data-og-opaque');
		expect(S('<p contenteditable bind:innerText={t}></p>')).toContain('<p data-og-opaque');
	});

	test('a custom element with only static children is stamped; its own dynamic attributes are fine', () => {
		expect(
			S('<ui-search mode={mode}><form action="/s"><input name="q" /></form></ui-search>')
		).toBe(
			'<ui-search data-og-opaque mode={mode}><form action="/s"><input name="q" /></form></ui-search>'
		);
		expect(S('<button is="x-btn"><span>go</span></button>')).toContain(
			'<button data-og-opaque is="x-btn">'
		);
	});

	test('a custom element whose children Svelte walks is NOT stamped', () => {
		for (const src of [
			'<x-card><h2>{title}</h2></x-card>',
			'<x-card>{#if open}<p>a</p>{/if}</x-card>',
			'<x-card><Inner /></x-card>',
			'<x-card><a href={url}>go</a></x-card>',
			'<x-card><button onclick={go}>go</button></x-card>',
			'<x-card>{@render children()}</x-card>',
			'<x-card><span use:act>a</span></x-card>',
			'<x-card><svelte:element this="p">a</svelte:element></x-card>',
			'<x-card><svelte:head><title>a</title></svelte:head></x-card>'
		])
			expect(S(src), src).toBeNull();
	});

	test('nested inside blocks and components’ children; outermost wins; never stamped twice', () => {
		const out = S(
			'{#if a}<section><x-w>{@html h}</x-w></section>{/if}<Comp><div>{@html z}</div></Comp>'
		)!;
		expect(out).toContain('<x-w data-og-opaque>');
		expect(out).toContain('<div data-og-opaque>');
		expect(S('<x-w data-og-opaque>{@html h}</x-w>')).toBeNull();
		// a stamped custom element's static descendants are not stamped again
		expect(S('<x-outer><x-inner><b>x</b></x-inner></x-outer>')).toBe(
			'<x-outer data-og-opaque><x-inner><b>x</b></x-inner></x-outer>'
		);
	});

	test("an each block's fallback is searched too", () => {
		expect(S('{#each xs as x}{x}{:else}<p>{@html h}</p>{/each}')).toContain('<p data-og-opaque>');
	});

	test('a style Svelte cannot parse does not stop the stamps', () => {
		expect(S('<p>{@html h}</p><style lang="scss">$c: red; p { color: $c; }</style>')).toContain(
			'<p data-og-opaque>'
		);
	});

	test('nothing to stamp, or unparsable → null', () => {
		expect(S('<div><p>{x}</p></div>')).toBeNull();
		expect(S('<x-w>{@html')).toBeNull();
	});
});
