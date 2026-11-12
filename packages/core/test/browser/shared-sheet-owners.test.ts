// A SHEET NAMES EVERY OUTERMOST ISLAND THAT USES IT (#854). The server claims a region sheet once per
// request, so its tag names only the first island that wrote it (`data-og-owner`); the page's tail
// lists the others (`data-og-owners`). A navigation that keeps any of them keeps the sheet, also when
// the next page's head does not list it (the server skipped the island the browser already has).
import { afterEach, expect, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { SpaRouter } from '../../src/runtime/router.ts';

const SHEET = '/_app/immutable/assets/Shared.854.css';
const style = (owner: string) =>
	`<style data-ogygia-region-css="${SHEET}" data-og-owner="${owner}">.s-854{color:red}</style>`;
const region = (fp: string) =>
	`<ogygia-region wake="none" data-og-fp="${fp}"><p class="s-854">${fp}</p></ogygia-region>`;

const real_fetch = window.fetch;
const home = location.href;
afterEach(() => {
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
	document.head.querySelectorAll('[data-ogygia-region-css]').forEach((n) => n.remove());
	document.body.innerHTML = '';
});

function html_response(html: string, url: string): Response {
	const res = new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
	Object.defineProperty(res, 'url', { value: new URL(url, location.origin).href });
	return res;
}

/** Serve `pages` (by path) as whole documents. */
function serve(pages: Record<string, { head?: string; body: string }>): void {
	window.fetch = async (input) => {
		const u = new URL(String(input), location.href);
		const page = pages[u.pathname];
		if (!page) return real_fetch(input);
		return html_response(
			'<!doctype html><html><head><meta name="ogygia-router" content="plain"><title>p</title>' +
				(page.head ?? '') +
				`</head><body>${page.body}</body></html>`,
			u.href
		);
	};
}

const sheets = () =>
	[...document.head.querySelectorAll('[data-ogygia-region-css]')].map((s) =>
		s.getAttribute('data-ogygia-region-css')
	);
const go = (path: string) => new SpaRouter().navigate(new URL(path, location.href));

test('a sheet two outer islands share stays while the second is kept and the first left', async () => {
	document.head.insertAdjacentHTML('beforeend', style('fp-first'));
	document.body.innerHTML =
		region('fp-first') +
		region('fp-second') +
		`<script type="application/json" data-og-owners>${JSON.stringify({ [SHEET]: ['fp-second'] })}</script>`;
	bootDev();
	serve({
		// (the server skipped the island the browser has: nothing on this page writes the sheet)
		'/shared-sheet-854-b': { body: region('fp-second') },
		'/shared-sheet-854-c': { body: '<p data-c>c</p>' }
	});

	await go('/shared-sheet-854-b');
	expect(document.querySelector('[data-og-fp="fp-first"]')).toBeNull();
	expect(sheets(), 'kept for the island still on the page').toEqual([SHEET]);

	await go('/shared-sheet-854-c');
	expect(document.querySelector('[data-c]')).not.toBeNull();
	expect(sheets(), 'gone with the last island that used it').toEqual([]);
});

test('a sheet the next page writes again names that page’s island as an owner too', async () => {
	document.head.insertAdjacentHTML('beforeend', style('fp-a'));
	document.body.innerHTML = region('fp-a');
	bootDev();
	serve({
		// island b writes the same sheet (kept as the node the page already has), island a leaves
		'/shared-sheet-854-b2': { head: style('fp-b'), body: region('fp-b') },
		// b is kept and skipped: this head does not list the sheet
		'/shared-sheet-854-c2': { body: region('fp-b') }
	});

	await go('/shared-sheet-854-b2');
	expect(sheets()).toEqual([SHEET]);
	await go('/shared-sheet-854-c2');
	expect(document.querySelector('[data-og-fp="fp-b"]')).not.toBeNull();
	expect(sheets(), 'kept for island b').toEqual([SHEET]);
});
