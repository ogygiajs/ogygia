// THE NEXT PAGE'S SHEETS STYLE NOTHING UNTIL ITS SWAP (#267). The router loads the next page's
// stylesheets before the swap, so the page goes in styled. But while the navigation waits for the
// slowest of them, the ones already loaded must not style the page still on screen: they belong to
// the page that has not come yet.
//
// Two sheets, for real: one loads at once (a `data:` sheet that sets a custom property on `<html>`),
// one is held at the network (the `hold_downloads` command), so the navigation is still waiting.
import { afterEach, beforeEach, expect } from 'vitest';
import { commands } from 'vitest/browser';
import { it_with_network_routes } from './_browsers.ts';
import { appears, end_time_hold, hold_time, release_time, sheet_loaded } from './_waits.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		hold_downloads(path: string): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

const real_fetch = window.fetch;
const home = location.href;
const HELD = '/nav-sheets-inert-slow.css';
const FAST = 'data:text/css,html%7B--og-next-page%3A%20on%7D';

const next_page = () =>
	getComputedStyle(document.documentElement).getPropertyValue('--og-next-page');

beforeEach(() => {
	link_boot();
	install_morph();
	document.body.innerHTML = '<p>first</p>';
	prepare_spa_document();
	window.fetch = async () =>
		new Response(
			`<!doctype html><html><head><meta name="ogygia-router" content="plain"><link rel="stylesheet" href="${FAST}"><link rel="stylesheet" href="${HELD}"><title>next</title></head><body><p>next</p></body></html>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
});
afterEach(async () => {
	end_time_hold();
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
	await commands.keep_downloads(HELD);
});

it_with_network_routes(
	'a sheet of the next page that loaded first does not style the page on screen',
	async () => {
		await commands.hold_downloads(HELD);
		const r = new SpaRouter();
		hold_time();
		const went = r.navigate(new URL('/nav-sheets-inert-next', location.href));
		// the fast sheet is in and loaded; the navigation still waits for the held one
		await sheet_loaded(await appears<HTMLLinkElement>(`link[href="${FAST}"]`, document.head));
		expect(r.nav.now.kind).toBe('loading');
		expect(document.querySelector('p')?.textContent).not.toBe('next');
		expect(next_page().trim()).toBe('');
		// the held sheet arrives: the page goes in, and its sheets style it
		release_time();
		await commands.keep_downloads(HELD);
		await went;
		expect(document.querySelector('p')?.textContent).toBe('next');
		expect(next_page().trim()).toBe('on');
	}
);
