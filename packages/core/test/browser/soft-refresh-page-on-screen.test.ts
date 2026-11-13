// A SOFT REFRESH REFRESHES THE PAGE ON SCREEN (#268). `invalidateAll` (what a remote form runs on
// success) re-reads the page's head and data in place. Started while a navigation to the next page
// waits (here on that page's stylesheet, held at the network for real), it must refresh the page
// still on screen: never fetch the next page and merge its title, head and page data into this one.
// The router's timers are the test's (fake): its 2 s cap on the sheet's wait never runs out on a
// loaded runner and swaps the next page in early.
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { it_with_network_routes } from './_browsers.ts';
import { in_head } from './_in-head.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';
import { page_state } from '../../src/shims/page-store.svelte.ts';
import { TEST_MARK_ATTR } from './_response-mark.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		hold_downloads(path: string): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

const real_fetch = window.fetch;
const home = location.href;
const HELD = '/soft-refresh-next.css';
const NEXT = '/soft-refresh-next';

const page = (title: string, who: string, extra = '') =>
	`<!doctype html><html><head><meta name="ogygia-router" content="plain"><meta name="soft-page" content="${who}">${extra}<title>${title}</title><script type="application/x-runtime-stand-in" data-ogygia-runtime${TEST_MARK_ATTR}>\x3C/script></head><body><p>${who}</p><script type="application/ogygia-page" data-og-format="json"${TEST_MARK_ATTR}>${JSON.stringify({ url: new URL(who === 'a' ? home : NEXT, home).href, data: { who } })}\x3C/script></body></html>`;

const asked: string[] = [];

beforeEach(() => {
	link_boot();
	install_morph();
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
	const marker = document.createElement('meta');
	marker.name = 'ogygia-router';
	document.head.append(marker);
	document.title = 'page A';
	document.body.innerHTML = '<p>a</p>';
	prepare_spa_document();
	window.fetch = async (input) => {
		const url = new URL(String(input instanceof Request ? input.url : input), home);
		asked.push(url.pathname);
		const html =
			url.pathname === NEXT
				? page('page B', 'b', `<link rel="stylesheet" href="${HELD}">`)
				: page('page A', 'a');
		return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
	};
});
afterEach(async () => {
	vi.useRealTimers();
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
	// (a fetched page's head brought its runtime stand-in)
	for (const el of document.head.querySelectorAll('script[data-ogygia-runtime]')) el.remove();
	// (and page B's sheet, which the next test's navigation must load itself)
	for (const el of document.head.querySelectorAll(`link[href="${HELD}"]`)) el.remove();
	await commands.keep_downloads(HELD);
});

it_with_network_routes(
	'invalidateAll while a navigation waits refreshes the page on screen, not the next one',
	async () => {
		await commands.hold_downloads(HELD);
		const r = new SpaRouter();
		r.start();
		const went = r.navigate(new URL(NEXT, home));
		// the next page is fetched; the navigation waits for its sheet
		await in_head(`link[href="${HELD}"]`);
		expect(r.nav.now.kind).toBe('loading');
		asked.length = 0;
		// a remote form on A succeeds: A's data is refreshed in place
		await r.invalidateAll();
		expect(asked).toEqual([new URL(home).pathname]);
		expect(document.title).toBe('page A');
		expect(document.head.querySelector('meta[name="soft-page"]')?.getAttribute('content')).toBe(
			'a'
		);
		expect((page_state.data as { who?: string }).who).toBe('a');
		expect(document.querySelector('p')?.textContent).toBe('a');
		// the navigation still goes in, afterwards
		await commands.keep_downloads(HELD);
		await went;
		expect(document.title).toBe('page B');
		expect((page_state.data as { who?: string }).who).toBe('b');
	}
);

it_with_network_routes(
	'a soft refresh while a navigation waits on the next page’s sheet leaves that sheet loading (#1124)',
	async () => {
		await commands.hold_downloads(HELD);
		const r = new SpaRouter();
		r.start();
		const went = r.navigate(new URL(NEXT, home));
		const sheet = await in_head(`link[href="${HELD}"]`);
		await r.invalidateAll();
		// the page on screen's head merge is not the navigation's: its sheet stays, still loading
		expect(sheet.isConnected).toBe(true);
		expect(document.head.querySelectorAll(`link[href="${HELD}"]`)).toHaveLength(1);
		// it arrives, and the navigation goes in on it (the cap's timer never runs: it is the test's)
		await commands.keep_downloads(HELD);
		await went;
		expect(document.title).toBe('page B');
		expect(document.head.querySelectorAll(`link[href="${HELD}"]`)).toHaveLength(1);
		expect(sheet.isConnected).toBe(true);
		expect(sheet.getAttribute('media')).toBeNull();
	}
);
