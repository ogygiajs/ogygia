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
/** What the next page's head lists besides the asset (a test's own). */
let next_extra = '';

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
			`<!doctype html><html><head><meta name="ogygia-router" content="plain"><script type="text/x-og-key-depth" src="../${ASSET}">\x3C/script>${next_extra}</head><body><p data-page="orders">orders</p></body></html>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
});
afterEach(() => {
	window.fetch = real_fetch;
	history.replaceState(history.state, '', home);
	for (const s of document.head.querySelectorAll('script[type="text/x-og-key-depth"]')) s.remove();
	added.length = 0;
	next_extra = '';
	for (const l of document.head.querySelectorAll('link[data-og-key-depth]')) l.remove();
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
		(s) => new URL(s.getAttribute('src')!, `${location.origin}/shop/nested`).pathname
	);
	expect(files).toEqual([FILE]);
	// the node from the first page stayed: kept, not taken out and put back
	expect(added[0]!.isConnected).toBe(true);
});

/** Navigate to the deeper page, the hand-off stubbed, and wait for it to be on screen. */
async function to_orders(): Promise<void> {
	const r = new SpaRouter();
	vi.spyOn(r, 'hand_off').mockImplementation(() => {
		if (r.nav.now.kind !== 'idle') r.nav.go('idle');
	});
	await r.navigate(new URL('/shop/dashboard/orders', location.href));
	await expect
		.poll(() => document.querySelector('[data-page="orders"]'), { timeout: 2_000 })
		.not.toBeNull();
	await expect.poll(() => r.nav.now.kind, { timeout: 2_000 }).toBe('idle');
	expect(location.pathname).toBe('/shop/dashboard/orders');
}

test('a kept parked sheet still names its file under the deeper address it was kept for (#1071)', async () => {
	const PARKED = '_app/immutable/assets/og-key-depth-parked.css';
	// the server's parked sheet on `/nested` (Kit's stand-in for a sheet it inlined): not fetched
	// until something turns it on, under the address of that moment
	const parked = document.createElement('link');
	parked.rel = 'stylesheet';
	parked.disabled = true;
	parked.media = '(max-width: 0)';
	parked.setAttribute('data-og-key-depth', '');
	parked.setAttribute('href', `./${PARKED}`);
	document.head.append(parked);
	runtime_session.adopt_document_head();
	next_extra = `<link rel="stylesheet" disabled media="(max-width: 0)" data-og-key-depth href="../${PARKED}">`;
	await to_orders();
	// kept, and turned on now it would fetch the file its page meant
	expect(parked.isConnected).toBe(true);
	expect(new URL(parked.href).pathname).toBe(`/shop/${PARKED}`);
});

test('a navigation to a deeper page leaves a kept, loaded sheet as it is: not fetched again', async () => {
	// the server's sheet on `/test/browser/nested`, written relative to it, loaded
	history.replaceState(history.state, '', '/test/browser/nested');
	const SHEET = 'fixtures/region-sheet.css?og-key-depth';
	const sheet = document.createElement('link');
	sheet.rel = 'stylesheet';
	sheet.setAttribute('data-og-key-depth', '');
	sheet.setAttribute('href', `./${SHEET}`);
	const loaded = new Promise((r) => sheet.addEventListener('load', r, { once: true }));
	document.head.append(sheet);
	await loaded;
	runtime_session.adopt_document_head();
	let loads = 0;
	sheet.addEventListener('load', () => loads++);
	const fetched = () =>
		performance.getEntriesByType('resource').filter((e) => e.name.endsWith(SHEET)).length;
	const before = fetched();
	const css = sheet.sheet;
	// the next page, one level deeper, lists the same file written relative to it
	next_extra = `<link rel="stylesheet" data-og-key-depth href="../${SHEET}">`;
	const r = new SpaRouter();
	vi.spyOn(r, 'hand_off').mockImplementation(() => {
		if (r.nav.now.kind !== 'idle') r.nav.go('idle');
	});
	await r.navigate(new URL('/test/browser/deep/orders', location.href));
	await expect.poll(() => r.nav.now.kind, { timeout: 2_000 }).toBe('idle');
	expect(location.pathname).toBe('/test/browser/deep/orders');
	await new Promise((r) => setTimeout(r, 100));
	// one node for the file, the same one, as written, its sheet the one it loaded
	expect(loads, 'its load fired again').toBe(0);
	expect(fetched(), 'requests for it').toBe(before);
	expect(sheet.sheet).toBe(css);
	expect([...document.head.querySelectorAll('link[data-og-key-depth]')]).toEqual([sheet]);
	expect(sheet.getAttribute('href')).toBe(`./${SHEET}`);
});
