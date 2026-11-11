// A REGION SHEET LEAVES WITH ITS PAGE (#799, found by the simulator). A deferred region's answer
// brings its sheet into the head. A navigation to a page with no such region takes the sheet out in
// the swap's task: a region that left the document uses no sheet, even before its teardown runs.
import { afterEach, expect, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { SpaRouter } from '../../src/runtime/router.ts';

const ENDPOINT = '/__ogygia__?id=abcabcabc799&props=W3t9XQ&exp=9999999999&sig=stub';
const SHEET = '/_app/immutable/assets/Greeting.799.css';
const STYLE = `<style data-ogygia-region-css="${SHEET}">.greeting-799{letter-spacing:4px}</style>`;

const real_fetch = window.fetch;
const home = location.href;
afterEach(() => {
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
	document.head.querySelectorAll('[data-ogygia-region-css]').forEach((n) => n.remove());
});

function html_response(html: string, url: string): Response {
	const res = new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
	Object.defineProperty(res, 'url', { value: new URL(url, location.origin).href });
	return res;
}

test('a deferred region’s sheet leaves the head with the page that used it', async () => {
	window.fetch = async (input) => {
		const u = String(input);
		if (u.includes('__ogygia__'))
			return html_response(`${STYLE}<p class="greeting-799" data-served>hello</p>`, ENDPOINT);
		return html_response(
			'<!doctype html><html><head><meta name="ogygia-router" content="plain"><title>about</title>' +
				'</head><body><p data-about>about</p></body></html>',
			u
		);
	};
	document.body.innerHTML = `<ogygia-region render="defer" when="load" endpoint="${ENDPOINT}"><p data-fallback>…</p></ogygia-region>`;
	bootDev();
	await expect
		.poll(() => document.querySelector('[data-served]'), { timeout: 10_000 })
		.not.toBeNull();
	const sheets = () =>
		[...document.head.querySelectorAll('[data-ogygia-region-css]')].map((s) =>
			s.getAttribute('data-ogygia-region-css')
		);
	expect(sheets()).toEqual([SHEET]);

	await new SpaRouter().navigate(new URL('/nav-region-sheet-left-about', location.href));
	expect(document.querySelector('[data-about]')).not.toBeNull();
	expect(sheets()).toEqual([]);
});
