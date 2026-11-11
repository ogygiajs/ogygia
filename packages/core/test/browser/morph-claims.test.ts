// The morph's rules that need a real DOM (a live attribute list, shadow roots) and no other test
// held (#512).
import { afterEach, expect, test } from 'vitest';
import { morph_children } from '../../src/runtime/morph.ts';

type Restorer = {
	__og_restore?: unknown;
	__og_adopt?: { shadow: ShadowRoot; sheets: CSSStyleSheet[] }[];
};
const w = globalThis as Restorer;

afterEach(() => {
	delete w.__og_restore;
	delete w.__og_adopt;
	document.body.replaceChildren();
});

test('removes every attribute the new render dropped, side by side ones too', () => {
	const parent = document.createElement('div');
	parent.innerHTML = '<p a="1" b="2" c="3" d="4"></p>';
	const next = document.createElement('p');
	next.setAttribute('d', '4');
	morph_children(parent, [next]);
	const p = parent.firstElementChild!;
	expect(p.getAttributeNames()).toEqual(['d']);
});

test('a copy of a restored host keeps its open shadow root, its children and its adopted sheets', () => {
	w.__og_restore = () => {};
	const host = document.createElement('x-card');
	const root = host.attachShadow({ mode: 'open' });
	root.innerHTML = '<b>inside</b>';
	const sheet = new CSSStyleSheet();
	root.adoptedStyleSheets = [sheet];
	const parent = document.createElement('div');
	morph_children(parent, [host]);
	const copy = parent.firstElementChild!;
	expect(copy).not.toBe(host);
	expect(copy.shadowRoot?.innerHTML).toBe('<b>inside</b>');
	expect(copy.shadowRoot?.adoptedStyleSheets.length).toBe(1);
	expect(copy.shadowRoot?.adoptedStyleSheets[0]).toBe(sheet);
});

test('a copied shadow root still waiting for its sheets is handed to the restorer', () => {
	w.__og_restore = () => {};
	const host = document.createElement('x-card');
	const root = host.attachShadow({ mode: 'open' }) as ShadowRoot & {
		__og_pending?: CSSStyleSheet[];
	};
	const sheet = new CSSStyleSheet();
	root.__og_pending = [sheet];
	const parent = document.createElement('div');
	morph_children(parent, [host]);
	const copy = parent.firstElementChild!.shadowRoot!;
	expect(w.__og_adopt).toEqual([{ shadow: copy, sheets: [sheet] }]);
});
