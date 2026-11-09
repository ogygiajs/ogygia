// WHICH BROWSER A BROWSER TEST RUNS IN, and the few tests that cannot run in every one. Each mark
// names what the test needs and why the other browsers cannot give it: never a bare skip. The PR
// that adds a mark lists it.
import { it } from 'vitest';
import { server } from 'vitest/browser';

/** The run drives the browser through Playwright (its three engines), not WebDriver (the released
 *  Firefox). */
export const PLAYWRIGHT: boolean = server.provider === 'playwright';

/** The engine: `chromium`, `firefox` or `webkit`. */
export const ENGINE: string = server.browser;

/**
 * A test that drops or holds real downloads through Playwright's network routes (the
 * `drop_downloads` / `hold_downloads` / `keep_downloads` commands). It runs in Playwright's
 * Chromium, Firefox and WebKit; the WebDriver run (the released Firefox) has no network routes.
 */
export const it_with_network_routes: typeof it = PLAYWRIGHT ? it : (it.skip as typeof it);

/**
 * A test that recovers a runtime lazy chunk (a bundler-resolved `import()`) after a failed download.
 * WebKit names no URL on a failed import (no message URL, no resource-timing entry) and keeps the
 * module failed, so nothing at runtime knows which file to ask for again: tracked in #385 (the
 * build has to hand each lazy loader its file). Runs with the network routes, outside WebKit.
 */
export const it_with_named_import_failures: typeof it =
	PLAYWRIGHT && ENGINE !== 'webkit' ? it : (it.skip as typeof it);

/**
 * A simulation that writes browser history thousands of times in seconds. WebKit throws on more
 * than 100 history writes per 10 s, and Firefox throws too past its own budget ("The operation is
 * insecure"): a page's budget, shared by every test file in it. The runtime writes at most two per
 * navigation, and none on a back or forward step, so a real page never reaches it; the router's
 * own history tests run in both.
 */
export const it_with_history_unthrottled: typeof it =
	ENGINE === 'chromium' ? it : (it.skip as typeof it);

/**
 * A test of the Layout Instability API (`PerformanceObserver` type `layout-shift`): Chromium only.
 * Firefox and WebKit do not report layout shifts, so there is nothing to observe there.
 */
export const it_with_layout_shift: typeof it =
	typeof PerformanceObserver !== 'undefined' &&
	PerformanceObserver.supportedEntryTypes?.includes('layout-shift')
		? it
		: (it.skip as typeof it);
