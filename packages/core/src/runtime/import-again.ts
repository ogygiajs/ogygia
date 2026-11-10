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
 * One failure no URL fixes: a static dependency of the chunk that failed. The error names the chunk
 * all the same, and the chunk under a fresh URL imports the dependency's own URL, which the browser
 * keeps failed: every retry fails the same way (#262). Told apart by the retry itself — it failed,
 * yet its own file came (the browser's resource timing holds its response): asking again cannot
 * help, so the loader stops asking, and the page says once that it needs a reload.
 *
 * A leaf: the boot and island-side code (devalue's lane, the entry locations) import it, so it
 * imports nothing of the boot (only `@ogygia/machine`, which the boot runs on); the boot hands it
 * its message (`on_reload_needed`).
 */
import { flights, machine, say, scope, STALE } from '@ogygia/machine';

/** How long a failed import waits for its file's timing entry before it reads as "no response". */
const ENTRY_WAIT_MS = 1000;

/**
 * The resource-timing entries for `url` once the browser has one, or none after
 * {@link ENTRY_WAIT_MS}. An engine can reject a failed import before the entry lands, and later
 * than one task: Firefox on a loaded machine. Chromium and Firefox give every download an entry (a
 * dropped one too, with a status of 0); WebKit gives a dropped one none, so only there the wait
 * runs out. Its own scope: it ends itself, and no page's visit owns a file's load.
 */
function entries_landed(url: string): Promise<readonly PerformanceEntry[]> {
	if (typeof PerformanceObserver === 'undefined') return Promise.resolve([]);
	const wait = scope();
	return new Promise<readonly PerformanceEntry[]>((resolve) => {
		const done = (entries: readonly PerformanceEntry[]) => {
			wait.close();
			resolve(entries);
		};
		// (buffered: an entry already in the timeline is delivered at once)
		wait
			.watch(
				new PerformanceObserver((list) => {
					const entries = list.getEntriesByName(url);
					if (entries.length > 0) done(entries);
				})
			)
			.observe({ type: 'resource', buffered: true });
		wait.timeout(() => done([]), ENTRY_WAIT_MS);
	});
}

/** The URL in a failed dynamic import's message: Chromium "Failed to fetch dynamically imported
 *  module: <url>", Firefox "error loading dynamically imported module: <url>". */
const FAILED_IMPORT_RE = /dynamically imported module:?\s+(\S+)/i;
/** WebKit's (Safari's) failed import, which names no URL: "Importing a module script failed." */
const WEBKIT_IMPORT_FAILED_RE = /^importing a module script failed\.?$/i;

/** Whether `error` is a dynamic import that failed to load (any engine's wording), not an error the
 *  module threw as it ran. */
export function is_failed_import(error: unknown): boolean {
	const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
	return FAILED_IMPORT_RE.test(message) || WEBKIT_IMPORT_FAILED_RE.test(message);
}

/**
 * The URL a failed dynamic import names, if it names one we can load again (http(s), this origin).
 * WebKit names none: there `known`, the file the caller imported, is it (#383).
 */
export function failed_import_url(error: unknown, known?: string): string | null {
	const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
	const match = FAILED_IMPORT_RE.exec(message);
	const named = match
		? match[1]
		: known !== undefined && WEBKIT_IMPORT_FAILED_RE.test(message)
			? known
			: null;
	if (named === null) return null;
	try {
		const url = new URL(named, typeof location !== 'undefined' ? location.href : undefined);
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
export function response_of(url: string): number | null {
	if (typeof performance === 'undefined' || typeof performance.getEntriesByName !== 'function')
		return null;
	return status_of(performance.getEntriesByName(url, 'resource'));
}

/** {@link response_of}, read from `entries` (one file's resource-timing entries). */
function status_of(entries: readonly PerformanceEntry[]): number | null {
	let status: number | null = null;
	for (const e of entries) {
		const t = e as PerformanceResourceTiming & { responseStatus?: number };
		// An engine that reports the status says 0 for a download that got no response (Firefox
		// gives a dropped one a response start too); one that does not (WebKit) is read by its
		// response start alone.
		if (typeof t.responseStatus === 'number') {
			if (t.responseStatus > 0) status = t.responseStatus;
		} else if (t.responseStart > 0) status = 0;
	}
	return status;
}

/** What the page says when a chunk cannot load until it reloads: the boot's message (./core.ts). */
let say_reload_needed: (url: string, error: unknown) => void = () => {};
/** Said once per page (for the first such chunk: one reload loads them all). */
const reload = say({ max: 1 });
/** The boot hands over its message for a chunk no retry can load. */
export function on_reload_needed(say: (url: string, error: unknown) => void): void {
	say_reload_needed = say;
}

/**
 * `load` (a bundler-resolved `() => import('./x.ts')`), and after it fails to download, the same
 * file under a fresh URL on each later call; once it has loaded, every later call is that load (a
 * fresh URL after a success would be a second copy of the module). A retry whose own file came and
 * still failed is a dependency's failure, which no URL fixes: from then on every call fails at once
 * with its error, asking nothing. Pair it with `flights()` from `@ogygia/machine`, which calls it
 * again on a failure and never keeps one.
 */
export function import_again<T>(
	load: () => Promise<T>,
	fresh: (url: string) => Promise<unknown> = (url) => import(/* @vite-ignore */ url),
	/** The file `load` imports, when the caller knows it: what a failure that names no URL (WebKit)
	 *  failed to load. */
	known?: string
): () => Promise<T> {
	const file = file_definition.create();
	return () => {
		const s = file.now;
		if (s.kind === 'loaded') return s.run as Promise<T>;
		if (s.kind === 'stuck') return Promise.reject(s.error);
		let run: Promise<T>;
		if (s.kind === 'failed') {
			// (each retry its own URL, counted as it starts: two calls at once ask under two)
			const attempt = s.attempt + 1;
			file.go('failed', { url: s.url, attempt });
			const url = retry_url(s.url, attempt);
			run = (fresh(url) as Promise<T>).catch((error: unknown) => {
				const status = response_of(url);
				// its own file came, and it still failed: a dependency's failure, which no URL fixes
				if (status !== null && status < 400 && file.move('failed', 'stuck', { error })) {
					reload.once('reload', () => say_reload_needed(url, error));
				}
				throw error;
			});
		} else {
			run = load().catch((error: unknown) => {
				const url = failed_import_url(error, known);
				// (a failure that names no URL: the next call loads the same way again)
				if (url !== null) file.move('fresh', 'failed', { url, attempt: 0 });
				throw error;
			});
		}
		run.then(
			() => {
				if (file.now.kind !== 'loaded') file.go('loaded', { run });
			},
			() => {}
		); // ok: the failure is the caller's: `run` itself is returned and rejects to it
		return run;
	};
}

/**
 * One file's loads, as a machine:
 *
 *   fresh ─ failed{url, attempt} ⟲ ─ loaded{run}
 *     ╲──────────────────────────╱ ╲ stuck{error}
 *
 * `fresh`: nothing failed yet (or a failure named no URL): a call loads the bundler's way. `failed`:
 * a download failed; each call asks under a fresh URL. `loaded`: a load landed, and every later call
 * is that load (a fresh URL after a success would be a second copy of the module). `stuck`: a retry's
 * own file came and it still failed, a dependency's failure: every later call fails at once with it.
 */
const file_definition = machine<{
	fresh: {};
	failed: { url: string; attempt: number };
	loaded: { run: Promise<unknown> };
	stuck: { error: unknown };
}>()({
	name: 'import-again',
	initial: 'fresh',
	steps: {
		fresh: ['failed', 'loaded'],
		failed: ['failed', 'loaded', 'stuck'],
		loaded: [],
		// (a retry already out when another got stuck may still land: the file loaded after all)
		stuck: ['loaded']
	}
});

/** Each file's loader, by URL (an island's own file: its load, and the warm ahead of it): what it
 *  asks for next (the file, or a fresh URL after a failed download). */
const file_loaders = new Map<string, () => Promise<unknown>>();

/** One load of each file at a time, kept once it lands: loads of one file that fail together share
 *  one retry, so a failure gets one fresh URL and the module runs once (#271). */
const file_loads = flights({
	name: 'island file',
	run: (url: string) => {
		let again = file_loaders.get(url);
		if (!again)
			file_loaders.set(
				url,
				(again = import_again(() => import(/* @vite-ignore */ url), undefined, url))
			);
		const load = again;
		return load().catch(async (error: unknown) => {
			const failed = failed_import_url(error, url);
			if (failed === null) throw error;
			// (an engine can reject the import before the response's timing entry is in the timeline:
			// Firefox on a loaded machine, by more than one task)
			const status = response_of(failed) ?? status_of(await entries_landed(failed));
			if (status === null) return load();
			throw error;
		});
	}
});

/**
 * The module at `url` (an island's own file), through {@link import_again}: a download that fails is
 * asked for again at once under a fresh URL, and by every later load of that file. A plain
 * `import()` of it once left an island whose file dropped one download dead for the tab (#261). A
 * file the server answered for (a 404 after a deploy) is not asked for again at once: the caller's
 * own recovery (./entry-locations.ts, the current build's file) is what helps there.
 */
export function import_file<T>(url: string): Promise<T> {
	// (nothing drops a file's load, so it is never STALE; were it, it is asked for again)
	return file_loads.get(url).then((m) => (m === STALE ? import_file<T>(url) : (m as T)));
}
