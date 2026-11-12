// A HELD REGION'S SHEET GOES WITH THE RENDER THAT WROTE IT (#1039, found by the simulator). The
// server writes a styled held region's sheet as a `<link data-ogygia-region-css>` inside the baked
// region. A navigation to a page with an unstyled held region in the same place morphs the one into
// the other; the sheet is render output, so it goes when the next render has none, as a fresh load
// of that page has none.
import { expect, test } from 'vitest';
import { morph_children, install as install_morph } from '../../src/runtime/morph.ts';

install_morph();

const SHEET =
	'<link rel="stylesheet" href="/_app/immutable/assets/og-region.x.css" data-ogygia-region-css="">';

function held(inner: string): Element {
	const host = document.createElement('div');
	host.innerHTML = `<ogygia-region live="" data-og-baked="">${inner}</ogygia-region>`;
	return host.firstElementChild!;
}

test('a baked region morphed to a render with no sheet loses the sheet the last render wrote', () => {
	const live = held(`${SHEET}<!--[--><div data-gen="held"><span>n8</span></div><!--]-->`);
	const next = held('<!--[--><div data-gen="held"><span>n3</span></div><!--]-->');
	morph_children(live, next.childNodes);
	expect(live.querySelector('span')?.textContent).toBe('n3');
	expect(live.querySelectorAll('link[data-ogygia-region-css]').length).toBe(0);
});

test('a baked region keeps a node its own runtime added', () => {
	const live = held('<!--[--><div data-gen="held"><span>n8</span></div><!--]-->');
	const own = document.createElement('aside');
	live.prepend(own);
	morph_children(
		live,
		held('<!--[--><div data-gen="held"><span>n3</span></div><!--]-->').childNodes
	);
	expect(own.parentNode).toBe(live);
});
