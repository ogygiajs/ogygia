// A document answers what a browser's does (src/happy.ts). happy-dom's
// `document.getElementsByTagNameNS` read its own owner document, which a document has none of, and
// threw: the router's title check on every client navigation failed (generated app 31, every seed).
import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { documents_by_namespace } from '../src/happy.ts';

const HTML = 'http://www.w3.org/1999/xhtml';

describe('a document', () => {
	it('finds its own elements by namespace and tag name', () => {
		documents_by_namespace();
		const w = new Window();
		w.document.write(
			'<html><head><title>t</title></head><body><svg><title>s</title></svg></body></html>'
		);
		expect(w.document.getElementsByTagNameNS(HTML, 'title').length).toBe(1);
		expect(w.document.getElementsByTagNameNS(HTML, 'html').length).toBe(1);
	});

	it('so does a parsed one, and an element still finds its own', () => {
		documents_by_namespace();
		const w = new Window();
		const parsed = new w.DOMParser().parseFromString('<p>a</p><title>x</title>', 'text/html');
		expect(parsed.getElementsByTagNameNS(HTML, 'title').length).toBe(1);
		expect(parsed.body.getElementsByTagNameNS(HTML, 'p').length).toBe(1);
	});
});
