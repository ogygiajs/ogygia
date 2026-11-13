// A KEPT PAGE IS KEPT FOR THE COPIES IT WAS ASKED WITH (runtime/router-nav.ts `fetch_page`, #1615).
// With server-delta navigation on, a page fetch names the regions the document shows live
// (`x-ogygia-known`) and the server leaves their content out. That answer fits only a document that
// still shows those copies: a soft refresh on a page kept its answer, the visitor went to a page
// without those regions and came back, and the back reused it. Its regions came in empty and
// hydration failed on them.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { reset_load_scheduler } from '../../src/runtime/load-scheduler.ts';
import { reset_document_painted } from '../../src/runtime/schedule.ts';

(globalThis as { __OGYGIA_SERVER_DELTA__?: boolean }).__OGYGIA_SERVER_DELTA__ = true;

const real_fetch = window.fetch;
/** The `x-ogygia-known` each page request went out with (`null`: none). */
const known: (string | null)[] = [];

beforeEach(() => {
	reset_load_scheduler();
	reset_document_painted();
	link_boot();
	known.length = 0;
	window.fetch = async (_input, init) => {
		const asked = new Headers(init?.headers).get('x-ogygia-known');
		known.push(asked);
		const region = asked === null ? '<span data-guard>live</span>' : '';
		return new Response(
			`<!doctype html><title>a</title><ogygia-region data-og-fp="f00dfeed00000001">${region}</ogygia-region>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
	};
});
afterEach(() => {
	window.fetch = real_fetch;
	document.body.replaceChildren();
});

test('a page kept with a live region left out is not served to a document without that region', async () => {
	const nav = await import('../../src/runtime/router-nav.ts');
	const href = new URL('/page-kept-by-known', location.href).href;
	const live = document.createElement('ogygia-region');
	live.setAttribute('data-og-fp', 'f00dfeed00000001');
	live.setAttribute('data-hydrated', '');
	document.body.append(live);
	const first = await nav.fetch_page(href);
	expect(known, 'the first fetch named the live region').toEqual(['f00dfeed00000001']);
	expect(first?.html).not.toContain('data-guard');
	// the visitor went to a page without that region
	live.remove();
	const again = await nav.fetch_page(href);
	expect(again?.html, 'the page came back with its region left out').toContain('data-guard');
	expect(known).toEqual(['f00dfeed00000001', null]);
});

test('a page kept for a document is served to it again while it shows the same copies', async () => {
	const nav = await import('../../src/runtime/router-nav.ts');
	const href = new URL('/page-kept-by-known-same', location.href).href;
	const live = document.createElement('ogygia-region');
	live.setAttribute('data-og-fp', 'f00dfeed00000001');
	live.setAttribute('data-hydrated', '');
	document.body.append(live);
	await nav.fetch_page(href, undefined, 'prefetch');
	const page = await nav.fetch_page(href);
	expect(page?.html).not.toContain('data-guard');
	expect(known, 'one request: the click took the prefetched page').toEqual(['f00dfeed00000001']);
});
