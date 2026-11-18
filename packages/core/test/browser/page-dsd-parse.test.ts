// A page the router parses (its next page, a soft refresh) goes through the same DSD-aware parser as
// a region's answer (#1894): declarative shadow roots attached, Svelte's comment markers kept, nothing
// built. And a host the morph copies into the live page keeps its declarative shadow root, unless
// the root is closed and not clonable (#1904): then dev says so with a code.
import { expect, test, vi } from 'vitest';
import {
	parse_page_document,
	parse_region_html,
	vouch_page_html
} from '../../src/runtime/html-sink.ts';
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

const LOST = 'closed_shadow_root_lost';

/** Morphs a live `<main><p>A</p></main>` toward the `<main>` of `body`, and gives the live copy and
 *  every console warning that named {@link LOST}. */
function morph_page(body: string): { live: HTMLElement; said: string[] } {
	const said: string[] = [];
	const spy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
		const text = a.map(String).join(' ');
		if (text.includes(LOST)) said.push(text);
	});
	const live = document.createElement('main');
	document.body.append(live);
	try {
		live.innerHTML = '<p>A</p>';
		const doc = parse(`<!doctype html><html><head></head><body><main>${body}</main></body></html>`);
		morph_children(live, doc.body.firstElementChild!.childNodes);
	} finally {
		spy.mockRestore();
	}
	return { live, said };
}

test('a host the morph copies in loses a closed declarative shadow root, and dev says so once', () => {
	const { live, said } = morph_page(
		`<p>A</p><section><x-shut style="display:block"><template shadowrootmode="closed"><div style="height:37px"></div><x-shut style="display:block"><template shadowrootmode="closed"><div style="height:5px"></div></template></x-shut></template></x-shut></section>`
	);
	try {
		const host = live.querySelector('section > x-shut') as HTMLElement;
		expect(host.ownerDocument).toBe(document);
		expect(host.querySelector('template')).toBeNull();
		expect(host.shadowRoot).toBeNull();
		expect(said.length).toBe(1);
		expect(said[0]).toContain(`https://ogygiajs.dev/e/${LOST}`);
	} finally {
		live.remove();
	}
});

test('a closed declarative shadow root inside an open one the morph carries is said once', () => {
	const { live, said } = morph_page(
		`<p>A</p><x-card><template shadowrootmode="open"><x-shut><template shadowrootmode="closed"><b>shut</b></template></x-shut></template></x-card>`
	);
	try {
		expect(live.querySelector('x-card')!.shadowRoot?.querySelector('x-shut')).not.toBeNull();
		expect(said.length).toBe(1);
	} finally {
		live.remove();
	}
});

test('a clonable closed declarative shadow root is copied with its host, and nothing is said', () => {
	const { live, said } = morph_page(
		`<p>A</p><x-shut style="display:block"><template shadowrootmode="closed" shadowrootclonable><div style="height:37px"></div></template></x-shut>`
	);
	try {
		expect((live.querySelector('x-shut') as HTMLElement).getBoundingClientRect().height).toBe(37);
		expect(said).toEqual([]);
	} finally {
		live.remove();
	}
});

test('a region update that copies in a closed declarative shadow root says so once', () => {
	const said: string[] = [];
	const spy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
		const text = a.map(String).join(' ');
		if (text.includes(LOST)) said.push(text);
	});
	const live = document.createElement('div');
	try {
		live.innerHTML = '<p>A</p>';
		const answer = parse_region_html(
			vouch_page_html(
				`<p>A</p><x-shut><template shadowrootmode="closed"><b>shut</b></template></x-shut>`
			)
		);
		morph_children(live, answer.childNodes);
	} finally {
		spy.mockRestore();
	}
	expect(live.querySelector('x-shut')!.shadowRoot).toBeNull();
	expect(said.length).toBe(1);
});

test('an open declarative shadow root the morph copies is carried, and nothing is said', () => {
	const { live, said } = morph_page(
		`<p>A</p><x-card><template shadowrootmode="open"><b>open</b></template></x-card>`
	);
	try {
		expect(live.querySelector('x-card')!.shadowRoot?.textContent).toBe('open');
		expect(said).toEqual([]);
	} finally {
		live.remove();
	}
});
