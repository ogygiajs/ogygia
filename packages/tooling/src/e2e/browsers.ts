// The few e2e specs that cannot run in every engine say why, here: never a bare skip.
import { test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * A console message's text the same in every engine: each argument's own text, an Error's message
 * (its code's link with it). Playwright's `text()` serializes an Error argument per engine: Chromium
 * writes its message, Firefox only its class.
 */
export async function console_text(m: ConsoleMessage): Promise<string> {
	const parts = await Promise.all(
		m.args().map(
			(a) =>
				a
					.evaluate((v) => (v instanceof Error ? `${v.name}: ${v.message}` : String(v)))
					.catch(() => '') // ok: an argument of a page that left: its text is gone with it
		)
	);
	return parts.length ? parts.join(' ') : m.text();
}

/** Skips the running test outside Chromium: it reads the page's own CPU samples through the JS
 *  Self-Profiling API (`new Profiler()` under `Document-Policy: js-profiling`), which only
 *  Chromium has. */
export function needs_js_self_profiling(page: Page): void {
	const engine = page.context().browser()?.browserType().name();
	test.skip(
		engine !== 'chromium',
		'needs the JS Self-Profiling API (the browser CPU samples): Chromium only'
	);
}

/**
 * The requests a page's hole preloads (`<link rel="preload" as="fetch">`, one per hole address)
 * add in this engine: `per_page` in WebKit, which never hands a fetch preload to a later `fetch()`
 * (every crossorigin, credentials and Cache-Control: the runtime's fetch asks again, #404), and 0
 * in Chromium and Firefox, which reuse it. A spec that counts a hole's requests or renders adds
 * this, so it stays exact about retries in every engine.
 */
export function unused_fetch_preloads(page: Page, per_page = 1): number {
	return page.context().browser()?.browserType().name() === 'webkit' ? per_page : 0;
}

/** Skips the running test outside Chromium: it drives the Chrome DevTools Protocol (CPU and
 *  network throttling), which Firefox and WebKit do not speak. */
export function needs_cdp(page: Page): void {
	const engine = page.context().browser()?.browserType().name();
	test.skip(
		engine !== 'chromium',
		'needs the Chrome DevTools Protocol (CPU and network throttling): Chromium only'
	);
}
