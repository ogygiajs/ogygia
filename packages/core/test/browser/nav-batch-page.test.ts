// A NAVIGATION'S HOLE BATCH IS FOR THE PAGE IT LEADS TO (#995). The router asks the next page's holes
// in one batch before the swap, while the page being left is still the document. The server reads the
// page a hole renders for from the request's referrer (server/render-page.ts `page_url_of`), so the
// batch names the destination as its referrer, not the page that happens to send it.
import { afterEach, expect, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { done_parcel } from '../../src/server/stream-regions.ts';

const ep = (sig: string) => `/__ogygia__?id=aaaaaaaaa995&props=${sig}&exp=9999999999&sig=${sig}`;
const hole = (sig: string) =>
	`<ogygia-region render="defer" when="load" endpoint="${ep(sig)}"><p>…</p></ogygia-region>`;

const real_fetch = window.fetch;
const home = location.href;
afterEach(() => {
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
	document.body.innerHTML = '';
});

test('a navigation’s hole batch names the page it leads to as its referrer', async () => {
	const batches: RequestInit[] = [];
	window.fetch = async (input, init) => {
		const u = new URL(String(input), location.href);
		if (init?.method === 'POST') {
			batches.push(init);
			return new Response(done_parcel(), { status: 200 });
		}
		if (u.pathname.startsWith('/__ogygia__'))
			return new Response('<p>answer</p>', {
				status: 200,
				headers: { 'content-type': 'text/html' }
			});
		const res = new Response(
			'<!doctype html><html><head><meta name="ogygia-router" content="plain"><title>p0</title>' +
				`</head><body>${hole('a')}${hole('b')}</body></html>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
		Object.defineProperty(res, 'url', { value: u.href });
		return res;
	};
	document.body.innerHTML = '<p>home</p>';
	bootDev();
	const dest = new URL('/nav-batch-page-995', location.href);
	await new SpaRouter().navigate(dest);
	expect(batches.length).toBe(1);
	expect(batches[0]!.referrer).toBe(dest.href);
});
