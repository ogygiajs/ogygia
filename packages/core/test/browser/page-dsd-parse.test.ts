// A page the router parses (its next page, a soft refresh) goes through the same DSD-aware parser as
// a region's answer (#1894): declarative shadow roots attached, Svelte's comment markers kept, nothing
// built. And a host the morph copies into the live page keeps its declarative shadow root.
import { expect, test } from 'vitest';
import { parse_page_document, vouch_page_html } from '../../src/runtime/html-sink.ts';
import { morph_children } from '../../src/runtime/morph.ts';

const parse = (html: string): Document => parse_page_document(vouch_page_html(html));

const PAGE = `<!doctype html><html lang="en"><head><title>B</title><meta name="ogygia-router" content=""></head><body class="b"><!--[--><x-card id="c"><template shadowrootmode="open"><x-badge>card B</x-badge><slot></slot></template><span>light</span></x-card><!--]--></body></html>`;

test('a parsed page has its declarative shadow roots, and no template is left inert', () => {
	const doc = parse(PAGE);
	const host = doc.querySelector('x-card')!;
	expect(host.shadowRoot?.querySelector('x-badge')?.textContent).toBe('card B');
	expect(doc.querySelectorAll('template[shadowrootmode]').length).toBe(0);
	expect(host.textContent).toBe('light');
});

test('a parsed page keeps its comments (Svelte’s hydration markers), its head and its body', () => {
	const doc = parse(PAGE);
	expect(doc.title).toBe('B');
	expect(doc.querySelector('meta[name="ogygia-router"]')).not.toBeNull();
	expect(doc.body.className).toBe('b');
	expect(doc.body.firstChild?.nodeType).toBe(Node.COMMENT_NODE);
	expect((doc.body.firstChild as Comment).data).toBe('[');
	expect((doc.body.lastChild as Comment).data).toBe(']');
});

test('a parsed page is inert: a defined element in it is not built, a script in it does not run', () => {
	let built = 0;
	if (!customElements.get('page-parse-probe'))
		customElements.define(
			'page-parse-probe',
			class extends HTMLElement {
				constructor() {
					super();
					built++;
				}
			}
		);
	const w = window as { __page_parse_ran?: number };
	const doc = parse(
		`<!doctype html><html><head></head><body><page-parse-probe></page-parse-probe><script>window.__page_parse_ran = 1</script></body></html>`
	);
	expect(built).toBe(0);
	expect(w.__page_parse_ran).toBeUndefined();
	document.body.append(doc.querySelector('page-parse-probe')!);
	expect(built).toBe(1);
	document.querySelector('page-parse-probe')!.remove();
});

test('an engine without setHTMLUnsafe still attaches a page’s declarative shadow roots', () => {
	const proto = HTMLHtmlElement.prototype as { setHTMLUnsafe?: unknown };
	const real = Object.getOwnPropertyDescriptor(proto, 'setHTMLUnsafe');
	Object.defineProperty(proto, 'setHTMLUnsafe', { value: undefined, configurable: true });
	try {
		const doc = parse(PAGE);
		expect(doc.querySelector('x-card')!.shadowRoot?.querySelector('x-badge')?.textContent).toBe(
			'card B'
		);
		expect(doc.querySelectorAll('template[shadowrootmode]').length).toBe(0);
	} finally {
		if (real) Object.defineProperty(proto, 'setHTMLUnsafe', real);
		else delete (proto as Record<string, unknown>).setHTMLUnsafe;
	}
});

test('a host the morph copies in keeps its declarative shadow root, with no restorer on the page', () => {
	const live = document.createElement('main');
	live.innerHTML = '<p>A</p>';
	const doc = parse(
		`<!doctype html><html><head></head><body><main><p>A</p><section><x-card><template shadowrootmode="open"><b>new</b><x-card><template shadowrootmode="open"><i>deep</i></template></x-card></template></x-card></section></main></body></html>`
	);
	morph_children(live, doc.body.firstElementChild!.childNodes);
	const host = live.querySelector('section > x-card')!;
	expect(host.ownerDocument).toBe(document);
	expect(host.shadowRoot?.querySelector('b')?.textContent).toBe('new');
	expect(host.shadowRoot?.querySelector('x-card')?.shadowRoot?.textContent).toBe('deep');
});
