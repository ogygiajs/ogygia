// A SOFT REFRESH TAKES ONLY THIS ORIGIN'S PAGE. `invalidateAll` re-reads the page on screen and
// merges its head and page data in place. A fetch of it that ended on another origin (a redirect
// the browser followed) is not this page: nothing of it is merged, as a navigation landing there
// is never swapped in (runtime/router-nav.ts `navigate`).
import { afterEach, beforeEach, expect, test } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';
import { page_state } from '../../src/shims/page-store.svelte.ts';

const real_fetch = window.fetch;
const home = location.href;

// (the seed bears the response mark its head's runtime stand-in bears, as the handle writes them:
// a seed without it is not the server's once side channels are marked, test/browser/side-channel-seeds.test.ts)
const MARK = ' data-og-mark="50f7f0e15ea50f7f0e15ea"';

const page = (who: string) =>
	`<!doctype html><html><head><meta name="ogygia-router" content="plain"><meta name="soft-page" content="${who}"><title>page ${who}</title><script type="application/x-runtime-stand-in" data-ogygia-runtime${MARK}>\x3C/script></head><body><p>${who}</p><script type="application/ogygia-page" data-og-format="json"${MARK}>${JSON.stringify({ url: home, data: { who } })}\x3C/script></body></html>`;

/** An answer the browser got by following a redirect to `url`. */
function landed(html: string, url: string): Response {
	const res = new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
	Object.defineProperty(res, 'url', { value: url });
	Object.defineProperty(res, 'redirected', { value: true });
	return res;
}

beforeEach(async () => {
	link_boot();
	install_morph();
	const marker = document.createElement('meta');
	marker.name = 'ogygia-router';
	document.head.append(marker);
	document.title = 'page a';
	document.body.innerHTML = '<p>a</p>';
	prepare_spa_document();
	window.fetch = async () =>
		new Response(page('a'), { status: 200, headers: { 'content-type': 'text/html' } });
	const r = new SpaRouter();
	r.start();
	await r.invalidateAll();
	expect((page_state.data as { who?: string }).who).toBe('a');
});
afterEach(() => {
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
	// (a fetched page's head brought its runtime stand-in)
	for (const el of document.head.querySelectorAll('script[data-ogygia-runtime]')) el.remove();
});

test('invalidateAll whose fetch landed on another origin merges nothing of that page', async () => {
	window.fetch = async () => landed(page('other'), 'https://other.example/landing');
	const r = new SpaRouter();
	r.start();
	await r.invalidateAll();
	expect(document.title).toBe('page a');
	expect(document.head.querySelector('meta[name="soft-page"][content="other"]')).toBeNull();
	expect((page_state.data as { who?: string }).who).toBe('a');
});

test('invalidateAll whose fetch was redirected within this origin still refreshes', async () => {
	window.fetch = async () => landed(page('moved'), new URL('/moved', home).href);
	const r = new SpaRouter();
	r.start();
	await r.invalidateAll();
	expect((page_state.data as { who?: string }).who).toBe('moved');
});
