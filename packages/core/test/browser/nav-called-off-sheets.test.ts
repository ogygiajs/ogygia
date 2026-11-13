// A NAVIGATION CALLED OFF BEFORE ITS SWAP (#267). The router puts the next page's stylesheets into
// the head before the swap, so they are loaded when the next page goes in. Back pressed while one of
// them still loads (or a link to the page on screen) calls the navigation off: the page stays, and
// the next page's sheets must go with the navigation, or they style the page on screen.
//
// The sheet loads for real and is held at the network (the `hold_downloads` command), so the
// navigation is still waiting for it when it is called off.
import { afterEach, beforeEach, expect } from 'vitest';
import { commands } from 'vitest/browser';
import { it_with_network_routes } from './_browsers.ts';
import { appears } from './_waits.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { SpaRouter } from '../../src/runtime/router.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		hold_downloads(path: string): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

const real_fetch = window.fetch;
const home = location.href;
const SHEET = '/nav-called-off-next.css';

beforeEach(() => {
	link_boot();
	window.fetch = async () =>
		new Response(
			`<!doctype html><html><head><meta name="ogygia-router" content="plain"><link rel="stylesheet" href="${SHEET}"><title>next</title></head><body><p>next</p></body></html>`,
			{ status: 200, headers: { 'content-type': 'text/html' } }
		);
});
afterEach(async () => {
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
	await commands.keep_downloads(SHEET);
});

it_with_network_routes(
	'a navigation called off while the next page’s sheet loads takes that sheet out',
	async () => {
		await commands.hold_downloads(SHEET);
		const r = new SpaRouter();
		const sheet = () => document.head.querySelector(`link[href="${SHEET}"]`);
		const went = r.navigate(new URL('/nav-called-off-next', location.href));
		// the next page's sheet is in the head, and the navigation waits for it
		await appears(`link[href="${SHEET}"]`, document.head);
		expect(r.nav.now.kind).toBe('loading');
		// back to the page on screen (popstate on the same document): the navigation is called off
		r.supersede();
		await went;
		expect(document.querySelector('p')?.textContent).not.toBe('next');
		expect(sheet()).toBeNull();
	}
);
