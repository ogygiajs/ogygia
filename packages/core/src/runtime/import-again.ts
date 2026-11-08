/**
 * A LAZY CHUNK THAT FAILED TO DOWNLOAD, ASKED FOR AGAIN. A browser keeps a module whose download
 * failed in its module map for the life of the page: a second `import()` of the same URL fails at
 * once, without a request (Chromium and Firefox both do; the e2e lazy-chunk-retry spec proves it).
 * Retrying the same `import()` therefore does nothing. What works is the same file under a new URL:
 * the failed import's error names the URL, so the next attempt imports it with an `og-retry` query
 * (a static server ignores it; a module never evaluated, so no second copy of its state exists).
 *
 * Safari's error names no URL: there the retry is the plain import again (it fails the same way),
 * so a dropped chunk stays dropped until the page reloads, as before.
 *
 * A leaf: the boot and island-side code (devalue's lane, the entry locations) import it, so it
 * imports nothing.
 */

/** The URL in a failed dynamic import's message: Chromium "Failed to fetch dynamically imported
 *  module: <url>", Firefox "error loading dynamically imported module: <url>". */
const FAILED_IMPORT_RE = /dynamically imported module:?\s+(\S+)/i;

/** The URL a failed dynamic import names, if it names one we can load again (http(s), this origin). */
export function failed_import_url(error: unknown): string | null {
	const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
	const match = FAILED_IMPORT_RE.exec(message);
	if (!match) return null;
	try {
		const url = new URL(match[1], typeof location !== 'undefined' ? location.href : undefined);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		if (typeof location !== 'undefined' && url.origin !== location.origin) return null;
		return url.href;
	} catch {
		return null;
	}
}

/** `url` with its retry mark: a URL the module map has not seen. */
export function retry_url(url: string, attempt: number): string {
	const u = new URL(url);
	u.searchParams.set('og-retry', String(attempt));
	return u.href;
}

/** The status of the response the browser's resource timing holds for `url` (0 where the browser does
 *  not say), or `null` when none came: a download that failed (or no timing for it). */
function response_of(url: string): number | null {
	if (typeof performance === 'undefined' || typeof performance.getEntriesByName !== 'function')
		return null;
	let status: number | null = null;
	for (const e of performance.getEntriesByName(url, 'resource')) {
		const t = e as PerformanceResourceTiming & { responseStatus?: number };
		if (t.responseStart > 0) status = t.responseStatus ?? 0;
	}
	return status;
}

/**
 * `load` (a bundler-resolved `() => import('./x.ts')`), and after it fails to download, the same
 * file under a fresh URL on each later call; once it has loaded, every later call is that load (a
 * fresh URL after a success would be a second copy of the module). Pair it with `once()` from
 * `@ogygia/machine`, which calls it again on a failure and never keeps one.
 */
export function import_again<T>(
	load: () => Promise<T>,
	fresh: (url: string) => Promise<unknown> = (url) => import(/* @vite-ignore */ url)
): () => Promise<T> {
	let failed: string | null = null;
	let attempt = 0;
	let loaded: Promise<T> | null = null;
	return () => {
		if (loaded) return loaded;
		let run: Promise<T>;
		if (failed !== null) run = fresh(retry_url(failed, ++attempt)) as Promise<T>;
		else {
			run = load().catch((error: unknown) => {
				failed = failed_import_url(error);
				throw error;
			});
		}
		run.then(
			() => (loaded = run),
			() => {}
		);
		return run;
	};
}

/** Each file's loader, by URL (an island's own file: its load, and the warm ahead of it). */
const file_loads = new Map<string, () => Promise<unknown>>();

/**
 * The module at `url` (an island's own file), through {@link import_again}: a download that fails is
 * asked for again at once under a fresh URL, and by every later load of that file. A plain
 * `import()` of it once left an island whose file dropped one download dead for the tab (#261). A
 * file the server answered for (a 404 after a deploy) is not asked for again at once: the caller's
 * own recovery (./entry-locations.ts, the current build's file) is what helps there.
 */
export function import_file<T>(url: string): Promise<T> {
	let load = file_loads.get(url);
	if (!load) file_loads.set(url, (load = import_again(() => import(/* @vite-ignore */ url))));
	const again = load;
	return again().catch((error: unknown) => {
		const failed = failed_import_url(error);
		if (failed !== null && response_of(failed) === null) return again();
		throw error;
	}) as Promise<T>;
}
