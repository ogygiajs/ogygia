// THE WAIT FOR THE NEXT PAGE'S SHEETS ALWAYS ENDS (runtime/router-nav.ts `preload_stylesheets`).
// The router loads the next page's stylesheets before its swap, so the page goes in styled. A sheet
// that fails to download ends its part of the wait at once, and one that never comes holds the
// navigation for STYLESHEET_WAIT_MS at most: the page goes in either way.
import { afterEach, beforeEach, expect } from 'vitest';
import { commands } from 'vitest/browser';
import { it_with_network_routes } from './_browsers.ts';
import { end_time_hold, hold_time } from './_in-head.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { install as install_morph } from '../../src/runtime/morph.ts';
import { SpaRouter } from '../../src/runtime/router.ts';
import { prepare_spa_document } from '../../src/runtime/seeds.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		drop_downloads(path: string, times: number): Promise<void>;
		hold_downloads(path: string): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

const real_fetch = window.fetch;
const home = location.href;
const FAILS = '/nav-sheet-wait-fails.css';
const NEVER = '/nav-sheet-wait-never.css';

const next_page = (sheet: string) => async () =>
	new Response(
		`<!doctype html><html><head><meta name="ogygia-router" content="plain"><link rel="stylesheet" href="${sheet}"><title>next</title></head><body><p>next</p></body></html>`,
		{ status: 200, headers: { 'content-type': 'text/html' } }
	);
/** The page on screen: the address goes with the swap. */
const shown = () => location.pathname;

beforeEach(() => {
	link_boot();
	install_morph();
	document.body.innerHTML = '<p>first</p>';
	prepare_spa_document();
});
afterEach(async () => {
	end_time_hold();
	window.fetch = real_fetch;
	history.replaceState(null, '', home);
	await commands.keep_downloads(FAILS);
	await commands.keep_downloads(NEVER);
});

it_with_network_routes(
	'a sheet of the next page that fails to download does not hold its navigation',
	async () => {
		await commands.drop_downloads(FAILS, 1);
		window.fetch = next_page(FAILS);
		// (the page's clock stopped: only the failed download can end the wait, never the cap)
		hold_time();
		void new SpaRouter().navigate(new URL('/nav-sheet-wait-next', location.href));
		await expect
			.poll(shown, { timeout: 1_500, message: 'the navigation waited on a failed sheet' })
			.toBe('/nav-sheet-wait-next');
	}
);

it_with_network_routes(
	'a sheet of the next page that never comes holds its navigation for the cap, then the page goes in',
	async () => {
		await commands.hold_downloads(NEVER);
		window.fetch = next_page(NEVER);
		void new SpaRouter().navigate(new URL('/nav-sheet-wait-later', location.href));
		await expect
			.poll(shown, { timeout: 4_000, message: 'the navigation waited on its sheet past the cap' })
			.toBe('/nav-sheet-wait-later');
	}
);
