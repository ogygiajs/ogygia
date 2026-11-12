// A NAVIGATION TAKES THE NEXT PAGE'S CODE ORIGINS (#1045). The server names the origins island code
// may load from on the head runtime script (`data-og-origins`), per response: a peer's CDN origin is
// named only on a page that used that peer's fragment. A navigation keeps the live runtime script, so
// the page it lands on must read the next response's origins as a first load reads them, or that
// page's peer islands are refused until a full reload.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';
import { code_url } from '../../src/runtime/code-origins.ts';

const real_fetch = window.fetch;
const home = location.href;
const NEXT = '/nav-code-origins-next';
const PEER = 'https://peer-cdn.example';
const PEER_FILE = PEER + '/_app/immutable/og-region.abc.js';

/** The head runtime stand-in, as the server writes it: its response's mark, and the origins it names. */
const runtime = (mark: string, origins = '') =>
	`<script type="application/x-runtime-stand-in" data-og-mark="${mark}" data-ogygia-runtime` +
	(origins ? ` data-og-origins="${origins}"` : '') +
	'></script>';

const page = (who: string, head_runtime: string) =>
	'<!doctype html><html><head><meta name="ogygia-router" content="plain">' +
	`<title>page ${who}</title>${head_runtime}</head><body><p>${who}</p></body></html>`;

beforeEach(() => {
	link_boot();
	install_morph();
	document.head.insertAdjacentHTML('afterbegin', runtime('a0a0a0a0a0a0a0a0a0a0a0a0'));
	const marker = document.createElement('meta');
	marker.name = 'ogygia-router';
	document.head.append(marker);
	document.title = 'page a';
	document.body.innerHTML = '<p>a</p>';
	prepare_spa_document();
	window.fetch = async (input) => {
		const url = new URL(String(input instanceof Request ? input.url : input), home);
		const html =
			url.pathname === NEXT
				? page('b', runtime('b1b1b1b1b1b1b1b1b1b1b1b1', PEER))
				: page('a', runtime('a0a0a0a0a0a0a0a0a0a0a0a0'));
		return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
	};
});
afterEach(() => {
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
	for (const el of document.head.querySelectorAll('script[data-ogygia-runtime]')) el.remove();
});

test('a page reached by a navigation loads island code from the origins its response names', async () => {
	// the first page names no peer origin: its code is refused there
	expect(code_url(PEER_FILE)).toBeNull();
	const r = new SpaRouter();
	r.start();
	await r.navigate(new URL(NEXT, home));
	expect(document.title).toBe('page b');
	expect(code_url(PEER_FILE)).toBe(PEER_FILE);
});
