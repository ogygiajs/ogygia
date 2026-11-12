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

/** WebKit's console line for a fetch that failed at the network (a connection the server dropped,
 *  a request the page's navigation cancelled), whatever the origin. */
const WEBKIT_NETWORK_FAILURE_RE = /^Fetch API cannot load \S+ due to access control checks\.$/;

/**
 * The page's uncaught errors, as they come. Playwright's WebKit reports WebKit's own console line
 * for a fetch that failed at the network ("Fetch API cannot load … due to access control checks.")
 * as a page error even when the page handles the rejection; Chromium and Firefox reject the fetch
 * and say nothing. That line is left out in WebKit, so a spec that expects no page errors holds the
 * page to the same bar in every engine.
 */
export function page_errors(page: Page): string[] {
	const webkit = page.context().browser()?.browserType().name() === 'webkit';
	const errors: string[] = [];
	page.on('pageerror', (e) => {
		// (the stack's first line is the whole console line: the message alone is cut at its `http:`)
		const line = (e.stack ?? '').split('\n')[0] ?? '';
		if (!(webkit && WEBKIT_NETWORK_FAILURE_RE.test(line))) errors.push(e.message);
	});
	return errors;
}

/**
 * Whether the profiler offers its report share link in this engine. WebKit caps a URL far below
 * what a report's link carries, so the report page disables the button there
 * (profiler/ui/ShareLink.svelte: "share the .ogp file"); Chromium and Firefox take it.
 */
export function shares_report_links(page: Page): boolean {
	return page.context().browser()?.browserType().name() !== 'webkit';
}

/**
 * Skips the running test where a navigation to a file sent as an attachment is not a download:
 * Playwright's WebKit on Linux shows the file as the page and reports no `download` event, for a
 * plain `location.href` to it too. Chromium, Firefox and WebKit on macOS (Safari's) download it.
 */
export async function needs_attachment_downloads(page: Page): Promise<void> {
	const engine = page.context().browser()?.browserType().name();
	const platform = engine === 'webkit' ? await page.evaluate(() => navigator.platform) : '';
	test.skip(
		platform.startsWith('Linux'),
		'needs a navigation to an attachment to download: WebKit on Linux shows it as the page'
	);
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
