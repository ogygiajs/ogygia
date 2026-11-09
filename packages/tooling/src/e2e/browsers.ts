// The few e2e specs that cannot run in every engine say why, here: never a bare skip.
import { test, type Page } from '@playwright/test';

/** Skips the running test outside Chromium: it drives the Chrome DevTools Protocol (CPU and
 *  network throttling), which Firefox and WebKit do not speak. */
export function needs_cdp(page: Page): void {
	const engine = page.context().browser()?.browserType().name();
	test.skip(
		engine !== 'chromium',
		'needs the Chrome DevTools Protocol (CPU and network throttling): Chromium only'
	);
}
