// WHICH BROWSER A BROWSER TEST RUNS IN, and the few tests that cannot run in every one. Each mark
// names what the test needs and why the other browsers cannot give it: never a bare skip. The PR
// that adds a mark lists it.
import { it } from 'vitest';
import { server } from 'vitest/browser';

/** The run drives the browser through Playwright (its three engines), not WebDriver (real Safari,
 *  real Firefox). */
export const PLAYWRIGHT: boolean = server.provider === 'playwright';

/** The engine: `chromium`, `firefox`, `webkit` (Playwright) or `safari` / `firefox` (WebDriver). */
export const ENGINE: string = server.browser;

/**
 * A test that drops or holds real downloads through Playwright's network routes (the
 * `drop_downloads` / `hold_downloads` / `keep_downloads` commands). It runs in Playwright's
 * Chromium, Firefox and WebKit; a WebDriver run (real Safari, real Firefox) has no network routes.
 */
export const it_with_network_routes: typeof it = PLAYWRIGHT ? it : (it.skip as typeof it);

/**
 * A test of the Layout Instability API (`PerformanceObserver` type `layout-shift`): Chromium only.
 * Firefox and WebKit do not report layout shifts, so there is nothing to observe there.
 */
export const it_with_layout_shift: typeof it =
	typeof PerformanceObserver !== 'undefined' &&
	PerformanceObserver.supportedEntryTypes?.includes('layout-shift')
		? it
		: (it.skip as typeof it);
