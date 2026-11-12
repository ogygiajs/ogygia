// A SHEET AN ISLAND'S FILE BROUGHT LEAVES WITH ITS PAGE (#966, found by the simulator). Loading an
// island's file can put a stylesheet in the head (a bundler's preloader adds the CSS the island's
// chunks need). A navigation to a page with no such island takes it out, as a fresh load of that page
// has none.
import { afterEach, expect, inject, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { SpaRouter } from '../../src/runtime/router.ts';

const ENTRY = '/test/browser/fixtures/code-sheet-island.ts';
const HYDRATED = 'ogygia-region[data-hydrated]';
const counter_html = () => decodeURIComponent(escape(atob(inject('counter_ssr_b64'))));
const sheets = () =>
	[...document.head.querySelectorAll('link[rel="stylesheet"]')].filter((l) =>
		(l.getAttribute('href') ?? '').includes('region-sheet.css')
	);

const real_fetch = window.fetch;
const home = location.href;
afterEach(() => {
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
	for (const s of sheets()) s.remove();
});

function html_response(html: string, url: string): Response {
	const res = new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
	Object.defineProperty(res, 'url', { value: new URL(url, location.origin).href });
	return res;
}

test('a sheet an island’s file brought leaves the head with the page that used it', async () => {
	window.fetch = async (input) =>
		html_response(
			'<!doctype html><html><head><meta name="ogygia-router" content="plain"><title>about</title>' +
				'</head><body><p data-about>about</p></body></html>',
			String(input)
		);
	document.body.innerHTML = counter_html();
	document.querySelector('ogygia-region')!.setAttribute('entry', ENTRY);
	bootDev();
	await expect
		.poll(() => document.querySelector(HYDRATED) !== null, { timeout: 10_000 })
		.toBe(true);
	expect(sheets()).toHaveLength(1);

	await new SpaRouter().navigate(new URL('/nav-code-sheet-left-about', location.href));
	expect(document.querySelector('[data-about]')).not.toBeNull();
	expect(sheets()).toEqual([]);
});

test('the sheet comes back with a page whose island runs that file again', async () => {
	const island_page = () => {
		const doc = new DOMParser().parseFromString(counter_html(), 'text/html');
		doc.querySelector('ogygia-region')!.setAttribute('entry', ENTRY);
		return (
			'<!doctype html><html><head><meta name="ogygia-router" content="plain"><title>counter</title>' +
			`</head><body>${doc.body.innerHTML}</body></html>`
		);
	};
	window.fetch = async (input) => {
		const u = String(input);
		if (u.includes('-again')) return html_response(island_page(), u);
		return html_response(
			'<!doctype html><html><head><meta name="ogygia-router" content="plain"><title>about</title>' +
				'</head><body><p data-about>about</p></body></html>',
			u
		);
	};
	document.body.innerHTML = counter_html();
	document.querySelector('ogygia-region')!.setAttribute('entry', ENTRY);
	bootDev();
	await expect
		.poll(() => document.querySelector(HYDRATED) !== null, { timeout: 10_000 })
		.toBe(true);
	const router = new SpaRouter();
	await router.navigate(new URL('/nav-code-sheet-left-away', location.href));
	expect(sheets()).toEqual([]);

	await router.navigate(new URL('/nav-code-sheet-left-again', location.href));
	await expect
		.poll(() => document.querySelector(HYDRATED) !== null, { timeout: 10_000 })
		.toBe(true);
	expect(sheets()).toHaveLength(1);
});
