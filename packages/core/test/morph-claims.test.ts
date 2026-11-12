// The morph's rules that runtime/morph.ts states and morph.test.ts did not hold (#512). Node, on the
// DOM shim: the shim import comes first, it installs the globals the morph's callers read.
import { beforeEach, describe, expect, test } from 'vitest';
import { document, el, frag, type DomElement, type DomNode } from './_stubs/dom.ts';
import { morph_children as dom_morph_children, type MorphOptions } from '../src/runtime/morph.ts';

function morph_children(parent: DomElement, new_nodes: DomNode[], options?: MorphOptions): void {
	dom_morph_children(parent as unknown as Element, new_nodes as unknown as Node[], options);
}

beforeEach(() => {
	document._active = null;
});

describe('the root, toward Svelte’s walk', () => {
	test('a hydrated region root handed to the repair has its children repaired', () => {
		const root = el('<ogygia-island data-hydrated><b>old</b></ogygia-island>');
		morph_children(root, frag('<i>new</i>'), { target: 'walk' });
		expect(root.firstElementChild!.localName).toBe('i');
	});

	test('a root the walk never reads (data-og-opaque) is left as it is', () => {
		const root = el('<div data-og-opaque><b>old</b></div>');
		const b = root.firstElementChild;
		morph_children(root, frag('<i>new</i>'), { target: 'walk' });
		expect(root.firstElementChild).toBe(b);
	});
});

describe('the aria-hidden sweep over focus', () => {
	test('strips aria-hidden="true" from the morph root itself when focus is inside it', () => {
		const root = el('<div aria-hidden="true"><button>Menu</button></div>');
		(root.firstElementChild as DomElement).focus();
		morph_children(root, frag('<button>Menu</button>'));
		expect(root.hasAttribute('aria-hidden')).toBe(false);
	});

	test('never climbs above the morph root', () => {
		const outer = el('<div aria-hidden="true"><div><button>Menu</button></div></div>');
		const root = outer.firstElementChild as DomElement;
		(root.firstElementChild as DomElement).focus();
		morph_children(root, frag('<button>Menu</button>'));
		expect(outer.getAttribute('aria-hidden')).toBe('true');
	});
});

describe('wrapper matching', () => {
	test('a key-less sibling removed above a wrapper keeps the keyed node inside the wrapper', () => {
		const parent = el(
			'<main><div class="banner">Old</div><div class="content"><section data-key="r1">island</section></div></main>'
		);
		const content = parent.children[1];
		const island = content.firstElementChild;
		morph_children(
			parent,
			frag('<div class="content"><section data-key="r1">island</section></div>')
		);
		expect(parent.children.length).toBe(1);
		expect(parent.children[0]).toBe(content);
		expect(parent.children[0].firstElementChild).toBe(island);
	});

	test('a wrapper of another tag holding the wanted key is not turned into the new wrapper', () => {
		const parent = el('<main><div class="w"><b id="k">x</b></div></main>');
		morph_children(parent, frag('<p>banner</p><section class="w"><b id="k">x</b></section>'));
		expect(parent.children.map((c) => c.localName)).toEqual(['p', 'section']);
	});
});

describe('form properties follow only a changed default', () => {
	test('a re-render with no value attribute leaves what the user typed', () => {
		const parent = el('<form><input name="q" value="server"></form>');
		const input = parent.firstElementChild as DomElement;
		input.value = 'typed';
		morph_children(parent, frag('<input name="q">'));
		expect(input.value).toBe('typed');
	});

	test('an option the user deselected stays deselected when the server re-sends the same default', () => {
		const parent = el(
			'<form><select><option value="a" selected>A</option><option value="b">B</option></select></form>'
		);
		const opt_a = (parent.firstElementChild as DomElement).children[0];
		opt_a.selected = false;
		morph_children(
			parent,
			frag('<select><option value="a" selected>A</option><option value="b">B</option></select>')
		);
		expect(opt_a.selected).toBe(false);
	});
});
