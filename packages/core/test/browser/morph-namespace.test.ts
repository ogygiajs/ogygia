import { expect, test } from 'vitest';
import { morph_children } from '../../src/runtime/morph.ts';

const XHTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';

/** An XHTML document: there an HTML element's `tagName` is lower case, like an SVG element's. */
function xhtml_doc(): Document {
	return new DOMParser().parseFromString(
		`<html xmlns="${XHTML}"><body><div id="host"/></body></html>`,
		'application/xhtml+xml'
	);
}

test('in an XHTML document, an HTML <a> and an SVG <a> are different elements: the morph replaces one with the other', () => {
	const doc = xhtml_doc();
	const host = doc.getElementById('host')!;
	const svg_a = doc.createElementNS(SVG, 'a');
	host.append(svg_a);
	const html_a = doc.createElementNS(XHTML, 'a');
	html_a.setAttribute('href', '/next');
	expect(svg_a.tagName).toBe(html_a.tagName);

	morph_children(host, [html_a]);

	expect(host.firstElementChild).not.toBe(svg_a);
	expect(host.firstElementChild?.namespaceURI).toBe(XHTML);
	expect(host.firstElementChild?.getAttribute('href')).toBe('/next');
});

test('in an XHTML document, a keyed HTML <a> that meets a keyed SVG <a> is replaced, not morphed', () => {
	const doc = xhtml_doc();
	const host = doc.getElementById('host')!;
	const first = doc.createElementNS(XHTML, 'b');
	const svg_a = doc.createElementNS(SVG, 'a');
	svg_a.setAttribute('id', 'k');
	host.append(first, svg_a);
	const html_a = doc.createElementNS(XHTML, 'a');
	html_a.setAttribute('id', 'k');

	morph_children(host, [html_a]);

	expect(host.childNodes.length).toBe(1);
	expect(host.firstElementChild?.namespaceURI).toBe(XHTML);
});
