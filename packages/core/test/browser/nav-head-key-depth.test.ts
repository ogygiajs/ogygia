// A HEAD NODE KEEPS ITS KEY WHEN THE ADDRESS MOVES (#821, found by the simulator). The server
// writes a page's asset URLs relative to that page: `./_app/x.js` on `/nested`, `../_app/x.js` on
// `/dashboard/orders`, one file. A client navigation between the two must see one file, so the head
// keeps one node for it, as a fresh load of the next page has.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';
import { runtime_session } from '../../src/runtime/session.ts';

const real_fetch = window.fetch;
const home = location.href;
// (under a base path, so the file differs from what the same text names against any other page)
const FILE = '/shop/_app/immutable/og-key-depth.js';
const ASSET = '_app/immutable/og-key-depth.js';
const added: Element[] = [];

beforeEach(() => {
	link_boot();
	install_morph();
	history.replaceState(history.state, '', '/shop/nested');
	// the server's head of `/nested`: its asset written relative to it
	const script = document.createElement('script');
	script.type = 'text/x-og-key-depth'; // (a type the browser does not run or fetch)
	script.setAttribute('src', `./${ASSET}`);
	document.head.append(script);
	added.push(script);
	runtime_session.adopt_document_head(); // (the boot's: what the server sent is the page's)
	document.body.innerHTML = '<p>nested</p>';
	prepare_spa_document();
	window.fetch = async () =>
		new Response(
			'<!doctype html><html><head><meta name="ogygia-router" content="plain">' +
				`<script type="text/x-og-key-depth" src="../${ASSET}"></script>` +
				'</head><body><p data-page="orders">orders</p></body></html>',
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
});
afterEach(() => {
	window.fetch = real_fetch;
	history.replaceState(history.state, '', home);
	for (const s of document.head.querySelectorAll('script[type="text/x-og-key-depth"]')) s.remove();
	added.length = 0;
});

test('a navigation to a page at another depth keeps one head node for the same file', async () => {
	const r = new SpaRouter();
	vi.spyOn(r, 'hand_off').mockImplementation(() => {
		if (r.nav.now.kind !== 'idle') r.nav.go('idle');
	});
	await r.navigate(new URL('/shop/dashboard/orders', location.href));
	await expect
		.poll(() => document.querySelector('[data-page="orders"]'), { timeout: 2_000 })
		.not.toBeNull();
	await expect.poll(() => r.nav.now.kind, { timeout: 2_000 }).toBe('idle');
	const files = [...document.head.querySelectorAll('script[type="text/x-og-key-depth"]')].map(
		(s) => new URL(s.getAttribute('src')!, location.origin + '/shop/nested').pathname
	);
	expect(files).toEqual([FILE]);
	// the node from the first page stayed: kept, not taken out and put back
	expect(added[0]!.isConnected).toBe(true);
});
