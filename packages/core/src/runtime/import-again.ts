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
 * A leaf: the boot and island-side code (devalue's lane) import it, so it imports nothing.
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

/**
 * `load` (a bundler-resolved `() => import('./x.ts')`), and after it fails to download, the same
 * file under a fresh URL on each later call. Pair it with `once()` from `@ogygia/machine`, which
 * calls it again on a failure and never keeps one.
 */
export function import_again<T>(
	load: () => Promise<T>,
	fresh: (url: string) => Promise<unknown> = (url) => import(/* @vite-ignore */ url)
): () => Promise<T> {
	let failed: string | null = null;
	let attempt = 0;
	return () => {
		if (failed !== null) return fresh(retry_url(failed, ++attempt)) as Promise<T>;
		return load().catch((error: unknown) => {
			failed = failed_import_url(error);
			throw error;
		});
	};
}
