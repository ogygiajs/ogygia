import { afterEach, beforeEach, expect, test } from 'vitest';
import { morph_children } from '../../src/runtime/morph.ts';
import { install_head_style } from '../../src/runtime/router-nav.ts';
import { slots } from '../../src/runtime/slots.ts';

/** Elements as the HTML parser makes them from `html`: it takes attribute names (one that starts
 *  with `-`, `@click`, `:class`) that `setAttribute` refused in every engine before the DOM's 2025
 *  relaxed names, and still refuses in the browsers of visitors who have not updated. */
function parsed(html: string): Element[] {
	const t = document.createElement('template');
	t.innerHTML = html;
	return Array.from(t.content.children);
}

/** An XML Name, the only attribute name `setAttribute` took before the relaxed names. */
const XML_NAME = /^[A-Za-z_:][\w.:-]*$/;
const real_set_attribute = Object.getOwnPropertyDescriptor(Element.prototype, 'setAttribute')!
	.value as (this: Element, name: string, value: string) => void;

// the engine of a visitor who has not updated: `setAttribute` refuses what is not an XML Name
beforeEach(() => {
	Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
		if (!XML_NAME.test(name))
			throw new DOMException(`'${name}' is not a valid attribute name.`, 'InvalidCharacterError');
		real_set_attribute.call(this, name, value);
	};
});
afterEach(() => {
	Element.prototype.setAttribute = real_set_attribute;
});

test('a render with an attribute name the parser takes but an older setAttribute refuses still morphs in, whole', () => {
	const host = document.createElement('div');
	host.append(...parsed('<section class="old"><p>old</p></section>'));
	const kept = host.firstElementChild!;

	morph_children(
		host,
		parsed('<section class="new" -panel="" @click="go" :class="x"><p>new</p></section>')
	);

	expect(host.firstElementChild).toBe(kept);
	expect(kept.getAttribute('class')).toBe('new');
	expect(kept.getAttribute('-panel')).toBe('');
	expect(kept.getAttribute('@click')).toBe('go');
	expect(kept.getAttribute(':class')).toBe('x');
	expect(kept.textContent).toBe('new');
});

test('an attribute the parser took under such a name changes value and is removed with the render', () => {
	const host = document.createElement('div');
	host.append(...parsed('<section @click="a" -panel=""></section>'));
	const kept = host.firstElementChild!;

	morph_children(host, parsed('<section @click="b"></section>'));
	expect(kept.getAttribute('@click')).toBe('b');
	expect(kept.hasAttribute('-panel')).toBe(false);

	morph_children(host, parsed('<section></section>'));
	expect(kept.attributes.length).toBe(0);
});

test("a navigation's head style with such an attribute name is installed with it", () => {
	const head = document.createElement('div');
	const [source] = parsed('<style @media-note="wide" data-x="1">p{color:red}</style>');
	const was_boot = slots.boot;
	const claimed: Node[] = [];
	slots.boot = {
		runtime_session: { claim_page_head: (n: Node) => claimed.push(n) }
	} as unknown as typeof slots.boot;

	let el: HTMLStyleElement;
	try {
		el = install_head_style(source, head as unknown as HTMLHeadElement);
	} finally {
		slots.boot = was_boot;
	}

	expect(claimed).toEqual([el]);
	expect(el.parentNode).toBe(head);
	expect(el.getAttribute('@media-note')).toBe('wide');
	expect(el.getAttribute('data-x')).toBe('1');
	expect(el.textContent).toBe('p{color:red}');
});
